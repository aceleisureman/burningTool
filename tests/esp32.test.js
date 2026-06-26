const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = path.join(os.tmpdir(), `esp32-test-${process.pid}.bin`);
fs.writeFileSync(BIN, Buffer.from([0xe9, 0x00, 0x00, 0x00]));
process.on('exit', () => { try { fs.unlinkSync(BIN); } catch (e) {} });

const {
  normalizeChip,
  normalizeBaud,
  normalizeOffset,
  resolveFlashParts,
  buildGlobalArgs
} = require('../src/main/flash/esp32');

test('normalizeChip only accepts known chips, falls back to auto', () => {
  assert.equal(normalizeChip('ESP32'), 'esp32');
  assert.equal(normalizeChip('esp32s3'), 'esp32s3');
  assert.equal(normalizeChip('esp8266'), 'esp8266');
  assert.equal(normalizeChip('stm32'), 'auto');
  assert.equal(normalizeChip(''), 'auto');
  assert.equal(normalizeChip(undefined), 'auto');
});

test('normalizeBaud clamps to esptool-sane range', () => {
  assert.equal(normalizeBaud(460800, 460800), 460800);
  assert.equal(normalizeBaud(99, 460800), 9600);
  assert.equal(normalizeBaud(9999999, 460800), 2000000);
  assert.equal(normalizeBaud('not-a-number', 115200), 115200);
});

test('normalizeOffset accepts hex/decimal and rejects garbage', () => {
  assert.equal(normalizeOffset('0x1000'), '0x1000');
  assert.equal(normalizeOffset('0X10000'), '0x10000');
  assert.equal(normalizeOffset(4096), '0x1000');
  assert.equal(normalizeOffset('4096'), '0x1000');
  assert.equal(normalizeOffset(0), '0x0');
  assert.equal(normalizeOffset('0'), '0x0');
  assert.equal(normalizeOffset('0xZZ'), null);
  assert.equal(normalizeOffset('app'), null);
  assert.equal(normalizeOffset(''), null);
});

test('buildGlobalArgs omits --chip for auto and includes reset timing', () => {
  const args = buildGlobalArgs({ chip: 'auto', baudRate: 921600, beforeReset: 'usb_reset', afterReset: 'no_reset' }, '/dev/ttyUSB0');
  assert.ok(!args.includes('--chip'));
  assert.deepEqual(args, ['--port', '/dev/ttyUSB0', '--baud', '921600', '--before', 'usb_reset', '--after', 'no_reset']);
});

test('buildGlobalArgs emits --chip for a concrete chip and defaults bad reset values', () => {
  const args = buildGlobalArgs({ chip: 'esp32c3', beforeReset: 'bogus', afterReset: 'bogus' }, 'COM7');
  assert.deepEqual(args, ['--chip', 'esp32c3', '--port', 'COM7', '--baud', '460800', '--before', 'default_reset', '--after', 'hard_reset']);
});

test('resolveFlashParts rejects illegal/duplicate offsets and empty selection', () => {
  assert.equal(resolveFlashParts({ parts: [] }).ok, false);
  assert.equal(resolveFlashParts({ firmwarePath: '' }).ok, false);
  const dup = resolveFlashParts({ parts: [{ offset: '0x0', path: BIN }, { offset: '0x0', path: BIN }] });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /重复/);
  const bad = resolveFlashParts({ parts: [{ offset: 'xyz', path: BIN }] });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /地址非法/);
});

test('resolveFlashParts accepts valid multi-offset .bin parts', () => {
  const r = resolveFlashParts({ parts: [{ offset: '0x1000', path: BIN }, { offset: '0x10000', path: BIN }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.parts.map((p) => p.offset), ['0x1000', '0x10000']);
});

test('resolveFlashParts rejects non-.bin firmware', () => {
  // this test file itself is .js, so it must be rejected as a firmware
  const r = resolveFlashParts({ firmwarePath: __filename, flashOffset: '0x0' });
  assert.equal(r.ok, false);
  assert.match(r.error, /\.bin/);
});
