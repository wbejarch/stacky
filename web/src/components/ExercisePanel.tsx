import type { Exercise } from '@tutor-agent/shared';
import { useTutor } from '../hooks/useTutor';
import styles from './ExercisePanel.module.css';
import { Markdown } from './Markdown';

const DIFFICULTY_LABELS: Record<Exercise['difficulty'], string> = {
  1: 'Fácil',
  2: 'Media',
  3: 'Difícil',
};

/** Exercise tabs plus the title, difficulty and statement of the selected exercise. */
export function ExercisePanel() {
  const { exercise } = useTutor();
  const { exercises, selectedExercise, selectExercise, completedIds } = exercise;

  if (exercises.length === 0 && selectedExercise === null) return null;

  return (
    <section className={styles.panel} aria-label="Ejercicio">
      {exercises.length > 0 && (
        <nav aria-label="Ejercicios">
          <ul className={styles.tabList}>
            {exercises.map((item, index) => {
              const selected = item.id === selectedExercise?.id;
              const completed = completedIds.has(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={selected ? `${styles.tab} ${styles.tabSelected}` : styles.tab}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => {
                      selectExercise(item.id);
                    }}
                  >
                    Ejercicio {index + 1}
                    {completed && (
                      <>
                        <span aria-hidden="true"> ✓</span>
                        <span className={styles.visuallyHidden}> (completado)</span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {selectedExercise !== null && (
        <article className={styles.exercise} aria-label="Ejercicio seleccionado">
          <div className={styles.titleRow}>
            <h2 className={styles.title}>{selectedExercise.title}</h2>
            <p className={styles.difficulty}>
              Dificultad: {DIFFICULTY_LABELS[selectedExercise.difficulty]} ({selectedExercise.difficulty}{' '}
              de 3)
            </p>
          </div>
          <Markdown>{selectedExercise.statement}</Markdown>
        </article>
      )}
    </section>
  );
}
