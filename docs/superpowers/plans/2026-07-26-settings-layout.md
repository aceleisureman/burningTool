# Settings Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将工具链设置页重组为环境概览、编译与烧录、默认工具链、路径与系统集成四个清晰区域。

**Architecture:** 仅修改 `SettingsView.vue` 的模板结构和设置页 CSS，不改变 `useSettings.js` 或 IPC。通过静态结构测试锁定分组标题和工具状态网格，完整测试与 Vite 构建验证兼容性。

**Tech Stack:** Vue 3、Element Plus、CSS Grid、Node.js test runner、Vite。

---

### Task 1: 锁定设置页分组结构

**Files:**
- Create: `tests/settings-layout.test.js`

- [ ] 写入读取 `SettingsView.vue` 的测试，断言存在环境概览、编译与烧录、默认工具链、路径与系统集成，以及工具状态网格类名。
- [ ] 运行 `node --test tests/settings-layout.test.js`，确认旧模板因缺少新分组而失败。

### Task 2: 重排设置页模板

**Files:**
- Modify: `renderer/src/views/SettingsView.vue`

- [ ] 添加环境概览条和整体就绪数量。
- [ ] 将现有字段移动到三个任务卡片中，原有绑定、条件和事件保持不变。
- [ ] 将默认工具链列表改用紧凑网格容器。

### Task 3: 添加响应式设置页样式

**Files:**
- Modify: `renderer/src/styles/layout.css`
- Modify: `renderer/src/styles/tools/mqtt.css`

- [ ] 添加概览条、章节说明、路径操作行、按钮区样式。
- [ ] 将工具状态列表改为双列 Grid，并在窄窗口下降为单列。
- [ ] 运行设置页结构测试，确认通过。

### Task 4: 完整验收

**Files:**
- Modify: `.gitignore`

- [ ] 忽略可视化讨论临时目录 `.superpowers/`。
- [ ] 运行 `npm run check`，期望测试、Lint 和 Vite 构建成功。
- [ ] 删除 `renderer/dist`，运行 `git diff --check`。
