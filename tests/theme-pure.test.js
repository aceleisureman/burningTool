'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('pure theme has a selectable preset and complete CSS variables', () => {
  const root = path.join(__dirname, '..');
  const theme = fs.readFileSync(path.join(root, 'renderer', 'src', 'composables', 'useTheme.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'renderer', 'src', 'styles', 'base.css'), 'utf8');
  assert.match(theme, /id:\s*'pure'/);
  assert.match(css, /html\[data-theme="pure"\]/);
  for (const token of ['--bg:', '--panel:', '--text:', '--accent:', '--term-bg:', '--el-color-primary:']) {
    assert.ok(css.slice(css.indexOf('html[data-theme="pure"]'), css.indexOf('html[data-theme="paper"]')).includes(token));
  }
});
