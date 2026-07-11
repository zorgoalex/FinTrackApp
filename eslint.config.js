import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

const browserGlobals = {
  alert: 'readonly',
  Blob: 'readonly',
  clearTimeout: 'readonly',
  confirm: 'readonly',
  console: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  FileReader: 'readonly',
  localStorage: 'readonly',
  navigator: 'readonly',
  prompt: 'readonly',
  setTimeout: 'readonly',
  URL: 'readonly',
  window: 'readonly',
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'OLD/**', 'coverage/**', 'supabase/functions/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: browserGlobals,
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-refresh/only-export-components': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['eslint.config.js', 'vite.config.js', 'postcss.config.js', 'tailwind.config.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
];
