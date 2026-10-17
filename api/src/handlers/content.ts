import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { errorResponse, getHeader, jsonResponse } from '../lib/http';
import { getExerciseRecord, getLesson, listModules, toPublicExercise } from '../lib/content';
import { withRequestLogging } from '../lib/logger';
import { parsePathParameters } from '../lib/validate';

const MODULES_ROUTE = '/api/modules';
const LESSON_ROUTE = '/api/modules/{id}/lesson';
const EXERCISE_ROUTE = '/api/exercises/{id}';

/** Path parameter `{id}` shared by the lesson and exercise routes. */
const IdParamsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * Content endpoints (buffered):
 * - `GET /api/modules`
 * - `GET /api/modules/{id}/lesson`
 * - `GET /api/exercises/{id}`
 *
 * Exercises are always serialized through `toPublicExercise`, so `solution`,
 * `hints` and `tests` never leave the server.
 */
async function handleContent(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const origin = getHeader(event.headers, 'Origin');

  if (event.httpMethod !== 'GET') {
    return errorResponse('not_found', 'Resource not found', origin);
  }

  switch (event.resource) {
    case MODULES_ROUTE:
      return jsonResponse(200, listModules(), origin);

    case LESSON_ROUTE: {
      const params = parsePathParameters(IdParamsSchema, event);
      if (!params.ok) return jsonResponse(params.status, params.error, origin);
      const lesson = getLesson(params.data.id);
      if (!lesson) return errorResponse('not_found', 'Module not found', origin);
      return jsonResponse(200, lesson, origin);
    }

    case EXERCISE_ROUTE: {
      const params = parsePathParameters(IdParamsSchema, event);
      if (!params.ok) return jsonResponse(params.status, params.error, origin);
      const record = getExerciseRecord(params.data.id);
      if (!record) return errorResponse('not_found', 'Exercise not found', origin);
      return jsonResponse(200, toPublicExercise(record), origin);
    }

    default:
      return errorResponse('not_found', 'Resource not found', origin);
  }
}

export const handler = withRequestLogging(handleContent);
