const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  getPlatformToolchainProfile,
  applyPlatformPaths,
  mergeCurrentPlatformPaths
} = require('../toolchain/platform-toolchains');

const KEIL_SUPPORTED = process.platform === 'win32';
const PLATFORM_TC = getPlatformToolchainProfile(process.platform, process.arch);

/* ── 默认工具链配置 ──────────────────────────────────────
 * 这些路径可在「设置」中修改，并持久化到 userData/config.json，
 * 不再写死在源码里，换机器只需改设置即可。
 */
const DEFAULT_CONFIG = {
  armGccPath: PLATFORM_TC.placeholders.armGccPath,
  makePath:   PLATFORM_TC.placeholders.makePath,
  pyocdPath:  PLATFORM_TC.placeholders.pyocdPath,
  openocdPath: PLATFORM_TC.placeholders.openocdPath,
  targetChip: 'stm32f103c8',
  elfName:    '', // 留空 = 自动在 build/ 下检测 .elf
  autoDetectChip: true, // 烧录前用 pyocd 自动识别芯片，识别不到回退到 targetChip
  connectUnderReset: false, // true = 复位状态下连接(connect under-reset)，解决固件占用 SWD/进低功耗后连不上(需探针 nRST 接到芯片复位脚)
  toolchainMode: 'custom', // 'custom' = 用上面的自定义路径；'default' = 自动下载到 toolchainRootPath/userData
  toolchainRootPath: '', // 默认工具链下载保存目录；留空=打包态 userData/toolchain，开发态仓库根 toolchain/
  ghProxy: '', // 可选下载加速镜像前缀，如 https://gh-proxy.com ；留空直连 GitHub
  buildSystem: 'auto', // 'auto' = 按工程文件自动判断；'make' = Makefile(GCC)；'keil' = Keil uVision5(UV4)
  keilUV4Path: String.raw`C:\Keil_v5\UV4\UV4.exe`, // Keil uVision5 的 UV4.exe 路径
  keilRebuild: false, // true = 重新编译全部(-z)；false = 增量编译(-b)
  cubeMxPath: PLATFORM_TC.placeholders.cubeMxPath, // STM32CubeMX 路径（用于把 CubeMX 工程一键生成 Makefile）
  flashMethod: 'pyocd', // 'pyocd' = pyOCD；'openocd' = OpenOCD；'keil' = Keil UV4
  ramLogConfig: {
    base: '0x20004800',
    magic: '0x524C4F47',
    size: 1024,
    interval: 500,
    encoding: 'utf-8',
    ring: true,
    offsets: { magic: 0, version: 4, size: 8, writePos: 12, seq: 16, data: 20 }
  },
  recentProjects: [], // 最近打开的工程目录（最新在前）
  windowBounds: null, // 主窗口尺寸/位置记忆 {x,y,width,height}
  floatBounds: null,  // 独立悬浮窗位置记忆
  floatVisible: true, // 是否显示独立悬浮窗
  stc51Config: {
    portPath: '',
    protocol: 'auto',
    baudRate: 115200,
    handshakeBaud: 2400,
    firmwarePath: '',
    eepromPath: '',
    eraseOnly: false,
    autoReset: false,
    resetPin: 'dtr',
    resetCmd: '',
    trimKHz: '',
    optionsText: '',
    debug: false
  }, // StcGal 串口/USB BSL 烧录配置
  esp32Config: {
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
    parts: [],
    partMode: false
  }, // ESP32/ESP8266 esptool 烧录配置
  platformPaths: {}, // 分平台路径配置 { windows|macos|linux: { armGccPath, makePath, pyocdPath, cubeMxPath, keilUV4Path } }
  serialQuickCmds: [], // 旧版：扁平快捷指令列表（兼容迁移用）
  serialCmdGroups: [], // 串口快捷指令分组 [{name, cmds:[{name,content,hex,interval,unit,enabled}]}]
  httpApi: {           // 本地 HTTP API：外部工具可 POST /api/build-flash 触发一键编译烧录
    enabled: true,     // 主进程启动时是否自动开启
    host: '127.0.0.1', // 仅监听回环；改成 0.0.0.0 才对外暴露（不推荐）
    port: 27080        // TCP 端口
  }
};

