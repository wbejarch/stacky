// Valid and invalid samples for every public schema of the API contract, plus
// the guarantee that the public `Exercise` never leaks `solution`.
import { describe, expect, it } from 'vitest';
import { ExerciseRecordSchema } from '../src/content-schema';
import * as sharedRoot from '../src/index';
import {
  ApiErrorSchema,
  ChatRequestSchema,
  ChatStreamEventSchema,
  ExerciseSchema,
  HintRequestSchema,
  HintResponseSchema,
  LessonSchema,
  MAX_CODE_LENGTH,
  MAX_MESSAGE_LENGTH,
  ModuleSchema,
  ProgressSchema,
  RunRequestSchema,
  RunResultSchema,
} from '../src/schemas';

const validModule = { id: 'modulo-03-condicionales', title: 'Condicionales', exerciseCount: 3 };
const validLesson = {
  moduleId: 'modulo-03-condicionales',
  title: 'Condicionales',
  markdown: '# Condicionales\n\nTexto.',
};
const validExercise = {
  id: 'm03-e01',
  moduleId: 'modulo-03-condicionales',
  title: 'Clasifica edades',
  statement: 'Escribe una función.',
  difficulty: 1,
  starterCode: 'def clasificar(edad):\n    pass\n',
  hintsAvailable: 3,
};
const validChatRequest = { sessionId: 'session-1', exerciseId: 'm03-e01', message: 'Hola' };
const validRunResult = {
  passed: false,
  tests: [
    { name: 'menor de edad', passed: false, message: 'Se esperaba "menor"' },
    { name: 'adulto', passed: true },
  ],
  stdout: '',
  stderr: '',
};
const validRecord = {
  id: 'm03-e01',
  moduleId: 'modulo-03-condicionales',
  title: 'Clasifica edades',
  statement: 'Escribe una función.',
  difficulty: 1,
  prerequisites: ['modulo-02'],
  starterCode: 'def clasificar(edad):\n    pass\n',
  hints: ['pista 1', 'pista 2', 'pista 3'],
  tests: [{ name: 'menor de edad', call: 'clasificar(15)', expected: 'menor' }],
  solution: 'def clasificar(edad):\n    return "menor" if edad < 18 else "adulto"\n',
};

describe('ModuleSchema', () => {
  it('accepts a valid module', () => {
    expect(ModuleSchema.safeParse(validModule).success).toBe(true);
  });

  it.each([
    ['missing title', { id: 'x', exerciseCount: 1 }],
    ['negative exerciseCount', { ...validModule, exerciseCount: -1 }],
    ['non-integer exerciseCount', { ...validModule, exerciseCount: 1.5 }],
  ])('rejects %s', (_label, sample) => {
    expect(ModuleSchema.safeParse(sample).success).toBe(false);
  });
});

