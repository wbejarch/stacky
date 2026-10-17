import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, postHint, streamChat, type ChatStreamHandlers } from '../api/client';
import { useChat } from './useChat';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../api/client');
  return {
    ...actual,
    getSessionId: vi.fn(() => 'session-1'),
    streamChat: vi.fn(),
    postHint: vi.fn(),
  };
});

const streamChatMock = vi.mocked(streamChat);
const postHintMock = vi.mocked(postHint);

/** A controllable `streamChat` call: tests push tokens and terminal events by hand. */
interface FakeStream {
  handlers: ChatStreamHandlers;
  signal: AbortSignal | undefined;
  request: Parameters<typeof streamChat>[0];
  /** Resolves the promise returned to the hook (the stream "closed"). */
  close: () => void;
  /** Rejects the promise (failure before the stream started). */
  fail: (error: unknown) => void;
}

function queueFakeStreams(): FakeStream[] {
  const streams: FakeStream[] = [];
  streamChatMock.mockImplementation((request, handlers, signal) => {
    return new Promise<void>((resolve, reject) => {
      streams.push({ handlers, signal, request, close: resolve, fail: reject });
    });
  });
  return streams;
}

function lastStream(streams: FakeStream[]): FakeStream {
  const stream = streams.at(-1);
  if (!stream) throw new Error('No stream was started');
  return stream;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useChat: streaming', () => {
  it('appends the student message and tokens incrementally, and done re-enables sending', async () => {
    const streams = queueFakeStreams();
    const { result } = renderHook(() => useChat('m03-e01'));

    act(() => result.current.send('  Hola tutor  '));

    expect(result.current.streaming).toBe(true);
    expect(result.current.messages.map((m) => [m.role, m.text])).toEqual([
      ['student', 'Hola tutor'],
      ['tutor', ''],
    ]);
    expect(lastStream(streams).request).toEqual({
      sessionId: 'session-1',
      exerciseId: 'm03-e01',
      message: 'Hola tutor',
    });

    act(() => lastStream(streams).handlers.onToken('¿Qué '));
    expect(result.current.messages[1]?.text).toBe('¿Qué ');
    expect(result.current.streaming).toBe(true);

    act(() => lastStream(streams).handlers.onToken('crees?'));
    expect(result.current.messages[1]?.text).toBe('¿Qué crees?');

    act(() => {
      lastStream(streams).handlers.onDone();
      lastStream(streams).close();
    });
    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.error).toBeNull();

    // Sending works again after done.
    act(() => result.current.send('Otra pregunta'));
    expect(streams).toHaveLength(2);
    expect(result.current.messages).toHaveLength(4);
  });

  it('ignores send while a reply is streaming', () => {
    const streams = queueFakeStreams();
    const { result } = renderHook(() => useChat('m03-e01'));

    act(() => result.current.send('primera'));
    act(() => result.current.send('segunda'));

    expect(streams).toHaveLength(1);
    expect(result.current.messages.filter((m) => m.role === 'student')).toHaveLength(1);
  });

  it('ignores empty messages and a missing exercise', () => {
    const streams = queueFakeStreams();
    const empty = renderHook(() => useChat('m03-e01'));
    act(() => empty.result.current.send('   '));
    const none = renderHook(() => useChat(null));
    act(() => none.result.current.send('hola'));

    expect(streams).toHaveLength(0);
    expect(none.result.current.messages).toEqual([]);
  });

  it('cancel aborts the request and keeps the partial text', async () => {
    const streams = queueFakeStreams();
    const { result } = renderHook(() => useChat('m03-e01'));

    act(() => result.current.send('hola'));
    act(() => lastStream(streams).handlers.onToken('Pensemos '));
    act(() => result.current.cancel());

    expect(lastStream(streams).signal?.aborted).toBe(true);
    expect(result.current.streaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.messages[1]?.text).toBe('Pensemos ');

    // Late tokens after cancel are ignored.
    act(() => lastStream(streams).handlers.onToken('ignorado'));
    expect(result.current.messages[1]?.text).toBe('Pensemos ');

    // The input is usable again.
    act(() => result.current.send('de nuevo'));
    expect(streams).toHaveLength(2);
  });

  it('cancel before the first token removes the empty tutor message', () => {
    queueFakeStreams();
    const { result } = renderHook(() => useChat('m03-e01'));

    act(() => result.current.send('hola'));
    act(() => result.current.cancel());

    expect(result.current.messages.map((m) => m.role)).toEqual(['student']);
  });

  it('aborts the stream on unmount', () => {
    const streams = queueFakeStreams();
    const { result, unmount } = renderHook(() => useChat('m03-e01'));

    act(() => result.current.send('hola'));
    unmount();

    expect(lastStream(streams).signal?.aborted).toBe(true);
  });
});

