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

const {
  APPLETS, parseToolVersion, supportedCommandTools, toolchainRoot, preferredToolchainRoot,
  legacyToolchainRoot, mergePathEntries, resolveShellProfile, updateManagedShellPath,
  removeManagedShellPath, inspectManagedShellPath, getShellPathStatus
} = require('../src/main/toolchain/toolchain');

test('packaged app stores default toolchain under userData (survives updates)', () => {
  assert.equal(toolchainRoot(), path.join(tmpUserData, 'toolchain'));
  assert.equal(preferredToolchainRoot(), path.join(tmpUserData, 'toolchain'));
  assert.equal(legacyToolchainRoot(), path.join(tmpExeDir, 'toolchain'));
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


test('resolveShellProfile selects platform and shell specific startup files', () => {
  const home = path.join(os.tmpdir(), 'burningtool-home');
  assert.equal(resolveShellProfile('darwin', '/bin/zsh', home), path.join(home, '.zprofile'));
  assert.equal(resolveShellProfile('darwin', '/bin/bash', home), path.join(home, '.bash_profile'));
  assert.equal(resolveShellProfile('linux', '/bin/zsh', home), path.join(home, '.zshrc'));
  assert.equal(resolveShellProfile('linux', '/bin/bash', home), path.join(home, '.bashrc'));
  assert.equal(resolveShellProfile('linux', '/bin/sh', home), path.join(home, '.profile'));
});

test('getShellPathStatus detects macOS and Linux profile configuration', () => {
  const home = path.join(os.tmpdir(), 'burningtool-shell-home-' + process.pid);
  const dirs = [path.join(home, 'toolchain', 'gcc', 'bin')];
  const macProfile = resolveShellProfile('darwin', '/bin/zsh', home);
  require('node:fs').mkdirSync(path.dirname(macProfile), { recursive: true });
  require('node:fs').writeFileSync(macProfile, updateManagedShellPath('', dirs));

  const mac = getShellPathStatus(dirs, { platform: 'darwin', shell: '/bin/zsh', home });
  assert.equal(mac.supported, true);
  assert.equal(mac.present, true);
  assert.equal(mac.profile, macProfile);
  assert.match(mac.label, /macOS/);

  const linux = getShellPathStatus(dirs, { platform: 'linux', shell: '/bin/bash', home });
  assert.equal(linux.supported, true);
  assert.equal(linux.present, false);
  assert.equal(linux.profile, path.join(home, '.bashrc'));
});

test('managed shell PATH block preserves user config and is replaceable', () => {
  const dirs = ['/opt/MCU Tools/gcc/bin', "/opt/vendor's/openocd/bin"];
  const original = 'export EDITOR=vim\n';
  const first = updateManagedShellPath(original, dirs);
  assert.match(first, /export EDITOR=vim/);
  assert.match(first, /burningTool toolchain PATH/);
  assert.match(first, /export PATH='\/opt\/MCU Tools\/gcc\/bin':"\$PATH"/);
  assert.match(first, /export PATH='\/opt\/vendor'"'"'s\/openocd\/bin':"\$PATH"/);
  assert.deepEqual(inspectManagedShellPath(first, dirs), { matched: dirs, missing: [] });

  const nextDirs = ['/opt/new/gcc/bin'];
  const second = updateManagedShellPath(first, nextDirs);
  assert.equal((second.match(/>>> burningTool toolchain PATH >>>/g) || []).length, 1);
  assert.equal(second, updateManagedShellPath(second, nextDirs));
  assert.deepEqual(inspectManagedShellPath(second, nextDirs), { matched: nextDirs, missing: [] });
  assert.doesNotMatch(second, /MCU Tools/);
  assert.equal(removeManagedShellPath(second).trim(), original.trim());
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



test('preferredToolchainRoot honors custom toolchainRootPath', () => {
  const custom = path.join(tmpUserData, 'my-toolchain-store');
  assert.equal(preferredToolchainRoot({ toolchainRootPath: custom }), path.resolve(custom));
  assert.equal(preferredToolchainRoot({ toolchainRootPath: '' }), path.join(tmpUserData, 'toolchain'));
});

test.after(() => {
  Module._load = origLoad;
});
