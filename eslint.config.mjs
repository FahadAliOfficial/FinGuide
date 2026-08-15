import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['eslint.config.mjs', '**/dist/**', '**/node_modules/**', '**/generated/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: ['./packages/*/tsconfig.json', './apps/api/tsconfig.lint.json', './apps/web/tsconfig.app.json', './apps/web/tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname
      },
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }]
    }
  },
  {
    files: ['**/*.test.ts', 'apps/api/src/test/**/*.ts'],
    rules: { '@typescript-eslint/require-await': 'off' }
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  }
);
