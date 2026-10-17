import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema, HintResponseSchema } from '@tutor-agent/shared';
import { handler } from '../src/handlers/hint';
import { jsonBody, makeContext, postEvent, ROUTES, spyOnLogs } from './helpers/events';
import { assertNoSolutionLeak, EXERCISE_IDS, RECORDS } from './helpers/leak';

const context = makeContext();

function post(body: unknown) {
  return handler(postEvent(ROUTES.hint, body), context);
}

beforeEach(() => {
  spyOnLogs();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hint handler', () => {
  it('Property 7: levels 1..3 of every exercise return the authored hint text', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...EXERCISE_IDS), fc.constantFrom(1, 2, 3), async (exerciseId, level) => {
        const result = await post({ exerciseId, level });

        expect(result.statusCode).toBe(200);
        const hint = HintResponseSchema.parse(jsonBody(result));
        const record = RECORDS.find((candidate) => candidate.id === exerciseId);
        expect(hint).toEqual({ level, text: record?.hints[level - 1] });
        expect(Object.keys(jsonBody(result) as object).sort()).toEqual(['level', 'text']);
        assertNoSolutionLeak(result.body);
      }),
      { numRuns: 30 },
    );
  });

  it.each([
    ['level 0', 0],
    ['level 4', 4],
    ['negative level', -1],
    ['non-integer level', 1.5],
    ['string level', '1'],
    ['null level', null],
  ])('returns 400 invalid_request for %s', async (_name, level) => {
    const result = await post({ exerciseId: 'm03-e01', level });

    expect(result.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(jsonBody(result)).code).toBe('invalid_request');
    assertNoSolutionLeak(result.body);
  });

  it.each([
    ['missing body', null],
    ['malformed JSON', '{not json'],
    ['missing level', { exerciseId: 'm03-e01' }],
    ['missing exerciseId', { level: 1 }],
    ['empty exerciseId', { exerciseId: '', level: 1 }],
    ['exerciseId too long', { exerciseId: 'x'.repeat(65), level: 1 }],
  ])('returns 400 invalid_request for %s', async (_name, body) => {
    const result = await post(body);

    expect(result.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(jsonBody(result)).code).toBe('invalid_request');
  });

  it('returns 404 not_found for an unknown exercise', async () => {
    const result = await post({ exerciseId: 'm99-e99', level: 1 });

    expect(result.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(jsonBody(result)).code).toBe('not_found');
  });

  it('returns 413 payload_too_large for a body over 64 KB', async () => {
    const result = await post({ exerciseId: 'm03-e01', level: 1, padding: 'x'.repeat(70 * 1024) });

    expect(result.statusCode).toBe(413);
    expect(ApiErrorSchema.parse(jsonBody(result)).code).toBe('payload_too_large');
  });

  it('does not echo submitted values in 400 messages', async () => {
    const result = await post({ exerciseId: 'm03-e01', level: 'SECRET-VALUE' });

    expect(result.body).not.toContain('SECRET-VALUE');
  });
});
