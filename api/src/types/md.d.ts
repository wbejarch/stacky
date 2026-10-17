// Markdown files are bundled as plain text (esbuild `loader: { '.md': 'text' }`
// in the Lambda bundles and a small Vite plugin in Vitest).
declare module '*.md' {
  const content: string;
  export default content;
}
