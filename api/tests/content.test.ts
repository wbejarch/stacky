import { describe, expect, it } from 'vitest';
import { ExerciseSchema, LessonSchema, ModuleSchema, exerciseIdsFor } from '@tutor-agent/shared';
import {
  getExerciseRecord,
  getLesson,
  listModules,
  toPublicExercise,
} from '../src/lib/content';

const MODULE_ID = 'modulo-03-condicionales';

describe('listModules', () => {
  it('returns only module 3, built from the content', () => {
    const modules = listModules();
    expect(modules).toHaveLength(1);
    const [module] = modules;
    expect(ModuleSchema.safeParse(module).success).toBe(true);
    expect(module?.id).toBe(MODULE_ID);
    expect(module?.title).toBe('Módulo 3: Condicionales');
    expect(module?.exerciseCount).toBe(3);
  });
});

describe('getLesson', () => {
  it('returns the lesson markdown of module 3', () => {
    const lesson = getLesson(MODULE_ID);
    expect(LessonSchema.safeParse(lesson).success).toBe(true);
    expect(lesson?.moduleId).toBe(MODULE_ID);
    expect(lesson?.title).toBe('Módulo 3: Condicionales');
    expect(lesson?.markdown.startsWith('# Módulo 3: Condicionales')).toBe(true);
    expect(lesson?.markdown).toContain('if');
  });

  it('returns undefined for unknown modules', () => {
    expect(getLesson('modulo-99-inexistente')).toBeUndefined();
    expect(getLesson('')).toBeUndefined();
  });
});

describe('getExerciseRecord', () => {
  it('resolves every id derived by exerciseIdsFor, including the solution', () => {
    const [module] = listModules();
    const ids = exerciseIdsFor(module!);
    expect(ids).toHaveLength(module!.exerciseCount);
    for (const id of ids) {
      const record = getExerciseRecord(id);
      expect(record?.id).toBe(id);
      expect(record?.moduleId).toBe(MODULE_ID);
      expect(record?.solution.length).toBeGreaterThan(0);
    }
  });

  it('returns undefined for unknown ids', () => {
    expect(getExerciseRecord('m99-e99')).toBeUndefined();
    expect(getExerciseRecord('')).toBeUndefined();
    expect(getExerciseRecord('__proto__')).toBeUndefined();
  });
});

describe('toPublicExercise', () => {
  const record = getExerciseRecord('m03-e01')!;
  const publicExercise = toPublicExercise(record);

  it('passes the strict ExerciseSchema', () => {
    expect(ExerciseSchema.safeParse(publicExercise).success).toBe(true);
  });

  it('has no solution, hints, tests or prerequisites keys', () => {
    for (const key of ['solution', 'hints', 'tests', 'prerequisites']) {
      expect(publicExercise).not.toHaveProperty(key);
    }
    expect(Object.keys(publicExercise).sort()).toEqual(
      ['difficulty', 'hintsAvailable', 'id', 'moduleId', 'starterCode', 'statement', 'title'].sort(),
    );
  });

  it('does not leak the solution text anywhere in the serialized output', () => {
    expect(JSON.stringify(publicExercise)).not.toContain(record.solution);
  });

  it('derives hintsAvailable from the number of hints', () => {
    expect(publicExercise.hintsAvailable).toBe(record.hints.length);
  });

  it('drops fields that are not in the allowlist even if the record has extra ones', () => {
    const polluted = { ...record, secret: 'x', extraHints: ['y'] };
    expect(toPublicExercise(polluted)).not.toHaveProperty('secret');
    expect(toPublicExercise(polluted)).not.toHaveProperty('extraHints');
  });
});
