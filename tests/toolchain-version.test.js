const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const tmpUserData = path.join(os.tmpdir(), 'burningtool-toolchain-test');
const tmpExeDir = path.join(os.tmpdir(), 'burningtool-app-root');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: true,
        getPath: (name) => (name === 'exe' ? path.join(tmpExeDir, 'MCU工具箱.exe') : tmpUserData)
      }
    };
  }
  return origLoad.apply(this, arguments);
};

const { APPLETS, parseToolVersion, supportedCommandTools, toolchainRoot, mergePathEntries } = require('../src/main/toolchain/toolchain');

test('packaged app stores default toolchain under app install root', () => {
  assert.equal(toolchainRoot(), path.join(tmpExeDir, 'toolchain'));
});

test('parseToolVersion extracts common tool versions', () => {
  assert.equal(parseToolVersion('gcc', 'arm-none-eabi-gcc (xPack GNU Arm Embedded GCC) 14.2.1'), '14.2.1');
  assert.equal(parseToolVersion('make', 'GNU Make 3.81'), '3.81');
  assert.equal(parseToolVersion('pyocd', 'pyOCD 0.38.0'), '0.38.0');
  assert.equal(parseToolVersion('openocd', 'xPack Open On-Chip Debugger 0.12.0+dev-02228'), '0.12.0+dev-02228');
  assert.equal(parseToolVersion('busybox', 'BusyBox v1.37.0-FRP-5307-g23d40f959'), '1.37.0-FRP-5307-g23d40f959');
});

test('supportedCommandTools returns platform-specific command lists', () => {
  assert.deepEqual(supportedCommandTools('windows'), APPLETS);
  assert.ok(supportedCommandTools('macos').includes('zsh'));
  assert.ok(!supportedCommandTools('macos').includes('chmod'));
  assert.ok(supportedCommandTools('linux').includes('bash'));
  assert.ok(supportedCommandTools('linux').includes('chmod'));
});



test('mergePathEntries prepends unique dirs without duplicates', () => {
  const a = path.join(tmpExeDir, 'toolchain', 'gcc', 'bin');
  const b = path.join(tmpExeDir, 'toolchain', 'make', 'bin');
  const first = mergePathEntries('', [a, b], ';');
  assert.equal(first.path, [a, b].join(';'));
  assert.deepEqual(first.added, [a, b]);
  const second = mergePathEntries(first.path, [a, b], ';');
  assert.equal(second.added.length, 0);
  assert.equal(second.path, first.path);
});

test.after(() => {
  Module._load = origLoad;
});
