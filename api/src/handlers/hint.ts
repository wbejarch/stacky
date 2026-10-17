import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { HintRequestSchema, type HintResponse } from '@tutor-agent/shared';
import { getExerciseRecord } from '../lib/content';
import { errorResponse, getHeader, jsonResponse } from '../lib/http';
import { withRequestLogging } from '../lib/logger';
import { parseBody } from '../lib/validate';

/**
 * `POST /api/hint`: returns the authored hint text of the requested level.
 * - Invalid body or level outside 1..3: 400. Body over 64 KB: 413.
 * - Unknown exercise: 404.
 * Only the hint text is returned; `solution` never leaves the server.
 */
async function hintHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const origin = getHeader(event.headers, 'Origin');

  const parsed = parseBody(HintRequestSchema, event);
  if (!parsed.ok) return errorResponse(parsed.error.code, parsed.error.message, origin);

  const { exerciseId, level } = parsed.data;
  const record = getExerciseRecord(exerciseId);
  if (!record) return errorResponse('not_found', 'Exercise not found', origin);

  const text = record.hints[level - 1];
  if (text === undefined) return errorResponse('invalid_request', 'Invalid level', origin);

  // Built field by field: never spread the record into a response.
  const body: HintResponse = { level, text };
  return jsonResponse(200, body, origin);
}

export const handler = withRequestLogging(hintHandler);
