import type { APIGatewayProxyResult } from 'aws-lambda';
import type { ApiError } from '@tutor-agent/shared';

/** Header bag as delivered by API Gateway (names keep the client casing). */
export type HeaderBag = Record<string, string | undefined> | null | undefined;

/** HTTP status for each `ApiError` code of the shared contract. */
const STATUS_BY_CODE: Record<ApiError['code'], number> = {
  invalid_request: 400,
  not_found: 404,
  payload_too_large: 413,
  internal_error: 500,
};

/** Generic message for unexpected failures. Never include traces or internals. */
export const INTERNAL_ERROR_MESSAGE = 'Internal error';

export function statusForCode(code: ApiError['code']): number {
  return STATUS_BY_CODE[code];
}

/** Builds a contract-shaped `ApiError` body. */
export function createApiError(code: ApiError['code'], message: string): ApiError {
  return { code, message };
}

/** Case-insensitive header lookup (API Gateway REST keeps the original casing). */
export function getHeader(headers: HeaderBag, name: string): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/**
 * Reads the allowed CORS origins from the `ALLOWED_ORIGINS` environment
 * variable (comma-separated list of origins).
 */
export function getAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env['ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * CORS headers for a response. The request `Origin` is echoed only when it is
 * in the allow list; otherwise no `Access-Control-Allow-Origin` is emitted.
 * `Vary: Origin` is always present so shared caches never mix variants.
 */
export function corsHeaders(
  origin: string | undefined,
  allowedOrigins: readonly string[] = getAllowedOrigins(),
): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/** JSON response with CORS headers for the given request origin. */
export function jsonResponse(
  status: number,
  body: unknown,
  origin?: string,
  allowedOrigins?: readonly string[],
): APIGatewayProxyResult {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(origin, allowedOrigins),
    },
    body: JSON.stringify(body),
  };
}

/** `ApiError` JSON response; the HTTP status is derived from the error code. */
export function errorResponse(
  code: ApiError['code'],
  message: string,
  origin?: string,
  allowedOrigins?: readonly string[],
): APIGatewayProxyResult {
  return jsonResponse(statusForCode(code), createApiError(code, message), origin, allowedOrigins);
}
