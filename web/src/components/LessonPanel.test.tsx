import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { TutorContextValue } from '../hooks/TutorContext';
import { LessonPanel } from './LessonPanel';

const state = vi.hoisted(() => ({ exercise: {} as Partial<TutorContextValue['exercise']> }));

vi.mock('../hooks/useTutor', () => ({
  useTutor: () => ({ exercise: state.exercise }),
}));

function setup(markdown: string) {
  state.exercise = {
    lesson: { moduleId: 'modulo-03-condicionales', title: 'Condicionales', markdown },
  };
  return render(<LessonPanel />);
}

describe('LessonPanel', () => {
  it('renders Markdown without raw HTML', () => {
    setup('## Seccion\n\nTexto <script id="evil">x</script> <b>raw</b>');
    expect(screen.getByRole('heading', { name: 'Seccion' })).toBeInTheDocument();
    expect(document.querySelector('#evil')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });

  it('does not repeat the module title that the header already shows', () => {
    setup('# Condicionales\n\nIntroducción\n\n## Uno');
    expect(screen.queryByRole('heading', { name: 'Condicionales' })).not.toBeInTheDocument();
    expect(screen.getByText('Introducción')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Uno' })).toBeInTheDocument();
  });

  it('keeps a leading heading that is not the module title', () => {
    setup('# Otro titulo\n\nTexto');
    expect(screen.getByRole('heading', { name: 'Otro titulo' })).toBeInTheDocument();
  });

  it('renders GFM tables as real tables', () => {
    setup('| Operador | Significa |\n|---|---|\n| `==` | igual a |');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Operador' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '==' })).toBeInTheDocument();
  });

  it('highlights Python code blocks', () => {
    setup('```python\nif x > 1:\n    print("hola")\n```');
    expect(document.querySelector('.hljs-keyword')).not.toBeNull();
  });

  it('builds a table of contents from the lesson sections', () => {
    setup('# Condicionales\n\n## Uno\n\ntexto\n\n## Dos\n\ntexto');
    const toc = screen.getByRole('navigation', { name: 'Contenido de la lección' });
    expect(toc).toHaveTextContent('Uno');
    expect(toc).toHaveTextContent('Dos');
  });
});
