import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ApiErrorSchema } from '@tutor-agent/shared';
import { jsonResponse } from '../src/lib/http';
import { resolveSessionId, startRequestLog, withRequestLogging } from '../src/lib/logger';

const context = { awsRequestId: 'req-123' } as Context;

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    resource: '/api/modules',
    path: '/api/modules',
    headers: {},
    body: null,
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEvent;
}

let logSpy: MockInstance<typeof console.log>;

function loggedLines(): Record<string, unknown>[] {
  return logSpy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

describe('resolveSessionId', () => {
  it('uses the X-Session-Id header (any casing)', () => {
    expect(resolveSessionId(makeEvent({ headers: { 'x-session-id': 'from-header' } }))).toBe('from-header');
  });

  it('falls back to "anonymous" when there is no identifier', () => {
    expect(resolveSessionId(makeEvent())).toBe('anonymous');
    expect(resolveSessionId(makeEvent({ headers: { 'X-Session-Id': '   ' } }))).toBe('anonymous');
  });

  it('prefers the body sessionId on /api/chat', () => {
    const event = makeEvent({
      httpMethod: 'POST',
      resource: '/api/chat',
      headers: { 'X-Session-Id': 'from-header' },
      body: JSON.stringify({ sessionId: 'from-body', exerciseId: 'm03-e01', message: 'hola' }),
    });
    expect(resolveSessionId(event)).toBe('from-body');
  });

  it('uses the header on /api/chat when the body is unusable', () => {
    const event = makeEvent({
      httpMethod: 'POST',
      resource: '/api/chat',
      headers: { 'X-Session-Id': 'from-header' },
      body: '{not json',
    });
    expect(resolveSessionId(event)).toBe('from-header');
  });

  it('ignores the body sessionId on other routes', () => {
    const event = makeEvent({
      httpMethod: 'POST',
      resource: '/api/hint',
      headers: { 'X-Session-Id': 'from-header' },
      body: JSON.stringify({ sessionId: 'from-body' }),
    });
    expect(resolveSessionId(event)).toBe('from-header');
  });

  it('truncates very long header values', () => {
    expect(resolveSessionId(makeEvent({ headers: { 'X-Session-Id': 'a'.repeat(500) } }))).toHaveLength(128);
  });
});

describe('withRequestLogging', () => {
  it('logs one JSON line with session, route, method, status, latency and request id', async () => {
    const handler = withRequestLogging(async () => jsonResponse(200, { ok: true }));
    const event = makeEvent({ headers: { 'X-Session-Id': 'sess-1' }, resource: '/api/exercises/{id}', path: '/api/exercises/m03-e01' });

    const result = await handler(event, context);

    expect(result.statusCode).toBe(200);
    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      sessionId: 'sess-1',
      route: '/api/exercises/{id}',
      method: 'GET',
      status: 200,
      requestId: 'req-123',
    });
    expect(typeof lines[0]?.['latencyMs']).toBe('number');
    expect(lines[0]?.['latencyMs']).toBeGreaterThanOrEqual(0);
  });

  it('logs "anonymous" when the client sent no session id', async () => {
    await withRequestLogging(async () => jsonResponse(404, {}))(makeEvent(), context);
    expect(loggedLines()[0]).toMatchObject({ sessionId: 'anonymous', status: 404 });
  });

  it('turns an unexpected exception into a generic 500 and keeps the stack in the log only', async () => {
    const handler = withRequestLogging(async (): Promise<APIGatewayProxyResult> => {
      throw new Error('secret database detail');
    });

    const result = await handler(makeEvent(), context);

    expect(result.statusCode).toBe(500);
    expect(ApiErrorSchema.parse(JSON.parse(result.body)).code).toBe('internal_error');
    expect(result.body).not.toContain('secret database detail');
    const line = loggedLines()[0];
    expect(line).toMatchObject({ level: 'error', status: 500, sessionId: 'anonymous' });
    expect(JSON.stringify(line)).toContain('secret database detail');
  });
});

describe('startRequestLog', () => {
  it('writes the line only when finish is called, including extra fields', () => {
    const request = startRequestLog(makeEvent({ headers: { 'X-Session-Id': 's' } }), context);
    expect(logSpy).not.toHaveBeenCalled();
    request.finish(200, { stream: true });
    expect(loggedLines()[0]).toMatchObject({ sessionId: 's', status: 200, stream: true, requestId: 'req-123' });
  });
});
