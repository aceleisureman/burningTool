import test from 'node:test';
import assert from 'node:assert';

// 渲染层纯函数工具（单一来源：ESM 版，App.vue 与单测共用）
import * as U from '../renderer/src/util.js';

test('baseName 取路径末段（兼容 \\ 与 /，去结尾斜杠）', () => {
  assert.strictEqual(U.baseName('/a/b/c'), 'c');
  assert.strictEqual(U.baseName('/a/b/c/'), 'c');
  assert.strictEqual(U.baseName('C:\\proj\\demo\\'), 'demo');
  assert.strictEqual(U.baseName('plain'), 'plain');
});

test('escHtml 转义 & < >', () => {
  assert.strictEqual(U.escHtml('<a> & </a>'), '&lt;a&gt; &amp; &lt;/a&gt;');
});

test('highlightJson 给 key/字符串/数字/布尔/null 套 span 且转义', () => {
  const h = U.highlightJson('{"k": 12, "b": true, "n": null, "s": "v"}');
  assert.ok(h.includes('<span class="jt-key">"k":</span>'));
  assert.ok(h.includes('<span class="jt-num">12</span>'));
  assert.ok(h.includes('<span class="jt-bool">true</span>'));
  assert.ok(h.includes('<span class="jt-null">null</span>'));
  assert.ok(h.includes('<span class="jt-str">"v"</span>'));
  // HTML 注入应被转义
  assert.ok(!U.highlightJson('"<img>"').includes('<img>'));
});

test('fmtPayload：HEX 原样、合法 JSON 美化、普通文本原样', () => {
  assert.deepStrictEqual(U.fmtPayload('AB CD', true), { text: 'AB CD', json: false });
  const j = U.fmtPayload('{"a":1}', false);
  assert.strictEqual(j.json, true);
  assert.strictEqual(j.text, '{\n  "a": 1\n}');
  assert.deepStrictEqual(U.fmtPayload('hello', false), { text: 'hello', json: false });
  // 形似 JSON 但非法 → 原样、不标记 json
  assert.deepStrictEqual(U.fmtPayload('{bad}', false), { text: '{bad}', json: false });
});

test('topicMatch 支持 + 单级与 # 多级通配', () => {
  assert.strictEqual(U.topicMatch('a/b', 'a/b'), true);
  assert.strictEqual(U.topicMatch('a/+/c', 'a/x/c'), true);
  assert.strictEqual(U.topicMatch('a/+/c', 'a/c'), false);
  assert.strictEqual(U.topicMatch('a/#', 'a/b/c/d'), true);
  assert.strictEqual(U.topicMatch('a/b', 'a/b/c'), false);
});

test('vidName 按 VID 识别芯片，未知则回退 VID 0x...', () => {
  assert.strictEqual(U.vidName('1a86'), 'CH340/CH9102（沁恒）');
  assert.strictEqual(U.vidName('0483'), 'ST-Link / STM32（ST）');
  assert.strictEqual(U.vidName('ffff'), 'VID 0xFFFF');
  assert.strictEqual(U.vidName(''), '');
});

test('portMainLabel / portSubLabel 组合友好名/芯片/VID-PID', () => {
  assert.strictEqual(U.portMainLabel({ path: 'COM3' }), 'COM3');
  assert.strictEqual(U.portMainLabel({}), '未知串口');
  const sub = U.portSubLabel({ friendlyName: 'USB-SERIAL (COM3)', vendorId: '1a86', productId: '7523' });
  assert.ok(sub.includes('USB-SERIAL'));
  assert.ok(sub.includes('CH340'));
  assert.ok(sub.includes('VID:1A86 PID:7523'));
});

test('cmdDelayMs 按单位换算', () => {
  assert.strictEqual(U.cmdDelayMs({ interval: 500, unit: 'ms' }), 500);
  assert.strictEqual(U.cmdDelayMs({ interval: 2, unit: 's' }), 2000);
  assert.strictEqual(U.cmdDelayMs({ interval: 1, unit: 'min' }), 60000);
  assert.strictEqual(U.cmdDelayMs({ interval: 3 }), 3);
});

test('bytesToHex / hexToBytes 往返一致', () => {
  assert.strictEqual(U.bytesToHex(new Uint8Array([0x0a, 0xff, 0x00])), '0A FF 00');
  assert.deepStrictEqual(Array.from(U.hexToBytes('0x0A ff,00')), [0x0a, 0xff, 0x00]);
  assert.throws(() => U.hexToBytes('ABC'), /偶数/);
});

test('fmtByte 十六/十进制', () => {
  assert.strictEqual(U.fmtByte(255, 'hex'), '0xFF');
  assert.strictEqual(U.fmtByte(5, 'hex'), '0x05');
  assert.strictEqual(U.fmtByte(255, 'dec'), '255');
});

test('bytesFromGrid 逐列式打包 8x8（左列全亮=0x01..MSB）', () => {
  // 8x8，仅第 0 列全亮
  const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => false));
  for (let r = 0; r < 8; r++) grid[r][0] = true;
  // col 扫描、msb、negative(阴码: on=1)：第一字节对应第 0 列 8 行全亮 = 0xFF
  const out = U.bytesFromGrid(grid, 8, 'col', true, true);
  assert.strictEqual(out.length, 8);
  assert.strictEqual(out[0], 0xff);
  assert.strictEqual(out[1], 0x00);
});
