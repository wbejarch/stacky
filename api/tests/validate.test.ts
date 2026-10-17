import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiErrorSchema, ChatRequestSchema } from '@tutor-agent/shared';
import { MAX_BODY_BYTES, parseBody, parsePathParameters } from '../src/lib/validate';

const validChat = { sessionId: 's-1', exerciseId: 'm03-e01', message: 'Hola' };

describe('parseBody', () => {
  it('returns typed data for a valid body', () => {
    const result = parseBody(ChatRequestSchema, { body: JSON.stringify(validChat) });
    expect(result).toEqual({ ok: true, data: validChat });
  });

  it('decodes base64 bodies', () => {
    const body = Buffer.from(JSON.stringify(validChat)).toString('base64');
    expect(parseBody(ChatRequestSchema, { body, isBase64Encoded: true })).toEqual({ ok: true, data: validChat });
  });

  it('returns 400 invalid_request when the body is missing or empty', () => {
    for (const body of [null, '']) {
      const result = parseBody(ChatRequestSchema, { body });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.error.code).toBe('invalid_request');
      }
    }
  });

  it('returns 400 for malformed JSON', () => {
    const result = parseBody(ChatRequestSchema, { body: '{not json' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 for schema violations and names fields but never values', () => {
    const result = parseBody(ChatRequestSchema, { body: JSON.stringify({ ...validChat, message: 'x'.repeat(2001) }) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(ApiErrorSchema.safeParse(result.error).success).toBe(true);
      expect(result.error.message).toContain('message');
      expect(result.error.message).not.toContain('xxxx');
    }
  });

  it('accepts a body exactly at the 64 KB cap', () => {
    const schema = z.object({ pad: z.string() });
    const overhead = Buffer.byteLength(JSON.stringify({ pad: '' }));
    const body = JSON.stringify({ pad: 'a'.repeat(MAX_BODY_BYTES - overhead) });
    expect(Buffer.byteLength(body)).toBe(MAX_BODY_BYTES);
    expect(parseBody(schema, { body }).ok).toBe(true);
  });

  it('returns 413 payload_too_large one byte over the cap, before parsing', () => {
    const schema = z.object({ pad: z.string() });
    const overhead = Buffer.byteLength(JSON.stringify({ pad: '' }));
    const body = JSON.stringify({ pad: 'a'.repeat(MAX_BODY_BYTES - overhead + 1) });
    const result = parseBody(schema, { body });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
      expect(result.error.code).toBe('payload_too_large');
    }
    // Not even valid JSON: the size check still wins.
    const huge = parseBody(schema, { body: 'x'.repeat(MAX_BODY_BYTES + 1) });
    expect(huge.ok === false && huge.status).toBe(413);
  });

  it('counts bytes, not characters, for the cap', () => {
    const schema = z.object({ pad: z.string() });
    // Each "é" is 2 bytes in UTF-8, so this is under the cap in characters but over in bytes.
    const body = JSON.stringify({ pad: 'é'.repeat(MAX_BODY_BYTES / 2) });
    const result = parseBody(schema, { body });
    expect(result.ok === false && result.status).toBe(413);
  });
});

describe('parsePathParameters', () => {
  const schema = z.object({ id: z.string().min(1).max(64) });

  it('validates path parameters', () => {
    expect(parsePathParameters(schema, { pathParameters: { id: 'm03-e01' } })).toEqual({
      ok: true,
      data: { id: 'm03-e01' },
    });
  });

  it('returns 400 when they are missing', () => {
    const result = parsePathParameters(schema, { pathParameters: null });
    expect(result.ok === false && result.status).toBe(400);
  });
});
