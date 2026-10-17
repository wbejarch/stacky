import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The API dev server (`npm run dev -w api`) listens on this port.
const API_TARGET = 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin `/api` in development, like CloudFront in production.
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
