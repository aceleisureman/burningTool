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
  getPlatform: async () => ({ platform: navigator.platform, arch: 'x64' }),
  getPlatformToolchain: async () => ({}),
  resetConfig: async () => ({}),
  toolchainStatus: async () => ({ installed: false }),
  installToolchain: async () => ({ success: false }),
  defaultToolchainStatus: async () => ({}),
  installDefaultToolchain: async () => ({}),
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
  onLog: (cb) => {},
  onDownloadProgress: (cb) => {},
  serialList: async () => [],
  serialOpen: async () => {},
  serialWrite: async () => {},
  serialClose: async () => {},
  onSerialData: (cb) => {},
  onSerialClosed: (cb) => {},
  onSerialError: (cb) => {},
  mqttConnect: async () => ({}),
  mqttDisconnect: async () => ({}),
  mqttSubscribe: async () => ({}),
  mqttUnsubscribe: async () => ({}),
  mqttPublish: async () => ({}),
  onMqttStatus: (cb) => {},
  onMqttMessage: (cb) => {},
  build: async () => ({ success: false, log: '请在 Electron 环境中使用' }),
  flash: async () => ({ success: false, log: '请在 Electron 环境中使用' }),
  buildAndFlash: async () => ({ success: false, log: '请在 Electron 环境中使用' }),
  exportQuickCmds: async () => ({}),
  importQuickCmds: async () => ({}),
};
console.log('[dev] window.api polyfill injected (browser mode)');
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
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./renderer/index.html', import.meta.url)),
      },
    },
  },
}));
