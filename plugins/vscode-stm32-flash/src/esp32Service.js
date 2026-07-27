'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  jobLock,
  flashEsp32,
  esp32ToolStatus,
  findArduinoSketch,
  arduinoCliStatus,
  compileArduino,
  flashArduino,
  resolveArduinoFirmware,
  fqbnFromCfg
} = require('../vendor/flash-core');
const { loadDesktopConfig } = require('./toolchainShare');
const { getProjectDir } = require('./project');

function clean(s) {
  return String(s || '').trim();
}

/** 常见 ESP32 Arduino FQBN 快捷项 */
const ESP32_FQBN_PRESETS = [
  { label: 'ESP32 Dev Module', value: 'esp32:esp32:esp32' },
  { label: 'ESP32-S2', value: 'esp32:esp32:esp32s2' },
  { label: 'ESP32-S3', value: 'esp32:esp32:esp32s3' },
  { label: 'ESP32-C3', value: 'esp32:esp32:esp32c3' },
  { label: 'ESP32-C6', value: 'esp32:esp32:esp32c6' },
  { label: '自定义 FQBN', value: 'custom' }
];

async function listSerialPorts() {
  try {
    let SerialPort = null;
    try { SerialPort = require('serialport').SerialPort; } catch {}
    if (!SerialPort) {
      try {
        const rootSp = path.resolve(__dirname, '../../../../node_modules/serialport');
        SerialPort = require(rootSp).SerialPort;
      } catch {}
    }
    if (SerialPort && typeof SerialPort.list === 'function') {
      const ports = await SerialPort.list();
      return {
        ok: true,
        source: 'serialport',
        ports: (ports || []).map((p) => ({
          path: p.path || '',
          label: p.friendlyName || p.manufacturer || p.path || '',
          manufacturer: p.manufacturer || '',
          vendorId: p.vendorId || '',
          productId: p.productId || ''
        })).filter((p) => p.path)
      };
    }
  } catch {
    /* fallback */
  }

  const ports = [];
  try {
    if (process.platform === 'darwin') {
      for (const name of fs.readdirSync('/dev')) {
        if (/^(cu|tty)\./.test(name)) {
          ports.push({ path: `/dev/${name}`, label: name, manufacturer: '', vendorId: '', productId: '' });
        }
      }
    } else if (process.platform === 'linux') {
      for (const name of fs.readdirSync('/dev')) {
        if (/^tty(USB|ACM|S)\d+/.test(name)) {
          ports.push({ path: `/dev/${name}`, label: name, manufacturer: '', vendorId: '', productId: '' });
        }
      }
    } else if (process.platform === 'win32') {
      const r = spawnSync('cmd', ['/c', 'mode'], { encoding: 'utf8', windowsHide: true });
      const text = `${r.stdout || ''}\n${r.stderr || ''}`;
      const found = new Set();
      for (const m of text.matchAll(/COM\d+/gi)) {
        const p = m[0].toUpperCase();
        if (!found.has(p)) {
          found.add(p);
          ports.push({ path: p, label: p, manufacturer: '', vendorId: '', productId: '' });
        }
      }
    }
  } catch {
    /* ignore */
  }
  return { ok: true, source: 'scan', ports };
}

function desktopEsp32Defaults() {
  try {
    const cfg = loadDesktopConfig() || {};
    return cfg.esp32Config && typeof cfg.esp32Config === 'object' ? cfg.esp32Config : {};
  } catch {
    return {};
  }
}

function desktopArduinoDefaults() {
  try {
    const cfg = loadDesktopConfig() || {};
    return {
      arduinoFqbn: cfg.arduinoFqbn || cfg.arduinoBoard || '',
      arduinoPort: cfg.arduinoPort || '',
      arduinoCliPath: cfg.arduinoCliPath || ''
    };
  } catch {
    return {};
  }
}

