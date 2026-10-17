// Shared ESLint flat config for every workspace (shared, web, api, infra).
// Workspaces run `eslint .` from their own directory; ESLint finds this file
// by walking up to the repository root.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    '**/cdk.out/**',
    '**/coverage/**',
  ]),

  // Base rules for all JavaScript and TypeScript files.
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Front end: browser globals and React hooks rules.
  {
    files: ['web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
    },
  },

  // Front end guardrails (Requirements 8.1, 8.2, 10.6).
  // 1) The reference solution must never reach the browser bundle: the
  //    `ExerciseRecordSchema` (which has `solution`) is only exposed through
  //    the `@tutor-agent/shared/content` subpath, so `web/` cannot import it.
  {
    files: ['web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tutor-agent/shared/content',
              message:
                'web/ must not import @tutor-agent/shared/content: it exposes the exercise record with the reference `solution`, which must never reach the front end. Use the public schemas from @tutor-agent/shared instead.',
            },
          ],
          patterns: [
            {
              group: ['@tutor-agent/shared/content/*'],
              message:
                'web/ must not import sub-paths of @tutor-agent/shared/content: they expose the reference `solution`, which must never reach the front end.',
            },
            {
              group: ['**/shared/src/content-schema', '**/shared/src/content-schema.*'],
              message:
                'web/ must not import shared/src/content-schema directly: it exposes the reference `solution`. Use the public schemas from @tutor-agent/shared instead.',
            },
          ],
        },
      ],
    },
  },

  // 2) Every HTTP call goes through `src/api/client.ts`. Direct `fetch` is
  //    forbidden in the rest of `web/src/`.
  {
    files: ['web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'Do not call fetch directly. Every HTTP call must go through the client in src/api/client.ts.',
        },
      ],
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].map((object) => ({
          object,
          property: 'fetch',
          message:
            'Do not call fetch directly. Every HTTP call must go through the client in src/api/client.ts.',
        })),
      ],
    },
  },

  // `src/api/` is the single HTTP exit point, so `fetch` (and fetch mocks in
  // its tests) are allowed there.
  {
    files: ['web/src/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
);
