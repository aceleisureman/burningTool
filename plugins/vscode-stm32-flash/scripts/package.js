'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const extensionDir = path.resolve(__dirname, '..');
const packagePath = path.join(extensionDir, 'package.json');
const original = fs.readFileSync(packagePath, 'utf8');
const packageJson = JSON.parse(original);
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(packageJson.version || ''));

if (!match) {
  throw new Error(`Unsupported extension version: ${packageJson.version || '(empty)'}`);
}

packageJson.version = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
process.stdout.write(`Packaging MCU-Assistant ${packageJson.version}\n`);

const result = spawnSync(
  'npx',
  ['--yes', '@vscode/vsce', 'package', '--no-dependencies', '--allow-missing-repository'],
  { cwd: extensionDir, stdio: 'inherit', shell: process.platform === 'win32' }
);

if (result.error || result.status !== 0) {
  fs.writeFileSync(packagePath, original, 'utf8');
  if (result.error) throw result.error;
  process.exitCode = result.status || 1;
}
