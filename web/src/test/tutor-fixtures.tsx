/**
 * Shared helpers for component tests: a fake tutor context value and a provider
 * that wires the REAL `useChat` hook into the context (for integration-style tests).
 */
import type { Exercise, RunResult } from '@tutor-agent/shared';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import { TutorContext, type TutorContextValue, type TutorRunState } from '../hooks/TutorContext';
import { useChat, type UseChatResult } from '../hooks/useChat';
import type { UseExerciseResult } from '../hooks/useExercise';

export function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'm03-e01',
    moduleId: 'modulo-03-condicionales',
    title: 'Clasifica edades',
    statement: 'Enunciado',
    difficulty: 1,
    starterCode: 'def clasificar(edad):\n    pass\n',
    hintsAvailable: 3,
    ...overrides,
  };
}

export function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    passed: false,
    tests: [{ name: 'caso', passed: false }],
    stdout: '',
    stderr: '',
    ...overrides,
  };
}

/** Same rule as `useChat.canRequestHint`: level N is enabled when N - 1 hints were used. */
function canRequestHintFor(hintsUsed: number) {
  return (level: number) => Number.isInteger(level) && level >= 1 && level <= 3 && hintsUsed >= level - 1;
}

export interface TutorValueOverrides {
  exercise?: Partial<UseExerciseResult>;
  runState?: Partial<TutorRunState>;
  chat?: Partial<UseChatResult>;
  runCode?: TutorContextValue['runCode'];
}

/** Builds a complete context value with `vi.fn()` callbacks; override only what a test needs. */
export function makeTutorValue(overrides: TutorValueOverrides = {}): TutorContextValue {
  const selectedExercise = overrides.exercise?.selectedExercise ?? makeExercise();
  const chatBase: UseChatResult = {
    messages: [],
    streaming: false,
    error: null,
    send: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    requestHint: vi.fn(() => Promise.resolve()),
    hintLoading: false,
    hintError: null,
    hintsUsed: 0,
    canRequestHint: () => true,
    ...overrides.chat,
  };
  const chat: UseChatResult = {
    ...chatBase,
    canRequestHint: overrides.chat?.canRequestHint ?? canRequestHintFor(chatBase.hintsUsed),
  };

  return {
    exercise: {
      modules: [],
      selectedModule: null,
      lesson: null,
      exercises: [selectedExercise],
      selectedExercise,
      selectExercise: vi.fn(),
      loading: false,
      error: null,
      reload: vi.fn(),
      completedIds: new Set<string>(),
      markCompleted: vi.fn(),
      code: selectedExercise.starterCode,
      setCode: vi.fn(),
      ...overrides.exercise,
    },
    runState: { running: false, result: null, error: null, ...overrides.runState },
    chat,
    runCode: overrides.runCode ?? vi.fn(() => Promise.resolve(null)),
  };
}

export function renderWithTutor(ui: ReactElement, value: TutorContextValue = makeTutorValue()) {
  return render(<TutorContext.Provider value={value}>{ui}</TutorContext.Provider>);
}

/** Provides the context with the real `useChat` for `exerciseId`; the rest comes from `makeTutorValue`. */
export function RealChatProvider({
  exerciseId = 'm03-e01',
  overrides,
  children,
}: {
  exerciseId?: string | null;
  overrides?: Omit<TutorValueOverrides, 'chat'>;
  children: ReactNode;
}) {
  const chat = useChat(exerciseId);
  const value = makeTutorValue({ ...overrides, chat });
  return <TutorContext.Provider value={value}>{children}</TutorContext.Provider>;
}
