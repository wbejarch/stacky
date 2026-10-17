/**
 * Shows the outcome of the last code run (Requirements 5.4, 5.8): one entry per
 * test with name, status and message, plus `stdout`, `stderr` and a celebration
 * message when every test passed. Reads everything from the tutor context.
 */
import { useTutor } from '../hooks/useTutor';
import styles from './ResultsPanel.module.css';

export function ResultsPanel() {
  const {
    runState: { running, result, error },
  } = useTutor();

  const passedCount = result?.tests.filter((test) => test.passed).length ?? 0;
  const totalCount = result?.tests.length ?? 0;

  return (
    <section className={styles.panel} aria-label="Resultados de las pruebas">
      <h2 className={styles.title}>Resultados</h2>

      {/* The live region stays mounted so screen readers announce its changes. */}
      <div className={styles.content} aria-live="polite" aria-atomic="false">
        {running && <p className={styles.info}>Ejecutando tu código…</p>}

        {!running && error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {!running && error === null && result === null && (
          <p className={styles.info}>
            Aún no has ejecutado tu código. Pulsa «Ejecutar» para ver los resultados de las pruebas.
          </p>
        )}

        {!running && result !== null && (
          <>
            {result.passed && (
              <p className={styles.celebration}>
                ¡Muy bien! Todas las pruebas pasaron. Has completado este ejercicio.
              </p>
            )}

            <p className={styles.summary}>
              {passedCount} de {totalCount} {totalCount === 1 ? 'prueba pasó' : 'pruebas pasaron'}
            </p>

            <ul className={styles.tests}>
              {result.tests.map((test, index) => (
                <li
                  key={`${index}-${test.name}`}
                  className={`${styles.test} ${test.passed ? styles.testPassed : styles.testFailed}`}
                >
                  <span className={styles.testName}>{test.name}</span>
                  <span className={styles.testStatus}>{test.passed ? '✔ Pasó' : '✘ Falló'}</span>
                  {test.message !== undefined && test.message !== '' && (
                    <span className={styles.testMessage}>{test.message}</span>
                  )}
                </li>
              ))}
            </ul>

            {result.stdout !== '' && (
              <div className={styles.output}>
                <h3 className={styles.outputTitle}>Salida (stdout)</h3>
                <pre className={styles.pre}>{result.stdout}</pre>
              </div>
            )}

            {result.stderr !== '' && (
              <div className={styles.output}>
                <h3 className={styles.outputTitle}>Errores (stderr)</h3>
                <pre className={`${styles.pre} ${styles.preError}`}>{result.stderr}</pre>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
