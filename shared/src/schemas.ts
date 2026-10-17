import { z } from 'zod';

/**
 * API contract shared by `web/` and `api/`. This file is the single source of
 * truth for request and response shapes (see stacky.md section 6).
 *
 * The public `Exercise` never carries `solution`, `hints` or `tests`; those
 * live only in the on-disk record used by server code.
 */

/** Maximum length of a chat message, in characters. */
export const MAX_MESSAGE_LENGTH = 2000;
/** Maximum length of student code sent to `/api/run`, in characters. */
export const MAX_CODE_LENGTH = 20_000;

const HintLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** Exercise difficulty, 1 (easiest) to 3. Shared with the on-disk record. */
export const DifficultySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const ModuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  exerciseCount: z.number().int().nonnegative(),
});
export type Module = z.infer<typeof ModuleSchema>;

export const LessonSchema = z.object({
  moduleId: z.string(),
  title: z.string(),
  markdown: z.string(),
});
export type Lesson = z.infer<typeof LessonSchema>;

// Public projection of an exercise: no `solution`, `hints` or `tests`.
export const ExerciseSchema = z.object({
  id: z.string(),
  moduleId: z.string(),
  title: z.string(),
  statement: z.string(),
  difficulty: DifficultySchema,
  starterCode: z.string(),
  hintsAvailable: z.number().int().min(0).max(3),
});
export type Exercise = z.infer<typeof ExerciseSchema>;

export const ChatRequestSchema = z.object({
  sessionId: z.string().min(1).max(128),
  exerciseId: z.string().min(1).max(64),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatStreamEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('token'), data: z.object({ text: z.string() }) }),
  z.object({ event: z.literal('done'), data: z.object({}) }),
  z.object({ event: z.literal('error'), data: z.object({ message: z.string() }) }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

export const HintRequestSchema = z.object({
  exerciseId: z.string().min(1).max(64),
  level: HintLevelSchema,
});
export type HintRequest = z.infer<typeof HintRequestSchema>;

export const HintResponseSchema = z.object({
  level: HintLevelSchema,
  text: z.string(),
});
export type HintResponse = z.infer<typeof HintResponseSchema>;

export const RunRequestSchema = z.object({
  exerciseId: z.string().min(1).max(64),
  code: z.string().max(MAX_CODE_LENGTH),
});
export type RunRequest = z.infer<typeof RunRequestSchema>;

export const RunResultSchema = z.object({
  passed: z.boolean(),
  tests: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      message: z.string().optional(),
    }),
  ),
  stdout: z.string(),
  stderr: z.string(),
});
export type RunResult = z.infer<typeof RunResultSchema>;

export const ProgressSchema = z.object({
  completedExerciseIds: z.array(z.string()),
  totalExercises: z.number().int().nonnegative(),
});
export type Progress = z.infer<typeof ProgressSchema>;

export const ApiErrorSchema = z.object({
  code: z.enum(['invalid_request', 'not_found', 'payload_too_large', 'internal_error']),
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
