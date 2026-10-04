import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { fileURLToPath, URL } from 'node:url';

// 开发模式下注入 window.api polyfill（Electron 不可用时的降级方案）
function apiInjectPlugin() {
  return {
    name: 'api-inject',
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === 'production' && !process.env.VITE_DEV_SERVER_URL) return html;
      const script = `<script>
if (!window.api) {
window.api = {
  selectDirectory: async () => {
    const r = await fetch('/api/mock?action=selectDirectory');
    const data = await r.json();
    return data.path || '';
  },
  selectFirmwareFile: async () => {
    const r = await fetch('/api/mock?action=selectFirmwareFile');
    const data = await r.json();
    return data.path || '';
  },
  getConfig: async () => {
    try {
      const r = await fetch('/api/config');
      return await r.json();
    } catch { return {}; }
  },
  saveConfig: async (cfg) => { await fetch('/api/config', {method:'POST',body:JSON.stringify(cfg)}); return true; },
  getMqttHistory: async () => [],
  saveMqttHistory: async () => true,
  getPlatform: async () => /win/i.test(navigator.platform) ? 'win32' : (/mac/i.test(navigator.platform) ? 'darwin' : 'linux'),
  getPlatformToolchain: async () => ({}),
  resetConfig: async () => ({}),
  toolchainStatus: async () => ({ installed: false }),
  installToolchain: async () => ({ success: false }),
  defaultToolchainStatus: async () => ({}),
  installDefaultToolchain: async () => ({}),
  toolchainSystemPathStatus: async () => ({ supported: false, present: false, message: '浏览器预览不支持系统 PATH' }),
  toolchainSystemPathAdd: async () => ({ ok: false, error: '浏览器预览不支持系统 PATH' }),
  toolchainSystemPathRemove: async () => ({ ok: false, error: '浏览器预览不支持系统 PATH' }),
  getRecent: async () => [],
  addRecent: async () => {},
  removeRecent: async () => {},
  checkDir: async (dir) => ({ exists: false }),
  generateMakefile: async () => ({}),
  checkProbe: async () => null,
  readChipInfo: async () => null,
  hardwareDebugCommand: async () => ({}),
  analyzeFirmware: async () => ({}),
  readRamLog: async () => ({}),
  stc51ToolStatus: async () => ({ installed: false }),
  installStcgal: async () => ({ success: false }),
  flashStc51: async (opts) => ({ success: false }),
  esp32ToolStatus: async () => ({ installed: false }),
  installEsptool: async () => ({ success: false }),
  flashEsp32: async (opts) => ({ success: false }),
  onLog: (cb) => () => {},
  onDownloadProgress: (cb) => () => {},
  serialList: async () => [],
  serialOpen: async () => {},
  serialWrite: async () => {},
  serialClose: async () => {},
  onSerialData: (cb) => () => {},
  onSerialClosed: (cb) => () => {},
  onSerialError: (cb) => () => {},
  mqttConnect: async () => ({}),
  mqttDisconnect: async () => ({}),
  mqttSubscribe: async () => ({}),
  mqttUnsubscribe: async () => ({}),
  mqttPublish: async () => ({}),
  onMqttStatus: (cb) => () => {},
  onMqttMessage: (cb) => () => {},
  httpApiStatus: async () => ({ running: false, bind: null, queueLength: 0, activeTaskId: null }),
  httpApiStart: async () => ({ ok: false, error: '浏览器预览不支持本地 HTTP API' }),
  httpApiStop: async () => ({ ok: true }),
  updateCheck: async () => ({ ok: false, error: '浏览器预览不支持自动更新' }),
  updateStatus: async () => ({ status: 'idle', currentVersion: 'dev', isPackaged: false }),
  updateInstall: async () => ({ ok: false, error: '浏览器预览不支持自动更新' }),
  onUpdateStatus: (cb) => () => {},
  build: async () => ({ success: false, log: '请在 Electron 环境中使用' }),
  flash: async () => ({ success: false, log: '请在 Electron 环境中使用' }),
  buildAndFlash: async () => ({ success: false, log: '请在 Electron 环境中使用' }),
  exportQuickCmds: async () => ({}),
  importQuickCmds: async () => ({}),
  copyToClipboard: async (text) => navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(String(text || '')) : false,
};
console.log('[dev] window.api polyfill injected (browser mode)');
}
<\/script>`;
      return html.replace('</head>', script + '</head>');
    },
  };
}

export default defineConfig(({ command }) => ({
  root: 'renderer',
  base: command === 'build' ? './' : '/',
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
    apiInjectPlugin(),
  ],
  server: { port: 5173, strictPort: true, open: false },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 恢复默认告警：此前被抬到 2000 等于关闭了「chunk 过大」提示
    chunkSizeWarningLimit: 600,
    sourcemap: false,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./renderer/index.html', import.meta.url)),
      },
      output: {
        // 手动分包：只把「体积大、变更少、被广泛共享」的库拆出来。
        // 注意：不要把整个 element-plus 强制塞进一个 chunk——它按需引入后
        // 由 Rollup 自动 tree-shake + 分片，强行归并反而失去按需拆分的收益。
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/vue/') || id.includes('@vue/') || id.includes('vue-demi')) return 'vue-vendor';
          return undefined;
        },
      },
    },
  },
}));
