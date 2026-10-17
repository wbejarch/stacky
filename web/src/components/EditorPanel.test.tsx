import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postHint } from '../api/client';
import { makeTutorValue, RealChatProvider, renderWithTutor } from '../test/tutor-fixtures';
import { EditorPanel } from './EditorPanel';

// Monaco cannot run in jsdom: replace it with a plain textarea that keeps the same props contract.
vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
    options,
  }: {
    value?: string;
    onChange?: (value: string | undefined) => void;
    options?: { ariaLabel?: string; readOnly?: boolean };
  }) => (
    <textarea
      aria-label={options?.ariaLabel}
      readOnly={options?.readOnly}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSessionId: vi.fn(() => 'session-1'), streamChat: vi.fn(), postHint: vi.fn() };
});

const hintButton = (level: number) => screen.getByTestId(`hint-button-${level}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EditorPanel: hint buttons', () => {
  it.each([
    [0, [false, true, true]],
    [1, [false, false, true]],
    [2, [false, false, false]],
    [3, [false, false, false]],
  ])('with %i hints used, disabled state of buttons 1-3 is %j', (hintsUsed, disabled) => {
    renderWithTutor(<EditorPanel />, makeTutorValue({ chat: { hintsUsed } }));
    [1, 2, 3].forEach((level, index) => {
      if (disabled[index]) expect(hintButton(level)).toBeDisabled();
      else expect(hintButton(level)).toBeEnabled();
    });
  });

  it('calls requestHint with the level of the clicked button', async () => {
    const requestHint = vi.fn(() => Promise.resolve());
    renderWithTutor(<EditorPanel />, makeTutorValue({ chat: { hintsUsed: 1, requestHint } }));

    await userEvent.click(screen.getByRole('button', { name: 'Pista 2' }));

    expect(requestHint).toHaveBeenCalledTimes(1);
    expect(requestHint).toHaveBeenCalledWith(2);
  });

  it('does not request a locked hint', async () => {
    const requestHint = vi.fn(() => Promise.resolve());
    renderWithTutor(<EditorPanel />, makeTutorValue({ chat: { hintsUsed: 0, requestHint } }));

    await userEvent.click(hintButton(3));

    expect(requestHint).not.toHaveBeenCalled();
  });

  it('disables every hint button while a hint is loading', () => {
    renderWithTutor(<EditorPanel />, makeTutorValue({ chat: { hintsUsed: 3, hintLoading: true } }));
    [1, 2, 3].forEach((level) => expect(hintButton(level)).toBeDisabled());
  });

  it('shows the hint error as an alert', () => {
    renderWithTutor(<EditorPanel />, makeTutorValue({ chat: { hintError: 'No se pudo obtener la pista.' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo obtener la pista.');
  });

  it('unlocks the levels in order 1 -> 2 -> 3 with the real useChat hook', async () => {
    vi.mocked(postHint).mockImplementation((request) =>
      Promise.resolve({ level: request.level, text: `texto de la pista ${request.level}` }),
    );
    render(
      <RealChatProvider>
        <EditorPanel />
      </RealChatProvider>,
    );

    expect(hintButton(1)).toBeEnabled();
    expect(hintButton(2)).toBeDisabled();
    expect(hintButton(3)).toBeDisabled();

    await userEvent.click(hintButton(1));
    await waitFor(() => expect(hintButton(2)).toBeEnabled());
    expect(hintButton(3)).toBeDisabled();

    await userEvent.click(hintButton(2));
    await waitFor(() => expect(hintButton(3)).toBeEnabled());

    await userEvent.click(hintButton(3));
    await waitFor(() => expect(postHint).toHaveBeenCalledTimes(3));
    expect(vi.mocked(postHint).mock.calls.map(([request]) => request.level)).toEqual([1, 2, 3]);
  });
});

describe('EditorPanel: run button', () => {
  it('is enabled and without progress indicator when idle, and calls runCode on click', async () => {
    const runCode = vi.fn(() => Promise.resolve(null));
    renderWithTutor(<EditorPanel />, makeTutorValue({ runCode }));

    const button = screen.getByRole('button', { name: 'Ejecutar' });
    expect(button).toBeEnabled();
    expect(screen.queryByTestId('run-progress')).not.toBeInTheDocument();

    await userEvent.click(button);

    expect(runCode).toHaveBeenCalledTimes(1);
  });

  it('is disabled and shows the progress indicator while running', async () => {
    const runCode = vi.fn(() => Promise.resolve(null));
    renderWithTutor(<EditorPanel />, makeTutorValue({ runState: { running: true }, runCode }));

    const button = screen.getByRole('button', { name: 'Ejecutar' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('run-progress')).toHaveTextContent('Ejecutando…');

    await userEvent.click(button);

    expect(runCode).not.toHaveBeenCalled();
  });
});

describe('EditorPanel: editor', () => {
  it('shows the current code and reports edits through setCode', () => {
    const setCode = vi.fn();
    renderWithTutor(<EditorPanel />, makeTutorValue({ exercise: { code: 'print(1)', setCode } }));

    const editor = screen.getByLabelText('Editor de código Python');
    expect(editor).toHaveValue('print(1)');

    fireEvent.change(editor, { target: { value: 'print(2)' } });

    expect(setCode).toHaveBeenCalledWith('print(2)');
  });

  it('shows the keyboard-exit hint text', () => {
    renderWithTutor(<EditorPanel />);
    expect(screen.getByText('Esc y luego Tab para salir del editor')).toBeVisible();
  });

  it('disables run and hints when there is no exercise', () => {
    renderWithTutor(<EditorPanel />, makeTutorValue({ exercise: { selectedExercise: null } }));
    expect(screen.getByRole('button', { name: 'Ejecutar' })).toBeDisabled();
    [1, 2, 3].forEach((level) => expect(hintButton(level)).toBeDisabled());
  });
});
