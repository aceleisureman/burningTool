const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const view = fs.readFileSync(path.join(root, 'renderer', 'src', 'views', 'SerialView.vue'), 'utf8');
const composable = fs.readFileSync(path.join(root, 'renderer', 'src', 'composables', 'useSerial.js'), 'utf8');

test('serial view exposes the reconnect toggle and state', () => {
  // 开关已随「串口设置」左栏整体搬进终端工具栏（.term-bar 里的 tb-icon-toggle），
  // 由 el-checkbox 改为自绘图标开关，因此这里断言的是行为等价物：
  // 状态必须绑定 serial.autoReconnect、点击必须切到 setAutoReconnect、且有无障碍名称。
  assert.match(view, /on: serial\.autoReconnect/);
  assert.match(view, /@click="setAutoReconnect\(!serial\.autoReconnect\)"/);
  assert.match(view, /aria-label="掉线自动重连"/);
  assert.match(view, /serial\.reconnecting/);
  assert.match(view, /serialReconnectStatus/);
});

test('serial reconnect uses backoff and excludes manual disconnects', () => {
  assert.match(composable, /const reconnectDelays = \[1000, 2000, 4000, 8000\]/);
  assert.match(composable, /manualDisconnect/);
  assert.match(composable, /serialAutoReconnect/);
  assert.match(composable, /scheduleReconnect\(\)/);
  assert.match(composable, /cancelReconnect\(true\)/);
});
