import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handler as contentHandler } from '../src/handlers/content';
import { handler as hintHandler } from '../src/handlers/hint';
import { handler as progressHandler } from '../src/handlers/progress';
import { handler as runHandler } from '../src/handlers/run';
import {
  getExerciseEvent,
  getLessonEvent,
  getModulesEvent,
  headerOf,
  makeContext,
  makeEvent,
  postEvent,
  ROUTES,
  spyOnLogs,
  TEST_REQUEST_ID,
} from './helpers/events';

type Buffered = (event: APIGatewayProxyEvent, context: ReturnType<typeof makeContext>) => Promise<APIGatewayProxyResult>;

interface Endpoint {
  name: string;
  route: string;
  method: string;
  handler: Buffered;
  /** Builds a valid event for the endpoint with the given extra headers. */
  build: (headers: Record<string, string>) => APIGatewayProxyEvent;
  /** Builds an event that is answered with a 4xx. */
  buildInvalid: (headers: Record<string, string>) => APIGatewayProxyEvent;
  invalidStatus: number;
}

const ENDPOINTS: Endpoint[] = [
  {
    name: 'GET /api/modules',
    route: ROUTES.modules,
    method: 'GET',
    handler: contentHandler,
    build: (headers) => getModulesEvent(headers),
    buildInvalid: (headers) => makeEvent({ resource: ROUTES.modules, method: 'DELETE', headers }),
    invalidStatus: 404,
  },
  {
    name: 'GET /api/modules/{id}/lesson',
    route: ROUTES.lesson,
    method: 'GET',
    handler: contentHandler,
    build: (headers) => getLessonEvent('modulo-03-condicionales', headers),
    buildInvalid: (headers) => getLessonEvent('modulo-99', headers),
    invalidStatus: 404,
  },
  {
    name: 'GET /api/exercises/{id}',
    route: ROUTES.exercise,
    method: 'GET',
    handler: contentHandler,
    build: (headers) => getExerciseEvent('m03-e01', headers),
    buildInvalid: (headers) => getExerciseEvent('m99-e99', headers),
    invalidStatus: 404,
  },
  {
    name: 'POST /api/hint',
    route: ROUTES.hint,
    method: 'POST',
    handler: hintHandler,
    build: (headers) => postEvent(ROUTES.hint, { exerciseId: 'm03-e01', level: 1 }, headers),
    buildInvalid: (headers) => postEvent(ROUTES.hint, { exerciseId: 'm03-e01', level: 7 }, headers),
    invalidStatus: 400,
  },
  {
    name: 'POST /api/run',
    route: ROUTES.run,
    method: 'POST',
    handler: runHandler,
    build: (headers) => postEvent(ROUTES.run, { exerciseId: 'm03-e01', code: 'x = 1' }, headers),
    buildInvalid: (headers) => postEvent(ROUTES.run, { exerciseId: 'm03-e01', code: 'a'.repeat(70 * 1024) }, headers),
    invalidStatus: 413,
  },
  {
    name: 'GET /api/progress',
    route: ROUTES.progress,
    method: 'GET',
    handler: progressHandler,
    build: (headers) => makeEvent({ resource: ROUTES.progress, headers }),
    buildInvalid: (headers) => makeEvent({ resource: ROUTES.progress, method: 'GET', headers }),
    invalidStatus: 200,
  },
];

const ALLOWED = 'http://localhost:5173';
const DENIED = 'https://evil.example.com';

let logs: ReturnType<typeof spyOnLogs>;

beforeEach(() => {
  logs = spyOnLogs();
  vi.stubEnv('ALLOWED_ORIGINS', `${ALLOWED},https://d111.cloudfront.net`);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.each(ENDPOINTS)('$name', (endpoint) => {
  describe('Property 9: structured log line', () => {
    it('logs sessionId from X-Session-Id, route, method, status, latencyMs and requestId', async () => {
      const result = await endpoint.handler(endpoint.build({ 'X-Session-Id': 'sess-42' }), makeContext());

      const lines = logs.lines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: 'info',
        message: 'request',
        sessionId: 'sess-42',
        route: endpoint.route,
        method: endpoint.method,
        status: result.statusCode,
        requestId: TEST_REQUEST_ID,
      });
      expect(typeof lines[0]?.['latencyMs']).toBe('number');
      expect(lines[0]?.['latencyMs']).toBeGreaterThanOrEqual(0);
      expect(typeof lines[0]?.['timestamp']).toBe('string');
    });

    it('logs "anonymous" when the request has no session id', async () => {
      await endpoint.handler(endpoint.build({}), makeContext());

      expect(logs.lines()[0]).toMatchObject({ sessionId: 'anonymous', route: endpoint.route });
    });

    it('logs the session and the error status for failing requests too', async () => {
      const result = await endpoint.handler(endpoint.buildInvalid({ 'x-session-id': 'sess-err' }), makeContext());

      expect(result.statusCode).toBe(endpoint.invalidStatus);
      expect(logs.lines()[0]).toMatchObject({ sessionId: 'sess-err', status: endpoint.invalidStatus, requestId: TEST_REQUEST_ID });
    });

    it('does not log request bodies or code', async () => {
      await endpoint.handler(endpoint.build({}), makeContext());
      await endpoint.handler(endpoint.buildInvalid({}), makeContext());

      const serialized = JSON.stringify(logs.lines());
      expect(serialized).not.toContain('x = 1');
      expect(serialized).not.toContain('aaaaaaaaaa');
    });
  });

  describe('CORS', () => {
    it('echoes an allowed origin', async () => {
      const result = await endpoint.handler(endpoint.build({ Origin: ALLOWED }), makeContext());

      expect(headerOf(result, 'Access-Control-Allow-Origin')).toBe(ALLOWED);
      expect(headerOf(result, 'Vary')).toBe('Origin');
    });

    it('does not emit Access-Control-Allow-Origin for a disallowed origin', async () => {
      const result = await endpoint.handler(endpoint.build({ Origin: DENIED }), makeContext());

      expect(headerOf(result, 'Access-Control-Allow-Origin')).toBeUndefined();
      expect(headerOf(result, 'Vary')).toBe('Origin');
    });

    it('does not emit it when there is no Origin header', async () => {
      const result = await endpoint.handler(endpoint.build({}), makeContext());

      expect(headerOf(result, 'Access-Control-Allow-Origin')).toBeUndefined();
    });

    it('applies the same rule to error responses', async () => {
      if (endpoint.invalidStatus === 200) return;
      const allowed = await endpoint.handler(endpoint.buildInvalid({ Origin: ALLOWED }), makeContext());
      const denied = await endpoint.handler(endpoint.buildInvalid({ Origin: DENIED }), makeContext());

      expect(headerOf(allowed, 'Access-Control-Allow-Origin')).toBe(ALLOWED);
      expect(headerOf(denied, 'Access-Control-Allow-Origin')).toBeUndefined();
    });
  });
});
