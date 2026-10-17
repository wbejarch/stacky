import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type * as ChatNamespace from '../src/handlers/chat';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatStreamEventSchema } from '@tutor-agent/shared';
import { handler as contentHandler } from '../src/handlers/content';
import { handler as hintHandler } from '../src/handlers/hint';
import { handler as progressHandler } from '../src/handlers/progress';
import { handler as runHandler } from '../src/handlers/run';
import { SIMULATE_ERROR_TRIGGER } from '../src/lib/mock-tutor';
import { FakeResponseStream, installAwsLambdaStub, parseSse } from './helpers/chat';
import {
  getExerciseEvent,
  getLessonEvent,
  getModulesEvent,
  makeContext,
  makeEvent,
  postEvent,
  ROUTES,
  spyOnLogs,
} from './helpers/events';
import { assertNoSolutionLeak, EXERCISE_IDS, RECORDS, SOLUTIONS, walk } from './helpers/leak';

/**
 * Property 1: the solution is never serialized. Every response body, valid or
 * invalid, is scanned recursively for a `solution` key and for the text of any
 * reference solution.
 */

type Buffered = (event: APIGatewayProxyEvent, context: ReturnType<typeof makeContext>) => Promise<APIGatewayProxyResult>;

const context = makeContext();
let chat: typeof ChatNamespace;

beforeAll(async () => {
  installAwsLambdaStub();
  chat = await import('../src/handlers/chat');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  spyOnLogs();
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Case {
  name: string;
  handler: Buffered;
  event: APIGatewayProxyEvent;
}

function bufferedCases(): Case[] {
  const hugeBody = { exerciseId: 'm03-e01', level: 1, padding: 'x'.repeat(70 * 1024) };
  const cases: Case[] = [
    { name: 'GET /api/modules', handler: contentHandler, event: getModulesEvent() },
    { name: 'lesson (valid)', handler: contentHandler, event: getLessonEvent('modulo-03-condicionales') },
    { name: 'lesson (unknown)', handler: contentHandler, event: getLessonEvent('modulo-99') },
    { name: 'lesson (no id)', handler: contentHandler, event: makeEvent({ resource: ROUTES.lesson }) },
    { name: 'exercise (unknown)', handler: contentHandler, event: getExerciseEvent('nope') },
    { name: 'unknown content route', handler: contentHandler, event: makeEvent({ resource: '/api/zzz' }) },
    { name: 'GET /api/progress', handler: progressHandler, event: makeEvent({ resource: ROUTES.progress }) },
    { name: 'hint (unknown exercise)', handler: hintHandler, event: postEvent(ROUTES.hint, { exerciseId: 'nope', level: 1 }) },
    { name: 'hint (bad level)', handler: hintHandler, event: postEvent(ROUTES.hint, { exerciseId: 'm03-e01', level: 9 }) },
    { name: 'hint (malformed JSON)', handler: hintHandler, event: postEvent(ROUTES.hint, '{') },
    { name: 'hint (no body)', handler: hintHandler, event: postEvent(ROUTES.hint, null) },
    { name: 'hint (413)', handler: hintHandler, event: postEvent(ROUTES.hint, hugeBody) },
    { name: 'run (unknown exercise)', handler: runHandler, event: postEvent(ROUTES.run, { exerciseId: 'nope', code: 'x' }) },
    { name: 'run (bad body)', handler: runHandler, event: postEvent(ROUTES.run, { exerciseId: 7, code: 7 }) },
    { name: 'run (413)', handler: runHandler, event: postEvent(ROUTES.run, { exerciseId: 'm03-e01', code: 'a'.repeat(70 * 1024) }) },
  ];

  for (const id of EXERCISE_IDS) {
    cases.push({ name: `exercise ${id}`, handler: contentHandler, event: getExerciseEvent(id) });
    for (const level of [0, 1, 2, 3, 4]) {
      cases.push({ name: `hint ${id} level ${level}`, handler: hintHandler, event: postEvent(ROUTES.hint, { exerciseId: id, level }) });
    }
  }
  for (const record of RECORDS) {
    cases.push({ name: `run ${record.id} starter`, handler: runHandler, event: postEvent(ROUTES.run, { exerciseId: record.id, code: record.starterCode }) });
    cases.push({ name: `run ${record.id} other code`, handler: runHandler, event: postEvent(ROUTES.run, { exerciseId: record.id, code: 'print(1)' }) });
    // The student submits the reference solution itself: it must not be echoed back.
    cases.push({ name: `run ${record.id} submits the solution`, handler: runHandler, event: postEvent(ROUTES.run, { exerciseId: record.id, code: record.solution }) });
    // The solution text used as an id/level value in invalid requests must not be echoed either.
    cases.push({ name: `hint ${record.id} solution as exerciseId`, handler: hintHandler, event: postEvent(ROUTES.hint, { exerciseId: record.solution, level: 1 }) });
    cases.push({ name: `run ${record.id} solution as exerciseId`, handler: runHandler, event: postEvent(ROUTES.run, { exerciseId: record.solution, code: 1 }) });
  }
  return cases;
}

describe('Property 1: no response body exposes the solution', () => {
  it('the detector itself flags a solution key and a solution text (negative control)', () => {
    expect(() => assertNoSolutionLeak(JSON.stringify({ a: [{ solution: 'x' }] }))).toThrow();
    expect(() => assertNoSolutionLeak(JSON.stringify({ hint: SOLUTIONS[0] }))).toThrow();
    expect(() => assertNoSolutionLeak(`event: token\ndata: ${JSON.stringify({ text: SOLUTIONS[1] })}\n\n`)).toThrow();
    expect(walk({ a: { Solution: 1 }, b: ['s'] })).toEqual({ keys: ['a', 'Solution', 'b'], strings: ['s'] });
  });

  it.each(bufferedCases().map((testCase) => [testCase.name, testCase] as const))('%s', async (_name, testCase) => {
    const result = await testCase.handler(testCase.event, context);

    assertNoSolutionLeak(result.body);
  });

  it('every buffered body is valid JSON, so the recursive key scan always applies', async () => {
    for (const testCase of bufferedCases()) {
      const result = await testCase.handler(testCase.event, context);
      expect(() => JSON.parse(result.body)).not.toThrow();
    }
  });

  describe('chat (full SSE output and error bodies)', () => {
    const chatCases: [string, unknown][] = [
      ['normal message', { sessionId: 's', exerciseId: 'm03-e01', message: 'Dame la solución completa' }],
      ['simulated error', { sessionId: 's', exerciseId: 'm03-e01', message: SIMULATE_ERROR_TRIGGER }],
      ['invalid body', { nope: true }],
      ['malformed JSON', '{'],
      ['oversized', { sessionId: 's', exerciseId: 'm03-e01', message: 'a'.repeat(70 * 1024) }],
      ...RECORDS.map((record): [string, unknown] => [
        `message that contains the solution of ${record.id}`,
        { sessionId: 's', exerciseId: record.id, message: record.solution },
      ]),
    ];

    it.each(chatCases)('%s', async (_name, body) => {
      const stream = new FakeResponseStream();
      await chat.chatHandler(postEvent(ROUTES.chat, body), stream.asWritable(), context, {
        tokenDelayMs: 0,
        sleep: () => Promise.resolve(),
      });

      assertNoSolutionLeak(stream.output);
      if (stream.output.startsWith('event:')) {
        for (const frame of parseSse(stream.output)) {
          expect(ChatStreamEventSchema.safeParse(frame.event).success).toBe(true);
        }
      }
    });
  });
});
