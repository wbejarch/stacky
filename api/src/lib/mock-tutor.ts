/**
 * Mock tutor for Phase 0. It never reacts to the student's message and never gives a solution:
 * it always answers with the same Socratic-style reply (in Spanish, because it is student-facing text).
 * Phase 1 replaces this module with the real agent behind the same API contract.
 */

/** Fixed Socratic reply: asks guiding questions and does not reveal any solution. */
export const MOCK_TUTOR_REPLY =
  '¡Buena pregunta! Antes de darte una respuesta, pensemos juntos. ' +
  '¿Qué te pide exactamente el enunciado del ejercicio? Cuéntamelo con tus palabras. ' +
  'Imagina que eres un portero de discoteca: según la edad de cada persona, ¿qué decisión tomarías? ' +
  '¿Qué condición tendrías que revisar primero? ' +
  'Intenta escribir una primera versión, aunque no sea perfecta, y ejecútala. ' +
  'Los errores son parte del camino y nos van a dar pistas. ' +
  'Si te atascas, puedes pedir una pista y seguimos paso a paso.';

/** Chat message that makes the mock fail mid-stream, to test the front-end error path. Removed in Phase 1. */
export const SIMULATE_ERROR_TRIGGER = '__simulate_error__';

/** Message sent in the `error` event when the failure is simulated. */
export const SIMULATED_ERROR_MESSAGE = 'Error simulado del tutor (Fase 0)';

/** Default pause between `token` events, in milliseconds. */
export const DEFAULT_TOKEN_DELAY_MS = 40;

/** Upper bound accepted for `MOCK_TOKEN_DELAY_MS`, so a typo cannot stall the stream. */
export const MAX_TOKEN_DELAY_MS = 5000;

/**
 * Splits a text into word fragments. Each fragment is a word with its trailing whitespace,
 * so `fragments(text).join('') === text` always holds and no fragment is empty.
 */
export function fragments(text: string = MOCK_TUTOR_REPLY): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

/**
 * Parses a delay value in milliseconds. Accepts only non-negative integers up to
 * {@link MAX_TOKEN_DELAY_MS}; anything else falls back to {@link DEFAULT_TOKEN_DELAY_MS}.
 */
export function parseTokenDelayMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TOKEN_DELAY_MS;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_TOKEN_DELAY_MS;
  const value = Number(trimmed);
  return value <= MAX_TOKEN_DELAY_MS ? value : DEFAULT_TOKEN_DELAY_MS;
}

/** Reads the token delay from `MOCK_TOKEN_DELAY_MS` (default 40 ms). */
export function getTokenDelayMs(env: Record<string, string | undefined> = process.env): number {
  return parseTokenDelayMs(env.MOCK_TOKEN_DELAY_MS);
}

/** Resolves after `ms` milliseconds. Resolves immediately when `ms` is 0 or less. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
