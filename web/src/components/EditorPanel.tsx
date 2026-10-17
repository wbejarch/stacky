/**
 * Editor zone (Requirements 5.1, 5.2, 5.3, 7.1, 7.2, 7.3, 14.3).
 *
 * - Monaco editor in Python mode. The code lives in the tutor context: the
 *   exercise hook resets it to the starter code whenever the exercise changes.
 * - "Ejecutar" is disabled and shows a progress indicator while a run is in flight.
 * - Three hint buttons. Button N is enabled only when `hintsUsed >= N - 1`
 *   (see `chat.canRequestHint`); the hint text goes to the chat transcript as "Pista N".
 * - A visible line explains how to leave the editor with the keyboard.
 *
 * Reads everything from context; it does not render the results panel.
 */
import Editor from '@monaco-editor/react';
import { useId } from 'react';
import { useTutor } from '../hooks/useTutor';
import styles from './EditorPanel.module.css';

const HINT_LEVELS = [1, 2, 3] as const;

export function EditorPanel() {
  const {
    exercise: { selectedExercise, code, setCode },
    runState: { running },
    chat: { canRequestHint, requestHint, hintLoading, hintError },
    runCode,
  } = useTutor();

  const keyboardHintId = useId();
  const hintsHelpId = useId();
  const hasExercise = selectedExercise !== null;

  return (
    <section className={styles.panel} aria-label="Editor de código">
      <div className={styles.editor} data-testid="editor-container">
        <Editor
          // Remount per exercise so each one starts from a clean editor state.
          key={selectedExercise?.id ?? 'no-exercise'}
          height="100%"
          language="python"
          theme="vs"
          value={code}
          onChange={(value) => setCode(value ?? '')}
          loading="Cargando editor…"
          options={{
            ariaLabel: 'Editor de código Python',
            minimap: { enabled: false },
            fontSize: 14,
            fontLigatures: false,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            readOnly: !hasExercise,
          }}
        />
      </div>
      <p id={keyboardHintId} className={styles.keyboardHint}>
        Esc y luego Tab para salir del editor
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.runButton}
          onClick={() => {
            void runCode();
          }}
          disabled={!hasExercise || running}
          aria-busy={running}
          data-testid="run-button"
        >
          Ejecutar
        </button>
        {running ? (
          <span className={styles.progress} role="status" data-testid="run-progress">
            <span className={styles.spinner} aria-hidden="true" />
            Ejecutando…
          </span>
        ) : null}
      </div>

      <div className={styles.hints} role="group" aria-label="Pistas" aria-describedby={hintsHelpId}>
        {HINT_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={styles.hintButton}
            onClick={() => {
              void requestHint(level);
            }}
            disabled={!hasExercise || hintLoading || !canRequestHint(level)}
            data-testid={`hint-button-${level}`}
          >
            Pista {level}
          </button>
        ))}
      </div>
      <p id={hintsHelpId} className={styles.hintsHelp}>
        Las pistas se desbloquean en orden. Aparecen en el chat del tutor.
      </p>
      {hintError !== null ? (
        <p className={styles.error} role="alert" data-testid="hint-error">
          {hintError}
        </p>
      ) : null}
    </section>
  );
}
