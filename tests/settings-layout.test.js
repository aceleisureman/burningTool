const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const viewPath = path.join(__dirname, '..', 'renderer', 'src', 'views', 'SettingsView.vue');
const source = fs.readFileSync(viewPath, 'utf8');
const stylePath = path.join(__dirname, '..', 'renderer', 'src', 'styles', 'layout.css');
const styles = fs.readFileSync(stylePath, 'utf8');

test('settings page is grouped by user task', () => {
  for (const heading of ['环境概览', '编译与烧录', '默认工具链', '路径与系统集成']) {
    assert.match(source, new RegExp(heading));
  }
});

test('settings page uses compact responsive toolchain grid', () => {
  assert.match(source, /class="tc-tool-list set-tool-grid"/);
  assert.match(source, /class="set-config-grid(?:\s[^"]*)?"/);
  assert.match(source, /class="set-overview"/);
});


test('settings page keeps flash path visibility behavior', () => {
  assert.match(source, /label="pyOCD 路径" v-if="draft\.flashMethod === 'pyocd'"/);
  assert.match(source, /label="OpenOCD 路径" v-if="draft\.flashMethod === 'openocd'"/);
});

test('settings page shows platform-specific PATH metadata', () => {
  assert.match(source, /:label="pathEnv\.label \|\| '系统 PATH'"/);
  assert.match(source, /pathEnv\.message/);
});

test('settings page balances compile, flash and toolchain sections', () => {
  assert.match(source, /class="set-config-grid set-balanced-grid"/);
  assert.match(source, /class="set-subsection set-balanced-panel"/);
  assert.match(source, /'set-tool-item-wide': item\.key === 'commandTools'/);

  const elfIndex = source.indexOf('label="ELF 文件名"');
  const flashPanelIndex = source.indexOf('<div class="set-subsection-title">烧录配置</div>');
  assert.ok(elfIndex > 0 && elfIndex < flashPanelIndex, 'ELF 文件名应归入编译配置');
});

test('settings layout styles provide cards and responsive grids', () => {
  for (const selector of ['.set-overview', '.set-config-grid', '.set-tool-grid', '.set-path-row']) {
    assert.match(styles, new RegExp(selector.replace('.', '\\.')));
  }
  assert.match(styles, /@media\s*\(max-width:\s*760px\)/);
  assert.match(styles, /\.set-balanced-grid\s*\{[^}]*align-items:\s*stretch/);
  assert.match(styles, /\.set-tool-item-wide\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
});
