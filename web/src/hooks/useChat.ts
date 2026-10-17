/**
 * Chat state for the tutor (Requirements 6.1 to 6.5, 7.2, 7.3).
 *
 * Responsibilities:
 * - Keeps the transcript (student messages, streamed tutor replies, hints).
 * - Streams the tutor reply through `streamChat` and appends each token as it arrives.
 * - Ignores `send` while a reply is streaming; `cancel` aborts and keeps the partial text.
 * - Surfaces chat errors in Spanish and lets the student retry the last message.
 * - Requests hints through `postHint` and inserts them in the transcript as "Pista N".
 * - Tracks hint progress per exercise.
 *
 * Design choice (transcripts): one transcript is kept PER EXERCISE, in memory
 * only. Switching exercises shows that exercise's own conversation and returns
 * to it intact when the student comes back. An in-flight reply is aborted when
 * the exercise changes (the partial text is kept) so tokens never land in the
 * wrong transcript.
 *
 * All HTTP goes through `../api/client`; this module never calls `fetch`.
 */
import type { HintRequest } from '@tutor-agent/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError, getSessionId, postHint, streamChat } from '../api/client';

export type ChatRole = 'student' | 'tutor';
export type HintLevel = HintRequest['level'];

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** Present on tutor messages that hold a hint (not a streamed reply). */
  kind?: 'hint';
  /** Label shown above a hint, for example "Pista 2". */
  label?: string;
  /** True on a tutor reply that stopped because of an error (partial text is kept). */
  failed?: boolean;
}

export interface UseChatResult {
  /** Transcript of the current exercise. */
  messages: ChatMessage[];
  /** True while a tutor reply is streaming. */
  streaming: boolean;
  /** Spanish error message of the last failed chat turn of this exercise, or null. */
  error: string | null;
  /** Sends a student message. Ignored while streaming, when empty, or without an exercise. */
  send: (text: string) => void;
  /** Aborts the reply in progress and keeps the partial text. */
  cancel: () => void;
  /** Resends the last student message after an error, replacing the failed tutor message. */
  retry: () => void;
  /** Requests the hint of `level` and appends it to the transcript. */
  requestHint: (level: number) => Promise<void>;
  /** True while a hint request is in flight. */
  hintLoading: boolean;
  /** Spanish error message of the last failed hint request, or null. */
  hintError: string | null;
  /** Number of hint levels used for the current exercise (0 to 3). */
  hintsUsed: number;
  /**
   * Level N is enabled only when level N-1 was used (level 1 is always enabled),
   * and the level must be 1, 2 or 3. Levels already used stay enabled so the
   * student can read them again.
   */
  canRequestHint: (level: number) => boolean;
}

const MAX_HINT_LEVEL = 3;
const GENERIC_CHAT_ERROR = 'No se pudo completar la respuesta del tutor. Inténtalo de nuevo.';
const GENERIC_HINT_ERROR = 'No se pudo obtener la pista. Inténtalo de nuevo.';

type Transcripts = Record<string, ChatMessage[]>;

/** Stable empty transcript, so `messages` keeps its identity when there is nothing to show. */
const NO_MESSAGES: ChatMessage[] = [];

interface ChatFailure {
  exerciseId: string;
  message: string;
  /** The student text to resend on retry. */
  text: string;
  /** The tutor message that failed, replaced on retry. */
  tutorId: string;
}

interface ActiveTurn {
  exerciseId: string;
  tutorId: string;
  controller: AbortController;
}

function isHintLevel(level: number): level is HintLevel {
  return Number.isInteger(level) && level >= 1 && level <= MAX_HINT_LEVEL;
}

