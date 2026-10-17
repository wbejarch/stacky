/**
 * Loads the module, its lesson and its exercises, and owns the selection state
 * (Requirements 2.8, 3.4, 3.5, 3.6, 4.4, 4.5, 5.8).
 *
 * - On mount it fetches the modules, selects the first one, then fetches the
 *   lesson and every exercise whose id comes from `exerciseIdsFor` (the contract
 *   has no endpoint that lists the exercises of a module).
 * - The first exercise is selected by default.
 * - `completedIds` lives in local state only; nothing is persisted in Phase 0.
 * - All HTTP goes through `../api/client`; this hook never calls `fetch`.
 */
import { exerciseIdsFor, type Exercise, type Lesson, type Module } from '@tutor-agent/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, getExercise, getLesson, getModules } from '../api/client';

const LOAD_ERROR_MESSAGE = 'No pudimos cargar el contenido. Inténtalo de nuevo.';
const EMPTY_CONTENT_MESSAGE = 'Todavía no hay módulos disponibles.';

export interface UseExerciseResult {
  /** Modules returned by the API. */
  modules: Module[];
  /** The selected module (the first one by default), or `null` until loaded. */
  selectedModule: Module | null;
  /** Lesson of the selected module, or `null` until loaded. */
  lesson: Lesson | null;
  /** Exercises of the selected module, in content order. */
  exercises: Exercise[];
  /** The selected exercise (the first one by default), or `null` until loaded. */
  selectedExercise: Exercise | null;
  /** Selects an exercise by id and resets the editor code to its starter code. Unknown ids are ignored. */
  selectExercise: (exerciseId: string) => void;
  /** True while the initial data (or a retry) is loading. */
  loading: boolean;
  /** Spanish message safe to show to the student, or `null`. */
  error: string | null;
  /** Retries the initial load after a failure (the "Reintentar" button). */
  reload: () => void;
  /** Ids of the exercises completed in this tab (local state only). */
  completedIds: ReadonlySet<string>;
  /** Marks an exercise as completed. */
  markCompleted: (exerciseId: string) => void;
  /** Current editor code of the selected exercise; empty until an exercise is selected. */
  code: string;
  /** Updates the editor code. */
  setCode: (code: string) => void;
}

interface LoadedContent {
  modules: Module[];
  module: Module;
  lesson: Lesson;
  exercises: Exercise[];
}

async function loadContent(signal: AbortSignal): Promise<LoadedContent> {
  const modules = await getModules({ signal });
  // Stop early when the hook unmounted or a newer load started.
  signal.throwIfAborted();
  const module = modules[0];
  if (!module) {
    throw new Error(EMPTY_CONTENT_MESSAGE);
  }
  const [lesson, exercises] = await Promise.all([
    getLesson(module.id, { signal }),
    Promise.all(exerciseIdsFor(module).map((id) => getExercise(id, { signal }))),
  ]);
  return { modules, module, lesson, exercises };
}

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error && error.message === EMPTY_CONTENT_MESSAGE) return error.message;
  return LOAD_ERROR_MESSAGE;
}

export function useExercise(): UseExerciseResult {
  const [modules, setModules] = useState<Module[]>([]);
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [completedIds, setCompletedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // `cancelled` guards against state updates after unmount or after a newer
    // load started; the controller also cancels the in-flight requests.
    let cancelled = false;
    const controller = new AbortController();

    loadContent(controller.signal)
      .then((content) => {
        if (cancelled) return;
        const first = content.exercises[0] ?? null;
        setModules(content.modules);
        setSelectedModule(content.module);
        setLesson(content.lesson);
        setExercises(content.exercises);
        setSelectedExerciseId(first?.id ?? null);
        setCode(first?.starterCode ?? '');
        setError(null);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(messageFor(caught));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  const selectedExercise = exercises.find((exercise) => exercise.id === selectedExerciseId) ?? null;

  const selectExercise = useCallback(
    (exerciseId: string) => {
      const next = exercises.find((exercise) => exercise.id === exerciseId);
      if (!next) return;
      setSelectedExerciseId(next.id);
      setCode(next.starterCode);
    },
    [exercises],
  );

  const markCompleted = useCallback((exerciseId: string) => {
    setCompletedIds((previous) => {
      if (previous.has(exerciseId)) return previous;
      return new Set(previous).add(exerciseId);
    });
  }, []);

  return {
    modules,
    selectedModule,
    lesson,
    exercises,
    selectedExercise,
    selectExercise,
    loading,
    error,
    reload,
    completedIds,
    markCompleted,
    code,
    setCode,
  };
}
