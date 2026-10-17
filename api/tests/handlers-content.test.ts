import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiErrorSchema,
  ExerciseSchema,
  LessonSchema,
  ModuleSchema,
  exerciseIdsFor,
  type Module,
} from '@tutor-agent/shared';
import { z } from 'zod';
import { handler } from '../src/handlers/content';
import {
  getExerciseEvent,
  getLessonEvent,
  getModulesEvent,
  headerOf,
  jsonBody,
  makeContext,
  makeEvent,
  ROUTES,
  spyOnLogs,
} from './helpers/events';
import { assertNoSolutionLeak, EXERCISE_IDS } from './helpers/leak';

const context = makeContext();
const MODULE_ID = 'modulo-03-condicionales';

beforeEach(() => {
  spyOnLogs();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('content handler: GET /api/modules', () => {
  it('returns Module[] that conforms to the shared schema', async () => {
    const result = await handler(getModulesEvent(), context);

    expect(result.statusCode).toBe(200);
    expect(headerOf(result, 'Content-Type')).toContain('application/json');
    const modules = z.array(ModuleSchema).parse(jsonBody(result));
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({ id: MODULE_ID, exerciseCount: 3 });
    expect(modules[0]?.title.length).toBeGreaterThan(0);
  });
});

describe('content handler: GET /api/modules/{id}/lesson', () => {
  it('returns a Lesson that conforms to the shared schema', async () => {
    const result = await handler(getLessonEvent(MODULE_ID), context);

    expect(result.statusCode).toBe(200);
    const lesson = LessonSchema.parse(jsonBody(result));
    expect(lesson.moduleId).toBe(MODULE_ID);
    expect(lesson.markdown).toContain('if');
  });

  it('returns 404 not_found for an unknown module', async () => {
    const result = await handler(getLessonEvent('modulo-99-inexistente'), context);

    expect(result.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(jsonBody(result)).code).toBe('not_found');
  });

  it('returns 400 invalid_request when the id path parameter is missing or too long', async () => {
    const missing = await handler(makeEvent({ resource: ROUTES.lesson, pathParameters: null }), context);
    const tooLong = await handler(getLessonEvent('x'.repeat(65)), context);

    for (const result of [missing, tooLong]) {
      expect(result.statusCode).toBe(400);
      expect(ApiErrorSchema.parse(jsonBody(result)).code).toBe('invalid_request');
    }
  });
});

describe('content handler: GET /api/exercises/{id}', () => {
  const publicKeys = Object.keys(ExerciseSchema.shape).sort();

  it.each(EXERCISE_IDS)('returns the public Exercise %s with exactly the contract fields', async (id) => {
    const result = await handler(getExerciseEvent(id), context);

    expect(result.statusCode).toBe(200);
    const body = jsonBody(result);
    const exercise = ExerciseSchema.parse(body);
    expect(exercise.id).toBe(id);
    expect(exercise.hintsAvailable).toBe(3);
    // The schema strips unknown keys when parsing, so also compare the raw keys.
    expect(Object.keys(body as object).sort()).toEqual(publicKeys);
    expect(body).not.toHaveProperty('solution');
    expect(body).not.toHaveProperty('hints');
    expect(body).not.toHaveProperty('tests');
    assertNoSolutionLeak(result.body);
  });

  it('returns 404 not_found for an unknown exercise', async () => {
    const result = await handler(getExerciseEvent('m99-e99'), context);

    expect(result.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(jsonBody(result)).code).toBe('not_found');
  });

  it('returns 400 invalid_request when the id is missing', async () => {
    const result = await handler(makeEvent({ resource: ROUTES.exercise, pathParameters: {} }), context);

    expect(result.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(jsonBody(result)).code).toBe('invalid_request');
  });
});

describe('content handler: other requests', () => {
  it('returns 404 for an unknown resource', async () => {
    const result = await handler(makeEvent({ resource: '/api/unknown' }), context);

    expect(result.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(jsonBody(result)).code).toBe('not_found');
  });

  it('returns 404 for a non-GET method on a content route', async () => {
    const result = await handler(makeEvent({ method: 'POST', resource: ROUTES.modules, body: {} }), context);

    expect(result.statusCode).toBe(404);
  });
});

describe('Property 8: exercise ids follow the convention', () => {
  it('every id from exerciseIdsFor resolves to an exercise of the module and counts match', async () => {
    const modules = z.array(ModuleSchema).parse(jsonBody(await handler(getModulesEvent(), context)));

    for (const module of modules satisfies Module[]) {
      const ids = exerciseIdsFor(module);
      expect(ids).toHaveLength(module.exerciseCount);
      for (const id of ids) {
        const result = await handler(getExerciseEvent(id), context);
        expect(result.statusCode).toBe(200);
        expect(ExerciseSchema.parse(jsonBody(result)).moduleId).toBe(module.id);
      }
    }
  });
});
