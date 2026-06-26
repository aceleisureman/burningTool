const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const tmpUserData = path.join(os.tmpdir(), 'burningtool-hardware-test');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => tmpUserData } };
  return origLoad.apply(this, arguments);
};

const { normalizeDebugHex, parseDebugAddress, isFlashAddress } = require('../src/main/flash/flasher');

test('hardware debug normalizes memory addresses', () => {
  assert.equal(normalizeDebugHex('20000000', '0x0'), '0x20000000');
  assert.equal(normalizeDebugHex('0x20000000', '0x0'), '0x20000000');
  assert.equal(normalizeDebugHex('bad-address', '0x20000000'), '0x20000000');
  assert.equal(parseDebugAddress('0x20000004'), 0x20000004);
});

test('hardware debug detects STM32 flash address range', () => {
  assert.equal(isFlashAddress(0x08000000), true);
  assert.equal(isFlashAddress(0x08010000), true);
  assert.equal(isFlashAddress(0x20000000), false);
});

test.after(() => {
  Module._load = origLoad;
});
