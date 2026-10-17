import { z } from 'zod';
import { DifficultySchema } from './schemas';

/**
 * On-disk shape of one entry in `content/<module>/ejercicios.json`.
 *
 * This record carries `solution`, `hints` and `tests`, so it is for SERVER
 * code and the content validation test only. It is exposed through the
 * subpath `@tutor-agent/shared/content` and is deliberately NOT re-exported
 * from the package root, so the front end cannot import it by accident.
 */

/** One test case: `call` is a Python expression, `expected` its literal result. */
export const ExerciseTestSchema = z.object({
  name: z.string().min(1),
  call: z.string().min(1),
  expected: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});
export type ExerciseTest = z.infer<typeof ExerciseTestSchema>;

export const ExerciseRecordSchema = z.object({
  id: z.string().min(1),
  moduleId: z.string().min(1),
  title: z.string().min(1),
  statement: z.string().min(1),
  difficulty: DifficultySchema,
  prerequisites: z.array(z.string()),
  starterCode: z.string(),
  // Exactly three progressive hints: orientation, structure, almost the solution.
  hints: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
  tests: z.array(ExerciseTestSchema).min(1),
  solution: z.string().min(1),
});
export type ExerciseRecord = z.infer<typeof ExerciseRecordSchema>;
