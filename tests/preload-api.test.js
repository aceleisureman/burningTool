'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('preload event subscriptions return removable listeners', () => {
  const listeners = new Map();
  let exposed = null;
  const fakeElectron = {
    contextBridge: {
      exposeInMainWorld(_name, api) { exposed = api; }
    },
    ipcRenderer: {
      invoke: async () => undefined,
      on(channel, handler) {
        if (!listeners.has(channel)) listeners.set(channel, new Set());
        listeners.get(channel).add(handler);
      },
      removeListener(channel, handler) {
        const set = listeners.get(channel);
        if (set) set.delete(handler);
      }
    }
  };

  const preloadPath = require.resolve('../src/preload/index.js');
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return fakeElectron;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[preloadPath];
    require(preloadPath);
    assert.ok(exposed);
    assert.equal(typeof exposed.getMqttHistory, 'function');
    assert.equal(typeof exposed.saveMqttHistory, 'function');

    let received = null;
    const off = exposed.onLog((payload) => { received = payload; });
    assert.equal(typeof off, 'function');
    assert.equal(listeners.get('log').size, 1);

    for (const handler of listeners.get('log')) handler({}, { text: 'hello' });
    assert.deepEqual(received, { text: 'hello' });

    off();
    assert.equal(listeners.get('log').size, 0);
  } finally {
    delete require.cache[preloadPath];
    Module._load = originalLoad;
  }
});
