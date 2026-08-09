# MCU工具箱

> Electron + Vue 3 + Vite 桌面应用，面向嵌入式开发者的一体化工具集。
> 跨平台（Windows / macOS / Linux），Monorepo 结构，含 VS Code 扩展。

---

## 功能模块

| 模块 | 说明 |
|------|------|
| STM32 编译烧录 | Makefile / Keil 编译，pyOCD / OpenOCD / Keil 烧录，工具链自动下载 |
| STC51 烧录 | STC 系列单片机串口烧录 |
| ESP32 烧录 | esptool 烧录支持 |
| 硬件调试 | 在线调试辅助 |
| 内存日志 | RAM Log 采集与文本展示 |
| 固件分析 | ELF / HEX / BIN 固件解析 |
| 串口终端 | 串口收发、字节统计 |
| MQTT 客户端 | 消息订阅与发布 |
| 字模生成 | 中文字模点阵实时预览 |
| CRC 计算 | 多算法 CRC 校验 |
| 设置 | 工具链路径、GitHub 镜像、各模块参数 |

---

## 仓库结构

```
.
├── src/main/               # 主进程（CommonJS，require）
│   ├── index.js            # 生命周期入口，装配 IPC 与上下文注入
│   ├── core/               # bus、config、updater、http-server、job-lock
│   ├── flash/              # STM32 re-export + STC51 / ESP32 独立实现
│   ├── toolchain/          # 工具链下载、安装、路径解析
│   ├── devices/            # serial、mqtt
│   ├── firmware/           # 固件分析
│   ├── ramlog/             # RAM 日志
│   └── ipc/                # IPC 注册（core / debug / flash / project / toolchain）
│
├── renderer/src/           # 渲染层（ESM，import）
│   ├── App.vue             # 根布局，工具切换
│   ├── views/              # 各工具页面（FlashView / SerialView / ...）
│   └── components/         # 公共组件（LogPanel / SerialTerminal / ...）
│
├── packages/
│   └── flash-core/         # @mcu-toolbox/flash-core — STM32 编译烧录共享核心
│       ├── core/           # bus、配置注入
│       ├── flash/          # build / flasher / probe / project / runner ...
│       └── toolchain/      # platform-toolchains、downloader ...
│
├── plugins/
│   └── vscode-stm32-flash/ # MCU-Assistant VS Code 扩展（复用 flash-core）
│
├── tests/                  # node:test 单元测试（23 个测试文件）
├── scripts/                # 开发辅助脚本（dev、stop、sync-ext-vendor、package-ext）
└── assets/                 # 应用图标
```

---

## 快速开始

### 环境要求

- Node.js ≥ 18
- npm

### 安装依赖

```bash
npm install
```

### 开发启动

