# 架构与目录职责

## 1. 项目形态

MCU 工具箱是 **Electron + Vue 3 + Vite** 桌面应用，并拆出共享核心与 VS Code 扩展：

| 路径 | 职责 |
|------|------|
| `src/main/` | Electron 主进程：生命周期、IPC 装配、设备与桌面专属逻辑 |
| `src/preload/` | `contextBridge` 安全 API |
| `renderer/src/` | Vue 渲染层：页面、组合式状态、样式 |
| `packages/flash-core/` | STM32 编译/烧录/工具链共享核心（无 Electron） |
| `plugins/vscode-stm32-flash/` | VS Code 扩展，复用 flash-core |
| `scripts/` | 开发启动、停止、扩展同步/打包 |
| `tests/` | `node:test` 单元与布局契约测试 |
| `docs/` | 结构/架构文档 |
| `assets/` | 应用图标与源图 |

本地依赖（已 gitignore）：`toolchain/`、`tools/`、`node_modules/`、`dist/`、`renderer/dist/`、`plugins/**/vendor/`、`*.vsix`。

## 2. 进程与数据流

```text
renderer (Vue)
  window.api.*
        │ preload contextBridge
        ▼
src/main (Electron)
  ipc/* 注册
  devices / flash / firmware / ramlog
        │
        ├─ packages/flash-core  (STM32 build/flash/toolchain)
        └─ 本机工具链 / 串口 / esptool / stcgal
```

- 渲染层每个工具：`views/*View.vue` + `composables/use*.js` + `styles/tools/*`
- 主进程入口 `src/main/index.js` 只做装配；IPC 按领域拆分注册
- STM32 编译烧录逻辑以 `packages/flash-core` 为准；`src/main/flash/*`（除 stc51/esp32）与 `src/main/toolchain/*` 多为 re-export

## 3. 推荐改动边界

| 需求 | 改哪里 |
|------|--------|
| STM32 编译/烧录/工具链探测 | `packages/flash-core`，再 `npm run ext:sync` |
| ESP32 / ESP8266 / STC 烧录 | `src/main/flash/esp32.js`、`stc51.js` + 对应 composable/view |
| 串口 / MQTT | `src/main/devices/*` + `useSerial` / `useMqtt` |
| 页面布局样式 | `renderer/src/views/*`、`styles/**` |
| CI / 打包 | `.github/workflows/`、`package.json` |

## 4. 当前工具面（渲染层）

固件烧录、StcGal、ESP32（含多 bin 方案）、硬件调试、内存日志、固件分析、串口调试、消息调试、字模生成、校验工具、设置。

## 5. 结构维护规则

1. 顶层目录保持职责单一，避免再堆无说明的杂项目录。
2. 生成物只进 gitignore 路径，不把工具链二进制提交入库。
3. 文档入口：用户看 `README.md`，开发约定看 `CLAUDE.md`，结构细节看本文。
