import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { vi, type MockInstance } from 'vitest';

export const TEST_REQUEST_ID = 'req-test-1';

/** Lambda context with only the field the handlers read. */
export function makeContext(awsRequestId: string = TEST_REQUEST_ID): Context {
  return { awsRequestId } as Context;
}

export interface EventOptions {
  method?: string;
  /** Route template, e.g. `/api/exercises/{id}`. */
  resource: string;
  /** Concrete path; defaults to the resource. */
  path?: string;
  headers?: Record<string, string>;
  pathParameters?: Record<string, string> | null;
  /** Objects are JSON-stringified; strings are sent as-is; `null` means no body. */
  body?: unknown;
  isBase64Encoded?: boolean;
}

/** Builds an API Gateway REST proxy event. */
export function makeEvent(options: EventOptions): APIGatewayProxyEvent {
  const { body } = options;
  const serialized = body === undefined || body === null ? null : typeof body === 'string' ? body : JSON.stringify(body);
  return {
    httpMethod: options.method ?? 'GET',
    resource: options.resource,
    path: options.path ?? options.resource,
    headers: options.headers ?? {},
    multiValueHeaders: {},
    pathParameters: options.pathParameters ?? null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    body: serialized,
    isBase64Encoded: options.isBase64Encoded ?? false,
  };
}

export const ROUTES = {
  modules: '/api/modules',
  lesson: '/api/modules/{id}/lesson',
  exercise: '/api/exercises/{id}',
  chat: '/api/chat',
  hint: '/api/hint',
  run: '/api/run',
  progress: '/api/progress',
} as const;

export function getModulesEvent(headers?: Record<string, string>): APIGatewayProxyEvent {
  return makeEvent({ resource: ROUTES.modules, headers: headers ?? {} });
}

export function getLessonEvent(id: string, headers?: Record<string, string>): APIGatewayProxyEvent {
  return makeEvent({
    resource: ROUTES.lesson,
    path: `/api/modules/${id}/lesson`,
    pathParameters: { id },
    headers: headers ?? {},
  });
}

export function getExerciseEvent(id: string, headers?: Record<string, string>): APIGatewayProxyEvent {
  return makeEvent({
    resource: ROUTES.exercise,
    path: `/api/exercises/${id}`,
    pathParameters: { id },
    headers: headers ?? {},
  });
}

export function postEvent(
  resource: string,
  body: unknown,
  headers?: Record<string, string>,
): APIGatewayProxyEvent {
  return makeEvent({ method: 'POST', resource, body, headers: headers ?? {} });
}

/** Parses the JSON body of a buffered response. */
export function jsonBody(result: APIGatewayProxyResult): unknown {
  return JSON.parse(result.body) as unknown;
}

/** Case-insensitive response header lookup. */
export function headerOf(result: Pick<APIGatewayProxyResult, 'headers'>, name: string): string | undefined {
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    if (key.toLowerCase() === name.toLowerCase()) return String(value);
  }
  return undefined;
}

/** Spies on `console.log` (the logger sink) and returns an accessor for the parsed JSON lines. */
export function spyOnLogs(): { spy: MockInstance<typeof console.log>; lines: () => Record<string, unknown>[] } {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return {
    spy,
    lines: () => spy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>),
  };
}
