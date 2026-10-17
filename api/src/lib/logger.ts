import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ChatRequestSchema } from '@tutor-agent/shared';
import { errorResponse, getHeader, INTERNAL_ERROR_MESSAGE } from './http';
import { MAX_BODY_BYTES, readRawBody } from './validate';

export const ANONYMOUS_SESSION = 'anonymous';
export const SESSION_HEADER = 'X-Session-Id';
const CHAT_ROUTE = '/api/chat';
const MAX_SESSION_ID_LENGTH = 128;

type LogLevel = 'info' | 'error';

/** Writes one JSON line to stdout (CloudWatch Logs picks it up as a structured entry). */
export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...fields }));
}

/** Minimal event shape the logger needs; real API Gateway events satisfy it. */
export type LoggableEvent = Partial<
  Pick<APIGatewayProxyEvent, 'headers' | 'body' | 'isBase64Encoded' | 'httpMethod' | 'resource' | 'path' | 'requestContext'>
>;

/** Route template (`/api/exercises/{id}`) so logs group by endpoint, not by id. */
export function routeOf(event: LoggableEvent): string {
  return event.resource ?? event.path ?? 'unknown';
}

/**
 * Session id for logs. For `/api/chat` a valid body `sessionId` takes
 * precedence; otherwise `X-Session-Id`; otherwise `"anonymous"`.
 */
export function resolveSessionId(event: LoggableEvent): string {
  if (routeOf(event) === CHAT_ROUTE) {
    const fromBody = sessionIdFromBody(event);
    if (fromBody) return fromBody;
  }
  const fromHeader = getHeader(event.headers, SESSION_HEADER)?.trim();
  if (fromHeader) return fromHeader.slice(0, MAX_SESSION_ID_LENGTH);
  return ANONYMOUS_SESSION;
}

function sessionIdFromBody(event: LoggableEvent): string | undefined {
  const raw = readRawBody({ body: event.body ?? null, isBase64Encoded: event.isBase64Encoded ?? false });
  if (!raw || raw.length > MAX_BODY_BYTES) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const result = ChatRequestSchema.shape.sessionId.safeParse((parsed as Record<string, unknown>)['sessionId']);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export interface RequestLog {
  sessionId: string;
  /** Writes the request log line. Call exactly once, when the status is known. */
  finish(status: number, extra?: Record<string, unknown>): void;
}

/**
 * Starts timing a request and returns a handle that writes the final log line
 * with `sessionId`, `route`, `method`, `status`, `latencyMs` and `requestId`.
 * Streaming handlers (chat) use it directly; buffered handlers use
 * `withRequestLogging`.
 */
export function startRequestLog(event: LoggableEvent, context: Pick<Context, 'awsRequestId'>): RequestLog {
  const startedAt = performance.now();
  const sessionId = resolveSessionId(event);
  const base = {
    sessionId,
    route: routeOf(event),
    method: event.httpMethod ?? 'unknown',
    requestId: context.awsRequestId ?? event.requestContext?.requestId ?? 'unknown',
  };
  return {
    sessionId,
    finish(status, extra = {}) {
      log(status >= 500 ? 'error' : 'info', 'request', {
        ...base,
        status,
        latencyMs: Math.round(performance.now() - startedAt),
        ...extra,
      });
    },
  };
}

type BufferedHandler = (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;

/**
 * Wraps a buffered handler: logs one structured line per request and turns an
 * unexpected exception into a generic 500 (the stack goes to the log only).
 */
export function withRequestLogging(handler: BufferedHandler): BufferedHandler {
  return async (event, context) => {
    const request = startRequestLog(event, context);
    try {
      const result = await handler(event, context);
      request.finish(result.statusCode);
      return result;
    } catch (error) {
      const origin = getHeader(event.headers, 'Origin');
      request.finish(500, {
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
      });
      return errorResponse('internal_error', INTERNAL_ERROR_MESSAGE, origin);
    }
  };
}