export function useChat(exerciseId: string | null): UseChatResult {
  const [transcripts, setTranscripts] = useState<Transcripts>({});
  const [streaming, setStreaming] = useState(false);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const [hintsUsedByExercise, setHintsUsedByExercise] = useState<Record<string, number>>({});
  const [hintLoading, setHintLoading] = useState(false);
  const [hintFailure, setHintFailure] = useState<{ exerciseId: string; message: string } | null>(null);

  // Refs hold what must be read synchronously (double-click guards, abort handles).
  const activeTurnRef = useRef<ActiveTurn | null>(null);
  const hintControllerRef = useRef<AbortController | null>(null);
  const hintInFlightRef = useRef(false);
  const idCounterRef = useRef(0);

  const nextId = useCallback((prefix: string): string => {
    idCounterRef.current += 1;
    return `${prefix}-${idCounterRef.current}`;
  }, []);

  const updateTranscript = useCallback((id: string, change: (messages: ChatMessage[]) => ChatMessage[]) => {
    setTranscripts((prev) => ({ ...prev, [id]: change(prev[id] ?? []) }));
  }, []);

  /** Aborts the active turn (if any) and drops its tutor message when it is still empty. */
  const abortActiveTurn = useCallback(() => {
    const turn = activeTurnRef.current;
    if (!turn) return;
    activeTurnRef.current = null;
    turn.controller.abort();
    setStreaming(false);
    updateTranscript(turn.exerciseId, (messages) =>
      messages.filter((message) => !(message.id === turn.tutorId && message.text === '')),
    );
  }, [updateTranscript]);

  // Abort the reply when the exercise changes and when the component unmounts,
  // so tokens never land in another transcript or in an unmounted tree.
  useEffect(() => {
    return () => {
      abortActiveTurn();
    };
  }, [exerciseId, abortActiveTurn]);

  // Abort a pending hint request on unmount.
  useEffect(() => {
    return () => {
      hintControllerRef.current?.abort();
    };
  }, []);

  const runTurn = useCallback(
    async (turnExerciseId: string, text: string, replaceTutorId: string | null) => {
      const controller = new AbortController();
      const tutorId = nextId('tutor');
      const turn: ActiveTurn = { exerciseId: turnExerciseId, tutorId, controller };
      activeTurnRef.current = turn;

      setStreaming(true);
      setFailure(null);
      updateTranscript(turnExerciseId, (messages) => {
        const base =
          replaceTutorId === null
            ? [...messages, { id: nextId('student'), role: 'student' as const, text }]
            : messages.filter((message) => message.id !== replaceTutorId);
        return [...base, { id: tutorId, role: 'tutor' as const, text: '' }];
      });

      /** True while this turn is still the active, non-cancelled one. */
      const isActive = () => activeTurnRef.current === turn && !controller.signal.aborted;

      const finish = () => {
        activeTurnRef.current = null;
        setStreaming(false);
      };

      const fail = (message: string) => {
        if (!isActive()) return;
        finish();
        setFailure({ exerciseId: turnExerciseId, message, text, tutorId });
        // Keep the partial text and mark it failed; an empty reply is removed.
        updateTranscript(turnExerciseId, (messages) =>
          messages.flatMap((entry) => {
            if (entry.id !== tutorId) return [entry];
            return entry.text === '' ? [] : [{ ...entry, failed: true }];
          }),
        );
      };

      try {
        await streamChat(
          { sessionId: getSessionId(), exerciseId: turnExerciseId, message: text },
          {
            onToken: (fragment) => {
              if (!isActive()) return;
              updateTranscript(turnExerciseId, (messages) =>
                messages.map((entry) => (entry.id === tutorId ? { ...entry, text: entry.text + fragment } : entry)),
              );
            },
            onDone: () => {
              if (isActive()) finish();
            },
            onError: fail,
          },
          controller.signal,
        );
        // Defensive: a stream that resolved without a terminal event must not leave the chat locked.
        if (isActive()) finish();
      } catch (error) {
        if (error instanceof ApiClientError && error.kind === 'aborted') return;
        fail(error instanceof ApiClientError ? error.message : GENERIC_CHAT_ERROR);
      }
    },
    [nextId, updateTranscript],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      // The ref check (not the `streaming` state) also blocks a double submit in the same tick.
      if (exerciseId === null || trimmed === '' || activeTurnRef.current !== null) return;
      void runTurn(exerciseId, trimmed, null);
    },
    [exerciseId, runTurn],
  );

  const cancel = useCallback(() => {
    abortActiveTurn();
  }, [abortActiveTurn]);

  const retry = useCallback(() => {
    if (exerciseId === null || activeTurnRef.current !== null) return;
    if (failure === null || failure.exerciseId !== exerciseId) return;
    void runTurn(exerciseId, failure.text, failure.tutorId);
  }, [exerciseId, failure, runTurn]);

  const hintsUsed = exerciseId === null ? 0 : (hintsUsedByExercise[exerciseId] ?? 0);

  const canRequestHint = useCallback(
    (level: number): boolean => isHintLevel(level) && hintsUsed >= level - 1,
    [hintsUsed],
  );

  const requestHint = useCallback(
    async (level: number): Promise<void> => {
      if (exerciseId === null || !isHintLevel(level) || !canRequestHint(level)) return;
      if (hintInFlightRef.current) return;

      const hintExerciseId = exerciseId;
      const controller = new AbortController();
      hintControllerRef.current = controller;
      hintInFlightRef.current = true;
      setHintLoading(true);
      setHintFailure(null);

      try {
        const response = await postHint({ exerciseId: hintExerciseId, level }, { signal: controller.signal });
        updateTranscript(hintExerciseId, (messages) => [
          ...messages,
          {
            id: nextId('hint'),
            role: 'tutor',
            kind: 'hint',
            label: `Pista ${response.level}`,
            text: response.text,
          },
        ]);
        setHintsUsedByExercise((prev) => ({
          ...prev,
          [hintExerciseId]: Math.max(prev[hintExerciseId] ?? 0, response.level),
        }));
      } catch (error) {
        if (error instanceof ApiClientError && error.kind === 'aborted') return;
        setHintFailure({
          exerciseId: hintExerciseId,
          message: error instanceof ApiClientError ? error.message : GENERIC_HINT_ERROR,
        });
      } finally {
        if (hintControllerRef.current === controller) hintControllerRef.current = null;
        hintInFlightRef.current = false;
        setHintLoading(false);
      }
    },
    [canRequestHint, exerciseId, nextId, updateTranscript],
  );

  const messages = (exerciseId === null ? undefined : transcripts[exerciseId]) ?? NO_MESSAGES;
  const error = failure !== null && failure.exerciseId === exerciseId ? failure.message : null;
  const hintError = hintFailure !== null && hintFailure.exerciseId === exerciseId ? hintFailure.message : null;

  return {
    messages,
    streaming,
    error,
    send,
    cancel,
    retry,
    requestHint,
    hintLoading,
    hintError,
    hintsUsed,
    canRequestHint,
  };
}
