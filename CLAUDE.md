# CLAUDE.md

本文件为 Claude Code 在本仓库工作时提供指引。

## 项目性质

MCU工具箱：Electron + Vue 3 + Vite 桌面应用，整合嵌入式开发工具（STM32/STC51/ESP32 烧录、硬件调试、内存日志、固件分析、串口、MQTT、字模生成、CRC）。跨平台（Windows/macOS/Linux）。

另含 monorepo 扩展：

- `packages/flash-core`：STM32 编译烧录共享核心（无 Electron）
- `plugins/vscode-stm32-flash`：VS Code 插件，复用 flash-core，与桌面端共用本机 toolchain 目录

## 常用命令

```bash
npm start            # 开发启动（Vite HMR + Electron）
npm run start:prod   # 正式启动（先 build 再起 Electron）
npm test             # node:test 单元测试
npm run lint         # ESLint
npm run check        # 测试 + lint + 渲染构建
npm run dist:mac-arm # 打包当前 Mac（Apple Silicon）
npm run dist:win     # 打包 Windows
npm run ext:sync     # 同步 flash-core 到扩展 vendor
npm run ext:package  # 打包 VS Code 扩展 .vsix
```

## 架构要点

- **主进程 CommonJS**（`src/main/`，用 `require`），**渲染层 ESM**（`renderer/src/`，用 `import`）。不要混用。
- **共享核心**：STM32 编译/烧录/工具链实现在 `packages/flash-core`。桌面端 `src/main/flash/*`（除 stc51/esp32）与 `src/main/toolchain/*` 为 re-export；启动时在 `src/main/index.js` 注入 `setPathsContext` / `setConfigLoader`。
- IPC 通道三步走：preload 暴露 → `src/main/ipc/register-*-ipc.js` 按领域注册 → composable 调用。`src/main/index.js` 只负责生命周期与装配。
- 渲染层每个工具由 `views/*.vue` 承载界面、`composables/use*.js` 承载状态与业务；[App.vue](renderer/src/App.vue) 只做根布局、依赖装配和工具切换。
- 日志经 bus sink 注入（实现位于 flash-core `core/bus.js`，桌面 re-export），子模块复用 `bus.send()`，渲染端按 `key` 原地更新进度行。
- 配置在 [src/main/core/config.js](src/main/core/config.js)，存 `app.getPath('userData')/config.json`，平台路径隔离（`platformPaths[platformId]`）。
- VS Code 扩展默认共用桌面端 userData/toolchain（按系统路径），settings 未填项回退桌面 config。

## 重要约定

- Element Plus **按需自动引入**（unplugin-auto-import + unplugin-vue-components），直接用组件标签即可，不要手动 import 组件。
- 字模生成编辑框默认为空（`gl.text: ''`），输入后实时生成预览。
- 三平台工具链下载计划在 flash-core `platform-toolchains.js`，Windows 全下载、mac/Linux 用系统命令 + 部分下载。
- `contextIsolation: true` + `nodeIntegration: false`，渲染层只能通过 `window.api` 访问主进程能力，不要关闭这两个安全选项。
- 改 STM32 编译烧录逻辑时改 `packages/flash-core`，不要只改 re-export 壳；打包扩展前执行 `npm run ext:sync`。

## 不要入版本库的目录

`toolchain/`、`tools/`、`node_modules/`、`dist/`、`renderer/dist/`、`*.vsix`、`plugins/**/vendor/` —— 本地依赖、构建/打包生成物，`.gitignore` 已排除。打包配置排除 `resources/`，不要恢复重复工具链副本。

## 测试

`tests/` 下用 `node --test`。新增主进程模块建议补对应测试（参照现有测试文件命名）。
