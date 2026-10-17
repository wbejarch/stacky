import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunResult } from '@tutor-agent/shared';
import { ApiClientError, postRun } from '../api/client';
import type * as ClientModule from '../api/client';
import { useRunCode } from './useRunCode';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return { ...actual, postRun: vi.fn() };
});

const postRunMock = vi.mocked(postRun);

const passing: RunResult = {
  passed: true,
  tests: [{ name: 'menor de edad', passed: true }],
  stdout: '',
  stderr: '',
};

/** Returns a promise plus its controls, to keep a request pending. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useRunCode', () => {
  beforeEach(() => {
    postRunMock.mockReset();
  });

  it('starts idle', () => {
    const { result } = renderHook(() => useRunCode());
    expect(result.current.running).toBe(false);
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('sets running while the call is pending and stores the result', async () => {
    const pending = deferred<RunResult>();
    postRunMock.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useRunCode());

    let promise!: Promise<RunResult | null>;
    act(() => {
      promise = result.current.run('m03-e01', 'print(1)');
    });
    expect(result.current.running).toBe(true);
    expect(postRunMock).toHaveBeenCalledWith(
      { exerciseId: 'm03-e01', code: 'print(1)' },
      expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
    );

    await act(async () => {
      pending.resolve(passing);
      await promise;
    });
    expect(result.current.running).toBe(false);
    expect(result.current.result).toEqual(passing);
    expect(result.current.error).toBeNull();
    await expect(promise).resolves.toEqual(passing);
  });

  it('exposes the Spanish message of an ApiClientError', async () => {
    postRunMock.mockRejectedValueOnce(new ApiClientError({ kind: 'network', message: 'Sin conexión.' }));
    const { result } = renderHook(() => useRunCode());

    await act(async () => {
      await result.current.run('m03-e01', 'x');
    });
    expect(result.current.error).toBe('Sin conexión.');
    expect(result.current.result).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it('uses a generic Spanish message for unexpected errors', async () => {
    postRunMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useRunCode());

    await act(async () => {
      await result.current.run('m03-e01', 'x');
    });
    expect(result.current.error).toBe('No se pudo ejecutar tu código. Inténtalo de nuevo.');
  });

  it('ignores a second run while one is in flight', async () => {
    const pending = deferred<RunResult>();
    postRunMock.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useRunCode());

    let first!: Promise<RunResult | null>;
    let second: RunResult | null | undefined;
    act(() => {
      first = result.current.run('m03-e01', 'a');
    });
    await act(async () => {
      second = await result.current.run('m03-e01', 'b');
    });
    expect(second).toBeNull();
    expect(postRunMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(passing);
      await first;
    });
    expect(result.current.result).toEqual(passing);
  });

  it('reset clears result and error', async () => {
    postRunMock.mockResolvedValueOnce(passing);
    const { result } = renderHook(() => useRunCode());
    await act(async () => {
      await result.current.run('m03-e01', 'x');
    });
    expect(result.current.result).not.toBeNull();

    act(() => result.current.reset());
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();

    postRunMock.mockRejectedValueOnce(new ApiClientError({ kind: 'http', message: 'Falla', status: 500 }));
    await act(async () => {
      await result.current.run('m03-e01', 'x');
    });
    expect(result.current.error).toBe('Falla');

    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
  });

  it('discards a response that arrives after reset and allows a new run', async () => {
    const stale = deferred<RunResult>();
    postRunMock.mockReturnValueOnce(stale.promise);
    const { result } = renderHook(() => useRunCode());

    let first!: Promise<RunResult | null>;
    act(() => {
      first = result.current.run('m03-e01', 'old');
    });
    act(() => result.current.reset());
    expect(result.current.running).toBe(false);

    await act(async () => {
      stale.resolve(passing);
      await expect(first).resolves.toBeNull();
    });
    expect(result.current.result).toBeNull();

    postRunMock.mockResolvedValueOnce({ ...passing, passed: false });
    await act(async () => {
      await result.current.run('m03-e02', 'new');
    });
    await waitFor(() => expect(result.current.result?.passed).toBe(false));
  });

  it('aborts the request and ignores the response after unmount', async () => {
    const pending = deferred<RunResult>();
    let signal: AbortSignal | undefined;
    postRunMock.mockImplementationOnce((_request, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const { result, unmount } = renderHook(() => useRunCode());

    let promise!: Promise<RunResult | null>;
    act(() => {
      promise = result.current.run('m03-e01', 'x');
    });
    unmount();
    expect(signal?.aborted).toBe(true);

    pending.resolve(passing);
    await expect(promise).resolves.toBeNull();
  });
});