describe('LessonSchema', () => {
  it('accepts a valid lesson', () => {
    expect(LessonSchema.safeParse(validLesson).success).toBe(true);
  });

  it('rejects a lesson without markdown', () => {
    const { markdown: _markdown, ...rest } = validLesson;
    expect(LessonSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a non-string title', () => {
    expect(LessonSchema.safeParse({ ...validLesson, title: 42 }).success).toBe(false);
  });
});

describe('ExerciseSchema', () => {
  it('accepts a valid public exercise', () => {
    expect(ExerciseSchema.safeParse(validExercise).success).toBe(true);
  });

  it.each([0, 4, 1.5])('rejects difficulty %s', (difficulty) => {
    expect(ExerciseSchema.safeParse({ ...validExercise, difficulty }).success).toBe(false);
  });

  it.each([-1, 4])('rejects hintsAvailable %s', (hintsAvailable) => {
    expect(ExerciseSchema.safeParse({ ...validExercise, hintsAvailable }).success).toBe(false);
  });

  it('rejects an exercise without starterCode', () => {
    const { starterCode: _starterCode, ...rest } = validExercise;
    expect(ExerciseSchema.safeParse(rest).success).toBe(false);
  });
});

describe('public Exercise does not leak the solution', () => {
  const forbidden = ['solution', 'hints', 'tests'];

  it('has no solution, hints or tests keys in its shape', () => {
    const keys = Object.keys(ExerciseSchema.shape);
    for (const key of forbidden) {
      expect(keys).not.toContain(key);
    }
  });

  it('strips solution, hints and tests when parsing an on-disk record', () => {
    const parsed = ExerciseSchema.parse({ ...validExercise, ...validRecord, hintsAvailable: 3 });
    for (const key of forbidden) {
      expect(parsed).not.toHaveProperty(key);
    }
    expect(JSON.stringify(parsed)).not.toContain('return "menor"');
  });

  it('does not export ExerciseRecordSchema from the package root', () => {
    expect(Object.keys(sharedRoot)).not.toContain('ExerciseRecordSchema');
    expect(sharedRoot).not.toHaveProperty('ExerciseRecordSchema');
  });
});

describe('ChatRequestSchema', () => {
  it('accepts a valid request', () => {
    expect(ChatRequestSchema.safeParse(validChatRequest).success).toBe(true);
  });

  it('rejects an empty message', () => {
    expect(ChatRequestSchema.safeParse({ ...validChatRequest, message: '' }).success).toBe(false);
  });

  it('rejects a whitespace-only message', () => {
    expect(ChatRequestSchema.safeParse({ ...validChatRequest, message: '  \n\t ' }).success).toBe(
      false,
    );
  });

  it('accepts a message of exactly 2000 characters', () => {
    const message = 'a'.repeat(MAX_MESSAGE_LENGTH);
    expect(MAX_MESSAGE_LENGTH).toBe(2000);
    expect(ChatRequestSchema.safeParse({ ...validChatRequest, message }).success).toBe(true);
  });

  it('rejects a message of 2001 characters', () => {
    const message = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);
    expect(ChatRequestSchema.safeParse({ ...validChatRequest, message }).success).toBe(false);
  });

  it('rejects a missing sessionId', () => {
    const { sessionId: _sessionId, ...rest } = validChatRequest;
    expect(ChatRequestSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a missing exerciseId', () => {
    const { exerciseId: _exerciseId, ...rest } = validChatRequest;
    expect(ChatRequestSchema.safeParse(rest).success).toBe(false);
  });
});

describe('ChatStreamEventSchema', () => {
  it.each([
    ['token', { event: 'token', data: { text: 'Hola' } }],
    ['done', { event: 'done', data: {} }],
    ['error', { event: 'error', data: { message: 'Algo salió mal' } }],
  ])('accepts a %s event', (_label, sample) => {
    expect(ChatStreamEventSchema.safeParse(sample).success).toBe(true);
  });

  it('rejects an unknown event name', () => {
    expect(ChatStreamEventSchema.safeParse({ event: 'ping', data: {} }).success).toBe(false);
  });

  it.each([
    ['token without text', { event: 'token', data: {} }],
    ['token with non-string text', { event: 'token', data: { text: 1 } }],
    ['error without message', { event: 'error', data: {} }],
    ['event without data', { event: 'done' }],
  ])('rejects a wrong data shape: %s', (_label, sample) => {
    expect(ChatStreamEventSchema.safeParse(sample).success).toBe(false);
  });
});

describe('HintRequestSchema', () => {
  it.each([1, 2, 3])('accepts level %s', (level) => {
    expect(HintRequestSchema.safeParse({ exerciseId: 'm03-e01', level }).success).toBe(true);
  });

  it.each([0, 4])('rejects level %s', (level) => {
    expect(HintRequestSchema.safeParse({ exerciseId: 'm03-e01', level }).success).toBe(false);
  });

  it('rejects a missing exerciseId', () => {
    expect(HintRequestSchema.safeParse({ level: 1 }).success).toBe(false);
  });
});

describe('HintResponseSchema', () => {
  it.each([1, 2, 3])('accepts level %s', (level) => {
    expect(HintResponseSchema.safeParse({ level, text: 'Pista' }).success).toBe(true);
  });

  it.each([0, 4])('rejects level %s', (level) => {
    expect(HintResponseSchema.safeParse({ level, text: 'Pista' }).success).toBe(false);
  });

  it('rejects a missing text', () => {
    expect(HintResponseSchema.safeParse({ level: 1 }).success).toBe(false);
  });
});

describe('RunRequestSchema', () => {
  it('accepts a valid request', () => {
    expect(RunRequestSchema.safeParse({ exerciseId: 'm03-e01', code: 'print(1)' }).success).toBe(
      true,
    );
  });

  it('accepts code of exactly 20,000 characters', () => {
    const code = 'a'.repeat(MAX_CODE_LENGTH);
    expect(MAX_CODE_LENGTH).toBe(20_000);
    expect(RunRequestSchema.safeParse({ exerciseId: 'm03-e01', code }).success).toBe(true);
  });

  it('rejects code of 20,001 characters', () => {
    const code = 'a'.repeat(MAX_CODE_LENGTH + 1);
    expect(RunRequestSchema.safeParse({ exerciseId: 'm03-e01', code }).success).toBe(false);
  });

  it('rejects a missing code field', () => {
    expect(RunRequestSchema.safeParse({ exerciseId: 'm03-e01' }).success).toBe(false);
  });
});

describe('RunResultSchema', () => {
  it('accepts a valid result with and without per-test messages', () => {
    expect(RunResultSchema.safeParse(validRunResult).success).toBe(true);
  });

  it.each([
    ['missing stdout', { ...validRunResult, stdout: undefined }],
    ['non-boolean passed', { ...validRunResult, passed: 'yes' }],
    ['test without name', { ...validRunResult, tests: [{ passed: true }] }],
    ['tests not an array', { ...validRunResult, tests: 'none' }],
  ])('rejects %s', (_label, sample) => {
    expect(RunResultSchema.safeParse(sample).success).toBe(false);
  });
});

describe('ProgressSchema', () => {
  it('accepts a valid progress', () => {
    expect(
      ProgressSchema.safeParse({ completedExerciseIds: ['m03-e01'], totalExercises: 3 }).success,
    ).toBe(true);
  });

  it.each([
    ['negative total', { completedExerciseIds: [], totalExercises: -1 }],
    ['non-string ids', { completedExerciseIds: [1], totalExercises: 3 }],
    ['missing ids', { totalExercises: 3 }],
  ])('rejects %s', (_label, sample) => {
    expect(ProgressSchema.safeParse(sample).success).toBe(false);
  });
});

describe('ApiErrorSchema', () => {
  it.each(['invalid_request', 'not_found', 'payload_too_large', 'internal_error'])(
    'accepts the code %s',
    (code) => {
      expect(ApiErrorSchema.safeParse({ code, message: 'Mensaje' }).success).toBe(true);
    },
  );

  it('rejects an unknown code', () => {
    expect(ApiErrorSchema.safeParse({ code: 'teapot', message: 'Mensaje' }).success).toBe(false);
  });

  it('rejects a missing message', () => {
    expect(ApiErrorSchema.safeParse({ code: 'not_found' }).success).toBe(false);
  });
});

describe('ExerciseRecordSchema (on-disk shape)', () => {
  it('accepts a valid record', () => {
    expect(ExerciseRecordSchema.safeParse(validRecord).success).toBe(true);
  });

  it.each([
    ['2 hints', ['a', 'b']],
    ['4 hints', ['a', 'b', 'c', 'd']],
    ['an empty hint', ['a', '', 'c']],
  ])('rejects hints that are not exactly 3 non-empty strings: %s', (_label, hints) => {
    expect(ExerciseRecordSchema.safeParse({ ...validRecord, hints }).success).toBe(false);
  });

  it('rejects an empty tests list', () => {
    expect(ExerciseRecordSchema.safeParse({ ...validRecord, tests: [] }).success).toBe(false);
  });

  it('rejects a missing solution', () => {
    const { solution: _solution, ...rest } = validRecord;
    expect(ExerciseRecordSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an empty solution', () => {
    expect(ExerciseRecordSchema.safeParse({ ...validRecord, solution: '' }).success).toBe(false);
  });
});
