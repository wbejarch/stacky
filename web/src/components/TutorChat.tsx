/**
 * Tutor chat zone (Requirements 6.2 to 6.5, 14.2).
 *
 * - The transcript lives in an `aria-live="polite"` region so new messages are announced.
 * - Message text is rendered as plain text (React text nodes, never raw HTML).
 * - While the tutor replies, sending is disabled and "Cancelar" is shown.
 * - On error a Spanish message with a "Reintentar" button is shown.
 * - Enter sends, Shift+Enter inserts a newline.
 *
 * All state comes from the tutor context; this component never calls the API.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTutor } from '../hooks/useTutor';
import type { ChatMessage } from '../hooks/useChat';
import styles from './TutorChat.module.css';

/** Matches the `ChatRequest.message` limit in `shared/`. */
const MAX_MESSAGE_LENGTH = 2000;

function speakerLabel(message: ChatMessage): string {
  if (message.role === 'student') return 'Tú';
  return message.label ?? 'Tutor';
}

export function TutorChat() {
  const { chat, exercise } = useTutor();
  const { messages, streaming, error, send, cancel, retry } = chat;
  const hasExercise = exercise.selectedExercise !== null;

  const [draft, setDraft] = useState('');
  const inputId = useId();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wasStreamingRef = useRef(false);

  // Keep the newest text visible while tokens arrive.
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [messages]);

  // A disabled textarea (and the removed "Cancelar" button) drops keyboard focus
  // to <body>. When the reply ends, give focus back to the input in that case.
  useEffect(() => {
    if (wasStreamingRef.current && !streaming) {
      const active = document.activeElement;
      if (active === null || active === document.body) inputRef.current?.focus();
    }
    wasStreamingRef.current = streaming;
  }, [streaming]);

  const canSend = hasExercise && !streaming && draft.trim() !== '';

  const submit = () => {
    if (!canSend) return;
    send(draft);
    setDraft('');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // `isComposing` avoids sending while an IME composition is being confirmed.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <section className={styles.chat} aria-label="Chat con el tutor">
      <h2 className={styles.title}>Tutor</h2>

      <div
        ref={transcriptRef}
        className={styles.transcript}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={streaming}
        aria-label="Conversación con el tutor"
        tabIndex={0}
      >
        {messages.length === 0 ? (
          <p className={styles.empty}>Escribe una pregunta o pide una pista para empezar.</p>
        ) : (
          <ul className={styles.messages}>
            {messages.map((message) => (
              <li
                key={message.id}
                className={`${styles.message} ${message.role === 'student' ? styles.student : styles.tutor}`}
              >
                <span className={styles.speaker}>{speakerLabel(message)}</span>
                {message.text === '' ? (
                  <span className={styles.typing}>El tutor está escribiendo…</span>
                ) : (
                  <p className={styles.text}>{message.text}</p>
                )}
                {message.failed === true && <span className={styles.incomplete}>(respuesta incompleta)</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error !== null && (
        <div className={styles.error} role="alert">
          <p className={styles.errorText}>{error}</p>
          <button type="button" className={styles.button} onClick={retry} disabled={streaming}>
            Reintentar
          </button>
        </div>
      )}

      <form className={styles.form} onSubmit={handleSubmit}>
        <label htmlFor={inputId} className={styles.label}>
          Mensaje para el tutor
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          className={styles.input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming || !hasExercise}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={3}
          placeholder="Escribe tu pregunta…"
        />
        <p className={styles.hint}>Enter para enviar, Shift+Enter para una línea nueva.</p>
        <div className={styles.actions}>
          {streaming && (
            <button type="button" className={styles.button} onClick={cancel}>
              Cancelar
            </button>
          )}
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={!canSend}>
            Enviar
          </button>
        </div>
      </form>
    </section>
  );
}
