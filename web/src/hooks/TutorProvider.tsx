/**
 * Single owner of the tutor state (Requirement 3.1): composes `useExercise`,
 * `useRunCode` and `useChat` and shares them through Context. No global state library.
 */
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { TutorContext, type TutorContextValue } from './TutorContext';
import { useChat } from './useChat';
import { useExercise } from './useExercise';
import { useRunCode } from './useRunCode';

export interface TutorProviderProps {
  children: ReactNode;
}

export function TutorProvider({ children }: TutorProviderProps) {
  const exercise = useExercise();
  const { run, reset: resetRun, running, result, error: runError } = useRunCode();

  const { selectedExercise, code, markCompleted } = exercise;
  const selectedExerciseId = selectedExercise?.id ?? null;
  const chat = useChat(selectedExerciseId);

  // A result belongs to one exercise: clear it (and discard any in-flight run)
  // whenever the selection changes.
  useEffect(() => {
    resetRun();
  }, [selectedExerciseId, resetRun]);

  const runCode = useCallback(async () => {
    if (selectedExerciseId === null) return null;
    const runResult = await run(selectedExerciseId, code);
    // `run` resolves with `null` when the response was discarded (exercise changed).
    if (runResult?.passed === true) {
      markCompleted(selectedExerciseId);
    }
    return runResult;
  }, [run, selectedExerciseId, code, markCompleted]);

  // The hooks return fresh objects on every render, so memoize on their fields
  // to keep the context value stable between unrelated re-renders.
  const {
    modules,
    selectedModule,
    lesson,
    exercises,
    selectExercise,
    loading,
    error: exerciseError,
    reload,
    completedIds,
    setCode,
  } = exercise;
  const {
    messages,
    streaming,
    error: chatError,
    send,
    cancel,
    retry,
    requestHint,
    hintLoading,
    hintError,
    hintsUsed,
    canRequestHint,
  } = chat;

  const value = useMemo<TutorContextValue>(
    () => ({
      exercise: {
        modules,
        selectedModule,
        lesson,
        exercises,
        selectedExercise,
        selectExercise,
        loading,
        error: exerciseError,
        reload,
        completedIds,
        markCompleted,
        code,
        setCode,
      },
      runState: { running, result, error: runError },
      chat: {
        messages,
        streaming,
        error: chatError,
        send,
        cancel,
        retry,
        requestHint,
        hintLoading,
        hintError,
        hintsUsed,
        canRequestHint,
      },
      runCode,
    }),
    [
      modules,
      selectedModule,
      lesson,
      exercises,
      selectedExercise,
      selectExercise,
      loading,
      exerciseError,
      reload,
      completedIds,
      markCompleted,
      code,
      setCode,
      running,
      result,
      runError,
      messages,
      streaming,
      chatError,
      send,
      cancel,
      retry,
      requestHint,
      hintLoading,
      hintError,
      hintsUsed,
      canRequestHint,
      runCode,
    ],
  );

  return <TutorContext.Provider value={value}>{children}</TutorContext.Provider>;
}