function detectProjectMode(projectDir) {
  const dir = clean(projectDir);
  if (!dir || !fs.existsSync(dir)) {
    return {
      mode: 'bin',
      modeLabel: '固件烧录（esptool）',
      projectDir: dir || '',
      arduino: null
    };
  }
  const arduino = findArduinoSketch(dir);
  if (arduino) {
    return {
      mode: 'arduino',
      modeLabel: `Arduino 工程（${arduino.name}.ino）`,
      projectDir: dir,
      arduino
    };
  }
  return {
    mode: 'bin',
    modeLabel: '固件烧录（esptool .bin）',
    projectDir: dir,
    arduino: null
  };
}

function createEsp32Service(deps) {
  const { output, statusBar, getConfig } = deps;

  /** @type {any} */
  let state = {
    busy: false,
    portPath: '',
    chip: 'auto',
    baudRate: 460800,
    flashMode: 'keep',
    flashFreq: 'keep',
    flashSize: 'detect',
    beforeReset: 'default_reset',
    afterReset: 'hard_reset',
    eraseBeforeWrite: false,
    flashOffset: '0x0',
    firmwarePath: '',
    ports: [],
    // tools
    esptoolOk: false,
    esptoolVersion: '',
    esptoolError: '',
    arduinoCliOk: false,
    arduinoCliVersion: '',
    arduinoCliError: '',
    // project
    projectDir: '',
    projectMode: 'bin', // arduino | bin
    projectModeLabel: '固件烧录（esptool）',
    arduinoSketch: '',
    arduinoSketchDir: '',
    arduinoFqbn: 'esp32:esp32:esp32',
    lastResult: null
  };

  function applyDesktopDefaults() {
    const d = desktopEsp32Defaults();
    const a = desktopArduinoDefaults();
    if (!state.portPath && d.portPath) state.portPath = d.portPath;
    if (!state.portPath && a.arduinoPort) state.portPath = a.arduinoPort;
    if (d.chip) state.chip = d.chip;
    if (d.baudRate) state.baudRate = d.baudRate;
    if (d.flashMode) state.flashMode = d.flashMode;
    if (d.flashFreq) state.flashFreq = d.flashFreq;
    if (d.flashSize) state.flashSize = d.flashSize;
    if (d.beforeReset) state.beforeReset = d.beforeReset;
    if (d.afterReset) state.afterReset = d.afterReset;
    if (typeof d.eraseBeforeWrite === 'boolean') state.eraseBeforeWrite = d.eraseBeforeWrite;
    if (d.flashOffset) state.flashOffset = d.flashOffset;
    if (d.firmwarePath) state.firmwarePath = d.firmwarePath;
    // Arduino FQBN：优先设置/桌面；默认 ESP32 Dev Module
    const cfg = getConfig() || {};
    state.arduinoFqbn = clean(cfg.arduinoFqbn || cfg.arduinoBoard || a.arduinoFqbn) || 'esp32:esp32:esp32';
  }

  function refreshProjectFromWorkspace() {
    const dir = getProjectDir() || '';
    const det = detectProjectMode(dir);
    state.projectDir = det.projectDir;
    state.projectMode = det.mode;
    state.projectModeLabel = det.modeLabel;
    state.arduinoSketch = det.arduino ? path.relative(dir, det.arduino.sketchFile) || path.basename(det.arduino.sketchFile) : '';
    state.arduinoSketchDir = det.arduino ? det.arduino.sketchDir : '';
    // 若 Arduino 且设置里还是 avr uno，自动偏向 esp32 fqbn
    const cfg = getConfig() || {};
    const fqbn = clean(cfg.arduinoFqbn || cfg.arduinoBoard || state.arduinoFqbn);
    if (det.mode === 'arduino') {
      if (!fqbn || fqbn.startsWith('arduino:avr:')) {
        state.arduinoFqbn = 'esp32:esp32:esp32';
      } else {
        state.arduinoFqbn = fqbn;
      }
    } else if (fqbn) {
      state.arduinoFqbn = fqbn;
    }
  }

  function snapshot() {
    const isArduino = state.projectMode === 'arduino';
    const canArduino = isArduino && !!state.portPath && !!state.arduinoFqbn && state.arduinoCliOk && !state.busy;
    const canEsptool = !isArduino && !!state.portPath && !!state.firmwarePath && state.esptoolOk && !state.busy;
    return {
      ...state,
      ports: (state.ports || []).map((p) => ({ ...p })),
      fqbnPresets: ESP32_FQBN_PRESETS,
      isArduino,
      canBuild: isArduino ? (state.arduinoCliOk && !state.busy && !!state.projectDir) : false,
      canFlash: isArduino ? canArduino : canEsptool,
      canBuildAndFlash: isArduino ? canArduino : canEsptool,
      firmwareName: state.firmwarePath ? path.basename(state.firmwarePath) : '',
      toolOk: isArduino ? state.arduinoCliOk : state.esptoolOk,
      toolVersion: isArduino ? state.arduinoCliVersion : state.esptoolVersion,
      toolError: isArduino ? state.arduinoCliError : state.esptoolError
    };
  }

  const listeners = new Set();
  function emit() {
    const s = snapshot();
    for (const fn of listeners) {
      try { fn(s); } catch { /* ignore */ }
    }
  }
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  async function refreshTool() {
    const cfg = getConfig() || {};
    // esptool
    try {
      const r = await esp32ToolStatus(cfg);
      state.esptoolOk = !!(r && r.ok);
      state.esptoolVersion = (r && r.version) || '';
      state.esptoolError = (r && r.error) || '';
    } catch (e) {
      state.esptoolOk = false;
      state.esptoolVersion = '';
      state.esptoolError = e.message || String(e);
    }
    // arduino-cli
    try {
      const r = await arduinoCliStatus(cfg);
      state.arduinoCliOk = !!(r && r.ok);
      state.arduinoCliVersion = (r && r.version) || '';
      state.arduinoCliError = (r && r.error) || '';
    } catch (e) {
      state.arduinoCliOk = false;
      state.arduinoCliVersion = '';
      state.arduinoCliError = e.message || String(e);
    }
    refreshProjectFromWorkspace();
    emit();
    return snapshot();
  }

  async function refreshPorts() {
    const r = await listSerialPorts();
    state.ports = (r && r.ports) || [];
    if (state.portPath && !state.ports.some((p) => p.path === state.portPath)) {
      state.ports = [{ path: state.portPath, label: state.portPath }, ...state.ports];
    }
    if (!state.portPath && state.ports[0]) state.portPath = state.ports[0].path;
    emit();
    return snapshot();
  }

  function update(partial = {}) {
    Object.assign(state, partial || {});
    // 同步 FQBN 到 vscode 设置（异步 fire-and-forget）
    if (partial && partial.arduinoFqbn != null) {
      try {
        const vscode = require('vscode');
        vscode.workspace.getConfiguration('stm32Flash').update(
          'arduinoFqbn',
          state.arduinoFqbn,
          vscode.ConfigurationTarget.Global
        ).then(() => {}, () => {});
        vscode.workspace.getConfiguration('stm32Flash').update(
          'arduinoPort',
          state.portPath,
          vscode.ConfigurationTarget.Global
        ).then(() => {}, () => {});
      } catch {
        /* non-vscode env */
      }
    }
    if (partial && partial.portPath != null) {
      try {
        const vscode = require('vscode');
        vscode.workspace.getConfiguration('stm32Flash').update(
          'arduinoPort',
          state.portPath,
          vscode.ConfigurationTarget.Global
        ).then(() => {}, () => {});
      } catch {
        /* ignore */
      }
    }
    emit();
    return snapshot();
  }

  function buildCfg() {
    const cfg = { ...(getConfig() || {}) };
    cfg.arduinoFqbn = state.arduinoFqbn || cfg.arduinoFqbn || 'esp32:esp32:esp32';
    cfg.arduinoBoard = cfg.arduinoFqbn;
    cfg.arduinoPort = state.portPath || cfg.arduinoPort || '';
    cfg.portPath = state.portPath || '';
    cfg.buildSystem = state.projectMode === 'arduino' ? 'arduino' : cfg.buildSystem;
    cfg.flashMethod = state.projectMode === 'arduino' ? 'arduino' : 'esptool';
    return cfg;
  }

  async function doBuild() {
    refreshProjectFromWorkspace();
    if (state.projectMode !== 'arduino') {
      output.append('[ESP32] 当前不是 Arduino 工程，无需 arduino-cli 编译；请直接选择 .bin 烧录', 'warn');
      return { ok: false, error: 'not-arduino-project' };
    }
    if (state.busy) return { ok: false, busy: true, error: '忙碌中' };
    if (!state.arduinoCliOk) {
      output.append(`[ESP32] ✗ ${state.arduinoCliError || '未找到 arduino-cli'}`, 'error');
      return { ok: false, error: 'no-arduino-cli' };
    }

    output.show(true);
    output.append('═════════ ESP32 Arduino 编译 ═════════', 'step');
    output.append(`[ESP32] 工程: ${state.projectDir}`, 'info');
    output.append(`[ESP32] 草图: ${state.arduinoSketch || state.arduinoSketchDir}`, 'info');
    output.append(`[ESP32] FQBN: ${state.arduinoFqbn}`, 'info');
    statusBar.setBusy('Arduino 编译中…');
    state.busy = true;
    state.lastResult = null;
    emit();

    const cfg = buildCfg();
    const sketchRoot = state.arduinoSketchDir || state.projectDir;
    const locked = await jobLock.runExclusive('arduino-compile-esp32', async () => compileArduino(sketchRoot, cfg));
    state.busy = false;
    if (locked.busy) {
      output.append(`[任务] 忙碌中：${locked.error}`, 'warn');
      statusBar.setBusy('忙碌');
      emit();
      return { ok: false, busy: true, error: locked.error };
    }
    const ok = !!(locked.result);
    state.lastResult = ok ? 'ok' : 'err';
    statusBar.setResult(ok);
    if (ok) {
      const fw = resolveArduinoFirmware(sketchRoot, cfg);
      if (fw) {
        state.firmwarePath = fw;
        output.append(`[ESP32] 产物: ${fw}`, 'info');
      }
    }
    emit();
    return { ok };
  }

  async function doFlash(opts = {}) {
    refreshProjectFromWorkspace();
    if (state.busy) return { ok: false, busy: true, error: '忙碌中' };

    // Arduino 工程 → arduino-cli upload
    if (state.projectMode === 'arduino') {
      const portPath = clean(opts.portPath || state.portPath);
      if (!portPath) {
        output.append('[ESP32] ✗ 未选择串口', 'error');
        return { ok: false, error: '未选择串口' };
      }
      if (!state.arduinoCliOk) {
        output.append(`[ESP32] ✗ ${state.arduinoCliError || '未找到 arduino-cli'}`, 'error');
        return { ok: false, error: 'no-arduino-cli' };
      }
      output.show(true);
      output.append('═════════ ESP32 Arduino 烧录 ═════════', 'step');
      output.append(`[ESP32] 草图: ${state.arduinoSketch || state.projectDir}`, 'info');
      output.append(`[ESP32] FQBN: ${state.arduinoFqbn}`, 'info');
      output.append(`[ESP32] 串口: ${portPath}`, 'info');
      statusBar.setBusy('Arduino 烧录中…');
      state.busy = true;
      state.lastResult = null;
      state.portPath = portPath;
      emit();

      const cfg = buildCfg();
      cfg.arduinoPort = portPath;
      const sketchRoot = state.arduinoSketchDir || state.projectDir;
      const locked = await jobLock.runExclusive('arduino-upload-esp32', async () => flashArduino(sketchRoot, cfg));
      state.busy = false;
      if (locked.busy) {
        output.append(`[任务] 忙碌中：${locked.error}`, 'warn');
        statusBar.setBusy('忙碌');
        emit();
        return { ok: false, busy: true, error: locked.error };
      }
      const ok = !!(locked.result);
      state.lastResult = ok ? 'ok' : 'err';
      statusBar.setResult(ok);
      emit();
      return { ok };
    }

    // 非 Arduino：esptool 烧 .bin
    const portPath = clean(opts.portPath || state.portPath);
    const firmwarePath = clean(opts.firmwarePath || state.firmwarePath);
    if (!portPath) {
      output.append('[ESP32] ✗ 未选择串口', 'error');
      return { ok: false, error: '未选择串口' };
    }
    if (!firmwarePath) {
      output.append('[ESP32] ✗ 未选择固件 (.bin)。若是 Arduino 工程请打开含 .ino 的目录', 'error');
      return { ok: false, error: '未选择固件' };
    }

    const flashOpts = {
      portPath,
      chip: opts.chip || state.chip || 'auto',
      baudRate: opts.baudRate || state.baudRate || 460800,
      flashMode: opts.flashMode || state.flashMode || 'keep',
      flashFreq: opts.flashFreq || state.flashFreq || 'keep',
      flashSize: opts.flashSize || state.flashSize || 'detect',
      beforeReset: opts.beforeReset || state.beforeReset || 'default_reset',
      afterReset: opts.afterReset || state.afterReset || 'hard_reset',
      eraseBeforeWrite: opts.eraseBeforeWrite != null ? !!opts.eraseBeforeWrite : !!state.eraseBeforeWrite,
      flashOffset: opts.flashOffset || state.flashOffset || '0x0',
      firmwarePath
    };

    output.show(true);
    output.append('═════════ ESP32 esptool 烧录 ═════════', 'step');
    statusBar.setBusy('ESP32 烧录中…');
    state.busy = true;
    state.lastResult = null;
    emit();

    const cfg = getConfig() || {};
    const locked = await jobLock.runExclusive('flash-esp32', async () => flashEsp32(flashOpts, cfg));
    state.busy = false;
    if (locked.busy) {
      output.append(`[任务] 忙碌中：${locked.error}`, 'warn');
      statusBar.setBusy('忙碌');
      emit();
      return { ok: false, busy: true, error: locked.error };
    }
    const result = locked.result || { ok: false, error: locked.error || '烧录失败' };
    state.lastResult = result.ok ? 'ok' : 'err';
    state.portPath = portPath;
    state.firmwarePath = firmwarePath;
    statusBar.setResult(!!result.ok);
    emit();
    return result;
  }

  async function doBuildAndFlash() {
    refreshProjectFromWorkspace();
    if (state.projectMode === 'arduino') {
      const b = await doBuild();
      if (!b.ok) return b;
      return doFlash();
    }
    // bin 模式无独立编译，直接烧
    return doFlash();
  }

  async function doErase() {
    if (state.busy) return { ok: false, busy: true, error: '忙碌中' };
    const portPath = clean(state.portPath);
    if (!portPath) {
      output.append('[ESP32] ✗ 未选择串口', 'error');
      return { ok: false, error: '未选择串口' };
    }
    output.show(true);
    output.append('═════════ ESP32 全片擦除 ═════════', 'step');
    statusBar.setBusy('ESP32 擦除中…');
    state.busy = true;
    emit();
    const cfg = getConfig() || {};
    const locked = await jobLock.runExclusive('flash-esp32-erase', async () => flashEsp32({
      portPath,
      chip: state.chip,
      baudRate: state.baudRate,
      beforeReset: state.beforeReset,
      afterReset: state.afterReset,
      eraseOnly: true
    }, cfg));
    state.busy = false;
    const result = (locked && locked.result) || { ok: false, error: locked && locked.error };
    state.lastResult = result.ok ? 'ok' : 'err';
    statusBar.setResult(!!result.ok);
    emit();
    return result;
  }

  // init
  applyDesktopDefaults();
  refreshProjectFromWorkspace();

  return {
    getState: snapshot,
    onChange,
    update,
    refreshTool,
    refreshPorts,
    refreshProjectFromWorkspace: () => { refreshProjectFromWorkspace(); emit(); return snapshot(); },
    doBuild,
    doFlash,
    doBuildAndFlash,
    doErase
  };
}

module.exports = {
  createEsp32Service,
  listSerialPorts,
  detectProjectMode,
  ESP32_FQBN_PRESETS
};
