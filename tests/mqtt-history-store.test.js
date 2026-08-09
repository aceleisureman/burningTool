'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

test('MQTT history is stored separately and restored by connection id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcu-mqtt-history-'));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => dir } };
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = require.resolve('../src/main/core/mqtt-history-store');
  try {
    delete require.cache[modulePath];
    const store = require(modulePath);
    store.saveMqttHistory([{ id: 'c1', messages: [{ text: 'hello' }] }]);
    assert.deepStrictEqual(store.loadMqttHistory(), [{ id: 'c1', messages: [{ text: 'hello' }] }]);
    assert.ok(store.historyPath().endsWith('mqtt-history.json'));
  } finally {
    delete require.cache[modulePath];
    Module._load = originalLoad;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
