# MCU-Assistant · VS Code 扩展

基于 MCU 工具箱「固件烧录」能力的 VS Code 插件：在编辑器内完成 **STM32 工程识别 / 编译 / 烧录**。

## 功能

- 工程识别：Makefile、Keil `.uvprojx`、CubeMX `.ioc`
- 编译：`make`（ARM GCC）或 Keil UV4（仅 Windows）
- 烧录：pyOCD（默认）/ OpenOCD / Keil UV4
- 辅助：检测烧录器、读取芯片信息、CubeMX 生成 Makefile
- 交互：命令面板、侧边栏面板、Output 日志、状态栏、`settings.json`

## 安装（开发态）

本扩展位于 monorepo：

```text
burningTool/
  packages/flash-core/          # 共享编译烧录核心
  plugins/vscode-stm32-flash/   # 本扩展
```

1. 在仓库根目录安装依赖：

```bash
npm install
npm run ext:sync    # 同步 packages/flash-core → vendor/（开发与打包都需要）
```

2. 用 VS Code / Cursor 打开仓库根目录。
3. 运行调试配置 **「Run STM32 Flash Extension」**（或 F5），打开 Extension Development Host。  
   也可在仓库根 `.vscode/launch.json` 使用同名配置（该目录默认 gitignore）。
4. 在新窗口侧边栏打开 **STM32 烧录**，或命令面板搜索 `STM32:`。

### 打包 .vsix

```bash
# 仓库根 —— 默认每次自动 patch 递增版本（0.1.0 → 0.1.1 → …）
npm run ext:package

# 可选
npm run ext:package -- --minor    # 0.1.x → 0.2.0
npm run ext:package -- --major    # 0.x.x → 1.0.0
npm run ext:package -- --no-bump  # 不改版本

# 产物：plugins/vscode-stm32-flash/mcu-assistant-<version>.vsix（已 gitignore）
code --install-extension plugins/vscode-stm32-flash/mcu-assistant-*.vsix --force
```

> `vendor/flash-core` 是打包用拷贝，**不要手改**；源码只改 `packages/flash-core`，再 `npm run ext:sync`。  
> 版本号写在 `plugins/vscode-stm32-flash/package.json` 的 `version` 字段，打包脚本会自动改写。

## 工具链共用（与 MCU 工具箱）

扩展与桌面端 **MCU 工具箱** 共用同一套工具链目录与配置，并按系统解析：

| 系统 | 共用 userData / toolchain |
|------|---------------------------|
| Windows | `%APPDATA%\\stm32-flasher\\toolchain` |
| macOS | `~/Library/Application Support/stm32-flasher/toolchain` |
| Linux | `~/.config/stm32-flasher/toolchain` |

- 桌面端 `config.json` 中的路径（含 `platformPaths.windows|macos|linux`）会作为 **settings 未填写时的回退**
- `toolchainMode` 默认 `default`：优先用共用目录内已下载的 gcc / pyOCD / OpenOCD
- 开发态若桌面目录尚无工具链，会回退仓库根 `toolchain/`
- 也可手动设置 `stm32Flash.toolchainRootPath` 覆盖

## 本机依赖

| 工具 | 用途 | 平台说明 |
|------|------|----------|
| `make` + `arm-none-eabi-gcc` | Makefile 编译 | Windows 可用工具箱下载的 make；mac/Linux 常用系统 make |
| `pyocd` | 默认烧录 / 探针 / 芯片识别 | 共用 venv 或 PATH |
| `openocd` | OpenOCD 烧录 | 共用 xpack 或 brew/apt |
| Keil `UV4.exe` | Keil 编译烧录 | **仅 Windows** |
| STM32CubeMX | 从 `.ioc` 生成 Makefile | 三平台路径不同，走分平台配置 |

## 常用设置

在设置中搜索 `stm32Flash`，或编辑 `settings.json`：

```json
{
  "stm32Flash.projectDir": "/path/to/your/stm32-project",
  "stm32Flash.targetChip": "stm32f103c8",
  "stm32Flash.flashMethod": "pyocd",
  "stm32Flash.autoDetectChip": true,
  "stm32Flash.connectUnderReset": false,
  "stm32Flash.pyocdPath": "",
  "stm32Flash.openocdPath": "",
  "stm32Flash.cubeMxPath": ""
}
```

## 命令

| 命令 | 说明 |
|------|------|
| `STM32: 选择工程目录` | 选择工程 |
| `STM32: 编译` | make / Keil 编译 |
| `STM32: 烧录` | 烧录已有固件 |
| `STM32: 一键编译烧录` | 编译成功后自动烧录 |
| `STM32: 检测烧录器` | pyOCD list |
| `STM32: 读取芯片信息` | 读 DBGMCU 等 |
| `STM32: 生成 Makefile` | CubeMX 工程 |
| `STM32: 取消当前任务` | 结束子进程 |
| `STM32: 打开日志` | Output 通道 |

## 架构

```text
VS Code Extension Host
  → plugins/vscode-stm32-flash (命令 / Webview / settings)
  → packages/flash-core (compile / flash / probe / toolchain)
  → 本机 pyOCD / OpenOCD / make / Keil
```

与桌面端 MCU 工具箱共用 `packages/flash-core`，配置由 VS Code settings 注入，不依赖桌面应用 HTTP API。

## 范围说明（v1）

- 仅 **STM32 固件烧录**（不含 StcGal / ESP32）
- 工具链一键下载为可选后续能力；当前推荐本机已安装工具或指定 `toolchainRootPath`

## 手工验证清单

1. F5 启动扩展开发宿主，侧边栏出现「STM32 烧录」
2. 打开含 Makefile 的工程 → 标签显示 Makefile
3. 编译 → Output「STM32 烧录」有 make 日志
4. 接 CMSIS-DAP → 检测烧录器成功
5. 烧录 / 一键成功
6. 忙碌时「取消」可结束任务


## 作者

- 锐新网络科技有限公司
- leisureman <banxiabk@gmail.com>
