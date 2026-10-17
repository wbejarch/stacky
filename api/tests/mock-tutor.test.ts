import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOKEN_DELAY_MS,
  MAX_TOKEN_DELAY_MS,
  MOCK_TUTOR_REPLY,
  fragments,
  getTokenDelayMs,
  parseTokenDelayMs,
  sleep,
} from '../src/lib/mock-tutor';

describe('MOCK_TUTOR_REPLY', () => {
  it('is non-empty Spanish text that asks guiding questions', () => {
    expect(MOCK_TUTOR_REPLY.trim().length).toBeGreaterThan(0);
    expect(MOCK_TUTOR_REPLY).toMatch(/[¿?¡áéíóúñ]/);
    expect(MOCK_TUTOR_REPLY).toContain('?');
  });

  it('does not contain code or a ready-made solution', () => {
    expect(MOCK_TUTOR_REPLY).not.toMatch(/\b(def|return|elif)\b|```/);
  });
});

describe('fragments', () => {
  it('joins back to the exact reply', () => {
    expect(fragments(MOCK_TUTOR_REPLY).join('')).toBe(MOCK_TUTOR_REPLY);
    expect(fragments().join('')).toBe(MOCK_TUTOR_REPLY);
  });

  it('produces several non-empty fragments for the reply', () => {
    const parts = fragments();
    expect(parts.length).toBeGreaterThan(10);
    expect(parts.every((part) => part.length > 0)).toBe(true);
  });

  it('preserves leading, trailing and inner whitespace', () => {
    const text = '  hola   mundo\n\nfin \n';
    const parts = fragments(text);
    expect(parts.join('')).toBe(text);
    expect(parts.every((part) => part.length > 0)).toBe(true);
  });

  it('returns no fragments for an empty string', () => {
    expect(fragments('')).toEqual([]);
  });
});

describe('parseTokenDelayMs', () => {
  it('defaults to 40 ms when the value is missing', () => {
    expect(DEFAULT_TOKEN_DELAY_MS).toBe(40);
    expect(parseTokenDelayMs(undefined)).toBe(40);
  });

  it('accepts non-negative integers, including 0', () => {
    expect(parseTokenDelayMs('0')).toBe(0);
    expect(parseTokenDelayMs('15')).toBe(15);
    expect(parseTokenDelayMs(' 100 ')).toBe(100);
    expect(parseTokenDelayMs(String(MAX_TOKEN_DELAY_MS))).toBe(MAX_TOKEN_DELAY_MS);
  });

  it('falls back to the default for invalid values', () => {
    for (const raw of ['', 'abc', '-5', '1.5', '1e3', 'NaN', 'Infinity', String(MAX_TOKEN_DELAY_MS + 1)]) {
      expect(parseTokenDelayMs(raw)).toBe(DEFAULT_TOKEN_DELAY_MS);
    }
  });
});

describe('getTokenDelayMs', () => {
  it('reads MOCK_TOKEN_DELAY_MS from the given environment', () => {
    expect(getTokenDelayMs({ MOCK_TOKEN_DELAY_MS: '5' })).toBe(5);
    expect(getTokenDelayMs({})).toBe(DEFAULT_TOKEN_DELAY_MS);
    expect(getTokenDelayMs({ MOCK_TOKEN_DELAY_MS: 'oops' })).toBe(DEFAULT_TOKEN_DELAY_MS);
  });
});

describe('sleep', () => {
  it('waits roughly the requested time', async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('resolves immediately for 0 or negative values', async () => {
    const start = Date.now();
    await sleep(0);
    await sleep(-10);
    expect(Date.now() - start).toBeLessThan(15);
  });
});
