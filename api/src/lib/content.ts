import { z } from 'zod';
import type { Exercise, Lesson, Module } from '@tutor-agent/shared';
// Server-side only: the record carries `solution`, `hints` and `tests`.
import { ExerciseRecordSchema, type ExerciseRecord } from '@tutor-agent/shared/content';
// Bundled by esbuild (`.json` native, `.md` as `text`); Vitest uses an equivalent plugin.
import exercisesJson from '../../../content/modulo-03-condicionales/ejercicios.json';
import lessonMarkdown from '../../../content/modulo-03-condicionales/leccion.md';

/** A module with its content already loaded and validated. */
interface ModuleRecord {
  /** Folder name under `content/`. */
  id: string;
  /** First `#` heading of `leccion.md`. */
  title: string;
  markdown: string;
  exercises: ExerciseRecord[];
}

/** Extracts the text of the first level-1 heading (`# Title`) of a Markdown document. */
function extractTitle(markdown: string, moduleId: string): string {
  const match = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(markdown);
  const title = match?.[1]?.trim();
  if (!title) throw new Error(`Module ${moduleId}: leccion.md has no "#" heading`);
  return title;
}

/** Validates the raw content of one module. Throws on invalid content (fail fast at cold start). */
function buildModule(id: string, markdown: string, rawExercises: unknown): ModuleRecord {
  const parsed = z.array(ExerciseRecordSchema).safeParse(rawExercises);
  if (!parsed.success) {
    throw new Error(`Module ${id}: invalid ejercicios.json\n${z.prettifyError(parsed.error)}`);
  }
  return { id, title: extractTitle(markdown, id), markdown, exercises: parsed.data };
}

// Only module 3 has content in Phase 0. Add new modules here as they are authored.
const MODULES: readonly ModuleRecord[] = [
  buildModule('modulo-03-condicionales', lessonMarkdown, exercisesJson),
];

const EXERCISES_BY_ID: ReadonlyMap<string, ExerciseRecord> = new Map(
  MODULES.flatMap((module) => module.exercises.map((exercise) => [exercise.id, exercise] as const)),
);

/** Modules that have content, in order. */
export function listModules(): Module[] {
  return MODULES.map((module) => ({
    id: module.id,
    title: module.title,
    exerciseCount: module.exercises.length,
  }));
}

/** Lesson of a module, or `undefined` if the module has no content. */
export function getLesson(moduleId: string): Lesson | undefined {
  const module = MODULES.find((candidate) => candidate.id === moduleId);
  if (!module) return undefined;
  return { moduleId: module.id, title: module.title, markdown: module.markdown };
}

/**
 * Full exercise record, including `solution`, `hints` and `tests`.
 * SERVER ONLY: never serialize this value; use `toPublicExercise` for responses.
 */
export function getExerciseRecord(id: string): ExerciseRecord | undefined {
  return EXERCISES_BY_ID.get(id);
}

/**
 * Public projection of an exercise. Built field by field (allowlist) on purpose:
 * never spread the record, so a field added to the content later cannot leak.
 */
export function toPublicExercise(record: ExerciseRecord): Exercise {
  return {
    id: record.id,
    moduleId: record.moduleId,
    title: record.title,
    statement: record.statement,
    difficulty: record.difficulty,
    starterCode: record.starterCode,
    hintsAvailable: record.hints.length,
  };
}
