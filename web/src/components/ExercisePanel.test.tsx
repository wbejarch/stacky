import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Exercise } from '@tutor-agent/shared';
import { vi } from 'vitest';
import type { TutorContextValue } from '../hooks/TutorContext';
import { ExercisePanel } from './ExercisePanel';

const state = vi.hoisted(() => ({ exercise: {} as Partial<TutorContextValue['exercise']> }));

vi.mock('../hooks/useTutor', () => ({
  useTutor: () => ({ exercise: state.exercise }),
}));

function makeExercise(n: number, difficulty: Exercise['difficulty']): Exercise {
  return {
    id: `m03-e0${n}`,
    moduleId: 'modulo-03-condicionales',
    title: `Ejercicio titulo ${n}`,
    statement: `Enunciado ${n} con \`codigo\``,
    difficulty,
    starterCode: '',
    hintsAvailable: 3,
  };
}

describe('ExercisePanel', () => {
  const exercises = [makeExercise(1, 1), makeExercise(2, 2), makeExercise(3, 3)];

  function setup(selectExercise = vi.fn(), completed: string[] = []) {
    state.exercise = {
      exercises,
      selectedExercise: exercises[1],
      selectExercise,
      completedIds: new Set(completed),
    };
    render(<ExercisePanel />);
    return selectExercise;
  }

  it('shows title, statement and difficulty of the selected exercise', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Ejercicio titulo 2' })).toBeInTheDocument();
    expect(screen.getByText('Enunciado 2 con', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Dificultad: Media/)).toBeInTheDocument();
  });

  it('lets the student switch between exercises and marks the selected one', async () => {
    const selectExercise = setup();
    expect(screen.getByRole('button', { name: 'Ejercicio 2' })).toHaveAttribute('aria-current', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Ejercicio 3' }));
    expect(selectExercise).toHaveBeenCalledWith('m03-e03');
  });

  it('announces completed exercises', () => {
    setup(vi.fn(), ['m03-e01']);
    expect(screen.getByRole('button', { name: /Ejercicio 1.*completado/ })).toBeInTheDocument();
  });
});
