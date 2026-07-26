#!/usr/bin/env node
// 将 packages/flash-core 同步到插件 vendor/，供 vsce 打包自包含使用。
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'packages', 'flash-core');
const dest = path.join(root, 'plugins', 'vscode-stm32-flash', 'vendor', 'flash-core');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const a = path.join(from, ent.name);
    const b = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

if (!fs.existsSync(path.join(src, 'package.json'))) {
  console.error('[ext:sync] 未找到 packages/flash-core，请在仓库根执行');
  process.exit(1);
}

rmrf(path.dirname(dest));
fs.mkdirSync(path.dirname(dest), { recursive: true });
copyDir(src, dest);
console.log('[ext:sync] 已同步: packages/flash-core → plugins/vscode-stm32-flash/vendor/flash-core');
