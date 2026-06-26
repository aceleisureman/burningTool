const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getPlatformToolchainProfile,
  applyPlatformPaths,
  mergeCurrentPlatformPaths,
  getToolchainDownloadPlan
} = require('../src/main/toolchain/platform-toolchains');

test('windows profile uses bundled gcc, bundled make, and bundled command tools', () => {
  const profile = getPlatformToolchainProfile('win32', 'x64');
  assert.equal(profile.id, 'windows');
  assert.equal(profile.supportsKeil, true);
  assert.equal(profile.defaultDownloads.gcc.archiveType, 'zip');
  assert.match(profile.defaultDownloads.gcc.fileName, /win32-x64\.zip$/);
  assert.equal(profile.defaultDownloads.make.mode, 'download');
  assert.match(profile.defaultDownloads.make.fileName, /win32-x64\.zip$/);
  assert.match(profile.defaultDownloads.openocd.fileName, /win32-x64\.zip$/);
  assert.equal(profile.defaultDownloads.openocd.pathDisplay, 'toolchain\\openocd\\');
  assert.equal(profile.commandTools.mode, 'busybox');
});

test('macOS arm64 profile downloads gcc tarball and uses system make', () => {
  const profile = getPlatformToolchainProfile('darwin', 'arm64');
  assert.equal(profile.id, 'macos');
  assert.equal(profile.supportsKeil, false);
  assert.match(profile.defaultDownloads.gcc.fileName, /darwin-arm64\.tar\.gz$/);
  assert.match(profile.defaultDownloads.gcc.url, /darwin-arm64\.tar\.gz$/);
  assert.match(profile.defaultDownloads.openocd.fileName, /darwin-arm64\.tar\.gz$/);
  assert.match(profile.defaultDownloads.openocd.url, /openocd-xpack/);
  assert.equal(profile.defaultDownloads.make.mode, 'system');
  assert.equal(profile.defaultDownloads.pyocd.mode, 'venv');
  assert.equal(profile.defaultDownloads.pyocd.pathDisplay, 'toolchain/pyocd/');
  assert.equal(profile.defaultDownloads.openocd.pathDisplay, 'toolchain/openocd/');
  assert.equal(profile.commandTools.mode, 'system');
});

test('linux x64 profile downloads gcc tarball and uses system make', () => {
  const profile = getPlatformToolchainProfile('linux', 'x64');
  assert.equal(profile.id, 'linux');
  assert.equal(profile.supportsKeil, false);
  assert.match(profile.defaultDownloads.gcc.fileName, /linux-x64\.tar\.gz$/);
  assert.match(profile.defaultDownloads.gcc.url, /linux-x64\.tar\.gz$/);
  assert.match(profile.defaultDownloads.openocd.fileName, /linux-x64\.tar\.gz$/);
  assert.equal(profile.defaultDownloads.make.mode, 'system');
  assert.equal(profile.commandTools.mode, 'system');
});

test('applyPlatformPaths maps only the current platform path group to legacy fields', () => {
  const cfg = applyPlatformPaths({
    armGccPath: 'windows-gcc',
    makePath: 'windows-make',
    pyocdPath: 'windows-pyocd',
    cubeMxPath: 'windows-cubemx',
    platformPaths: {
      macos: {
        armGccPath: 'mac-gcc',
        makePath: 'mac-make',
        pyocdPath: 'mac-pyocd',
        cubeMxPath: 'mac-cubemx'
      }
    }
  }, 'macos');

  assert.equal(cfg.armGccPath, 'mac-gcc');
  assert.equal(cfg.makePath, 'mac-make');
  assert.equal(cfg.pyocdPath, 'mac-pyocd');
  assert.equal(cfg.cubeMxPath, 'mac-cubemx');
  assert.equal(cfg.platformPaths.macos.pyocdPath, 'mac-pyocd');
});

test('mergeCurrentPlatformPaths saves edited fields into only the current platform group', () => {
  const cfg = mergeCurrentPlatformPaths({
    platformPaths: {
      windows: { pyocdPath: 'windows-pyocd' },
      macos: { pyocdPath: 'old-mac-pyocd' }
    }
  }, {
    armGccPath: 'mac-gcc',
    makePath: 'mac-make',
    pyocdPath: 'new-mac-pyocd',
    cubeMxPath: 'mac-cubemx'
  }, 'macos');

  assert.equal(cfg.platformPaths.windows.pyocdPath, 'windows-pyocd');
  assert.equal(cfg.platformPaths.macos.pyocdPath, 'new-mac-pyocd');
  assert.equal(cfg.pyocdPath, 'new-mac-pyocd');
});

test('applyPlatformPaths replaces stale windows paths with current platform defaults', () => {
  const cfg = applyPlatformPaths({
    armGccPath: String.raw`C:\stm32\gcc\bin`,
    makePath: String.raw`D:\tools\make\bin`,
    pyocdPath: String.raw`C:\Python312\Scripts\pyocd.exe`,
    cubeMxPath: String.raw`C:\Program Files\STM32CubeMX\STM32CubeMX.exe`
  }, 'macos', {
    armGccPath: '/opt/homebrew/bin',
    makePath: '/usr/bin',
    pyocdPath: '/opt/homebrew/bin/pyocd',
    cubeMxPath: '/Applications/STM32CubeMX.app/Contents/MacOs/STM32CubeMX'
  });

  assert.equal(cfg.armGccPath, '/opt/homebrew/bin');
  assert.equal(cfg.makePath, '/usr/bin');
  assert.equal(cfg.pyocdPath, '/opt/homebrew/bin/pyocd');
  assert.equal(cfg.cubeMxPath, '/Applications/STM32CubeMX.app/Contents/MacOs/STM32CubeMX');
});

test('applyPlatformPaths removes stale windows paths from current platform group', () => {
  const cfg = applyPlatformPaths({
    platformPaths: {
      macos: {
        pyocdPath: String.raw`C:\Python312\Scripts\pyocd.exe`
      }
    }
  }, 'macos', {
    pyocdPath: '/opt/homebrew/bin/pyocd'
  });

  assert.equal(cfg.pyocdPath, '/opt/homebrew/bin/pyocd');
  assert.equal(cfg.platformPaths.macos.pyocdPath, '/opt/homebrew/bin/pyocd');
});

test('download plan follows toolchain mode and platform', () => {
  const win = getPlatformToolchainProfile('win32', 'x64');
  const mac = getPlatformToolchainProfile('darwin', 'arm64');

  assert.deepEqual(getToolchainDownloadPlan(mac, 'custom').downloads, []);

  const winPlan = getToolchainDownloadPlan(win, 'default');
  assert.deepEqual(winPlan.downloads.map((x) => x.key), ['commandTools', 'gcc', 'make', 'pyocd', 'openocd']);

  const macPlan = getToolchainDownloadPlan(mac, 'default');
  assert.deepEqual(macPlan.downloads.map((x) => x.key), ['gcc', 'pyocd', 'openocd']);
  assert.deepEqual(macPlan.system.map((x) => x.key), ['commandTools', 'make']);
});
