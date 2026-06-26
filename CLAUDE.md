# CLAUDE.md

本文件为 Claude Code 在本仓库工作时提供指引。

## 项目性质

MCU工具箱：Electron + Vue 3 + Vite 桌面应用，整合 9 个嵌入式开发工具（STM32/STC51/ESP32 烧录、硬件调试、内存日志、固件分析、串口、MQTT、字模生成）。跨平台（Windows/macOS/Linux）。

## 关键命令

```bash
npm start            # 开发启动（Vite HMR + Electron）
npm run start:prod   # 正式启动（先 build 再起 Electron）
npm test             # node:test 单元测试
npm run lint         # ESLint
npm run dist:mac-arm # 打包当前 Mac（Apple Silicon）
npm run dist:win     # 打包 Windows
```

## 架构要点

- **主进程 CommonJS**（`src/main/`，用 `require`），**渲染层 ESM**（`renderer/src/`，用 `import`）。不要混用。
- IPC 通道三步走：preload 暴露 → index.js 注册 `ipcMain.handle` → composable 调用。见 [src/preload/index.js](src/preload/index.js)。
- 渲染层每个工具一个 composable（`renderer/src/composables/use*.js`），[App.vue](renderer/src/App.vue) 只做 `tool` 切换编排，业务逻辑全在 composable。
- 日志经 [src/main/core/bus.js](src/main/core/bus.js) sink 注入，子模块复用 `bus.send()`，渲染端按 `key` 原地更新进度行。
- 配置在 [src/main/core/config.js](src/main/core/config.js)，存 `app.getPath('userData')/config.json`，平台路径隔离（`platformPaths[platformId]`）。

## 重要约定

- Element Plus **按需自动引入**（unplugin-auto-import + unplugin-vue-components），直接用组件标签即可，不要手动 import 组件。
- 字模生成编辑框默认为空（`gl.text: ''`），输入后实时生成预览。
- 三平台工具链下载计划在 [src/main/toolchain/platform-toolchains.js](src/main/toolchain/platform-toolchains.js)，Windows 全下载、mac/Linux 用系统命令 + 部分下载。
- `contextIsolation: true` + `nodeIntegration: false`，渲染层只能通过 `window.api` 访问主进程能力，不要关闭这两个安全选项。

## 不要入版本库的目录

`toolchain/`、`resources/toolchain/`、`tools/`、`node_modules/`、`dist/` —— 运行时生成的大体积二进制，`.gitignore` 已排除。

## 测试

`tests/` 下用 `node --test`。新增主进程模块建议补对应测试（参照现有 15 个测试文件命名）。
