import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.nx/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['apps/api/**/*.ts', 'libs/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      // Decision 2: RLS only protects requests made with the user's token, so the secret-key client must stay out of request paths.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/system-client', '**/system-client.js'],
              message: 'The secret-key client is for system jobs only. Request handlers use the per-request user client.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Playwright runs in Node but its init scripts run in the page. No react-hooks: fixture `use()` isn't a hook.
    files: ['apps/web/e2e/**/*.ts', 'apps/web/*.config.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
