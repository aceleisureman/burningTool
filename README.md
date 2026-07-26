# MCU工具箱 (STM32 工具箱)

> 可视化编译烧录 · 串口/MQTT 调试 · 字模生成 · 固件分析
> 跨平台桌面应用（Windows / macOS / Linux），面向嵌入式开发的一体化工具箱。

---

## 概览

MCU工具箱是一个基于 **Electron + Vue 3 + Vite** 的桌面应用，把嵌入式开发常用的零散命令行工具整合成统一可视化界面。开箱即用，自动按平台下载工具链，无需手动配置环境。

### 内置 10 大工具

| 工具 | 功能 | 后端 |
|------|------|------|
| 🔧 **烧录工具** | STM32 编译烧录（Makefile/Keil/CubeMX 工程识别） | pyOCD / OpenOCD / Keil UV4 |
| 🟢 **StcGal** | STC 8051 系列单片机烧录 | stcgal（Python） |
| 📡 **ESP32 烧录** | ESP32 系列芯片烧录 | esptool（Python） |
| 🔌 **硬件调试** | 调试探针命令交互 | pyOCD cmd |
| 📝 **内存日志** | 读取设备 RAM 日志 | 串口/探针 |
| 🔍 **固件分析** | ELF/HEX 固件解析（段、符号、大小） | arm-none-eabi 工具链 |
| ↔️ **串口调试** | 收发 / HEX / 快捷指令 / 循环发送 | serialport |
| 💬 **MQTT 调试** | 多连接 · 订阅/发布 · JSON 高亮 | mqtt.js |
| 🅰 **字模生成** | 点阵字模（PCtoLCD2002 风格） | Canvas 光栅化 |
| 🧮 **校验工具** | Checksum / CRC8 / CRC16 / CRC32 | 前端算法 |

---

## 技术栈

- **主进程**：Electron 35 + Node.js（CommonJS）
- **渲染进程**：Vue 3 + Element Plus 2.9 + Vite 5
- **原生依赖**：serialport 13（串口）、mqtt 5（MQTT）
- **打包**：electron-builder 25（跨平台 NSIS/DMG/AppImage）
- **按需引入**：unplugin-auto-import + unplugin-vue-components（Element Plus 组件/样式按需打包）

---

## 快速开始

### 环境要求

- Node.js ≥ 18
- Python 3（用于本地 pyOCD / stcgal / esptool 虚拟环境）
- Windows 用户：自动下载 busybox + ARM GCC；macOS/Linux 使用系统自带命令

### 安装

```bash
npm install
```

### 开发模式（HMR 热重载）

```bash
npm start
```

> 拉起 Vite dev server（5173 端口）后启动 Electron，渲染层经 http 加载，HMR 可用。

### 正式启动（无 HMR）

```bash
npm run start:prod
```

---

## 打包命令

| 命令 | 说明 |
|------|------|
| `npm run dist:win` | Windows x64（NSIS 安装包 + 便携版） |
| `npm run dist:mac` | macOS Intel (x64) .dmg |
| `npm run dist:mac-arm` | macOS Apple Silicon (arm64) .dmg |
| `npm run dist:mac-all` | macOS universal（Intel + Apple Silicon 通用） |
| `npm run dist:linux` | Linux（AppImage/deb/rpm） |
| `npm run dist:all` | Windows + macOS + Linux 全平台 |
| `npm run pack` | 仅打包不制作安装包（调试用） |

所有 `dist:*` 命令会先执行 `vite build` 构建渲染层，再调用 electron-builder。产物输出到 `dist/`。

---

## 测试与代码检查

```bash
npm test          # 运行 node:test 单元测试（tests/ 目录）
npm run lint      # ESLint 代码检查
npm run check     # 测试 + lint + 渲染层生产构建
```

测试覆盖：工具链版本、flash 解析、固件分析、OpenOCD 路径、ESP32、构建系统、Makefile 启动修复、STM32 目标、平台工具链、配置、工具函数、pyOCD 诊断、硬件调试、内存日志、bus 事件等。

---

## 项目结构

```text
burningTool/
├── packages/
│   └── flash-core/                 # 共享编译烧录核心（无 Electron，桌面端与 VS Code 扩展共用）
├── plugins/
│   └── vscode-stm32-flash/         # VS Code 扩展：STM32 编译烧录
├── src/main/                       # Electron 主进程（CommonJS）
│   ├── index.js                    # 生命周期、路径注入、日志 sink、IPC 装配
│   ├── ipc/                        # 按领域注册 IPC
│   ├── core/                       # 配置、窗口相关桌面核心
│   ├── toolchain/                  # 兼容 re-export → packages/flash-core
│   ├── flash/                      # STM32 兼容 re-export；stc51/esp32 仍在此
│   ├── devices/                    # 串口、MQTT
│   ├── firmware/                   # 固件分析
│   └── ramlog/                     # 内存日志
├── src/preload/index.js            # contextBridge 安全 API
├── renderer/src/
│   ├── App.vue                     # 根布局、页面状态装配
│   ├── views/                      # 每个工具一个页面组件
│   ├── composables/                # 每个领域一个状态/业务组合函数
│   ├── components/                 # 跨工具通用组件
│   └── styles/                     # base、layout 与 tools/* 页面样式
├── tests/                          # node:test
├── docs/
│   ├── README.md                   # 文档索引
│   └── architecture.md             # 架构与目录职责
├── assets/icons/                   # 应用图标
├── scripts/                        # 开发/停止/扩展同步打包脚本
├── package.json
├── vite.config.mjs
└── eslint.config.mjs
```

