import fc from 'fast-check';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type * as ChatNamespace from '../src/handlers/chat';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema, ChatRequestSchema } from '@tutor-agent/shared';
import { fragments, MOCK_TUTOR_REPLY, SIMULATE_ERROR_TRIGGER, SIMULATED_ERROR_MESSAGE } from '../src/lib/mock-tutor';
import {
  FakeResponseStream,
  installAwsLambdaStub,
  parseSse,
  type ResponseMetadata,
} from './helpers/chat';
import { makeContext, postEvent, ROUTES, spyOnLogs, TEST_REQUEST_ID } from './helpers/events';
import { assertNoSolutionLeak } from './helpers/leak';

// Type-only import: the runtime import happens after the `awslambda` stub is installed.
type ChatModule = typeof ChatNamespace;

let chat: ChatModule;
let metadata: ResponseMetadata[];
let logs: ReturnType<typeof spyOnLogs>;

const noWait = { tokenDelayMs: 0, sleep: () => Promise.resolve() };
const validBody = { sessionId: 'sess-body', exerciseId: 'm03-e01', message: 'Hola, ¿me ayudas?' };

beforeAll(async () => {
  // `chat.ts` calls `awslambda.streamifyResponse` at import time, so stub first.
  metadata = installAwsLambdaStub();
  chat = await import('../src/handlers/chat');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  metadata.length = 0;
  logs = spyOnLogs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function invoke(
  event: APIGatewayProxyEvent,
  options: Parameters<ChatModule['chatHandler']>[3] = noWait,
): Promise<FakeResponseStream> {
  const stream = new FakeResponseStream();
  await chat.chatHandler(event, stream.asWritable(), makeContext(), options);
  return stream;
}

describe('chat handler: valid requests', () => {
  it('streams 200 text/event-stream with token events and exactly one done event', async () => {
    const stream = await invoke(postEvent(ROUTES.chat, validBody));

    expect(metadata).toHaveLength(1);
    expect(metadata[0]?.statusCode).toBe(200);
    expect(metadata[0]?.headers).toMatchObject({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

    const frames = parseSse(stream.output);
    const events = frames.map((frame) => frame.event);
    expect(events.length).toBe(fragments().length + 1);
    expect(events.slice(0, -1).every((event) => event.event === 'token')).toBe(true);
    expect(events.at(-1)).toEqual({ event: 'done', data: {} });
    // Tokens reassemble into the full fixed reply.
    const text = events.flatMap((event) => (event.event === 'token' ? [event.data.text] : [])).join('');
    expect(text).toBe(MOCK_TUTOR_REPLY);
    expect(stream.ended).toBe(true);
    expect(stream.writesAfterEnd).toBe(0);
    assertNoSolutionLeak(stream.output);
  });

  it('frames follow `event: <name>\\ndata: <json>\\n\\n` exactly', async () => {
    const stream = await invoke(postEvent(ROUTES.chat, validBody));

    const first = stream.chunks[0];
    expect(first).toMatch(/^event: token\ndata: \{"text":".*"\}\n\n$/s);
    expect(stream.chunks.at(-1)).toBe('event: done\ndata: {}\n\n');
  });

  it('does not wait before the first token, only between tokens', async () => {
    const waits: number[] = [];
    await invoke(postEvent(ROUTES.chat, validBody), {
      tokenDelayMs: 7,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    expect(waits).toHaveLength(fragments().length - 1);
    expect(waits.every((ms) => ms === 7)).toBe(true);
  });

  it('with `__simulate_error__` emits some tokens, one error event, then nothing', async () => {
    const stream = await invoke(postEvent(ROUTES.chat, { ...validBody, message: SIMULATE_ERROR_TRIGGER }));

    expect(metadata[0]?.statusCode).toBe(200);
    const events = parseSse(stream.output).map((frame) => frame.event);
    const terminal = events.at(-1);
    expect(events.slice(0, -1).length).toBeGreaterThan(0);
    expect(events.slice(0, -1).every((event) => event.event === 'token')).toBe(true);
    expect(terminal).toEqual({ event: 'error', data: { message: SIMULATED_ERROR_MESSAGE } });
    expect(events.filter((event) => event.event !== 'token')).toHaveLength(1);
    expect(stream.ended).toBe(true);
    expect(stream.writesAfterEnd).toBe(0);
  });

  it('closes with a single error event when a failure happens mid-stream', async () => {
    let calls = 0;
    const stream = await invoke(postEvent(ROUTES.chat, validBody), {
      tokenDelayMs: 0,
      sleep: () => {
        calls += 1;
        return calls === 3 ? Promise.reject(new Error('boom internal detail')) : Promise.resolve();
      },
    });

    const events = parseSse(stream.output).map((frame) => frame.event);
    expect(events.filter((event) => event.event === 'token')).toHaveLength(3);
    expect(events.at(-1)?.event).toBe('error');
    expect(events.filter((event) => event.event !== 'token')).toHaveLength(1);
    expect(stream.output).not.toContain('boom internal detail');
    expect(stream.ended).toBe(true);
    expect(stream.writesAfterEnd).toBe(0);
    expect(logs.lines().at(-1)).toMatchObject({ status: 200, streamOutcome: 'error' });
  });

  it('Property 4: any accepted message yields token* then exactly one terminal event, nothing after', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.string({ minLength: 1, maxLength: 200 }).filter((message) => message.trim().length > 0),
          fc.constant(SIMULATE_ERROR_TRIGGER),
        ),
        async (message) => {
          const stream = await invoke(postEvent(ROUTES.chat, { ...validBody, message }));

          const events = parseSse(stream.output).map((frame) => frame.event);
          const terminalIndexes = events.flatMap((event, index) => (event.event === 'token' ? [] : [index]));
          expect(terminalIndexes).toEqual([events.length - 1]);
          expect(events.at(-1)?.event).toBe(message === SIMULATE_ERROR_TRIGGER ? 'error' : 'done');
          expect(stream.ended).toBe(true);
          expect(stream.writesAfterEnd).toBe(0);
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe('chat handler: invalid requests never open a stream (Property 3)', () => {
  const invalidBodies: [string, unknown][] = [
    ['missing body', null],
    ['empty body', ''],
    ['malformed JSON', '{not json'],
    ['JSON array', []],
    ['JSON string', '"hola"'],
    ['missing message', { sessionId: 's', exerciseId: 'm03-e01' }],
    ['missing sessionId', { exerciseId: 'm03-e01', message: 'hola' }],
    ['missing exerciseId', { sessionId: 's', message: 'hola' }],
    ['empty message', { ...validBody, message: '' }],
    ['whitespace-only message', { ...validBody, message: '   \n  ' }],
    ['message over 2000 characters', { ...validBody, message: 'a'.repeat(2001) }],
    ['empty sessionId', { ...validBody, sessionId: '' }],
    ['sessionId over 128 characters', { ...validBody, sessionId: 's'.repeat(129) }],
    ['exerciseId over 64 characters', { ...validBody, exerciseId: 'e'.repeat(65) }],
    ['non-string message', { ...validBody, message: 42 }],
  ];

  it.each(invalidBodies)('%s -> 400 JSON ApiError', async (_name, body) => {
    const stream = await invoke(postEvent(ROUTES.chat, body));

    expect(metadata).toHaveLength(1);
    expect(metadata[0]?.statusCode).toBe(400);
    expect(metadata[0]?.headers?.['Content-Type']).toContain('application/json');
    expect(metadata[0]?.headers?.['Content-Type']).not.toContain('text/event-stream');
    expect(ApiErrorSchema.parse(JSON.parse(stream.output))).toMatchObject({ code: 'invalid_request' });
    expect(stream.output).not.toContain('event:');
    expect(stream.ended).toBe(true);
    assertNoSolutionLeak(stream.output);
  });

  it('accepts a message of exactly 2000 characters', async () => {
    const stream = await invoke(postEvent(ROUTES.chat, { ...validBody, message: 'a'.repeat(2000) }));

    expect(metadata[0]?.statusCode).toBe(200);
    expect(parseSse(stream.output).at(-1)?.event.event).toBe('done');
  });

  it('body over 64 KB -> 413 JSON payload_too_large', async () => {
    const stream = await invoke(postEvent(ROUTES.chat, { ...validBody, message: 'a'.repeat(70 * 1024) }));

    expect(metadata[0]?.statusCode).toBe(413);
    expect(metadata[0]?.headers?.['Content-Type']).toContain('application/json');
    expect(ApiErrorSchema.parse(JSON.parse(stream.output)).code).toBe('payload_too_large');
    expect(stream.output).not.toContain('event:');
  });

  it('Property 3: any JSON value that fails ChatRequest gives 400 JSON and never an SSE stream', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.jsonValue().filter((value) => !ChatRequestSchema.safeParse(value).success),
        async (value) => {
          metadata.length = 0;
          const stream = await invoke(postEvent(ROUTES.chat, JSON.stringify(value)));

          expect(metadata).toHaveLength(1);
          expect(metadata[0]?.statusCode).toBe(400);
          expect(metadata[0]?.headers?.['Content-Type']).not.toContain('text/event-stream');
          expect(ApiErrorSchema.safeParse(JSON.parse(stream.output)).success).toBe(true);
          expect(stream.output).not.toContain('event:');
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('chat handler: logs, CORS and exports', () => {
  it('logs the body sessionId (over the header), route, method, status, latency and request id', async () => {
    await invoke(postEvent(ROUTES.chat, validBody, { 'X-Session-Id': 'sess-header' }));

    const lines = logs.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      sessionId: 'sess-body',
      route: '/api/chat',
      method: 'POST',
      status: 200,
      requestId: TEST_REQUEST_ID,
      streamOutcome: 'done',
    });
    expect(typeof lines[0]?.['latencyMs']).toBe('number');
  });

  it('logs the header sessionId when the body is invalid, and "anonymous" when there is none', async () => {
    await invoke(postEvent(ROUTES.chat, { nope: true }, { 'X-Session-Id': 'sess-header' }));
    await invoke(postEvent(ROUTES.chat, { nope: true }));

    const lines = logs.lines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ sessionId: 'sess-header', status: 400, route: '/api/chat', method: 'POST' });
    expect(lines[1]).toMatchObject({ sessionId: 'anonymous', status: 400, requestId: TEST_REQUEST_ID });
  });

  it('logs 413 for oversized bodies, using the header session (oversized bodies are not parsed)', async () => {
    await invoke(
      postEvent(ROUTES.chat, { ...validBody, message: 'a'.repeat(70 * 1024) }, { 'X-Session-Id': 'sess-header' }),
    );

    expect(logs.lines()[0]).toMatchObject({ status: 413, sessionId: 'sess-header', route: '/api/chat' });
  });

  it('echoes an allowed origin and omits CORS for a disallowed one (stream and error responses)', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', 'http://localhost:5173,https://d111.cloudfront.net');
    const allowed = { Origin: 'http://localhost:5173' };
    const denied = { Origin: 'https://evil.example.com' };

    await invoke(postEvent(ROUTES.chat, validBody, allowed));
    await invoke(postEvent(ROUTES.chat, validBody, denied));
    await invoke(postEvent(ROUTES.chat, { nope: true }, allowed));
    await invoke(postEvent(ROUTES.chat, { nope: true }, denied));

    expect(metadata[0]?.headers?.['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(metadata[1]?.headers).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(metadata[2]?.headers?.['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(metadata[3]?.headers).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  it('exports `handler` as the streamified function (identity in the stub)', () => {
    expect(typeof chat.handler).toBe('function');
  });
});
