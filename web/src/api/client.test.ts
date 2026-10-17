import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest } from '@tutor-agent/shared';
import type * as ClientModule from './client';

const SESSION_KEY = 'tutor-agent.sessionId';

const chatRequest: ChatRequest = { sessionId: 'session-1', exerciseId: 'm03-e01', message: 'Hola' };

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const moduleFixture = { id: 'modulo-03-condicionales', title: 'Condicionales', exerciseCount: 3 };
const lessonFixture = { moduleId: 'modulo-03-condicionales', title: 'Condicionales', markdown: '# Hola' };
const exerciseFixture = {
  id: 'm03-e01',
  moduleId: 'modulo-03-condicionales',
  title: 'Clasifica edades',
  statement: 'Escribe una función.',
  difficulty: 1,
  starterCode: 'def clasificar(edad):\n    pass\n',
  hintsAvailable: 3,
};
const hintFixture = { level: 1, text: 'Piensa en los rangos.' };
const runFixture = { passed: false, tests: [{ name: 'menor de edad', passed: false }], stdout: '', stderr: '' };
const progressFixture = { completedExerciseIds: ['m03-e01'], totalExercises: 3 };

const encoder = new TextEncoder();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Builds a `text/event-stream` response whose body emits the given text chunks. */
function sseResponse(chunks: string[], onCancel?: () => void): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(chunk));
      }
    },
    cancel() {
      onCancel?.();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const tokenFrame = (text: string): string => `event: token\ndata: ${JSON.stringify({ text })}\n\n`;
const doneFrame = 'event: done\ndata: {}\n\n';

/** Mocks `fetch` and returns the mock. The factory runs once per call. */
function mockFetch(factory: (input: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const mock = vi.fn<typeof fetch>((input, init) => Promise.resolve(factory(String(input), init)));
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Mocks `fetch` so it rejects with an `AbortError` as soon as the request signal aborts. */
function mockAbortableFetch() {
  const mock = vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (signal?.aborted) {
          fail();
        } else {
          signal?.addEventListener('abort', fail, { once: true });
        }
      }),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

function callArgs(mock: ReturnType<typeof mockFetch>, index = 0): { url: string; init: RequestInit } {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`fetch call ${index} was not made`);
  return { url: String(call[0]), init: call[1] ?? {} };
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

function makeHandlers() {
  return { onToken: vi.fn<(text: string) => void>(), onDone: vi.fn<() => void>(), onError: vi.fn<(m: string) => void>() };
}

/** Loads a fresh copy of the client so its module-level session state is reset. */
async function loadClient(): Promise<typeof ClientModule> {
  vi.resetModules();
  return import('./client');
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubEnv('VITE_API_URL', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('URL building', () => {
  it('uses relative /api paths when VITE_API_URL is empty', async () => {
    const { getModules } = await loadClient();
    const fetchMock = mockFetch(() => jsonResponse([moduleFixture]));

    await getModules();

    expect(callArgs(fetchMock).url).toBe('/api/modules');
  });

  it('uses relative /api paths when VITE_API_URL is unset', async () => {
    vi.stubEnv('VITE_API_URL', undefined);
    const { getModules } = await loadClient();
    const fetchMock = mockFetch(() => jsonResponse([moduleFixture]));

    await getModules();

    expect(callArgs(fetchMock).url).toBe('/api/modules');
  });

  it.each([
    ['https://api.example.com', 'https://api.example.com/api/modules'],
    ['https://api.example.com/', 'https://api.example.com/api/modules'],
    ['https://api.example.com///', 'https://api.example.com/api/modules'],
    ['  https://api.example.com/  ', 'https://api.example.com/api/modules'],
    ['https://example.com/prod/', 'https://example.com/prod/api/modules'],
  ])('prefixes VITE_API_URL %j without duplicating slashes', async (base, expected) => {
    vi.stubEnv('VITE_API_URL', base);
    const { getModules } = await loadClient();
    const fetchMock = mockFetch(() => jsonResponse([moduleFixture]));

    await getModules();

    expect(callArgs(fetchMock).url).toBe(expected);
  });

  it('URI-encodes path ids', async () => {
    const { getLesson, getExercise } = await loadClient();
    const fetchMock = mockFetch((url) =>
      url.includes('/lesson') ? jsonResponse(lessonFixture) : jsonResponse(exerciseFixture),
    );

    await getLesson('módulo 3/x?');
    await getExercise('a b/../c#d');

    expect(callArgs(fetchMock, 0).url).toBe('/api/modules/m%C3%B3dulo%203%2Fx%3F/lesson');
    expect(callArgs(fetchMock, 1).url).toBe('/api/exercises/a%20b%2F..%2Fc%23d');
  });

  it('calls the documented endpoints with the right method and JSON body', async () => {
    const { getProgress, postHint, postRun } = await loadClient();
    const fetchMock = mockFetch((url) => {
      if (url === '/api/hint') return jsonResponse(hintFixture);
      if (url === '/api/run') return jsonResponse(runFixture);
      return jsonResponse(progressFixture);
    });

    await postHint({ exerciseId: 'm03-e01', level: 1 });
    await postRun({ exerciseId: 'm03-e01', code: 'print(1)' });
    await getProgress();

    const hint = callArgs(fetchMock, 0);
    expect(hint.url).toBe('/api/hint');
    expect(hint.init.method).toBe('POST');
    expect(JSON.parse(String(hint.init.body))).toEqual({ exerciseId: 'm03-e01', level: 1 });
    expect(headersOf(hint.init)['Content-Type']).toBe('application/json');

    const run = callArgs(fetchMock, 1);
    expect(run.url).toBe('/api/run');
    expect(run.init.method).toBe('POST');
    expect(JSON.parse(String(run.init.body))).toEqual({ exerciseId: 'm03-e01', code: 'print(1)' });

    const progress = callArgs(fetchMock, 2);
    expect(progress.url).toBe('/api/progress');
    expect(progress.init.method).toBe('GET');
    expect(progress.init.body).toBeUndefined();
  });

  it('returns validated data from every JSON endpoint', async () => {
    const client = await loadClient();
    mockFetch((url) => {
      if (url === '/api/modules') return jsonResponse([moduleFixture]);
      if (url.endsWith('/lesson')) return jsonResponse(lessonFixture);
      if (url.startsWith('/api/exercises/')) return jsonResponse(exerciseFixture);
      if (url === '/api/hint') return jsonResponse(hintFixture);
      if (url === '/api/run') return jsonResponse(runFixture);
      return jsonResponse(progressFixture);
    });

    expect(await client.getModules()).toEqual([moduleFixture]);
    expect(await client.getLesson('m')).toEqual(lessonFixture);
    expect(await client.getExercise('e')).toEqual(exerciseFixture);
    expect(await client.postHint({ exerciseId: 'e', level: 1 })).toEqual(hintFixture);
    expect(await client.postRun({ exerciseId: 'e', code: '' })).toEqual(runFixture);
    expect(await client.getProgress()).toEqual(progressFixture);
  });
});

describe('X-Session-Id header', () => {
  it('is sent on JSON requests and stored in sessionStorage', async () => {
    const { getModules } = await loadClient();
    const fetchMock = mockFetch(() => jsonResponse([moduleFixture]));

    await getModules();

    const sent = headersOf(callArgs(fetchMock).init)['X-Session-Id'];
    expect(sent).toBeTruthy();
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe(sent);
  });

  it('is stable across calls, including streamChat', async () => {
    const { getModules, getProgress, streamChat } = await loadClient();
    const fetchMock = mockFetch((url) =>
      url === '/api/chat' ? sseResponse([doneFrame]) : jsonResponse(url === '/api/modules' ? [] : progressFixture),
    );

    await getModules();
    await getProgress();
    await streamChat(chatRequest, makeHandlers());

    const ids = [0, 1, 2].map((i) => headersOf(callArgs(fetchMock, i).init)['X-Session-Id']);
    expect(ids[0]).toBeTruthy();
    expect(new Set(ids).size).toBe(1);
  });

  it('reuses the id already stored in sessionStorage after a reload', async () => {
    window.sessionStorage.setItem(SESSION_KEY, 'stored-id');
    const { getModules, getSessionId } = await loadClient();
    const fetchMock = mockFetch(() => jsonResponse([]));

    await getModules();

    expect(getSessionId()).toBe('stored-id');
    expect(headersOf(callArgs(fetchMock).init)['X-Session-Id']).toBe('stored-id');
  });

  it('keeps the id in memory when sessionStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const { getSessionId } = await loadClient();

    const first = getSessionId();
    expect(first).toBeTruthy();
    expect(getSessionId()).toBe(first);
  });
});

describe('JSON error handling', () => {
  it('throws kind "schema" when the body does not match the contract', async () => {
    const { getModules } = await loadClient();
    mockFetch(() => jsonResponse([{ id: 1 }]));

    await expect(getModules()).rejects.toMatchObject({ name: 'ApiClientError', kind: 'schema' });
  });

  it('throws kind "schema" when the body has the wrong top-level shape', async () => {
    const { getModules, getProgress } = await loadClient();
    mockFetch((url) => jsonResponse(url === '/api/modules' ? { not: 'an array' } : { completedExerciseIds: 'x' }));

    await expect(getModules()).rejects.toMatchObject({ kind: 'schema' });
    await expect(getProgress()).rejects.toMatchObject({ kind: 'schema' });
  });

  it('throws kind "schema" when a 200 body is not JSON', async () => {
    const { getProgress } = await loadClient();
    mockFetch(() => new Response('<html>oops</html>', { status: 200 }));

    await expect(getProgress()).rejects.toMatchObject({ kind: 'schema', status: 200 });
  });

  it('throws kind "http" with the parsed ApiError on a non-2xx response', async () => {
    const { getExercise, ApiClientError } = await loadClient();
    const apiError = { code: 'not_found', message: 'Exercise not found' };
    mockFetch(() => jsonResponse(apiError, 404));

    const error = await getExercise('nope').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ kind: 'http', status: 404, apiError });
    expect((error as InstanceType<typeof ApiClientError>).retryable).toBe(false);
  });

  it('throws kind "http" without apiError when the error body is not a valid ApiError', async () => {
    const { postRun } = await loadClient();
    mockFetch(() => new Response('Bad gateway', { status: 502 }));

    const error = (await postRun({ exerciseId: 'e', code: '' }).catch((e: unknown) => e)) as {
      kind: string;
      status: number;
      apiError?: unknown;
      retryable: boolean;
    };

    expect(error).toMatchObject({ kind: 'http', status: 502, retryable: true });
    expect(error.apiError).toBeUndefined();
  });

  it('does not leak server internals in the message', async () => {
    const { getProgress } = await loadClient();
    mockFetch(() => jsonResponse({ code: 'internal_error', message: 'secret stack trace' }, 500));

    const error = (await getProgress().catch((e: unknown) => e)) as Error;

    expect(error.message).not.toContain('secret stack trace');
  });

  it('throws kind "network" when fetch rejects', async () => {
    const { getModules } = await loadClient();
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    const error = (await getModules().catch((e: unknown) => e)) as { kind: string; retryable: boolean };

    expect(error).toMatchObject({ kind: 'network', retryable: true });
  });

  it('throws kind "aborted" when the signal aborts a JSON request', async () => {
    const { getModules } = await loadClient();
    mockAbortableFetch();
    const controller = new AbortController();

    const pending = getModules({ signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'ApiClientError', kind: 'aborted' });
  });

  it('throws kind "aborted" when the signal is already aborted', async () => {
    const { getProgress } = await loadClient();
    mockAbortableFetch();
    const controller = new AbortController();
    controller.abort();

    await expect(getProgress({ signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('passes the signal to fetch', async () => {
    const { getModules } = await loadClient();
    const fetchMock = mockFetch(() => jsonResponse([]));
    const controller = new AbortController();

    await getModules({ signal: controller.signal });

    expect(callArgs(fetchMock).init.signal).toBe(controller.signal);
  });
});

describe('streamChat', () => {
  it('posts the request with SSE headers', async () => {
    const { streamChat } = await loadClient();
    const fetchMock = mockFetch(() => sseResponse([doneFrame]));

    await streamChat(chatRequest, makeHandlers());

    const { url, init } = callArgs(fetchMock);
    expect(url).toBe('/api/chat');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(chatRequest);
    const headers = headersOf(init);
    expect(headers['Accept']).toBe('text/event-stream');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Session-Id']).toBeTruthy();
  });

  it('delivers tokens in order and then done', async () => {
    const { streamChat } = await loadClient();
    mockFetch(() => sseResponse([tokenFrame('Hola'), tokenFrame(', '), tokenFrame('mundo'), doneFrame]));
    const handlers = makeHandlers();
    const order: string[] = [];
    handlers.onToken.mockImplementation((text) => order.push(`token:${text}`));
    handlers.onDone.mockImplementation(() => order.push('done'));

    await streamChat(chatRequest, handlers);

    expect(order).toEqual(['token:Hola', 'token:, ', 'token:mundo', 'done']);
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('handles frames split across network chunks', async () => {
    const { streamChat } = await loadClient();
    const full = tokenFrame('¡Qué bien 🙂!') + doneFrame;
    const chunks = Array.from(full);
    mockFetch(() => sseResponse(chunks));
    const handlers = makeHandlers();

    await streamChat(chatRequest, handlers);

    expect(handlers.onToken).toHaveBeenCalledTimes(1);
    expect(handlers.onToken).toHaveBeenCalledWith('¡Qué bien 🙂!');
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('calls onError with the server message on an error event and stops', async () => {
    const { streamChat } = await loadClient();
    mockFetch(() =>
      sseResponse([
        tokenFrame('Hola'),
        'event: error\ndata: {"message":"El tutor no está disponible"}\n\n',
        tokenFrame('ignored'),
        doneFrame,
      ]),
    );
    const handlers = makeHandlers();

    await streamChat(chatRequest, handlers);

    expect(handlers.onToken).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledWith('El tutor no está disponible');
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it('ignores frames after done and releases the connection', async () => {
    const { streamChat } = await loadClient();
    const onCancel = vi.fn();
    mockFetch(() => sseResponse([tokenFrame('a'), doneFrame, tokenFrame('late')], onCancel));
    const handlers = makeHandlers();

    await streamChat(chatRequest, handlers);

    expect(handlers.onToken).toHaveBeenCalledTimes(1);
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('rejects on a 400 before the stream starts without calling handlers', async () => {
    const { streamChat } = await loadClient();
    const apiError = { code: 'invalid_request', message: 'message too long' };
    mockFetch(() => jsonResponse(apiError, 400));
    const handlers = makeHandlers();

    await expect(streamChat(chatRequest, handlers)).rejects.toMatchObject({ kind: 'http', status: 400, apiError });

    expect(handlers.onToken).not.toHaveBeenCalled();
    expect(handlers.onDone).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('rejects with kind "network" when fetch fails before the stream starts', async () => {
    const { streamChat } = await loadClient();
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const handlers = makeHandlers();

    await expect(streamChat(chatRequest, handlers)).rejects.toMatchObject({ kind: 'network' });
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('rejects with kind "stream" when the response is not an event stream', async () => {
    const { streamChat } = await loadClient();
    mockFetch(() => jsonResponse({ hello: 'world' }));
    const handlers = makeHandlers();

    await expect(streamChat(chatRequest, handlers)).rejects.toMatchObject({ kind: 'stream' });
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('calls onError when the stream ends without a terminal event', async () => {
    const { streamChat } = await loadClient();
    mockFetch(() => sseResponse([tokenFrame('Hola')]));
    const handlers = makeHandlers();

    await streamChat(chatRequest, handlers);

    expect(handlers.onToken).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it('calls onError when the connection drops mid-stream', async () => {
    const { streamChat } = await loadClient();
    mockFetch(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(tokenFrame('Hola')));
        },
        pull() {
          throw new TypeError('network error');
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const handlers = makeHandlers();

    await streamChat(chatRequest, handlers);

    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it.each([
    ['non-JSON data', 'event: token\ndata: not json\n\n'],
    ['wrong payload shape', 'event: token\ndata: {"text":42}\n\n'],
    ['unknown event name', 'event: banana\ndata: {}\n\n'],
    ['default event name', 'data: {"text":"x"}\n\n'],
  ])('calls onError once and stops on an invalid frame (%s)', async (_label, frame) => {
    const { streamChat } = await loadClient();
    mockFetch(() => sseResponse([frame, tokenFrame('after'), doneFrame]));
    const handlers = makeHandlers();

    await streamChat(chatRequest, handlers);

    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onToken).not.toHaveBeenCalled();
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it('resolves quietly when aborted before the request is sent', async () => {
    const { streamChat } = await loadClient();
    mockAbortableFetch();
    const controller = new AbortController();
    controller.abort();
    const handlers = makeHandlers();

    await expect(streamChat(chatRequest, handlers, controller.signal)).resolves.toBeUndefined();

    expect(handlers.onToken).not.toHaveBeenCalled();
    expect(handlers.onDone).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('resolves quietly when aborted while waiting for the response', async () => {
    const { streamChat } = await loadClient();
    mockAbortableFetch();
    const controller = new AbortController();
    const handlers = makeHandlers();

    const pending = streamChat(chatRequest, handlers, controller.signal);
    controller.abort();

    await expect(pending).resolves.toBeUndefined();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('resolves quietly when aborted mid-stream and calls no further handlers', async () => {
    const { streamChat } = await loadClient();
    const controller = new AbortController();
    mockFetch((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(encoder.encode(tokenFrame('Hola')));
          // Like a real fetch body, the stream errors when the request is aborted.
          init?.signal?.addEventListener(
            'abort',
            () => streamController.error(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const handlers = makeHandlers();
    handlers.onToken.mockImplementation(() => controller.abort());

    await expect(streamChat(chatRequest, handlers, controller.signal)).resolves.toBeUndefined();

    expect(handlers.onToken).toHaveBeenCalledTimes(1);
    expect(handlers.onDone).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('resolves quietly when the stream ends after an abort', async () => {
    const { streamChat } = await loadClient();
    const controller = new AbortController();
    mockFetch(() => sseResponse([tokenFrame('Hola')]));
    const handlers = makeHandlers();
    handlers.onToken.mockImplementation(() => controller.abort());

    await expect(streamChat(chatRequest, handlers, controller.signal)).resolves.toBeUndefined();

    expect(handlers.onError).not.toHaveBeenCalled();
    expect(handlers.onDone).not.toHaveBeenCalled();
  });
});