> 详细职责说明见 [docs/architecture.md](docs/architecture.md)。  
> `toolchain/`、`tools/`、`node_modules/`、`dist/`、`renderer/dist/`、`*.vsix`、`plugins/**/vendor/` 均为本地依赖或生成物，不入版本库。默认工具链在运行时按平台下载；打包配置明确排除 `resources/`，仓库不再维护重复工具链副本。

### VS Code 扩展

```bash
npm run ext:sync      # packages/flash-core → plugins/.../vendor
npm run ext:package   # 同步 + 自动递增版本号 + 生成 .vsix
# npm run ext:package -- --minor|--major|--no-bump
```

---

## 架构说明

### 双进程模型

```
┌─────────────────────────────┐        IPC (ipcMain.handle)
│  渲染进程 (Vue 3 + Element)  │  ←─────────────────────→  ┌──────────────────────────┐
│  window.api.*               │   contextBridge 安全暴露    │  主进程 (Electron/Node)    │
│  composables/*.js           │                            │  src/main/*               │
│  经 Vite 构建 → renderer/dist│                            │  调用 pyOCD/OpenOCD/串口   │
└─────────────────────────────┘                            └──────────────────────────┘
```

- **渲染层**通过 [src/preload/index.js](src/preload/index.js) 暴露的 `window.api` 调用主进程，`contextIsolation: true` + `nodeIntegration: false` 保证安全。
- 每个工具对应一个 `composable`（如 [useFlash.js](renderer/src/composables/useFlash.js)），状态与逻辑封装在组合式函数中，[App.vue](renderer/src/App.vue) 只做工具切换编排。
- **日志/进度**经 [core/bus.js](src/main/core/bus.js) 事件总线，子模块复用同一套 sink 推送到渲染端，渲染端按 `key` 原地更新进度行，不刷屏。

### IPC 通道

主进程入口只负责装配，[src/main/ipc/](src/main/ipc/) 按 core/toolchain/project/flash/debug 五个领域注册 `ipcMain.handle`。串口/MQTT 继续由各自设备模块注册。主要通道：

| 通道 | 用途 |
|------|------|
| `select-directory` / `check-dir` | 选择/检测工程目录 |
| `build` / `flash` / `build-and-flash` | 编译烧录 |
| `generate-makefile` | CubeMX → Makefile 重生成 |
| `install-default-toolchain` | 自动下载工具链 |
| `check-probe` / `read-chip-info` | 探针/芯片探测 |
| `analyze-firmware` / `read-ram-log` | 固件分析/内存日志 |
| `flash-stc51` / `flash-esp32` | 51/ESP32 烧录 |
| `serial-*` / `mqtt-*` | 串口/MQTT 全套 |

### 跨平台工具链

[src/main/toolchain/platform-toolchains.js](src/main/toolchain/platform-toolchains.js) 定义三平台下载计划：

- **Windows**：busybox（rm/mkdir 等命令）+ ARM GCC + make + OpenOCD + pyOCD venv 全部下载
- **macOS**：使用系统自带命令，下载 ARM GCC + OpenOCD，pyOCD 用 venv
- **Linux**：使用系统自带命令，下载 ARM GCC + OpenOCD，pyOCD 用 venv

配置按平台隔离路径（`platformPaths[platformId]`），切换系统自动重匹配，避免 Windows 路径残留导致跨平台失效。

### 配置存储

配置写入 `app.getPath('userData')/config.json`（[core/config.js](src/main/core/config.js)），含：工具链路径、目标芯片、烧录方式、串口/MQTT 连接、快捷指令分组、窗口位置等。`reset-config` 恢复默认但保留历史项目。

---

## 开发约定

- 主进程使用 **CommonJS**（`require`），渲染层使用 **ESM**（`import`）。
- 新增 IPC 通道：① 在 [src/preload/index.js](src/preload/index.js) 暴露 → ② 在 [src/main/ipc/](src/main/ipc/) 对应领域 registrar 注册 → ③ 渲染端对应 composable 调用。
- Element Plus 组件/样式**按需自动引入**，无需手动 import；新增组件直接用标签即可（`unplugin-vue-components` 自动解析）。
- 调试探针枚举、芯片识别等耗时操作有缓存（如 `_pyocdTargetOk`），避免重复探测。
- 字模生成编辑框默认为空，输入后实时生成点阵预览与代码。

---

## 部署提示

- 原生模块 `serialport` 打包时 electron-builder 会 `npmRebuild` 自动重编译对应平台二进制。
- `asarUnpack: ["**/*.node"]` 确保原生 `.node` 文件解包到磁盘可执行。
- macOS 需 `icon.icns`、Windows 需 `icon.ico`，图标源在 [assets/icons/](assets/icons/)。
- 首次打包某平台会下载该平台预编译二进制，耗时较长。

---

## 版本

- **版本号**：1.0.0
- **appId**：`com.ruixin.mcutoolbox`
- **版权**：Copyright © 2026 锐新网络科技有限公司

## License

私有项目，版权归锐新网络科技有限公司所有。
