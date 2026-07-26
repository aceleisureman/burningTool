# 项目架构

## 分层

```mermaid
flowchart LR
  V["Vue views"] --> C["Composables"]
  C --> P["Preload window.api"]
  P --> I["IPC registrars"]
  I --> D["Domain modules"]
  D --> X["Toolchains / devices"]
```

- **渲染层**：`renderer/src/views/` 负责页面，`composables/` 负责状态和业务调用，`styles/` 按基础、布局、工具页面拆分。
- **安全桥**：`src/preload/index.js` 是渲染层访问 Node/Electron 能力的唯一入口。
- **主进程装配**：`src/main/index.js` 仅负责生命周期、日志 sink 和 IPC registrar 装配。
- **IPC 层**：`src/main/ipc/` 按 core、toolchain、project、flash、debug 分类，通道名和返回结构应保持向后兼容。
- **领域层**：toolchain、flash、devices、firmware、ramlog 各自封装实现。

## 核心模块

### 工具链

- `toolchain/toolchain.js`：兼容门面。
- `paths.js`：跨平台根目录和可执行文件解析。
- `status.js`：版本探测、默认工具链状态、构建环境。
- `installer.js`：BusyBox、pyOCD、stcgal、esptool、GCC/OpenOCD 安装。
- `system-path.js`：Windows 用户 PATH 管理。

### 编译烧录

- `flash/flasher.js`：兼容门面。
- `probe.js`：探针枚举、芯片识别、硬件调试。
- `project.js`：Keil/CubeMX/Makefile 工程识别和固件定位。
- `build.js`：Make/Keil 编译。
- `runner.js`：pyOCD/OpenOCD/Keil 烧录。

## 变更约束

1. 新增 IPC 必须同步更新 preload、对应 registrar 和渲染端调用。
2. `toolchain.js`、`flasher.js` 作为公共兼容入口，不应绕过它们形成跨目录耦合。
3. 页面状态优先放 composable，页面模板放 view，根组件不承载具体工具 UI。
4. 提交前执行 `npm run check`。