describe('useChat: errors and retry', () => {
  it('shows the error from an error event and retry replaces the failed tutor message', async () => {
    const streams = queueFakeStreams();
    const { result } = renderHook(() => useChat('m03-e01'));

    act(() => result.current.send('hola'));
    act(() => lastStream(streams).handlers.onToken('Parcial'));
    act(() => {
      lastStream(streams).handlers.onError('La conversación con el tutor se interrumpió.');
      lastStream(streams).close();
    });

    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.error).toBe('La conversación con el tutor se interrumpió.');
    expect(result.current.messages[1]).toMatchObject({ text: 'Parcial', failed: true });

    act(() => result.current.retry());

    // Same student message, failed reply replaced by a fresh empty one.
    expect(streams).toHaveLength(2);
    expect(lastStream(streams).request.message).toBe('hola');
    expect(result.current.error).toBeNull();
    expect(result.current.streaming).toBe(true);
    expect(result.current.messages.map((m) => [m.role, m.text])).toEqual([
      ['student', 'hola'],
      ['tutor', ''],
    ]);

    act(() => {
      lastStream(streams).handlers.onToken('Listo');
      lastStream(streams).handlers.onDone();
      lastStream(streams).close();
    });
    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.messages.map((m) => m.text)).toEqual(['hola', 'Listo']);
  });

  it('maps a network failure before the stream starts to a Spanish error and allows retry', async () => {
    const streams = queueFakeStreams();
    const { result } = renderHook(() => useChat('m03-e01'));

    act(() => result.current.send('hola'));
    act(() => {
      lastStream(streams).fail(
        new ApiClientError({ kind: 'network', message: 'No se pudo conectar con el servidor.' }),
      );
    });

    await waitFor(() => expect(result.current.error).toBe('No se pudo conectar con el servidor.'));
    expect(result.current.streaming).toBe(false);
    // The empty tutor message is dropped; the student message stays.
    expect(result.current.messages.map((m) => m.role)).toEqual(['student']);

    act(() => result.current.retry());
    expect(streams).toHaveLength(2);
    expect(result.current.messages.map((m) => m.role)).toEqual(['student', 'tutor']);
  });

  it('uses a generic Spanish message for unexpected failures', async () => {
    const streams = queueFakeStreams();
    const { result } = renderHook(() => useChat('m03-e01'));

    act(() => result.current.send('hola'));
    act(() => lastStream(streams).fail(new Error('boom')));

    await waitFor(() => expect(result.current.error).toMatch(/tutor/i));
    expect(result.current.error).not.toContain('boom');
  });

  it('retry does nothing without a prior error', () => {
    const streams = queueFakeStreams();
    const { result } = renderHook(() => useChat('m03-e01'));

    act(() => result.current.retry());

    expect(streams).toHaveLength(0);
  });
});

