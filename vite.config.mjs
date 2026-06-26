import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { fileURLToPath, URL } from 'node:url';

// 渲染层（Electron）Vite 构建：
// - root = renderer/，产物入 renderer/dist/
// - build 用 base './'（Electron file:// 下相对路径）；dev server 用 '/'（HMR 正常）
// - HTML 入口：主窗口 index.html
// - Element Plus 按需引入：仅打包用到的组件及其样式（含 ElMessage/ElMessageBox），大幅瘦身
export default defineConfig(({ command }) => ({
  root: 'renderer',
  base: command === 'build' ? './' : '/',
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
  ],
  server: { port: 5173, strictPort: true },
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
