import { useEffect, useRef, useState } from 'react';
import { useTutor } from '../hooks/useTutor';
import styles from './LessonPanel.module.css';
import { Markdown } from './Markdown';

interface Section {
  id: string;
  title: string;
}

/**
 * The header already shows the module title, so drop the lesson's leading `# Title`
 * line when it repeats it. Any other leading heading is kept.
 */
export function withoutTitleHeading(markdown: string, title: string): string {
  const match = /^\s*#[ \t]+(.+?)[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (match === null || match[1]?.trim() !== title.trim()) return markdown;
  return markdown.slice(match[0].length).replace(/^\s+/, '');
}

/**
 * Lesson Markdown with a table of contents. The section list is read from the
 * rendered `##` headings (rendered as `h3`), so it always matches the content.
 */
export function LessonPanel() {
  const { exercise } = useTutor();
  const { lesson } = exercise;
  const articleRef = useRef<HTMLElement>(null);
  const [sections, setSections] = useState<Section[]>([]);

  const markdown = lesson === null ? null : withoutTitleHeading(lesson.markdown, lesson.title);

  useEffect(() => {
    const article = articleRef.current;
    if (article === null) {
      setSections([]);
      return;
    }
    const headings = Array.from(article.querySelectorAll<HTMLElement>('h3'));
    setSections(
      headings.map((heading, index) => {
        const id = `leccion-seccion-${index + 1}`;
        heading.id = id;
        return { id, title: heading.textContent };
      }),
    );
  }, [markdown]);

  const goTo = (id: string) => {
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <section className={styles.panel} aria-label="Lección">
      {lesson !== null && (
        <>
          {sections.length > 1 && (
            <nav aria-label="Contenido de la lección">
              <details className={styles.toc}>
                <summary className={styles.tocTitle}>
                  En esta lección ({sections.length} secciones)
                </summary>
                <ul className={styles.tocList}>
                  {sections.map((section) => (
                    <li key={section.id}>
                      <button
                        type="button"
                        className={styles.tocLink}
                        onClick={() => {
                          goTo(section.id);
                        }}
                      >
                        {section.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </nav>
          )}
          <article ref={articleRef} className={styles.lesson} aria-label="Texto de la lección">
            <Markdown>{markdown ?? ''}</Markdown>
          </article>
        </>
      )}
    </section>
  );
}
