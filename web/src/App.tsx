import { lazy, Suspense, useState } from 'react';
import styles from './App.module.css';
import { ExercisePanel } from './components/ExercisePanel';
import { Header } from './components/Header';
import { LessonPanel } from './components/LessonPanel';
import { ResultsPanel } from './components/ResultsPanel';
import { TutorChat } from './components/TutorChat';
import { useTutor } from './hooks/useTutor';

// Monaco is heavy: load it (and bundle it, see monacoSetup.ts) in its own chunk
// so the lesson and the chat are interactive before the editor arrives.
const EditorPanel = lazy(async () => {
  const [{ EditorPanel: component }] = await Promise.all([
    import('./components/EditorPanel'),
    import('./monacoSetup'),
  ]);
  return { default: component };
});

type View = 'lesson' | 'practice' | 'tutor';

const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'lesson', label: 'Lección' },
  { id: 'practice', label: 'Práctica' },
  { id: 'tutor', label: 'Tutor' },
];

/**
 * Header plus the three zones (Requirement 3.1): lesson, practice (exercise,
 * editor and results) and chat.
 *
 * From 900 px up the zones sit side by side and each one scrolls on its own, so
 * the editor and the chat never leave the screen. Below 900 px a bottom tab bar
 * shows one zone at a time (see App.module.css). Hints and tutor replies land in
 * the chat zone, so the "Tutor" tab shows how many messages are still unseen.
 */
export function App() {
  const { exercise, chat } = useTutor();
  const { loading, error, reload } = exercise;
  const [view, setView] = useState<View>('lesson');

  // Unseen tutor messages: everything added to the transcript since the student
  // last left the "Tutor" tab. The mark is set when leaving that tab.
  const messageCount = chat.messages.length;
  const [seenCount, setSeenCount] = useState(0);
  if (seenCount > messageCount) {
    // The transcript is shorter (another exercise was selected): never keep a larger mark.
    setSeenCount(messageCount);
  }
  const unread = view === 'tutor' ? 0 : Math.max(0, messageCount - seenCount);

  const showView = (next: View) => {
    if (view === 'tutor' && next !== 'tutor') setSeenCount(messageCount);
    setView(next);
  };

  if (loading) {
    return (
      <div className={styles.app}>
        <Header />
        <main className={styles.state}>
          <p role="status" className={styles.message}>
            <span className={styles.spinner} aria-hidden="true" />
            Cargando la lección…
          </p>
        </main>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className={styles.app}>
        <Header />
        <main className={styles.state}>
          <div role="alert" className={`${styles.message} ${styles.errorBox}`}>
            <p className={styles.errorText}>{error}</p>
            <button type="button" className={styles.retry} onClick={reload}>
              Reintentar
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <Header />
      <main className={styles.layout} data-view={view}>
        <div className={styles.zone} data-zone="lesson">
          <LessonPanel />
        </div>
        <div className={`${styles.zone} ${styles.workspace}`} data-zone="practice">
          <ExercisePanel />
          <Suspense
            fallback={
              <p role="status" className={styles.editorLoading}>
                Cargando editor…
              </p>
            }
          >
            <EditorPanel />
          </Suspense>
          <ResultsPanel />
        </div>
        <div className={styles.zone} data-zone="tutor">
          <TutorChat />
        </div>
      </main>
      <nav className={styles.tabbar} aria-label="Secciones">
        {VIEWS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={id === view ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            aria-current={id === view ? 'page' : undefined}
            onClick={() => {
              showView(id);
            }}
          >
            {label}
            {id === 'tutor' && unread > 0 ? (
              <span className={styles.badge} aria-hidden="true" data-testid="tutor-unread">
                {unread}
              </span>
            ) : null}
          </button>
        ))}
        <p role="status" className={styles.visuallyHidden}>
          {unread > 0
            ? `${unread} ${unread === 1 ? 'mensaje nuevo' : 'mensajes nuevos'} en la pestaña Tutor`
            : ''}
        </p>
      </nav>
    </div>
  );
}
