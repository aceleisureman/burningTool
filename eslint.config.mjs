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
    files: ['src/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', 'packages/**/*.js', 'plugins/**/*.js'],
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
      // 允许空 catch（有意吞异常），但空函数体/空块仍报错
      'no-empty': ['error', { allowEmptyCatch: true }],
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
  {
    // CommonJS 模块包装参数 (module, exports, require, __dirname, __filename)
    // 与测试里透传给内部模块的 (parent, isMain) 属有意保留，避免误报
    files: ['**/*.js'],
    rules: {
      'no-unused-vars': ['warn', {
        args: 'after-used',
        argsIgnorePattern: '^(parent|isMain|module|exports|require)$|^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },
];
