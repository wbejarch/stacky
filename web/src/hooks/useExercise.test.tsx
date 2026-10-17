import type { Exercise, Lesson, Module } from '@tutor-agent/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as clientModule from '../api/client';
import { ApiClientError, getExercise, getLesson, getModules } from '../api/client';
import { useExercise } from './useExercise';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof clientModule>();
  return {
    ...actual,
    getModules: vi.fn(),
    getLesson: vi.fn(),
    getExercise: vi.fn(),
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

const exercisesById = new Map([exercise(1), exercise(2)].map((e) => [e.id, e]));

beforeEach(() => {
  vi.mocked(getModules).mockReset().mockResolvedValue([module3]);
  vi.mocked(getLesson).mockReset().mockResolvedValue(lesson);
  vi.mocked(getExercise)
    .mockReset()
    .mockImplementation(async (id) => {
      const found = exercisesById.get(id);
      if (!found) throw new Error(`unexpected id ${id}`);
      return found;
    });
});

describe('useExercise', () => {
  it('loads the first module and selects the first exercise by default', async () => {
    const { result } = renderHook(() => useExercise());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.modules).toEqual([module3]);
    expect(result.current.selectedModule).toEqual(module3);
    expect(result.current.lesson).toEqual(lesson);
    expect(result.current.exercises.map((e) => e.id)).toEqual(['m03-e01', 'm03-e02']);
    expect(result.current.selectedExercise?.id).toBe('m03-e01');
    expect(result.current.code).toBe('# starter 1\n');
    expect(getLesson).toHaveBeenCalledWith(module3.id, expect.anything());
    expect(getExercise).toHaveBeenCalledTimes(2);
  });

  it('shows a Spanish error and recovers on retry', async () => {
    vi.mocked(getModules).mockRejectedValueOnce(
      new ApiClientError({ kind: 'network', message: 'No se pudo conectar con el servidor.' }),
    );
    const { result } = renderHook(() => useExercise());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('No se pudo conectar con el servidor.');
    expect(result.current.selectedExercise).toBeNull();

    act(() => {
      result.current.reload();
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.selectedExercise?.id).toBe('m03-e01');
  });

  it('falls back to a generic Spanish message for unexpected failures', async () => {
    vi.mocked(getLesson).mockRejectedValueOnce(new TypeError('boom'));
    const { result } = renderHook(() => useExercise());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('No pudimos cargar el contenido. Inténtalo de nuevo.');
  });

  it('changes the selection and resets the code to the starter code', async () => {
    const { result } = renderHook(() => useExercise());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setCode('print("edited")');
    });
    expect(result.current.code).toBe('print("edited")');

    act(() => {
      result.current.selectExercise('m03-e02');
    });
    expect(result.current.selectedExercise?.id).toBe('m03-e02');
    expect(result.current.code).toBe('# starter 2\n');

    act(() => {
      result.current.selectExercise('does-not-exist');
    });
    expect(result.current.selectedExercise?.id).toBe('m03-e02');
  });

  it('marks exercises as completed in local state', async () => {
    const { result } = renderHook(() => useExercise());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.completedIds.size).toBe(0);

    act(() => {
      result.current.markCompleted('m03-e01');
      result.current.markCompleted('m03-e01');
    });
    expect([...result.current.completedIds]).toEqual(['m03-e01']);
  });

  it('does not update state after unmount', async () => {
    let resolveModules: (value: Module[]) => void = () => undefined;
    vi.mocked(getModules).mockReturnValueOnce(
      new Promise<Module[]>((resolve) => {
        resolveModules = resolve;
      }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result, unmount } = renderHook(() => useExercise());
    unmount();
    resolveModules([module3]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.current.loading).toBe(true);
    expect(getLesson).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
