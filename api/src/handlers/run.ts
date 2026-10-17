import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { RunRequestSchema, type RunResult } from '@tutor-agent/shared';
import type { ExerciseRecord } from '@tutor-agent/shared/content';
import { getExerciseRecord } from '../lib/content';
import { errorResponse, getHeader, jsonResponse } from '../lib/http';
import { withRequestLogging } from '../lib/logger';
import { parseBody } from '../lib/validate';

/** Message attached to every failing test of the simulated run. */
export const SIMULATED_FAIL_MESSAGE = 'Ejecución simulada (Fase 0)';

/**
 * Phase 0 simulated run: the code is only compared with the starter code,
 * never executed, parsed or evaluated. Unchanged starter code fails every
 * test; any other code passes every test. Only the test names are read from
 * the record, so `call`, `expected` and `solution` cannot leak.
 */
export function simulateRun(record: ExerciseRecord, code: string): RunResult {
  const passed = code.trim() !== record.starterCode.trim();
  return {
    passed,
    tests: record.tests.map((test) =>
      passed
        ? { name: test.name, passed: true }
        : { name: test.name, passed: false, message: SIMULATED_FAIL_MESSAGE },
    ),
    stdout: '',
    stderr: '',
  };
}

/** `POST /api/run` */
export const handler = withRequestLogging(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = getHeader(event.headers, 'Origin');

    const parsed = parseBody(RunRequestSchema, event);
    if (!parsed.ok) return errorResponse(parsed.error.code, parsed.error.message, origin);

    const record = getExerciseRecord(parsed.data.exerciseId);
    if (!record) return errorResponse('not_found', 'Exercise not found', origin);

    return jsonResponse(200, simulateRun(record, parsed.data.code), origin);
  },
);
