import js from '@eslint/js';
import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'renderer/dist/**',
      'toolchain/**',
      'resources/**',
      'tools/**',
      'renderer/auto-imports.d.ts',
      'renderer/components.d.ts',
      'vite.config.mjs.timestamp-*.mjs',
    ],
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['src/**/*.js', 'scripts/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['src/main/electron-api.js'],
    rules: {
      // Polyfill intentionally mirrors overlapping EventEmitter/BrowserWindow APIs.
      'no-dupe-class-members': 'off',
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['renderer/src/**/*.{js,vue}', 'vite.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ElMessage: 'readonly',
        ElMessageBox: 'readonly',
      },
    },
  },
  {
    rules: {
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'off',
    },
  },
];
