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
  toolchainMode: 'custom', // 'custom' = 用上面的自定义路径；'default' = 用软件根目录 toolchain/ 自动下载的
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

// 内存缓存：避免每次 IPC 都同步读盘 + JSON.parse（saveConfig 写盘时同步刷新缓存）
let _configCache = null;
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

// 合并保存：以“当前已持久化配置”为底，仅覆盖传入的字段，
// 避免设置面只传部分字段时把 recentProjects 等其他字段清空。
function saveConfig(cfg) {
  const base = Object.assign({}, DEFAULT_CONFIG, loadConfig());
  const merged = normalizeConfig(mergeCurrentPlatformPaths(base, cfg, PLATFORM_TC.id, DEFAULT_CONFIG));
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf8');
  _configCache = merged;
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
  addRecent,
  removeRecent
};
