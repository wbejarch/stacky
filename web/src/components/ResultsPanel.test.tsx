import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeRunResult, makeTutorValue, renderWithTutor } from '../test/tutor-fixtures';
import type { TutorRunState } from '../hooks/TutorContext';
import { ResultsPanel } from './ResultsPanel';

function renderPanel(runState: Partial<TutorRunState>) {
  return renderWithTutor(<ResultsPanel />, makeTutorValue({ runState }));
}

const CELEBRATION = /Todas las pruebas pasaron/;

describe('ResultsPanel', () => {
  it('shows the empty state before the first run', () => {
    renderPanel({});
    expect(screen.getByText(/Aún no has ejecutado tu código/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the running state and hides previous results', () => {
    renderPanel({
      running: true,
      result: makeRunResult({ passed: true, tests: [{ name: 'viejo', passed: true }] }),
    });
    expect(screen.getByText('Ejecutando tu código…')).toBeInTheDocument();
    expect(screen.queryByText('viejo')).not.toBeInTheDocument();
    expect(screen.queryByText(CELEBRATION)).not.toBeInTheDocument();
    expect(screen.queryByText(/Aún no has ejecutado/)).not.toBeInTheDocument();
  });

  it('renders name, status and message for every test', () => {
    renderPanel({
      result: makeRunResult({
        passed: false,
        tests: [
          { name: 'menor de edad', passed: true },
          { name: 'borde 18', passed: false, message: 'Esperaba "adulto" y obtuve "menor"' },
        ],
      }),
    });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);

    expect(within(items[0]!).getByText('menor de edad')).toBeInTheDocument();
    expect(within(items[0]!).getByText(/Pasó/)).toBeInTheDocument();

    expect(within(items[1]!).getByText('borde 18')).toBeInTheDocument();
    expect(within(items[1]!).getByText(/Falló/)).toBeInTheDocument();
    expect(within(items[1]!).getByText('Esperaba "adulto" y obtuve "menor"')).toBeInTheDocument();

    expect(screen.getByText('1 de 2 pruebas pasaron')).toBeInTheDocument();
  });

  it('uses the singular summary for a single test', () => {
    renderPanel({ result: makeRunResult({ tests: [{ name: 'único', passed: true }] }) });
    expect(screen.getByText('1 de 1 prueba pasó')).toBeInTheDocument();
  });

  it('shows stdout and stderr only when they are not empty', () => {
    const { unmount } = renderPanel({ result: makeRunResult() });
    expect(screen.queryByText(/Salida \(stdout\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Errores \(stderr\)/)).not.toBeInTheDocument();
    unmount();

    renderPanel({ result: makeRunResult({ stdout: 'hola mundo', stderr: 'NameError: x' }) });
    expect(screen.getByText(/Salida \(stdout\)/)).toBeInTheDocument();
    expect(screen.getByText('hola mundo')).toBeInTheDocument();
    expect(screen.getByText(/Errores \(stderr\)/)).toBeInTheDocument();
    expect(screen.getByText('NameError: x')).toBeInTheDocument();
  });

  it('shows only stdout when stderr is empty', () => {
    renderPanel({ result: makeRunResult({ stdout: 'salida' }) });
    expect(screen.getByText(/Salida \(stdout\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Errores \(stderr\)/)).not.toBeInTheDocument();
  });

  it('shows the celebration message only when every test passed', () => {
    const { unmount } = renderPanel({ result: makeRunResult({ passed: false }) });
    expect(screen.queryByText(CELEBRATION)).not.toBeInTheDocument();
    unmount();

    renderPanel({ result: makeRunResult({ passed: true, tests: [{ name: 'caso', passed: true }] }) });
    expect(screen.getByText(CELEBRATION)).toBeInTheDocument();
  });

  it('shows a run error as an alert and not the empty state', () => {
    renderPanel({ error: 'No se pudo ejecutar tu código. Inténtalo de nuevo.' });
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo ejecutar tu código. Inténtalo de nuevo.');
    expect(screen.queryByText(/Aún no has ejecutado/)).not.toBeInTheDocument();
  });
});
