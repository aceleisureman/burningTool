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

test('flash page puts command toolbar above project, quick settings and terminal', () => {
  const projectIndex = viewSource.indexOf('class="ops-section ops-project"');
  const commandIndex = viewSource.indexOf('class="ops-section ops-actions"');
  const settingsIndex = viewSource.indexOf('class="ops-section ops-utility"');
  const terminalIndex = viewSource.indexOf('class="log-panel"');

  assert.ok(commandIndex >= 0);
  assert.ok(commandIndex < projectIndex);
  assert.ok(projectIndex < settingsIndex);
  assert.ok(settingsIndex < terminalIndex);
});

test('flash page presents icon-based commands, quick tools and flash methods', () => {
  assert.match(viewSource, /class="action-command-grid"/);
  assert.match(viewSource, /class="command-button command-build"/);
  assert.match(viewSource, /class="command-button command-flash"/);
  assert.match(viewSource, /class="command-button command-primary"/);
  assert.equal((viewSource.match(/class="command-icon"/g) || []).length, 3);
  assert.match(viewSource, /class="utility-panel quick-tools"/);
  assert.ok((viewSource.match(/class="tool-icon-button/g) || []).length >= 3);
  assert.match(viewSource, /class="method-icon-group"/);
  assert.ok((viewSource.match(/class="method-icon-choice"/g) || []).length >= 2);
  assert.match(viewSource, /class="utility-panel flash-method"/);

  assert.match(styles, /\.action-command-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /\.action-command-grid \.command-button\.el-button\s*\{[^}]*height:\s*64px/s);
  assert.match(styles, /\.command-icon\s*\{[^}]*font-size:\s*22px/s);
  assert.match(styles, /\.command-flash\.el-button\s*\{[^}]*linear-gradient/s);
  assert.match(styles, /\.tool-icon-button\.el-button\s*\{[^}]*height:\s*52px/s);
  assert.match(styles, /\.method-icon-group\s*\{[^}]*display:\s*grid/s);
  assert.match(styles, /\.ops-utility\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /@media\s*\(max-width:\s*900px\)/);
});

test('terminal toolbar keeps clear-log action beside other log actions', () => {
  const toolbar = viewSource.slice(viewSource.indexOf('class="log-toolbar"'), viewSource.indexOf('</div>', viewSource.indexOf('class="log-toolbar"')) + 6);
  assert.match(toolbar, /LogClearBtn/);
});
