// D:\project\tools\burning tool\plugins\vscode-stm32-flash\eslint.config.mjs
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['vendor/**', 'node_modules/**', '*.vsix']
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'eqeqeq': ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-throw-literal': 'error'
    }
  }
];
