import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema, RunResultSchema } from '@tutor-agent/shared';
import { handler, SIMULATED_FAIL_MESSAGE } from '../src/handlers/run';
import { jsonBody, makeContext, postEvent, ROUTES, spyOnLogs } from './helpers/events';
import { assertNoSolutionLeak, EXERCISE_IDS, RECORDS } from './helpers/leak';

const context = makeContext();

function run(exerciseId: string, code: string) {
  return handler(postEvent(ROUTES.run, { exerciseId, code }), context);
}

beforeEach(() => {
  spyOnLogs();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>)['__evaluated'];
});

describe('run handler', () => {
  it.each(RECORDS)('starter code of $id fails every test with the simulated message', async (record) => {
    const result = await run(record.id, record.starterCode);

    expect(result.statusCode).toBe(200);
    const body = RunResultSchema.parse(jsonBody(result));
    expect(body.passed).toBe(false);
    expect(body.tests.map((test) => test.name)).toEqual(record.tests.map((test) => test.name));
    for (const test of body.tests) {
      expect(test.passed).toBe(false);
      expect(test.message).toBe(SIMULATED_FAIL_MESSAGE);
    }
    expect(SIMULATED_FAIL_MESSAGE).toBe('Ejecución simulada (Fase 0)');
    expect(body.stdout).toBe('');
    expect(body.stderr).toBe('');
  });

  it.each(RECORDS)('any other code for $id passes every test', async (record) => {
    const result = await run(record.id, `${record.starterCode}\n# changed`);

    const body = RunResultSchema.parse(jsonBody(result));
    expect(body.passed).toBe(true);
    expect(body.tests.map((test) => test.name)).toEqual(record.tests.map((test) => test.name));
    expect(body.tests.every((test) => test.passed)).toBe(true);
  });

  it('compares trimmed code: starter code with extra whitespace still counts as unchanged', async () => {
    const record = RECORDS[0]!;
    const body = RunResultSchema.parse(jsonBody(await run(record.id, `\n\n${record.starterCode}   \n`)));

    expect(body.passed).toBe(false);
  });

  it('Property 6: outcome depends only on whether the code equals the starter code', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...EXERCISE_IDS),
        fc.oneof(fc.string({ maxLength: 300 }), fc.constantFrom(...RECORDS.map((record) => record.starterCode))),
        async (exerciseId, code) => {
          const record = RECORDS.find((candidate) => candidate.id === exerciseId)!;
          const result = await run(exerciseId, code);

          expect(result.statusCode).toBe(200);
          const body = RunResultSchema.parse(jsonBody(result));
          const expectedPassed = code.trim() !== record.starterCode.trim();
          expect(body.passed).toBe(expectedPassed);
          expect(body.tests.map((test) => test.name)).toEqual(record.tests.map((test) => test.name));
          expect(body.tests.every((test) => test.passed === expectedPassed)).toBe(true);
          // The schema strips unknown keys, so check the raw test objects: no `call`/`expected` leak.
          for (const test of (jsonBody(result) as { tests: object[] }).tests) {
            expect(Object.keys(test).every((key) => ['name', 'passed', 'message'].includes(key))).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('never evaluates the submitted code', async () => {
    const hostile = [
      'globalThis.__evaluated = true',
      '(globalThis.__evaluated = true)',
      '}); globalThis.__evaluated = true; (function(){',
      "import os; os.system('echo pwned')",
    ];

    for (const code of hostile) {
      const body = RunResultSchema.parse(jsonBody(await run('m03-e01', code)));
      expect(body.stdout).toBe('');
      expect(body.stderr).toBe('');
    }
    expect((globalThis as Record<string, unknown>)['__evaluated']).toBeUndefined();
  });

  it('does not echo the submitted code, even when it is the reference solution', async () => {
    for (const record of RECORDS) {
      const result = await run(record.id, record.solution);

      expect(result.statusCode).toBe(200);
      assertNoSolutionLeak(result.body);
      expect(result.body).not.toContain(record.solution.trim());
    }
  });

  it('returns 404 not_found for an unknown exercise', async () => {
    const result = await run('m99-e99', 'print(1)');

    expect(result.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(jsonBody(result)).code).toBe('not_found');
  });

  it.each([
    ['missing body', null],
    ['malformed JSON', '{oops'],
    ['missing code', { exerciseId: 'm03-e01' }],
    ['non-string code', { exerciseId: 'm03-e01', code: 42 }],
    ['code over 20,000 characters', { exerciseId: 'm03-e01', code: 'a'.repeat(20_001) }],
    ['empty exerciseId', { exerciseId: '', code: 'x' }],
  ])('returns 400 invalid_request for %s', async (_name, body) => {
    const result = await handler(postEvent(ROUTES.run, body), context);

    expect(result.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(jsonBody(result)).code).toBe('invalid_request');
  });

  it('accepts code of exactly 20,000 characters', async () => {
    const result = await run('m03-e01', 'a'.repeat(20_000));

    expect(result.statusCode).toBe(200);
  });

  it('returns 413 payload_too_large for a body over 64 KB', async () => {
    const result = await run('m03-e01', 'a'.repeat(70 * 1024));

    expect(result.statusCode).toBe(413);
    expect(ApiErrorSchema.parse(jsonBody(result)).code).toBe('payload_too_large');
  });
});
