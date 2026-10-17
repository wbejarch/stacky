import { useTutor } from '../hooks/useTutor';
import styles from './Header.module.css';

/** Project name, the title of the selected module and the exercise progress. */
export function Header() {
  const { exercise } = useTutor();
  const moduleTitle = exercise.lesson?.title ?? exercise.selectedModule?.title ?? null;
  const total = exercise.exercises.length;
  const done = exercise.exercises.filter((item) => exercise.completedIds.has(item.id)).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <h1 className={styles.title}>Tutor de Python</h1>
        {moduleTitle !== null && <p className={styles.module}>{moduleTitle}</p>}
      </div>
      {total > 0 && (
        <div className={styles.progress}>
          <span className={styles.progressLabel}>
            Progreso: {done} de {total} {total === 1 ? 'ejercicio' : 'ejercicios'}
          </span>
          <div
            className={styles.bar}
            role="progressbar"
            aria-label="Progreso del módulo"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
          >
            <div className={styles.barFill} style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
    </header>
  );
}
