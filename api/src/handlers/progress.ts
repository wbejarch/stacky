import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ProgressSchema, type Progress } from '@tutor-agent/shared';
import { listModules } from '../lib/content';
import { getHeader, jsonResponse } from '../lib/http';
import { withRequestLogging } from '../lib/logger';

/**
 * `GET /api/progress`: fixed value in Phase 0 (no persistence).
 * Nothing is completed; the total is the number of exercises of all modules with content.
 */
export function buildProgress(): Progress {
  const totalExercises = listModules().reduce((sum, module) => sum + module.exerciseCount, 0);
  return ProgressSchema.parse({ completedExerciseIds: [], totalExercises });
}

export const handler = withRequestLogging(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = getHeader(event.headers, 'Origin');
    return jsonResponse(200, buildProgress(), origin);
  },
);
