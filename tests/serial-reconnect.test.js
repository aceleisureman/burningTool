const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const view = fs.readFileSync(path.join(root, 'renderer', 'src', 'views', 'SerialView.vue'), 'utf8');
const composable = fs.readFileSync(path.join(root, 'renderer', 'src', 'composables', 'useSerial.js'), 'utf8');

test('serial view exposes the reconnect checkbox and state', () => {
  assert.match(view, /:model-value="serial\.autoReconnect"/);
  assert.match(view, /class="src-title">掉线重连</);
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
