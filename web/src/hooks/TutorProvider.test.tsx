import type { Exercise, Lesson, Module, RunResult } from '@tutor-agent/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ClientModule from '../api/client';
import { getExercise, getLesson, getModules, postRun } from '../api/client';
import { TutorProvider } from './TutorProvider';
import { useTutor } from './useTutor';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    getModules: vi.fn(),
    getLesson: vi.fn(),
    getExercise: vi.fn(),
    postRun: vi.fn(),
  };
});

const module3: Module = { id: 'modulo-03-condicionales', title: 'Condicionales', exerciseCount: 2 };
const lesson: Lesson = { moduleId: module3.id, title: 'Condicionales', markdown: '# Condicionales' };

function exercise(n: number): Exercise {
  return {
    id: `m03-e0${n}`,
    moduleId: module3.id,
    title: `Ejercicio ${n}`,
    statement: `Enunciado ${n}`,
    difficulty: 1,
    starterCode: `# starter ${n}\n`,
    hintsAvailable: 3,
  };
}

function runResult(passed: boolean): RunResult {
  return { passed, tests: [{ name: 'caso', passed }], stdout: '', stderr: '' };
}

function wrapper({ children }: { children: ReactNode }) {
  return <TutorProvider>{children}</TutorProvider>;
}

async function renderLoaded() {
  const hook = renderHook(() => useTutor(), { wrapper });
  await waitFor(() => expect(hook.result.current.exercise.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  const byId = new Map([exercise(1), exercise(2)].map((e) => [e.id, e]));
  vi.mocked(getModules).mockReset().mockResolvedValue([module3]);
  vi.mocked(getLesson).mockReset().mockResolvedValue(lesson);
  vi.mocked(getExercise)
    .mockReset()
    .mockImplementation(async (id) => {
      const found = byId.get(id);
      if (!found) throw new Error(`unexpected id ${id}`);
      return found;
    });
  vi.mocked(postRun).mockReset();
});

describe('TutorProvider', () => {
  it('loads the module and exposes exercise, run and chat state', async () => {
    const { result } = await renderLoaded();

    expect(result.current.exercise.error).toBeNull();
    expect(result.current.exercise.lesson).toEqual(lesson);
    expect(result.current.exercise.selectedExercise?.id).toBe('m03-e01');
    expect(result.current.exercise.code).toBe('# starter 1\n');
    expect(result.current.runState).toEqual({ running: false, result: null, error: null });
    expect(result.current.chat.messages).toEqual([]);
  });

  it('runs the editor code for the selected exercise and marks it completed on pass', async () => {
    vi.mocked(postRun).mockResolvedValueOnce(runResult(true));
    const { result } = await renderLoaded();

    act(() => {
      result.current.exercise.setCode('def clasificar(edad): return "menor"');
    });
    await act(async () => {
      await result.current.runCode();
    });

    expect(postRun).toHaveBeenCalledWith(
      { exerciseId: 'm03-e01', code: 'def clasificar(edad): return "menor"' },
      expect.anything(),
    );
    expect(result.current.runState.result?.passed).toBe(true);
    expect([...result.current.exercise.completedIds]).toEqual(['m03-e01']);
  });

  it('does not mark the exercise completed when the run fails', async () => {
    vi.mocked(postRun).mockResolvedValueOnce(runResult(false));
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.runCode();
    });

    expect(result.current.runState.result?.passed).toBe(false);
    expect(result.current.exercise.completedIds.size).toBe(0);
  });

  it('clears the run result when the selected exercise changes', async () => {
    vi.mocked(postRun).mockResolvedValueOnce(runResult(false));
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.runCode();
    });
    expect(result.current.runState.result).not.toBeNull();

    act(() => {
      result.current.exercise.selectExercise('m03-e02');
    });

    await waitFor(() => expect(result.current.runState.result).toBeNull());
    expect(result.current.exercise.selectedExercise?.id).toBe('m03-e02');
  });
});

describe('useTutor', () => {
  it('throws a clear error outside a TutorProvider', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useTutor())).toThrow(
      'useTutor must be used within a TutorProvider',
    );
    errorSpy.mockRestore();
  });
});
