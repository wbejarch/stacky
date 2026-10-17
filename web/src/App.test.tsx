import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from './App';
import type { TutorContextValue } from './hooks/TutorContext';

const state = vi.hoisted(() => ({
  exercise: {} as Partial<TutorContextValue['exercise']>,
  messages: [] as unknown[],
}));

vi.mock('./hooks/useTutor', () => ({
  useTutor: () => ({ exercise: state.exercise, chat: { messages: state.messages } }),
}));
vi.mock('./components/Header', () => ({ Header: () => <header>Cabecera</header> }));
vi.mock('./components/LessonPanel', () => ({
  LessonPanel: () => <section aria-label="Lección y ejercicio" />,
}));
vi.mock('./monacoSetup', () => ({}));
vi.mock('./components/ExercisePanel', () => ({
  ExercisePanel: () => <section aria-label="Ejercicio" />,
}));
vi.mock('./components/EditorPanel', () => ({
  EditorPanel: () => <section aria-label="Editor" />,
}));
vi.mock('./components/ResultsPanel', () => ({
  ResultsPanel: () => <section aria-label="Resultados" />,
}));
vi.mock('./components/TutorChat', () => ({
  TutorChat: () => <section aria-label="Tutor" />,
}));

describe('App', () => {
  beforeEach(() => {
    state.messages = [];
  });

  it('shows an accessible loading state while the initial data loads', () => {
    state.exercise = { loading: true, error: null, reload: vi.fn() };
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando');
    expect(screen.queryByLabelText('Editor')).not.toBeInTheDocument();
  });

  it('shows the error with a "Reintentar" button that reloads', async () => {
    const reload = vi.fn();
    state.exercise = { loading: false, error: 'No pudimos cargar el contenido.', reload };
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar el contenido.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('renders the three zones inside main once loaded', async () => {
    state.exercise = { loading: false, error: null, reload: vi.fn() };
    render(<App />);
    const main = screen.getByRole('main');
    expect(main).toContainElement(screen.getByLabelText('Lección y ejercicio'));
    // The editor chunk is lazy: it shows a status first and the panel afterwards.
    expect(main).toContainElement(await screen.findByLabelText('Editor'));
    expect(main).toContainElement(screen.getByLabelText('Resultados'));
    expect(main).toContainElement(screen.getByLabelText('Tutor'));
  });

  it('switches zones from the tab bar used on narrow screens', async () => {
    state.exercise = { loading: false, error: null, reload: vi.fn() };
    render(<App />);
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('data-view', 'lesson');
    await userEvent.click(screen.getByRole('button', { name: 'Práctica' }));
    expect(main).toHaveAttribute('data-view', 'practice');
    await userEvent.click(screen.getByRole('button', { name: 'Tutor' }));
    expect(main).toHaveAttribute('data-view', 'tutor');
  });

  it('flags new chat messages on the Tutor tab until the student opens it', async () => {
    state.exercise = { loading: false, error: null, reload: vi.fn() };
    const { rerender } = render(<App />);
    expect(screen.queryByTestId('tutor-unread')).not.toBeInTheDocument();

    // A hint arrives while the student is in "Lección".
    state.messages = [{ id: 'hint-1' }];
    rerender(<App />);
    expect(screen.getByTestId('tutor-unread')).toHaveTextContent('1');
    expect(screen.getByText('1 mensaje nuevo en la pestaña Tutor')).toBeInTheDocument();

    // Opening the tab clears it, and later messages count again from there.
    await userEvent.click(screen.getByRole('button', { name: 'Tutor' }));
    expect(screen.queryByTestId('tutor-unread')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Práctica' }));
    state.messages = [{ id: 'hint-1' }, { id: 'reply-1' }, { id: 'reply-2' }];
    rerender(<App />);
    expect(screen.getByTestId('tutor-unread')).toHaveTextContent('2');
  });

  it('starts counting again when the transcript is replaced by a shorter one', async () => {
    state.exercise = { loading: false, error: null, reload: vi.fn() };
    state.messages = [{ id: 'a' }, { id: 'b' }];
    const { rerender } = render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Tutor' }));
    await userEvent.click(screen.getByRole('button', { name: 'Práctica' }));

    // Another exercise has an empty transcript, then gets its first hint.
    state.messages = [];
    rerender(<App />);
    state.messages = [{ id: 'c' }];
    rerender(<App />);
    expect(screen.getByTestId('tutor-unread')).toHaveTextContent('1');
  });
});
