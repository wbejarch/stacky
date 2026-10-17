import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { streamChat, type ChatStreamHandlers } from '../api/client';
import type { ChatMessage } from '../hooks/useChat';
import { makeTutorValue, RealChatProvider, renderWithTutor } from '../test/tutor-fixtures';
import { TutorChat } from './TutorChat';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSessionId: vi.fn(() => 'session-1'), streamChat: vi.fn(), postHint: vi.fn() };
});

const streamChatMock = vi.mocked(streamChat);

const input = () => screen.getByLabelText('Mensaje para el tutor');
const sendButton = () => screen.getByRole('button', { name: 'Enviar' });

describe('TutorChat (fake context)', () => {
  it('shows the empty hint and an aria-live log region', () => {
    renderWithTutor(<TutorChat />);
    const log = screen.getByRole('log', { name: 'Conversación con el tutor' });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(within(log).getByText(/Escribe una pregunta o pide una pista/)).toBeInTheDocument();
  });

  it('renders student, tutor and hint messages with their speaker labels', () => {
    const messages: ChatMessage[] = [
      { id: 's1', role: 'student', text: 'Hola' },
      { id: 't1', role: 'tutor', text: '¿Qué has probado?' },
      { id: 'h1', role: 'tutor', kind: 'hint', label: 'Pista 2', text: 'Piensa en elif' },
      { id: 't2', role: 'tutor', text: 'Parcial', failed: true },
      { id: 't3', role: 'tutor', text: '' },
    ];
    renderWithTutor(<TutorChat />, makeTutorValue({ chat: { messages } }));

    const items = within(screen.getByRole('log')).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('TúHola');
    expect(items[1]).toHaveTextContent('Tutor¿Qué has probado?');
    expect(items[2]).toHaveTextContent('Pista 2Piensa en elif');
    expect(items[3]).toHaveTextContent('(respuesta incompleta)');
    expect(items[4]).toHaveTextContent('El tutor está escribiendo…');
  });

  it('renders message text as plain text, never as HTML', () => {
    const messages: ChatMessage[] = [{ id: 't1', role: 'tutor', text: '<b id="evil">negrita</b>' }];
    renderWithTutor(<TutorChat />, makeTutorValue({ chat: { messages } }));
    expect(screen.getByText('<b id="evil">negrita</b>')).toBeInTheDocument();
    expect(document.querySelector('#evil')).toBeNull();
  });

  it('disables input and send while streaming and shows "Cancelar", which calls cancel', async () => {
    const cancel = vi.fn();
    renderWithTutor(<TutorChat />, makeTutorValue({ chat: { streaming: true, cancel } }));

    expect(input()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole('log')).toHaveAttribute('aria-busy', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('enables the input and hides "Cancelar" when not streaming', () => {
    renderWithTutor(<TutorChat />);
    expect(input()).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(screen.getByRole('log')).toHaveAttribute('aria-busy', 'false');
  });

  it('shows the error with a "Reintentar" button that calls retry', async () => {
    const retry = vi.fn();
    renderWithTutor(<TutorChat />, makeTutorValue({ chat: { error: 'Se perdió la conexión.', retry } }));

    expect(screen.getByRole('alert')).toHaveTextContent('Se perdió la conexión.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('does not show an error area without an error', () => {
    renderWithTutor(<TutorChat />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('sends with Enter, trims through send, and clears the input', async () => {
    const send = vi.fn();
    renderWithTutor(<TutorChat />, makeTutorValue({ chat: { send } }));

    await userEvent.type(input(), 'Hola tutor{Enter}');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('Hola tutor');
    expect(input()).toHaveValue('');
  });

  it('does not send with Shift+Enter and keeps the newline in the draft', async () => {
    const send = vi.fn();
    renderWithTutor(<TutorChat />, makeTutorValue({ chat: { send } }));

    await userEvent.type(input(), 'línea 1{Shift>}{Enter}{/Shift}línea 2');

    expect(send).not.toHaveBeenCalled();
    expect(input()).toHaveValue('línea 1\nlínea 2');
  });

  it('sends with the "Enviar" button, which is disabled for an empty or blank draft', async () => {
    const send = vi.fn();
    renderWithTutor(<TutorChat />, makeTutorValue({ chat: { send } }));

    expect(sendButton()).toBeDisabled();
    await userEvent.type(input(), '   ');
    expect(sendButton()).toBeDisabled();
    await userEvent.type(input(), 'pregunta');
    expect(sendButton()).toBeEnabled();

    await userEvent.click(sendButton());

    expect(send).toHaveBeenCalledWith('   pregunta');
    expect(input()).toHaveValue('');
  });

  it('does not send a blank draft with Enter', async () => {
    const send = vi.fn();
    renderWithTutor(<TutorChat />, makeTutorValue({ chat: { send } }));

    await userEvent.type(input(), '  {Enter}');

    expect(send).not.toHaveBeenCalled();
  });

  it('disables the input and send when there is no exercise', () => {
    renderWithTutor(<TutorChat />, makeTutorValue({ exercise: { selectedExercise: null } }));
    expect(input()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
  });
});

/** A controllable `streamChat` call: tests push tokens and terminal events by hand. */
interface FakeStream {
  handlers: ChatStreamHandlers;
  signal: AbortSignal | undefined;
  request: Parameters<typeof streamChat>[0];
  close: () => void;
}

function queueFakeStreams(): FakeStream[] {
  const streams: FakeStream[] = [];
  streamChatMock.mockImplementation((request, handlers, signal) => {
    return new Promise<void>((resolve) => {
      streams.push({ handlers, signal, request, close: resolve });
    });
  });
  return streams;
}

function lastStream(streams: FakeStream[]): FakeStream {
  const stream = streams.at(-1);
  if (!stream) throw new Error('No stream was started');
  return stream;
}

function renderWithRealChat() {
  return render(
    <RealChatProvider>
      <TutorChat />
    </RealChatProvider>,
  );
}

describe('TutorChat (real useChat, mocked streamChat)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends tokens progressively and re-enables the input on done', async () => {
    const streams = queueFakeStreams();
    renderWithRealChat();

    await userEvent.type(input(), '¿Cómo empiezo?{Enter}');

    expect(streams).toHaveLength(1);
    expect(lastStream(streams).request).toEqual({
      sessionId: 'session-1',
      exerciseId: 'm03-e01',
      message: '¿Cómo empiezo?',
    });
    const log = screen.getByRole('log');
    expect(within(log).getByText('¿Cómo empiezo?')).toBeInTheDocument();
    expect(within(log).getByText('El tutor está escribiendo…')).toBeInTheDocument();
    expect(input()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();

    act(() => lastStream(streams).handlers.onToken('Pensemos '));
    expect(within(log).getByText('Pensemos')).toBeInTheDocument();
    expect(within(log).queryByText('El tutor está escribiendo…')).not.toBeInTheDocument();

    act(() => lastStream(streams).handlers.onToken('juntos: ¿qué debería pasar si edad es 17?'));
    expect(within(log).getByText('Pensemos juntos: ¿qué debería pasar si edad es 17?')).toBeInTheDocument();
    // Still streaming between tokens.
    expect(input()).toBeDisabled();

    await act(async () => {
      lastStream(streams).handlers.onDone();
      lastStream(streams).close();
    });

    expect(input()).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Focus returns to the input once the reply ends.
    expect(input()).toHaveFocus();
    expect(within(log).getByText('Pensemos juntos: ¿qué debería pasar si edad es 17?')).toBeInTheDocument();
  });

  it('cancel aborts the request, keeps the partial text and re-enables sending', async () => {
    const streams = queueFakeStreams();
    renderWithRealChat();

    await userEvent.type(input(), 'hola{Enter}');
    act(() => lastStream(streams).handlers.onToken('Pensemos '));
    expect(lastStream(streams).signal?.aborted).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(lastStream(streams).signal?.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(input()).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(screen.getByRole('log')).getByText('Pensemos')).toBeInTheDocument();

    // A token that arrives after cancelling is ignored.
    act(() => lastStream(streams).handlers.onToken('tarde'));
    expect(screen.queryByText(/tarde/)).not.toBeInTheDocument();
  });

  it('shows the error with "Reintentar", keeps partial text, and retry resends the same message', async () => {
    const streams = queueFakeStreams();
    renderWithRealChat();

    await userEvent.type(input(), 'ayuda{Enter}');
    act(() => lastStream(streams).handlers.onToken('Empecemos '));
    await act(async () => {
      lastStream(streams).handlers.onError('Se perdió la conexión con el tutor.');
      lastStream(streams).close();
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Se perdió la conexión con el tutor.');
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(input()).toBeEnabled();
    expect(screen.getByText('(respuesta incompleta)')).toBeInTheDocument();
    expect(screen.getByText('Empecemos')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(streams).toHaveLength(2);
    expect(lastStream(streams).request.message).toBe('ayuda');
    // The error is cleared and the failed partial reply is replaced.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('(respuesta incompleta)')).not.toBeInTheDocument();
    expect(screen.queryByText('Empecemos')).not.toBeInTheDocument();
    // The student message is not duplicated.
    expect(screen.getAllByText('ayuda')).toHaveLength(1);

    act(() => lastStream(streams).handlers.onToken('Ahora sí.'));
    await act(async () => {
      lastStream(streams).handlers.onDone();
      lastStream(streams).close();
    });

    expect(screen.getByText('Ahora sí.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input()).toBeEnabled();
  });

  it('removes the empty tutor reply and shows the error when the stream fails before any token', async () => {
    const streams = queueFakeStreams();
    renderWithRealChat();

    await userEvent.type(input(), 'hola{Enter}');
    await act(async () => {
      lastStream(streams).handlers.onError('El tutor no está disponible.');
      lastStream(streams).close();
    });

    expect(screen.getByRole('alert')).toHaveTextContent('El tutor no está disponible.');
    expect(screen.queryByText('El tutor está escribiendo…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled();
  });
});
