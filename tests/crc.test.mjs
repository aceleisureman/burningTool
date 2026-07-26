import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcCrc,
  listCrcAlgorithms,
  parseCrcInput,
  bytesToHex,
} from '../renderer/src/util.js';

test('listCrcAlgorithms includes common protocol algorithms', () => {
  const ids = listCrcAlgorithms().map((x) => x.id);
  for (const id of ['checksum8', 'xor8', 'crc8', 'crc16_modbus', 'crc16_xmodem', 'crc32']) {
    assert.ok(ids.includes(id), id);
  }
});

test('parseCrcInput supports hex/ascii/dec', () => {
  assert.deepEqual(Array.from(parseCrcInput('01 03 00 0A', 'hex')), [0x01, 0x03, 0x00, 0x0a]);
  assert.deepEqual(Array.from(parseCrcInput('AB', 'ascii')), [0x41, 0x42]);
  assert.deepEqual(Array.from(parseCrcInput('1 2 255', 'dec')), [1, 2, 255]);
});

test('checksum8 and xor8', () => {
  const bytes = parseCrcInput('01 02 03', 'hex');
  assert.equal(calcCrc('checksum8', bytes).value, 6);
  assert.equal(calcCrc('xor8', bytes).value, 0);
});

test('crc16_modbus known vector', () => {
  // 01 03 00 00 00 0A -> 0xCDC5, wire order low-byte first: C5 CD
  const r = calcCrc('crc16_modbus', parseCrcInput('01 03 00 00 00 0A', 'hex'));
  assert.equal(r.hex, 'CDC5');
  assert.equal(r.bytesHex, 'C5 CD');
});

test('crc16_xmodem known vector', () => {
  const r = calcCrc('crc16_xmodem', parseCrcInput('123456789', 'ascii'));
  assert.equal(r.hex, '31C3');
});

test('crc16_ccitt known vector', () => {
  const r = calcCrc('crc16_ccitt', parseCrcInput('123456789', 'ascii'));
  assert.equal(r.hex, '29B1');
});

test('crc8 maxim known vector', () => {
  const r = calcCrc('crc8_maxim', parseCrcInput('123456789', 'ascii'));
  assert.equal(r.hex, 'A1');
});

test('crc32 known vector', () => {
  const r = calcCrc('crc32', parseCrcInput('123456789', 'ascii'));
  assert.equal(r.hex, 'CBF43926');
  assert.equal(r.bytesHex, '26 39 F4 CB');
});

test('crc32c known vector', () => {
  const r = calcCrc('crc32c', parseCrcInput('123456789', 'ascii'));
  assert.equal(r.hex, 'E3069283');
});

test('bytesToHex helper still works for preview', () => {
  assert.equal(bytesToHex(parseCrcInput('0A ff', 'hex')), '0A FF');
});
