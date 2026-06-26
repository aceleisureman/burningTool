'use strict';
const test = require('node:test');
const assert = require('node:assert');

// bus.js 是无 electron 依赖的纯日志聚合器，可直接 require
const bus = require('../src/main/core/bus');

test('未注册 sink 时调用不抛错（默认 no-op）', () => {
  assert.doesNotThrow(() => {
    bus.send('hello');
    bus.sendProgress(1, 2);
    bus.sendDownloadProgress(50);
  });
});

test('setSinks 后 send 按注册回调路由参数', () => {
  const calls = { send: [], prog: [], dl: [] };
  bus.setSinks({
    send: (...a) => calls.send.push(a),
    sendProgress: (...a) => calls.prog.push(a),
    sendDownloadProgress: (...a) => calls.dl.push(a)
  });
  bus.send('line', 'info');
  bus.sendProgress(3, 10);
  bus.sendDownloadProgress(42);
  assert.deepStrictEqual(calls.send, [['line', 'info']]);
  assert.deepStrictEqual(calls.prog, [[3, 10]]);
  assert.deepStrictEqual(calls.dl, [[42]]);
});

test('setSinks 忽略非函数项，保留已注册的有效回调', () => {
  const got = [];
  bus.setSinks({ send: (...a) => got.push(a) });
  // 传入非函数不应覆盖/破坏
  bus.setSinks({ send: 123, sendProgress: null });
  assert.doesNotThrow(() => bus.send('x'));
  assert.deepStrictEqual(got, [['x']]);
});
