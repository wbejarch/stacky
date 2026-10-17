import { expect } from 'vitest';
import { z } from 'zod';
import { ExerciseRecordSchema, type ExerciseRecord } from '@tutor-agent/shared/content';
import exercisesJson from '../../../content/modulo-03-condicionales/ejercicios.json';

/** Authored exercise records, loaded straight from the content (includes `solution`). */
export const RECORDS: readonly ExerciseRecord[] = z.array(ExerciseRecordSchema).parse(exercisesJson);

export const EXERCISE_IDS: readonly string[] = RECORDS.map((record) => record.id);

/** Full reference solutions, the text that must never appear in any response. */
export const SOLUTIONS: readonly string[] = RECORDS.map((record) => record.solution);

/** Recursively collects every object key and string value of a JSON value. */
export function walk(value: unknown, keys: string[] = [], strings: string[] = []): { keys: string[]; strings: string[] } {
  if (typeof value === 'string') {
    strings.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) walk(item, keys, strings);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      keys.push(key);
      walk(item, keys, strings);
    }
  }
  return { keys, strings };
}

/** Extracts the JSON payloads of every frame of an SSE body. */
export function sseDataPayloads(body: string): unknown[] {
  return body
    .split('\n\n')
    .flatMap((frame) => frame.split('\n'))
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice('data:'.length).trim()) as unknown);
}

/**
 * Asserts that a response body (JSON, SSE or plain text) contains no `solution` key
 * at any depth and none of the reference solution texts, raw or JSON-escaped.
 */
export function assertNoSolutionLeak(body: string, solutions: readonly string[] = SOLUTIONS): void {
  const parsed: unknown[] = [];
  try {
    parsed.push(JSON.parse(body) as unknown);
  } catch {
    // Not a single JSON document: treat as SSE and inspect each frame payload.
    try {
      parsed.push(...sseDataPayloads(body));
    } catch {
      // Plain text; only the raw checks below apply.
    }
  }

  for (const value of parsed) {
    const { keys, strings } = walk(value);
    expect(keys.map((key) => key.toLowerCase())).not.toContain('solution');
    for (const text of strings) {
      for (const solution of solutions) expect(text).not.toContain(solution.trim());
    }
  }

  expect(body).not.toMatch(/["']solution["']\s*:/i);
  for (const solution of solutions) {
    const trimmed = solution.trim();
    expect(body).not.toContain(trimmed);
    expect(body).not.toContain(JSON.stringify(trimmed).slice(1, -1));
  }
}
