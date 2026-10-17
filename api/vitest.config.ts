import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Mirrors the esbuild `.md` -> `text` loader used when bundling the Lambdas, so
 * tests can `import lesson from '.../leccion.md'` and get the file as a string.
 */
function markdownAsText(): Plugin {
  return {
    name: 'markdown-as-text',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0]?.endsWith('.md')) return null;
      return { code: `export default ${JSON.stringify(code)};`, map: null };
    },
  };
}

export default defineConfig({
  plugins: [markdownAsText()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
