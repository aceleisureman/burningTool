'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

// config.js 依赖 electron 的 app.getPath('userData')；用临时目录 mock electron，
// 这样可在 node:test 下加载真实 config.js 并验证其纯逻辑（无需 refactor 生产代码）。
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'burningtool-cfg-'));
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => tmpUserData } };
  }
  return origLoad.apply(this, arguments);
};

const config = require('../src/main/core/config');

const isWin = process.platform === 'win32';

test('configPath 指向 userData/config.json', () => {
  assert.strictEqual(config.configPath(), path.join(tmpUserData, 'config.json'));
});

test('loadConfig 返回带 recentProjects 数组的对象', () => {
  const cfg = config.loadConfig();
  assert.strictEqual(typeof cfg, 'object');
  assert.ok(Array.isArray(cfg.recentProjects));
});

test('normalizeConfig 在非 Windows 上把 keil 回退为 make/pyocd', { skip: isWin }, () => {
  const out = config.normalizeConfig({ buildSystem: 'keil', flashMethod: 'keil' });
  assert.strictEqual(out.buildSystem, 'make');
  assert.strictEqual(out.flashMethod, 'pyocd');
});

test('addRecent 去重 + 置顶 + 上限 12', () => {
  config.removeRecent('/p/a');
  config.removeRecent('/p/b');
  config.addRecent('/p/a');
  let list = config.addRecent('/p/b');
  assert.deepStrictEqual(list.slice(0, 2), ['/p/b', '/p/a']);
  // 重复加 /p/a 应去重并置顶
  list = config.addRecent('/p/a');
  assert.strictEqual(list[0], '/p/a');
  assert.strictEqual(list.filter((d) => d === '/p/a').length, 1);
  // 上限 12
  for (let i = 0; i < 20; i++) config.addRecent('/p/x' + i);
  list = config.loadConfig().recentProjects;
  assert.ok(list.length <= 12, `recentProjects length ${list.length} > 12`);
  assert.strictEqual(list[0], '/p/x19');
});

test('removeRecent 移除指定项', () => {
  config.addRecent('/p/gone');
  assert.ok(config.loadConfig().recentProjects.includes('/p/gone'));
  const list = config.removeRecent('/p/gone');
  assert.ok(!list.includes('/p/gone'));
});

test.after(() => {
  Module._load = origLoad;
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* noop */ }
});
