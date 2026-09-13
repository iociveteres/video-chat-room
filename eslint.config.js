import js from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/', '**/coverage/', '**/playwright-report/', '**/test-results/', 'prds/']),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    files: ['packages/server/**/*.ts', 'e2e/**/*.ts', '*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['packages/client/**/*.{ts,tsx}'],
    extends: [eslintReact.configs['recommended-type-checked'], reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      // Аналог react/no-danger: dangerouslySetInnerHTML запрещён как класс XSS (TDD §10).
      '@eslint-react/dom-no-dangerously-set-innerhtml': 'error',
    },
  },

  prettier,
);
