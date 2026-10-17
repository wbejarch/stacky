import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { z } from 'zod';
import type { ApiError } from '@tutor-agent/shared';
import { createApiError, statusForCode } from './http';

/** Maximum accepted request body size (64 KB). */
export const MAX_BODY_BYTES = 64 * 1024;

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: ApiError };

type BodyEvent = Pick<APIGatewayProxyEvent, 'body'> & Partial<Pick<APIGatewayProxyEvent, 'isBase64Encoded'>>;
type PathEvent = Pick<APIGatewayProxyEvent, 'pathParameters'>;

function failure(code: ApiError['code'], message: string): ParseResult<never> {
  return { ok: false, status: statusForCode(code), error: createApiError(code, message) };
}

/**
 * Returns the decoded request body, or `null` when it is missing.
 * Base64 bodies are decoded so the size cap applies to the real payload.
 */
export function readRawBody(event: BodyEvent): string | null {
  if (event.body === null || event.body === undefined) return null;
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

/** Validates a value with a zod schema and returns a typed result. */
export function parseWith<S extends z.ZodType>(
  schema: S,
  value: unknown,
  what: string,
): ParseResult<z.output<S>> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  // Report only the failing field names, never the submitted values.
  const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))]
    .filter((path) => path.length > 0)
    .join(', ');
  return failure('invalid_request', fields ? `Invalid ${what}: ${fields}` : `Invalid ${what}`);
}

/**
 * Parses the JSON body of a request with a zod schema.
 * - Over 64 KB: 413 `payload_too_large` (checked before parsing).
 * - Missing, malformed or non-conforming body: 400 `invalid_request`.
 */
export function parseBody<S extends z.ZodType>(schema: S, event: BodyEvent): ParseResult<z.output<S>> {
  const raw = readRawBody(event);
  if (raw === null || raw.length === 0) return failure('invalid_request', 'Request body is required');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return failure('payload_too_large', 'Request body is too large');
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return failure('invalid_request', 'Request body must be valid JSON');
  }
  return parseWith(schema, json, 'request body');
}

/** Validates the path parameters of a request with a zod schema. */
export function parsePathParameters<S extends z.ZodType>(
  schema: S,
  event: PathEvent,
): ParseResult<z.output<S>> {
  return parseWith(schema, event.pathParameters ?? {}, 'path parameters');
}
