# MCU工具箱 (STM32 工具箱)

> 可视化编译烧录 · 串口/MQTT 调试 · 字模生成 · 固件分析
> 跨平台桌面应用（Windows / macOS / Linux），面向嵌入式开发的一体化工具箱。

---

## 概览

MCU工具箱是一个基于 **Electron + Vue 3 + Vite** 的桌面应用，把嵌入式开发常用的零散命令行工具整合成统一可视化界面。开箱即用，自动按平台下载工具链，无需手动配置环境。

### 内置 9 大工具

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
npm test        # 运行 node:test 单元测试（tests/ 目录）
npm run lint    # ESLint 代码检查
```

测试覆盖：工具链版本、flash 解析、固件分析、OpenOCD 路径、ESP32、构建系统、Makefile 启动修复、STM32 目标、平台工具链、配置、工具函数、pyOCD 诊断、硬件调试、内存日志、bus 事件等。

---

## 项目结构

```
burningTool/
├── src/main/                    # Electron 主进程（CommonJS）
│   ├── index.js                 # 入口：单实例锁 + IPC 注册中心
│   ├── windows.js               # 窗口管理（主窗口/悬浮窗/托盘）
│   ├── core/
│   │   ├── config.js            # 配置读写（config.json，平台路径隔离）
│   │   └── bus.js                # 事件总线（日志/进度 sink 注入）
│   ├── toolchain/
│   │   ├── toolchain.js         # 工具链探测/安装/路径解析
│   │   ├── platform-toolchains.js # 三平台下载包配置（win/mac/linux）
│   │   ├── downloader.js         # 8 线程分段下载 + 镜像加速
│   │   └── proc.js               # 通用进程执行（流式输出/超时/捕获）
│   ├── flash/
│   │   ├── flasher.js           # 编译烧录核心（make/Keil/pyOCD/OpenOCD）
│   │   ├── flash-parsing.js     # DEVID 表/探针选择/输出清洗
│   │   ├── stm32-targets.js     # pyOCD 目标规范化 + OpenOCD 配置
│   │   ├── pyocd-diagnostics.js # 烧录失败诊断建议
│   │   ├── openocd-paths.js     # OpenOCD 路径转义
│   │   ├── makefile-startup-repair.js # CubeMX 工程启动文件修复
│   │   ├── stc51.js              # STC 8051 烧录
│   │   └── esp32.js              # ESP32 烧录
│   ├── devices/
│   │   ├── serial.js            # serialport 串口 IPC
│   │   └── mqtt.js               # mqtt.js 多连接 IPC
│   ├── firmware/analyzer.js     # 固件分析
│   └── ramlog/ramlog.js         # 内存日志读取
├── src/preload/index.js         # preload：contextBridge 暴露 window.api
├── renderer/                    # Vue 3 渲染层
│   ├── index.html               # HTML 入口
│   ├── src/
│   │   ├── App.vue              # 根组件（9 工具切换）
│   │   ├── main.js              # Vue 入口
│   │   ├── util.js              # 渲染端工具函数
│   │   └── composables/         # 组合式函数（每工具一个）
│   │       ├── useFlash.js      ├── useStc51.js
│   │       ├── useEsp32.js      ├── useHardwareDebug.js
│   │       ├── useRamLog.js     ├── useFirmwareAnalysis.js
│   │       ├── useSerial.js     ├── useMqtt.js
│   │       ├── useGlyph.js      ├── useSettings.js
│   │       ├── useLog.js        └── useTheme.js
│   └── fonts/                   # 阿里妈妈方圆体（自定义字体）
├── assets/icons/                # 应用图标（.ico/.icns/.png/.iconset）
├── tests/                       # node:test 单元测试
├── scripts/                     # dev.js（HMR 启动）/ stop-electron.js
├── resources/toolchain/         # 预置工具链（构建打包进 app）
├── vite.config.mjs              # Vite 配置（root=renderer/）
└── package.json
```

> **注意**：`toolchain/`、`resources/toolchain/`、`tools/`、`node_modules/`、`dist/` 是运行时生成的大体积二进制，已在 `.gitignore` 中排除，不入版本库。

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

主进程在 [src/main/index.js](src/main/index.js) 注册全部 `ipcMain.handle`，串口/MQTT 各自模块化注册（`registerSerial` / `registerMqtt`）。主要通道：

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
- 新增 IPC 通道：① 在 [src/preload/index.js](src/preload/index.js) 暴露 → ② 在 [src/main/index.js](src/main/index.js) 注册 `ipcMain.handle` → ③ 渲染端对应 composable 调用。
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