describe('useChat: hints', () => {
  it('enables hint levels in order and tracks progress per exercise', async () => {
    postHintMock.mockImplementation(async ({ level }) => ({ level, text: `texto ${level}` }));
    const { result, rerender } = renderHook(({ id }) => useChat(id), { initialProps: { id: 'm03-e01' } });

    expect(result.current.hintsUsed).toBe(0);
    expect(result.current.canRequestHint(1)).toBe(true);
    expect(result.current.canRequestHint(2)).toBe(false);
    expect(result.current.canRequestHint(3)).toBe(false);
    expect(result.current.canRequestHint(4)).toBe(false);
    expect(result.current.canRequestHint(0)).toBe(false);

    // Level 2 is ignored while level 1 has not been used.
    await act(() => result.current.requestHint(2));
    expect(postHintMock).not.toHaveBeenCalled();

    await act(() => result.current.requestHint(1));
    expect(result.current.hintsUsed).toBe(1);
    expect(result.current.canRequestHint(2)).toBe(true);
    expect(result.current.canRequestHint(3)).toBe(false);

    await act(() => result.current.requestHint(2));
    await act(() => result.current.requestHint(3));
    expect(result.current.hintsUsed).toBe(3);
    expect(result.current.canRequestHint(3)).toBe(true);
    expect(postHintMock.mock.calls.map(([request]) => request)).toEqual([
      { exerciseId: 'm03-e01', level: 1 },
      { exerciseId: 'm03-e01', level: 2 },
      { exerciseId: 'm03-e01', level: 3 },
    ]);

    // Another exercise starts from zero; the first one keeps its progress.
    rerender({ id: 'm03-e02' });
    expect(result.current.hintsUsed).toBe(0);
    expect(result.current.canRequestHint(2)).toBe(false);

    rerender({ id: 'm03-e01' });
    expect(result.current.hintsUsed).toBe(3);
  });

  it('inserts the hint in the transcript as a tutor message labelled "Pista N"', async () => {
    postHintMock.mockResolvedValue({ level: 1, text: 'Piensa en la condición.' });
    const streams = queueFakeStreams();
    const { result } = renderHook(() => useChat('m03-e01'));

    act(() => result.current.send('ayuda'));
    act(() => {
      lastStream(streams).handlers.onToken('Hola');
      lastStream(streams).handlers.onDone();
      lastStream(streams).close();
    });
    await waitFor(() => expect(result.current.streaming).toBe(false));

    await act(() => result.current.requestHint(1));

    expect(result.current.messages).toHaveLength(3);
    expect(result.current.messages[2]).toMatchObject({
      role: 'tutor',
      kind: 'hint',
      label: 'Pista 1',
      text: 'Piensa en la condición.',
    });
  });

  it('exposes hintLoading while the request is pending and ignores a second click', async () => {
    let resolveHint: (value: { level: 1; text: string }) => void = () => undefined;
    postHintMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHint = resolve;
        }),
    );
    const { result } = renderHook(() => useChat('m03-e01'));

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.requestHint(1);
    });
    expect(result.current.hintLoading).toBe(true);

    await act(() => result.current.requestHint(1));
    expect(postHintMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveHint({ level: 1, text: 'pista' });
      await first;
    });
    expect(result.current.hintLoading).toBe(false);
    expect(result.current.hintsUsed).toBe(1);
  });

  it('reports a hint failure without consuming the level', async () => {
    postHintMock.mockRejectedValue(new ApiClientError({ kind: 'network', message: 'Sin conexión.' }));
    const { result } = renderHook(() => useChat('m03-e01'));

    await act(() => result.current.requestHint(1));

    expect(result.current.hintError).toBe('Sin conexión.');
    expect(result.current.hintsUsed).toBe(0);
    expect(result.current.messages).toEqual([]);
    expect(result.current.hintLoading).toBe(false);
  });
});

describe('useChat: per-exercise transcripts', () => {
  it('keeps a separate transcript per exercise and aborts a reply when the exercise changes', async () => {
    const streams = queueFakeStreams();
    const { result, rerender } = renderHook(({ id }) => useChat(id), { initialProps: { id: 'm03-e01' } });

    act(() => result.current.send('hola e01'));
    act(() => lastStream(streams).handlers.onToken('parcial'));

    rerender({ id: 'm03-e02' });
    expect(lastStream(streams).signal?.aborted).toBe(true);
    expect(result.current.streaming).toBe(false);
    expect(result.current.messages).toEqual([]);

    rerender({ id: 'm03-e01' });
    expect(result.current.messages.map((m) => m.text)).toEqual(['hola e01', 'parcial']);
  });
});
