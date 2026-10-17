// Tests for the `shared` workspace live in `shared/tests/` (one file per source
// module, imported from `../src/`). Vitest runs them with `npm run test -w shared`.
import { describe, expect, it } from 'vitest';
import { exerciseIdsFor } from '../src/ids';
import type { Module } from '../src/schemas';

const moduleWith = (id: string, exerciseCount: number): Module => ({
  id,
  title: 'Test module',
  exerciseCount,
});

describe('exerciseIdsFor', () => {
  it('derives the module 3 ids', () => {
    expect(exerciseIdsFor(moduleWith('modulo-03-condicionales', 3))).toEqual([
      'm03-e01',
      'm03-e02',
      'm03-e03',
    ]);
  });

  it('returns an empty list when exerciseCount is 0', () => {
    expect(exerciseIdsFor(moduleWith('modulo-03-condicionales', 0))).toEqual([]);
  });

  it('keeps two-digit padding past 9 exercises', () => {
    const ids = exerciseIdsFor(moduleWith('modulo-03-condicionales', 10));
    expect(ids).toHaveLength(10);
    expect(ids[8]).toBe('m03-e09');
    expect(ids[9]).toBe('m03-e10');
  });

  it.each(['condicionales', 'modulo-3-condicionales', 'modulo-03', 'Modulo-03-x', ''])(
    'throws a clear error for the invalid module id "%s"',
    (id) => {
      expect(() => exerciseIdsFor(moduleWith(id, 3))).toThrow(/Invalid module id/);
    },
  );
});
