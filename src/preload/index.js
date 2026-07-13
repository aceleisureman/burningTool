// 当 Electron 二进制未正确注入 API 时，使用 polyfill
const electronAPI = require('electron');
const { contextBridge, ipcRenderer } = electronAPI;

contextBridge.exposeInMainWorld('api', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectFirmwareFile: () => ipcRenderer.invoke('select-firmware-file'),
  build:           (dir) => ipcRenderer.invoke('build', dir),
  flash:           (dir) => ipcRenderer.invoke('flash', dir),
  buildAndFlash:   (dir) => ipcRenderer.invoke('build-and-flash', dir),
  getConfig:        () => ipcRenderer.invoke('get-config'),
  saveConfig:       (cfg) => ipcRenderer.invoke('save-config', cfg),
  getPlatform:      () => ipcRenderer.invoke('get-platform'),
  getPlatformToolchain: () => ipcRenderer.invoke('get-platform-toolchain'),
  resetConfig:      () => ipcRenderer.invoke('reset-config'),
  exportQuickCmds:  (data) => ipcRenderer.invoke('export-quickcmds', data),
  importQuickCmds:  () => ipcRenderer.invoke('import-quickcmds'),
  toolchainStatus:  () => ipcRenderer.invoke('toolchain-status'),
  installToolchain: () => ipcRenderer.invoke('install-toolchain'),
  defaultToolchainStatus:  () => ipcRenderer.invoke('default-toolchain-status'),
  installDefaultToolchain: (opts) => ipcRenderer.invoke('install-default-toolchain', opts),
  getRecent:        () => ipcRenderer.invoke('get-recent'),
  addRecent:        (dir) => ipcRenderer.invoke('add-recent', dir),
  removeRecent:     (dir) => ipcRenderer.invoke('remove-recent', dir),
  checkDir:         (dir) => ipcRenderer.invoke('check-dir', dir),
  generateMakefile: (dir) => ipcRenderer.invoke('generate-makefile', dir),
  checkProbe:       () => ipcRenderer.invoke('check-probe'),
  readChipInfo:     () => ipcRenderer.invoke('read-chip-info'),
  hardwareDebugCommand: (action, opts) => ipcRenderer.invoke('hardware-debug-command', action, opts),
  analyzeFirmware:  (dir) => ipcRenderer.invoke('analyze-firmware', dir),
  readRamLog:       (opts) => ipcRenderer.invoke('read-ram-log', opts),
  stc51ToolStatus:  () => ipcRenderer.invoke('stc51-tool-status'),
  installStcgal:    (opts) => ipcRenderer.invoke('install-stcgal', opts),
  flashStc51:       (opts) => ipcRenderer.invoke('flash-stc51', opts),
  esp32ToolStatus:  () => ipcRenderer.invoke('esp32-tool-status'),
  installEsptool:   (opts) => ipcRenderer.invoke('install-esptool', opts),
  flashEsp32:       (opts) => ipcRenderer.invoke('flash-esp32', opts),
  onLog:           (cb) => ipcRenderer.on('log', (_e, data) => cb(data)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, data) => cb(data)),
  // ── 串口调试（serialport 后端）──
  serialList:       () => ipcRenderer.invoke('serial-list'),                 // 枚举所有 COM 口（含识别信息）
  serialOpen:       (opts) => ipcRenderer.invoke('serial-open', opts),       // 按路径打开串口
  serialWrite:      (data) => ipcRenderer.invoke('serial-write', data),      // 写字节数组
  serialClose:      () => ipcRenderer.invoke('serial-close'),                // 关闭
  onSerialData:     (cb) => ipcRenderer.on('serial-data', (_e, arr) => cb(arr)),   // 接收数据（字节数组）
  onSerialClosed:   (cb) => ipcRenderer.on('serial-closed', () => cb()),           // 串口被关闭/掉线
  onSerialError:    (cb) => ipcRenderer.on('serial-error', (_e, msg) => cb(msg)),  // 串口错误
  // ── MQTT 调试（mqtt.js 后端）──
  mqttConnect:      (opts) => ipcRenderer.invoke('mqtt-connect', opts),       // 连接 broker
  mqttDisconnect:   (opts) => ipcRenderer.invoke('mqtt-disconnect', opts),    // 断开（按连接 id）
  mqttSubscribe:    (opts) => ipcRenderer.invoke('mqtt-subscribe', opts),     // 订阅 {topic,qos}
  mqttUnsubscribe:  (opts) => ipcRenderer.invoke('mqtt-unsubscribe', opts),   // 退订 {topic}
  mqttPublish:      (opts) => ipcRenderer.invoke('mqtt-publish', opts),       // 发布 {topic,payload,qos,retain}
  onMqttStatus:     (cb) => ipcRenderer.on('mqtt-status', (_e, s) => cb(s)),  // 连接状态变化
  onMqttMessage:    (cb) => ipcRenderer.on('mqtt-message', (_e, m) => cb(m)),
  // ── 本地 HTTP API ──
  httpApiStatus:    () => ipcRenderer.invoke('http-api-status'),
  httpApiStart:     (opts) => ipcRenderer.invoke('http-api-start', opts),
  httpApiStop:      () => ipcRenderer.invoke('http-api-stop'),
  // ── 自动更新（GitHub Releases）──
  updateCheck:      () => ipcRenderer.invoke('update-check'),    // 手动检查更新
  updateStatus:     () => ipcRenderer.invoke('update-status'),   // 当前更新状态/进度
  updateInstall:    () => ipcRenderer.invoke('update-install'),  // 重启并安装已下载的更新
  copyToClipboard:  (text) => ipcRenderer.invoke('clipboard-write', text)  // 收到消息
});
