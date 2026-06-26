const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRead32Words,
  wordsToBytesLE,
  decodeRamLogSnapshot,
  normalizeRamLogConfig,
  read32ByteLength
} = require('../src/main/ramlog/ramlog');

test('ramlog parses pyOCD read32 output words', () => {
  const out = [
    '0x20004b00:  0x524c4f47 0x00000001 0x00000400 0x00000005',
    '0x20004b10:  0x00000008 0x6c6c6548'
  ].join('\n');
  assert.deepEqual(parseRead32Words(out), [0x524c4f47, 1, 1024, 5, 8, 0x6c6c6548]);
});

test('ramlog parses current pyOCD read32 output without 0x prefixes', () => {
  const out = [
    '0000305 W Board ID 4559 is not recognized [mbed_board]',
    '20004800:  524c4f47 00010000 00000400 00000013    |RLOG............|',
    '20004810:  00000001 544f4f42 4152203a 474f4c4d    |....TOOBAR :GOLM|'
  ].join('\n');
  assert.deepEqual(parseRead32Words(out), [
    0x524c4f47,
    0x00010000,
    0x00000400,
    0x00000013,
    0x00000001,
    0x544f4f42,
    0x4152203a,
    0x474f4c4d
  ]);
});

test('ramlog converts read32 words to little-endian bytes', () => {
  assert.deepEqual(Array.from(wordsToBytesLE([0x524c4f47, 0x00000005], 8)), [
    0x47, 0x4f, 0x4c, 0x52, 0x05, 0x00, 0x00, 0x00
  ]);
});

test('ramlog decodes linear buffer snapshot', () => {
  const cfg = normalizeRamLogConfig({ size: 8, ring: false });
  const bytes = new Uint8Array(cfg.offsets.data + 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(cfg.offsets.magic, 0x524c4f47, true);
  view.setUint32(cfg.offsets.version, 1, true);
  view.setUint32(cfg.offsets.size, 8, true);
  view.setUint32(cfg.offsets.writePos, 5, true);
  view.setUint32(cfg.offsets.seq, 7, true);
  bytes.set(Buffer.from('Hello\0\0\0'), cfg.offsets.data);

  const r = decodeRamLogSnapshot(bytes, cfg);
  assert.equal(r.meta.magicOk, true);
  assert.equal(r.meta.seq, 7);
  assert.equal(r.text, 'Hello');
});

test('ramlog decodes ring buffer in chronological order', () => {
  const cfg = normalizeRamLogConfig({ size: 8, ring: true });
  const bytes = new Uint8Array(cfg.offsets.data + 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(cfg.offsets.magic, 0x524c4f47, true);
  view.setUint32(cfg.offsets.version, 1, true);
  view.setUint32(cfg.offsets.size, 8, true);
  view.setUint32(cfg.offsets.writePos, 3, true);
  view.setUint32(cfg.offsets.seq, 9, true);
  bytes.set(Buffer.from('XYZdefgh'), cfg.offsets.data);

  const r = decodeRamLogSnapshot(bytes, cfg);
  assert.equal(r.text, 'defghXYZ');
});

test('ramlog reports magic mismatch', () => {
  const cfg = normalizeRamLogConfig({ size: 4 });
  const bytes = new Uint8Array(cfg.offsets.data + 4);
  const r = decodeRamLogSnapshot(bytes, cfg);
  assert.equal(r.meta.magicOk, false);
  assert.equal(r.meta.magicHex, '0x00000000');
});

test('ramlog read32 length is byte aligned for pyOCD', () => {
  assert.equal(read32ByteLength({ size: 1024, offsets: { data: 20 } }), 1044);
});
