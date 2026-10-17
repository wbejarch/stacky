import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressSchema } from '@tutor-agent/shared';
import { handler } from '../src/handlers/progress';
import { headerOf, jsonBody, makeContext, makeEvent, ROUTES, spyOnLogs } from './helpers/events';
import { assertNoSolutionLeak } from './helpers/leak';

beforeEach(() => {
  spyOnLogs();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('progress handler: GET /api/progress', () => {
  it('returns the fixed Progress with no completed exercises and 3 in total', async () => {
    const result = await handler(makeEvent({ resource: ROUTES.progress }), makeContext());

    expect(result.statusCode).toBe(200);
    expect(headerOf(result, 'Content-Type')).toContain('application/json');
    const progress = ProgressSchema.parse(jsonBody(result));
    expect(progress).toEqual({ completedExerciseIds: [], totalExercises: 3 });
    assertNoSolutionLeak(result.body);
  });

  it('ignores the session header: the value is the same for every session', async () => {
    const a = await handler(makeEvent({ resource: ROUTES.progress, headers: { 'X-Session-Id': 'a' } }), makeContext());
    const b = await handler(makeEvent({ resource: ROUTES.progress, headers: { 'X-Session-Id': 'b' } }), makeContext());

    expect(a.body).toBe(b.body);
  });
});
