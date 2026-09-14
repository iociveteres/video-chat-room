import js from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noPeerConnectionTrackMutation from './eslint-rules/no-peer-connection-track-mutation.js';

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
    rules: {
      // Префикс `_` — намеренно неиспользуемый параметр (например, 4-арность error handler в Express).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    files: [
      'packages/server/**/*.ts',
      'packages/protocol-tests/**/*.ts',
      'packages/*/scripts/**/*.mjs',
      'e2e/**/*.ts',
      '*.{js,ts}',
    ],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['packages/client/**/*.{ts,tsx}'],
    extends: [eslintReact.configs['recommended-type-checked'], reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      // Аналог react/no-danger: dangerouslySetInnerHTML запрещён как класс XSS (TDD §10).
      '@eslint-react/dom-no-dangerously-set-innerhtml': 'error',
      // Только callback-ack: продолжение после await emitWithAck выполнилось бы уже после событий
      // из той же пачки пакетов, и в state появились бы «призраки» (TDD этапа 1 §4.3, этапа 4 §12).
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='emitWithAck']",
          message:
            'emitWithAck запрещён на клиенте: используйте socket.timeout(ms).emit(event, payload, callback).',
        },
      ],
    },
  },

  // Инварианты звонка (TDD этапа 4 §3.2, §12): без ренеготиации. Правило типовое — только для TS.
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      vcr: { rules: { 'no-peer-connection-track-mutation': noPeerConnectionTrackMutation } },
    },
    rules: { 'vcr/no-peer-connection-track-mutation': 'error' },
  },

  prettier,
);
