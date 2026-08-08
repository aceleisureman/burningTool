#!/usr/bin/env node
// 同步 vendor → 自动递增扩展版本号 → 打包 .vsix
//
// 用法（仓库根）:
//   npm run ext:package              # 默认 patch: 0.1.0 → 0.1.1
//   npm run ext:package -- --minor   # 0.1.0 → 0.2.0
//   npm run ext:package -- --major   # 0.1.0 → 1.0.0
//   npm run ext:package -- --no-bump # 不改版本，仅打包
//   EXT_BUMP=minor npm run ext:package
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const extDir = path.join(root, 'plugins', 'vscode-stm32-flash');
const pkgPath = path.join(extDir, 'package.json');

function run(cmd, args, cwd, shell = false) {
  // 默认不用 shell，由 spawnSync 直接处理带空格的路径（如 C:\Program Files、burning tool）；
  // Windows 上 .cmd 批处理（如 npx）必须走 shell（Node 安全策略），其参数不含空格，无注入风险
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell });
  if (r.error) {
    console.error(`[ext:package] 启动失败: ${cmd} — ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status || 1);
}

function parseBump(argv, env) {
  const args = argv.slice(2);
  if (args.includes('--no-bump') || args.includes('--keep')) return 'none';
  if (args.includes('--major')) return 'major';
  if (args.includes('--minor')) return 'minor';
  if (args.includes('--patch')) return 'patch';
  const fromEnv = String(env.EXT_BUMP || env.BUMP || '').trim().toLowerCase();
  if (['none', 'major', 'minor', 'patch'].includes(fromEnv)) return fromEnv;
  return 'patch';
}

function bumpSemver(version, kind) {
  const m = String(version || '0.0.0').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!m) throw new Error(`无效版本号: ${version}`);
  let major = Number(m[1]);
  let minor = Number(m[2]);
  let patch = Number(m[3]);
  if (kind === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === 'minor') {
    minor += 1;
    patch = 0;
  } else if (kind === 'patch') {
    patch += 1;
  } else if (kind !== 'none') {
    throw new Error(`未知递增类型: ${kind}`);
  }
  return `${major}.${minor}.${patch}`;
}

function readPkg() {
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
}

function writePkg(pkg) {
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

function main() {
  if (!fs.existsSync(pkgPath)) {
    console.error('[ext:package] 未找到扩展 package.json');
    process.exit(1);
  }

  // 1) 同步 flash-core → vendor
  run(process.execPath, [path.join(root, 'scripts', 'sync-ext-vendor.js')], root);

  // 2) 版本递增
  const kind = parseBump(process.argv, process.env);
  const pkg = readPkg();
  const oldVersion = pkg.version || '0.0.0';
  const newVersion = bumpSemver(oldVersion, kind);
  if (kind !== 'none') {
    pkg.version = newVersion;
    writePkg(pkg);
    console.log(`[ext:package] 版本 ${oldVersion} → ${newVersion} (${kind})`);
  } else {
    console.log(`[ext:package] 保持版本 ${oldVersion} (--no-bump)`);
  }

  // 3) 清理旧 vsix（同目录），避免堆积
  for (const name of fs.readdirSync(extDir)) {
    if (name.endsWith('.vsix')) {
      try {
        fs.unlinkSync(path.join(extDir, name));
        console.log(`[ext:package] 已删除旧包: ${name}`);
      } catch {
        /* ignore */
      }
    }
  }

  // 4) 打包
  run(
    'npx',
    ['--yes', '@vscode/vsce', 'package', '--no-dependencies', '--allow-missing-repository'],
    extDir,
    process.platform === 'win32'
  );

  const outName = `mcu-assistant-${kind === 'none' ? oldVersion : newVersion}.vsix`;
  const outPath = path.join(extDir, outName);
  if (fs.existsSync(outPath)) {
    console.log(`[ext:package] 完成: ${outPath}`);
  } else {
    // vsce 文件名以 package.json version 为准
    const found = fs.readdirSync(extDir).filter((f) => f.endsWith('.vsix'));
    console.log(`[ext:package] 完成: ${found.map((f) => path.join(extDir, f)).join(', ')}`);
  }
  console.log('[ext:package] 安装: code --install-extension plugins/vscode-stm32-flash/*.vsix --force');
}

main();
