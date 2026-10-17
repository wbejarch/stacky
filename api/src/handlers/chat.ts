import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import type { Writable } from 'node:stream';
import { ChatRequestSchema, type ApiError, type ChatStreamEvent } from '@tutor-agent/shared';
import { corsHeaders, createApiError, getHeader, INTERNAL_ERROR_MESSAGE, statusForCode } from '../lib/http';
import { startRequestLog } from '../lib/logger';
import {
  fragments,
  getTokenDelayMs,
  SIMULATE_ERROR_TRIGGER,
  SIMULATED_ERROR_MESSAGE,
  sleep,
} from '../lib/mock-tutor';
import { parseBody } from '../lib/validate';

/** Number of `token` events sent before the simulated failure. */
const SIMULATED_ERROR_AFTER_TOKENS = 3;

/** Spanish message (student-facing) for unexpected failures after the stream has started. */
const STREAM_FAILURE_MESSAGE = 'El tutor tuvo un problema. Inténtalo de nuevo.';

/** Test seams: both default to the production behavior. */
export interface ChatOptions {
  /** Pause between `token` events in ms. Defaults to `MOCK_TOKEN_DELAY_MS` (40 ms). */
  tokenDelayMs?: number;
  /** Replaceable sleep, so tests do not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
}

/** Serializes one SSE frame: `event: <name>\ndata: <json>\n\n`. JSON never contains raw newlines. */
export function sseFrame(event: ChatStreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * Writes a JSON `ApiError` as the whole response (no SSE) and ends the stream.
 * `HttpResponseStream.from` is what carries the status code and headers to API Gateway.
 */
function endWithError(
  responseStream: Writable,
  status: number,
  error: ApiError,
  origin: string | undefined,
): void {
  const out = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(origin),
    },
  });
  out.write(JSON.stringify(error));
  out.end();
}

/**
 * `POST /api/chat`: simulated tutor reply streamed as Server-Sent Events.
 * - Invalid body (400) or body over 64 KB (413): JSON `ApiError`, the SSE stream is never opened.
 * - Valid body: 200 `text/event-stream` with `token` events and exactly one terminal event
 *   (`done`, or `error` when the message is `__simulate_error__` or something fails mid-stream).
 *   Nothing is written after the terminal event.
 */
export async function chatHandler(
  event: APIGatewayProxyEvent,
  responseStream: Writable,
  context: Context,
  options: ChatOptions = {},
): Promise<void> {
  const request = startRequestLog(event, context);
  const origin = getHeader(event.headers, 'Origin');
  let sse: Writable | undefined;
  let outcome: 'done' | 'error' | undefined;

  try {
    const parsed = parseBody(ChatRequestSchema, event);
    if (!parsed.ok) {
      endWithError(responseStream, parsed.status, parsed.error, origin);
      request.finish(parsed.status);
      return;
    }

    const out = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        ...corsHeaders(origin),
      },
    });
    sse = out;

    const delayMs = options.tokenDelayMs ?? getTokenDelayMs();
    const wait = options.sleep ?? sleep;
    const simulateError = parsed.data.message === SIMULATE_ERROR_TRIGGER;
    const parts = fragments();
    const tokenCount = simulateError ? Math.min(SIMULATED_ERROR_AFTER_TOKENS, parts.length) : parts.length;

    for (let i = 0; i < tokenCount; i++) {
      // No pause before the first token: it must arrive well under 1 s.
      if (i > 0) await wait(delayMs);
      out.write(sseFrame({ event: 'token', data: { text: parts[i] ?? '' } }));
    }

    if (simulateError) {
      outcome = 'error';
      out.write(sseFrame({ event: 'error', data: { message: SIMULATED_ERROR_MESSAGE } }));
    } else {
      outcome = 'done';
      out.write(sseFrame({ event: 'done', data: {} }));
    }
    out.end();
    request.finish(200, { streamOutcome: outcome });
  } catch (error) {
    const detail =
      error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
    if (sse && outcome === undefined) {
      // Stream already started and no terminal event was sent yet: close it with one `error` event.
      try {
        sse.write(sseFrame({ event: 'error', data: { message: STREAM_FAILURE_MESSAGE } }));
        sse.end();
      } catch {
        // The connection is already gone; nothing else to do.
      }
      request.finish(200, { streamOutcome: 'error', error: detail });
    } else if (!sse) {
      try {
        endWithError(
          responseStream,
          statusForCode('internal_error'),
          createApiError('internal_error', INTERNAL_ERROR_MESSAGE),
          origin,
        );
      } catch {
        // The connection is already gone; nothing else to do.
      }
      request.finish(500, { error: detail });
    } else {
      // Terminal event already written; never write after it.
      request.finish(200, { streamOutcome: outcome, error: detail });
    }
  }
}

export const handler = awslambda.streamifyResponse(
  (event: APIGatewayProxyEvent, responseStream, context) => chatHandler(event, responseStream, context),
);
