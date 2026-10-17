import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import python from 'highlight.js/lib/languages/python';
import styles from './Markdown.module.css';

export interface MarkdownProps {
  /** Markdown source. */
  children: string;
  className?: string;
}

// The page title is the only `h1` (see Header), so content headings go one level down.
const components: Components = {
  h1: ({ node: _node, ...props }) => <h2 {...props} />,
  h2: ({ node: _node, ...props }) => <h3 {...props} />,
  h3: ({ node: _node, ...props }) => <h4 {...props} />,
  h4: ({ node: _node, ...props }) => <h5 {...props} />,
  // GFM tables scroll horizontally on narrow screens instead of widening the page.
  table: ({ node: _node, children, ...props }: { node?: unknown; children?: ReactNode }) => (
    <div className={styles.tableWrap}>
      <table {...props}>{children}</table>
    </div>
  ),
};

const remarkPlugins = [remarkGfm];
// Only Python is registered (no auto-detection) to keep the bundle small.
const rehypePlugins: NonNullable<Parameters<typeof ReactMarkdown>[0]['rehypePlugins']> = [
  [rehypeHighlight, { languages: { python }, detect: false }],
];

/**
 * Renders GitHub-flavoured Markdown (tables, task lists, strikethrough) with
 * Python syntax highlighting, without raw HTML (Requirement 4.2).
 *
 * `rehype-raw` is deliberately not used and `skipHtml` drops any HTML found in
 * the source, so content can never inject elements or scripts.
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={className ? `${styles.markdown} ${className}` : styles.markdown}>
      <ReactMarkdown
        skipHtml
        components={components}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
