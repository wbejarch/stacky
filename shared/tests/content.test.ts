// Validates the on-disk module content against the shared schemas, so a broken
// `ejercicios.json` fails the build instead of failing at runtime.
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ExerciseRecordSchema, type ExerciseRecord } from '../src/content-schema';
import { exerciseIdsFor } from '../src/ids';

const MODULE_DIR = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../content/modulo-03-condicionales',
);
const MODULE_ID = basename(MODULE_DIR);

const rawExercises: unknown = JSON.parse(
  readFileSync(resolve(MODULE_DIR, 'ejercicios.json'), 'utf8'),
);

describe(`content of ${MODULE_ID}/ejercicios.json`, () => {
  const parsed = z.array(ExerciseRecordSchema).safeParse(rawExercises);

  it('parses with ExerciseRecordSchema', () => {
    if (!parsed.success) {
      expect.fail(`ejercicios.json is invalid:\n${z.prettifyError(parsed.error)}`);
    }
    expect(parsed.data.length).toBeGreaterThan(0);
  });

  // The remaining checks need valid records; the test above reports the schema errors.
  const records: ExerciseRecord[] = parsed.success ? parsed.data : [];

  it('has unique ids', () => {
    const ids = records.map((r) => r.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates, `duplicate ids: ${duplicates.join(', ')}`).toEqual([]);
  });

  it('uses the exerciseIdsFor convention (mNN-eMM, in order)', () => {
    const expected = exerciseIdsFor({
      id: MODULE_ID,
      title: MODULE_ID,
      exerciseCount: records.length,
    });
    expect(records.map((r) => r.id)).toEqual(expected);
  });

  it('has moduleId equal to the folder name on every exercise', () => {
    const wrong = records.filter((r) => r.moduleId !== MODULE_ID).map((r) => r.id);
    expect(wrong, `exercises with a wrong moduleId: ${wrong.join(', ')}`).toEqual([]);
  });

  it('has exactly 3 hints on every exercise', () => {
    const wrong = records.filter((r) => r.hints.length !== 3).map((r) => r.id);
    expect(wrong, `exercises without exactly 3 hints: ${wrong.join(', ')}`).toEqual([]);
  });

  it('has at least 3 tests on every exercise', () => {
    const wrong = records.filter((r) => r.tests.length < 3).map((r) => r.id);
    expect(wrong, `exercises with fewer than 3 tests: ${wrong.join(', ')}`).toEqual([]);
  });

  it('has a non-empty reference solution on every exercise', () => {
    const wrong = records.filter((r) => r.solution.trim() === '').map((r) => r.id);
    expect(wrong, `exercises without a solution: ${wrong.join(', ')}`).toEqual([]);
  });
});
