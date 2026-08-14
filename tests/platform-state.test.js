'use strict';
const test = require('node:test');
const assert = require('node:assert');

const {
  applyPlatformState,
  mergeCurrentPlatformState,
  snapshotPlatformState
} = require('../src/main/core/platform-state');

test('applyPlatformState 用本平台快照覆盖顶层与嵌套字段', () => {
  const cfg = {
    toolchainRootPath: 'D:\\toolchain',
    recentProjects: ['C:\\proj\\a'],
    stc51Config: { portPath: 'COM3', baudRate: 115200 },
    esp32Config: { portPath: 'COM4', chip: 'auto' },
    platformState: {
      macos: {
        toolchainRootPath: '/Users/me/toolchain',
        windowBounds: { x: 1, y: 2, width: 800, height: 600 },
        floatBounds: null,
        recentProjects: ['/Users/me/proj'],
        stc51Config: { portPath: '/dev/tty.usbserial', firmwarePath: '', eepromPath: '' },
        esp32Config: { portPath: '/dev/tty.wchusbserial', firmwarePath: '', parts: [] }
      }
    }
  };
  const out = applyPlatformState(cfg, 'macos');
  assert.strictEqual(out.toolchainRootPath, '/Users/me/toolchain');
  assert.deepStrictEqual(out.recentProjects, ['/Users/me/proj']);
  assert.strictEqual(out.stc51Config.portPath, '/dev/tty.usbserial');
  assert.strictEqual(out.stc51Config.baudRate, 115200); // 非隔离字段保持共享
  assert.strictEqual(out.esp32Config.portPath, '/dev/tty.wchusbserial');
  assert.strictEqual(out.esp32Config.chip, 'auto');
});

test('applyPlatformState 首次在本平台加载旧配置时清洗另一平台的路径/串口号', () => {
  const cfg = {
    toolchainRootPath: 'D:\\toolchain',
    recentProjects: ['C:\\proj\\a', '/Users/me/proj'],
    stc51Config: { portPath: 'COM3' },
    esp32Config: { portPath: 'COM4', firmwarePath: 'C:\\fw\\app.bin' }
  };
  const out = applyPlatformState(cfg, 'macos');
  assert.strictEqual(out.toolchainRootPath, '');
  assert.deepStrictEqual(out.recentProjects, ['/Users/me/proj']);
  assert.strictEqual(out.stc51Config.portPath, '');
  assert.strictEqual(out.esp32Config.firmwarePath, '');
  // 并已回写本平台快照
  assert.strictEqual(out.platformState.macos.toolchainRootPath, '');
});

test('applyPlatformState 在 windows 平台清洗 POSIX 路径', () => {
  const out = applyPlatformState({ toolchainRootPath: '/Users/me/toolchain', recentProjects: ['/Users/me/proj'] }, 'windows');
  assert.strictEqual(out.toolchainRootPath, '');
  assert.deepStrictEqual(out.recentProjects, []);
});

test('mergeCurrentPlatformState 保存时以最新值覆盖本平台快照且不动其他平台', () => {
  const cfg = {
    toolchainRootPath: '/new/root',
    stc51Config: { portPath: '/dev/tty.new' },
    esp32Config: { portPath: '' },
    platformState: {
      macos: snapshotPlatformState({ toolchainRootPath: '/old/root', stc51Config: { portPath: '/dev/tty.old' } }),
      windows: snapshotPlatformState({ toolchainRootPath: 'D:\\toolchain', stc51Config: { portPath: 'COM3' } })
    }
  };
  const merged = mergeCurrentPlatformState(cfg, 'macos');
  assert.strictEqual(merged.platformState.macos.toolchainRootPath, '/new/root');
  assert.strictEqual(merged.platformState.macos.stc51Config.portPath, '/dev/tty.new');
  assert.strictEqual(merged.platformState.windows.toolchainRootPath, 'D:\\toolchain');
  // 保存后再 apply，不会用旧值覆盖新值
  const applied = applyPlatformState(merged, 'macos');
  assert.strictEqual(applied.toolchainRootPath, '/new/root');
  assert.strictEqual(applied.stc51Config.portPath, '/dev/tty.new');
});
