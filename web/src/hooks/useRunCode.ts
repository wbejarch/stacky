/**
 * Runs the student's code through `POST /api/run` (Requirements 5.2, 5.3, 5.4).
 *
 * - `running` is true while a request is in flight (drives the disabled "Ejecutar" button).
 * - `result` holds the last `RunResult`; `error` holds a Spanish message safe to show.
 * - Only one run can be in flight at a time; extra calls are ignored.
 * - `reset()` clears result and error and discards any in-flight response, so a
 *   late answer for a previous exercise never shows up (call it when the exercise changes).
 * - Responses that arrive after `reset()` or after unmount are ignored.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunResult } from '@tutor-agent/shared';
import { ApiClientError, postRun } from '../api/client';

const GENERIC_ERROR = 'No se pudo ejecutar tu código. Inténtalo de nuevo.';

export interface UseRunCode {
  /** Sends the code for execution. Resolves with the result, or `null` on failure, cancellation or if ignored. */
  run: (exerciseId: string, code: string) => Promise<RunResult | null>;
  /** True while a run request is in flight. */
  running: boolean;
  /** Result of the last successful run, or `null`. */
  result: RunResult | null;
  /** Spanish error message of the last failed run, or `null`. */
  error: string | null;
  /** Clears result and error and discards any in-flight run. */
  reset: () => void;
}

export function useRunCode(): UseRunCode {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Synchronous guard against concurrent runs (state updates are asynchronous).
  const inFlight = useRef(false);
  // Incremented by `reset()` and on unmount; a response is stale if its ticket no longer matches.
  const ticket = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const discardInFlight = useCallback(() => {
    ticket.current += 1;
    controller.current?.abort();
    controller.current = null;
    inFlight.current = false;
  }, []);

  useEffect(() => {
    return () => {
      discardInFlight();
    };
  }, [discardInFlight]);

  const run = useCallback(async (exerciseId: string, code: string): Promise<RunResult | null> => {
    if (inFlight.current) return null;

    inFlight.current = true;
    const myTicket = ticket.current;
    const abort = new AbortController();
    controller.current = abort;

    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const data = await postRun({ exerciseId, code }, { signal: abort.signal });
      if (ticket.current !== myTicket) return null;
      setResult(data);
      return data;
    } catch (caught) {
      if (ticket.current !== myTicket) return null;
      if (caught instanceof ApiClientError && caught.kind === 'aborted') return null;
      setError(caught instanceof ApiClientError ? caught.message : GENERIC_ERROR);
      return null;
    } finally {
      if (ticket.current === myTicket) {
        inFlight.current = false;
        controller.current = null;
        setRunning(false);
      }
    }
  }, []);

  const reset = useCallback(() => {
    discardInFlight();
    setRunning(false);
    setResult(null);
    setError(null);
  }, [discardInFlight]);

  return { run, running, result, error, reset };
}
