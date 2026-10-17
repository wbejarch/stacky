import { describe, expect, it } from 'vitest';
import { ApiErrorSchema } from '@tutor-agent/shared';
import {
  corsHeaders,
  createApiError,
  errorResponse,
  getAllowedOrigins,
  getHeader,
  jsonResponse,
  statusForCode,
} from '../src/lib/http';

const ALLOWED = ['http://localhost:5173', 'https://d111.cloudfront.net'];

describe('getAllowedOrigins', () => {
  it('parses a comma-separated list and trims blanks', () => {
    expect(getAllowedOrigins({ ALLOWED_ORIGINS: ' http://a.test , https://b.test ,, ' })).toEqual([
      'http://a.test',
      'https://b.test',
    ]);
  });

  it('returns an empty list when the variable is not set', () => {
    expect(getAllowedOrigins({})).toEqual([]);
  });
});

describe('corsHeaders', () => {
  it('echoes the origin only when it is allowed', () => {
    expect(corsHeaders('http://localhost:5173', ALLOWED)['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
  });

  it('omits Access-Control-Allow-Origin for unknown or missing origins', () => {
    expect(corsHeaders('https://evil.test', ALLOWED)).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(corsHeaders(undefined, ALLOWED)).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(corsHeaders('http://localhost:5173', [])).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  it('never answers with a wildcard and always varies on Origin', () => {
    const headers = corsHeaders('https://evil.test', ALLOWED);
    expect(Object.values(headers)).not.toContain('*');
    expect(headers['Vary']).toBe('Origin');
  });

  it('reads the allow list from ALLOWED_ORIGINS by default', () => {
    process.env['ALLOWED_ORIGINS'] = 'https://env.test';
    try {
      expect(corsHeaders('https://env.test')['Access-Control-Allow-Origin']).toBe('https://env.test');
    } finally {
      delete process.env['ALLOWED_ORIGINS'];
    }
  });
});

describe('jsonResponse', () => {
  it('serializes the body with JSON headers and the status', () => {
    const response = jsonResponse(200, { ok: true }, 'http://localhost:5173', ALLOWED);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(response.headers?.['Content-Type']).toContain('application/json');
    expect(response.headers?.['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
  });
});

describe('errorResponse', () => {
  it.each([
    ['invalid_request', 400],
    ['not_found', 404],
    ['payload_too_large', 413],
    ['internal_error', 500],
  ] as const)('maps %s to HTTP %i with a contract-shaped body', (code, status) => {
    const response = errorResponse(code, 'message', undefined, ALLOWED);
    expect(response.statusCode).toBe(status);
    expect(statusForCode(code)).toBe(status);
    expect(ApiErrorSchema.parse(JSON.parse(response.body))).toEqual(createApiError(code, 'message'));
  });
});

describe('getHeader', () => {
  it('finds headers case-insensitively', () => {
    expect(getHeader({ 'x-session-id': 'abc' }, 'X-Session-Id')).toBe('abc');
    expect(getHeader({ 'X-SESSION-ID': 'abc' }, 'x-session-id')).toBe('abc');
  });

  it('returns undefined for missing headers or bags', () => {
    expect(getHeader({}, 'Origin')).toBeUndefined();
    expect(getHeader(null, 'Origin')).toBeUndefined();
  });
});
