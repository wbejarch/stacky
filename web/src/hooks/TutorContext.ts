/**
 * Context object and value type for the tutor state (Requirement 3.1).
 *
 * Kept apart from `TutorProvider.tsx` (component) and `useTutor.ts` (hook) so
 * each file exports one kind of thing, which keeps React Fast Refresh working.
 */
import type { RunResult } from '@tutor-agent/shared';
import { createContext } from 'react';
import type { UseChatResult } from './useChat';
import type { UseExerciseResult } from './useExercise';
import type { UseRunCode } from './useRunCode';

/** State of the last code run, without the imperative `run` and `reset` (use `runCode`). */
export type TutorRunState = Pick<UseRunCode, 'running' | 'result' | 'error'>;

export interface TutorContextValue {
  /** Module, lesson, exercises, selection, editor code and local completion. */
  exercise: UseExerciseResult;
  /** Running flag, result and error of the last code run for the selected exercise. */
  runState: TutorRunState;
  /** Chat transcript, streaming and hint state for the selected exercise. */
  chat: UseChatResult;
  /**
   * Runs the current editor code against the selected exercise. When every test
   * passes, the exercise is marked as completed (local state only).
   * Resolves with the result, or `null` when there is no exercise, the run failed,
   * was cancelled, or another run is in flight.
   */
  runCode: () => Promise<RunResult | null>;
}

/** `null` means "outside a TutorProvider"; `useTutor` turns that into an error. */
export const TutorContext = createContext<TutorContextValue | null>(null);