```bash
npm start          # Vite HMR + Electron（热重载）
npm run start:prod # 先 build 再启动（模拟生产）
```

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm start` | 开发启动（HMR） |
| `npm run start:prod` | 正式启动 |
| `npm test` | node:test 单元测试 |
| `npm run lint` | ESLint 检查 |
| `npm run check` | 测试 + Lint + 渲染构建（全量检查） |
| `npm run dist:win` | 打包 Windows（NSIS + 便携版） |
| `npm run dist:mac-arm` | 打包 macOS Apple Silicon |
| `npm run dist:mac-all` | 打包 macOS Universal |
| `npm run dist:linux` | 打包 Linux AppImage |
| `npm run ext:sync` | 同步 flash-core 到 VS Code 扩展 vendor |
| `npm run ext:package` | 打包 VS Code 扩展 .vsix |

---

## 架构要点

- **主进程 CommonJS，渲染层 ESM**，不要混用。
- **共享核心**：STM32 编译/烧录/工具链实现在 `packages/flash-core`，`src/main/flash/`（除 stc51/esp32）和 `src/main/toolchain/` 均为 re-export 壳；启动时注入 `setPathsContext` / `setConfigLoader`。改 STM32 逻辑改 `packages/flash-core`，不要只改壳。
- **IPC 三步走**：preload 暴露 → `src/main/ipc/register-*-ipc.js` 注册 → composable 调用。
- **安全模式**：`contextIsolation: true` + `nodeIntegration: false`，渲染层只能通过 `window.api` 访问主进程能力。
- **Element Plus 按需引入**：unplugin-auto-import + unplugin-vue-components，直接用组件标签，不要手动 import。
- **日志 bus**：实现在 flash-core `core/bus.js`，子模块用 `bus.send()`，渲染端按 `key` 原地更新进度行。
- **配置**：`src/main/core/config.js`，存 `userData/config.json`，路径按平台隔离。

---

## VS Code 扩展（MCU-Assistant）

位于 `plugins/vscode-stm32-flash/`，版本 `0.1.45`。

**功能：** STM32 编译、烧录、一键编译烧录、Makefile 生成、烧录器检测、芯片信息读取。

**工具链共用：** 默认与桌面端共用 userData/toolchain 目录（按系统路径），settings 未填项回退桌面 config。

**打包流程：**

```bash
npm run ext:sync     # 同步 flash-core 最新代码到扩展 vendor
npm run ext:package  # 生成 .vsix
```

---

## 打包发布

打包产物输出到 `dist/`，Windows 同时生成 NSIS 安装包和便携版。

```bash
npm run dist:win        # Windows x64
npm run dist:mac-arm    # macOS Apple Silicon
npm run dist:mac-all    # macOS Universal（x64 + arm64）
npm run dist:linux      # Linux AppImage
```

发布配置：GitHub Releases，仓库 `aceleisureman/burningTool`，支持 `electron-updater` 自动更新。

### 自动更新加速

国内网络可在「设置 → 路径与系统集成 → 应用更新镜像」中配置 HTTPS 更新源。留空时使用 GitHub 官方源；镜像的清单检查或安装包下载失败时，会自动回退官方源。

镜像应完整同步同一版本的 Release 产物，建议直接同步全部附件：

| 平台 | 必需文件 |
|---|---|
| Windows | `latest.yml`、NSIS 安装包；建议同步对应 `.blockmap` |
| Linux x64 | `latest-linux.yml`、AppImage；建议同步对应更新文件 |
| macOS | `latest-mac.yml`、清单指向的 `.zip` |

可使用自建 OSS/CDN/R2 等静态目录，也可填写兼容 Generic Update Feed 的 GitHub 代理完整目录，例如：

```text
https://proxy.example/https://github.com/aceleisureman/burningTool/releases/latest/download/
```

代理必须支持 `latest*.yml`、Release 文件重定向和 Range 请求。项目不内置未经确认的公共代理；更新地址仅允许 HTTPS 且不能包含用户名或密码。更新镜像拥有分发可执行程序的能力，应仅使用可信、自管的服务。macOS 自管更新继续校验清单中的 SHA-512。

---

## 稳定性边界

为避免异常工具输出、超大调试消息或导入文件长期占用内存，桌面端设置了以下上限：

| 场景 | 上限与行为 |
|---|---|
| 子进程捕获输出 | 默认仅保留最后 8 MiB；单行超过 64 Ki 字符时分段处理，并返回截断标记 |
| MQTT | 最多 32 个同时在线连接、每连接启用 256 个订阅；单条收发载荷 256 KiB，主进程待推送队列最多 4 MiB |
| MQTT 历史 | 单连接内存历史约 4 Mi 字符；写入 `config.json` 的消息文本最多 128 Ki 字符/连接 |
| 串口终端 | 单次写入最多 1 MiB；接收数据按最多 64 KiB 的 IPC 数据块推送 |
| 快捷指令文件 | 导入/导出最多 2 MiB、128 个分组、4096 条指令 |

超过上限的接收/显示内容会明确标记为已截断；主动发布或写入超过上限时会直接返回错误，不会静默发送部分数据。

---

## 测试

使用 Node.js 内置 `node:test`，测试文件位于 `tests/`。

```bash
npm test
```

覆盖模块包括：build-system、bus、config、crc、downloader、esp32、firmware-analyzer、flash-command-size、flash-layout、flash-parsing、hardware-debug、http-server、makefile-startup-repair、openocd-paths、platform-toolchains、preload-api、proc、pyocd-diagnostics、ramlog、settings-layout、stm32-targets、toolchain-version、update-source、util。

新增主进程模块时建议同步补充对应测试文件。

---

## 不入版本库的目录

`toolchain/`、`tools/`、`node_modules/`、`dist/`、`renderer/dist/`、`*.vsix`、`plugins/**/vendor/` — 均已由 `.gitignore` 排除。

---

## 版权

Copyright © 2026 锐新网络科技有限公司