/* ── 配置读写 ─────────────────────────────────────────── */
function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// 内存缓存：避免每次 IPC 都同步读盘 + JSON.parse
let _configCache = null;
// 防抖落盘：设置开关/窗口拖拽会高频 save；合并写盘降低主进程卡顿
let _saveTimer = null;
let _dirtyConfig = null; // 待写入磁盘的最新快照
const SAVE_DEBOUNCE_MS = 80;

function loadConfig() {
  if (_configCache) return _configCache;
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    _configCache = normalizeConfig(Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw)));
  } catch {
    _configCache = normalizeConfig(Object.assign({}, DEFAULT_CONFIG));
  }
  return _configCache;
}

function normalizeConfig(cfg) {
  const next = applyPlatformPaths(Object.assign({}, cfg), PLATFORM_TC.id, DEFAULT_CONFIG);
  if (!KEIL_SUPPORTED) {
    if (next.buildSystem === 'keil') next.buildSystem = 'make';
    if (next.flashMethod === 'keil') next.flashMethod = 'pyocd';
  }
  return next;
}

function writeConfigToDisk(merged) {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // 原子写：先写临时文件再 rename，避免进程被杀时截断 config.json
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, p);
  } catch {
    // 跨设备等极端情况：回退直接写
    fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function scheduleDiskWrite(merged) {
  _dirtyConfig = merged;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    const snap = _dirtyConfig;
    _dirtyConfig = null;
    if (snap) writeConfigToDisk(snap);
  }, SAVE_DEBOUNCE_MS);
  if (_saveTimer.unref) _saveTimer.unref();
}

// 退出前强制落盘，避免防抖窗口内丢配置
function flushSaveConfig() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  if (_dirtyConfig) {
    const snap = _dirtyConfig;
    _dirtyConfig = null;
    writeConfigToDisk(snap);
    return true;
  }
  return false;
}

// 合并保存：以“当前已持久化配置”为底，仅覆盖传入的字段，
// 避免设置面只传部分字段时把 recentProjects 等其他字段清空。
// opts.immediate === true 时同步写盘（重置配置等关键路径）。
function saveConfig(cfg, opts) {
  const base = Object.assign({}, DEFAULT_CONFIG, loadConfig());
  const merged = normalizeConfig(mergeCurrentPlatformPaths(base, cfg, PLATFORM_TC.id, DEFAULT_CONFIG));
  _configCache = merged;
  if (opts && opts.immediate) {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    _dirtyConfig = null;
    writeConfigToDisk(merged);
  } else {
    scheduleDiskWrite(merged);
  }
  return merged;
}

/* ── 历史项目 ────────────────────────────────── */
function addRecent(dir) {
  if (!dir) return loadConfig().recentProjects;
  const cfg = loadConfig();
  const list = cfg.recentProjects || [];
  if (list[0] === dir) return list;   // 已在首位：每次编译/烧录/HTTP 任务都会调用，避免无意义重写 config.json
  cfg.recentProjects = [dir, ...list.filter((d) => d !== dir)].slice(0, 12);
  saveConfig(cfg);
  return cfg.recentProjects;
}

function removeRecent(dir) {
  const cfg = loadConfig();
  cfg.recentProjects = (cfg.recentProjects || []).filter((d) => d !== dir);
  saveConfig(cfg);
  return cfg.recentProjects;
}

module.exports = {
  PLATFORM_TC,
  KEIL_SUPPORTED,
  DEFAULT_CONFIG,
  configPath,
  loadConfig,
  normalizeConfig,
  saveConfig,
  flushSaveConfig,
  addRecent,
  removeRecent
};
