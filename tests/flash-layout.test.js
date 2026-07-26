const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'renderer', 'src', 'App.vue'), 'utf8');
const viewSource = fs.readFileSync(path.join(root, 'renderer', 'src', 'views', 'FlashView.vue'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'renderer', 'src', 'styles', 'tools', 'flash.css'), 'utf8');

test('sidebar keeps product names for STC and ESP32 while other labels use four Chinese characters', () => {
  const expected = ['固件烧录', 'StcGal', 'ESP32', '硬件调试', '内存日志', '固件分析', '串口调试', '消息调试', '字模生成'];
  const navBlock = appSource.slice(appSource.indexOf('<div class="nav-section">工具</div>'), appSource.indexOf('<div class="nav-spacer"></div>'));
  const labels = [...navBlock.matchAll(/<span class="label">([^<]+)<\/span>/g)].map((match) => match[1]);

  assert.deepEqual(labels, expected);
  for (const label of labels.filter((_, index) => index !== 1 && index !== 2)) assert.match(label, /^[\u4e00-\u9fff]{4}$/);
});

test('flash page puts command toolbar above project and terminal', () => {
  const projectIndex = viewSource.indexOf('class="ops-section ops-project"');
  const commandIndex = viewSource.indexOf('class="ops-section ops-actions"');
  const terminalIndex = viewSource.indexOf('class="log-panel"');

  assert.ok(commandIndex >= 0);
  assert.ok(projectIndex >= 0);
  assert.ok(terminalIndex >= 0);
  assert.ok(commandIndex < projectIndex);
  assert.ok(projectIndex < terminalIndex);
});

test('flash page presents icon-based commands, quick tools and flash methods', () => {
  assert.match(viewSource, /class="action-bar"/);
  assert.match(viewSource, /class="action-group action-group-main"/);
  assert.match(viewSource, /class="command-button command-build"/);
  assert.match(viewSource, /class="command-button command-flash"/);
  assert.match(viewSource, /class="command-button command-primary"/);
  assert.equal((viewSource.match(/class="command-glyph command-glyph-/g) || []).length, 3);
  assert.ok((viewSource.match(/class="tool-icon-button/g) || []).length >= 3);
  assert.match(viewSource, /class="method-icon-group"/);
  assert.ok((viewSource.match(/class="method-icon-choice"/g) || []).length >= 2);

  assert.match(styles, /\.action-bar\s*\{[^}]*display:\s*flex/s);
  assert.match(styles, /\.action-group-main \.command-button\.el-button\s*\{[^}]*width:\s*48px/s);
  assert.match(styles, /\.action-group-main \.command-button\.el-button\s*\{[^}]*height:\s*48px/s);
  assert.match(styles, /\.tool-icon-button\.el-button\s*\{[^}]*height:\s*40px/s);
  assert.match(styles, /\.method-icon-group\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(styles, /\.ops-actions\s*\{[^}]*grid-template-columns:\s*170px\s+minmax\(0,\s*1fr\)/s);
  assert.match(styles, /@media\s*\(max-width:\s*900px\)/);
});

test('terminal toolbar keeps clear-log action beside other log actions', () => {
  const toolbar = viewSource.slice(viewSource.indexOf('class="log-toolbar"'), viewSource.indexOf('</div>', viewSource.indexOf('class="log-toolbar"')) + 6);
  assert.match(toolbar, /LogClearBtn/);
});
