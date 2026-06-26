const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const tmpUserData = path.join(os.tmpdir(), 'burningtool-firmware-test');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => tmpUserData } };
  return origLoad.apply(this, arguments);
};

const {
  parseSizeA,
  parseNmSizeSort,
  parseMapMemoryConfig,
  formatBytes
} = require('../src/main/firmware/analyzer');

test('parseSizeA calculates Flash and RAM usage from section table', () => {
  const parsed = parseSizeA(`
section           size         addr
.isr_vector        268    134217728
.text             8000    134217996
.rodata            200    134225996
.data               24    536870912
.bss              2592    536870936
`);

  assert.equal(parsed.flashUsed, 8468);
  assert.equal(parsed.ramUsed, 2616);
  assert.equal(parsed.sections.length, 5);
});

test('parseNmSizeSort returns largest symbols first', () => {
  const symbols = parseNmSizeSort(`
08000100 00000020 T Reset_Handler
08000200 00000180 T main
20000000 00000040 B rx_buffer
`);

  assert.equal(symbols[0].name, 'main');
  assert.equal(symbols[0].size, 0x180);
  assert.equal(symbols[1].name, 'rx_buffer');
});

test('parseMapMemoryConfig extracts memory regions', () => {
  const regions = parseMapMemoryConfig(`
Memory Configuration

Name             Origin             Length             Attributes
FLASH            0x08000000         0x00010000         xr
RAM              0x20000000         0x00005000         xrw
*default*        0x00000000         0xffffffff
`);

  assert.equal(regions[0].name, 'FLASH');
  assert.equal(regions[0].length, 0x10000);
  assert.equal(regions[1].name, 'RAM');
  assert.equal(regions[1].length, 0x5000);
});

test('formatBytes keeps firmware sizes readable', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(2 * 1048576), '2.00 MB');
});

test.after(() => {
  Module._load = origLoad;
});
