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

字体子集化（`renderer/fonts/*.woff2` 体积优化，需要 `fonttools` + `brotli`）：

```bash
python scripts/subset-font.py   # 扫描界面用字 -> 裁剪字体，2.4MB -> ~360KB
```

无独显 / 远程桌面 / 虚拟机环境若遇 Electron GPU 进程崩溃
（`exit_code=-1073741819` / `GPU process isn't usable. Goodbye.`），用软件渲染启动：

```bash
MCU_DISABLE_GPU=1 npm start      # dev.js 会追加 --disable-gpu 等参数
```

## 启动性能监控

启动卡顿（窗口边框已出现但内容区白屏）用内置监控脚本定位，它经 CDP 采集
「进程启动 → 首屏可见」全链路分段耗时：

```bash
npm run perf:startup                 # 单次测量
npm run perf:startup:x3              # 连续 3 次取中位数，并写 startup-report.json
node scripts/startup-monitor.js --no-gpu   # 软件渲染环境
```

主进程侧探针默认关闭，需要时显式开启（`startup-monitor.js` 会自动加）：

```bash
MCU_STARTUP_PROFILE=1 npm start      # 渲染层首帧绘制后打印分段报告
MCU_STARTUP_SLOW_MS=60 npm start     # 慢同步操作阈值（默认 60ms）
```

已知启动期同步瓶颈及对策（改动时勿回退）：

| 位置 | 问题 | 对策 |
|------|------|------|
| `packages/flash-core/toolchain/status.js` `commandVersion` | 5 次串行 `spawnSync` 探测版本，单次 timeout 2500ms | 进程内缓存 + timeout 降到 800ms；安装后调 `invalidateVersionCache()` |
| `packages/flash-core/toolchain/system-path.js` `readWindowsUserPath` | `spawnSync('reg query')` 同步 ~90ms | TTL 30s 缓存；写入后 `invalidateUserPathCache()` |
| `renderer/src/App.vue` `onMounted` | `checkEnv`/`refreshDefaultTc`/`initUpdate` 抢首帧 | 移入 `idle()`（`requestIdleCallback` 降级双 rAF） |
| `renderer/src/composables/useSettings.js` `loadConfig` | 3 次 IPC 串行 | `Promise.allSettled` 并行 |

主进程侧调试端口（排查渲染层问题用，Node 22 自带全局 `WebSocket`，可手写 CDP 客户端）：

```bash
MCU_DEBUG_PORT=9222 npm start        # 起 dev 后 curl 127.0.0.1:9222/json/list 找 page target
```

## ⚠️ Vue 响应式陷阱（勿回退，已踩过两次）

**`reactive()` 会自动解包内层 ref —— 嵌套 ref 是 bug 温床。**

```js
// ❌ 错：reactive 会把 messagesView 解包成普通数组
const conn = reactive({ messagesView: ref([]) });
conn.messagesView.value;          // undefined → undefined.length 抛 TypeError
conn.messagesView = next;         // 可以（reactive 追踪该属性）
syncWindow(conn.messages, conn.messagesView, conn._win);  // 传出的是数组不是 ref！

// ✅ 对：写入端按形态分派
function syncWindow(messages, view, state, container, key) {
  const next = messages.slice(start, end);
  if (isRef(view)) view.value = next;            // 还是 ref
  else if (container && key) container[key] = next;  // 已被解包 → 在容器上整体替换
  ...
}
```

**为什么这个坑特别危险**：这类错误若发生在**某个组件的 render 期**，会冒泡到父级
（尤其 `<App>` 这种多根 fragment），使 `patchBlockChildren` 的 fragment 锚点失效，
Vue 抛 `Cannot read properties of null (reading 'parentNode')`，**此后整个应用的 DOM 更新全部中断**。
外部表现是「点任何按钮都没反应」，但 Vue 内部状态（如 `portChooser.visible`）其实是正确的 ——
极易误判成事件绑定或组件注册问题。

**排查要点**：
- 看 `.el-overlay` 的 `display` 与 `innerHTML.length`，**不要**只看组件内部状态布尔值
- 用 CDP 监听 `Runtime.exceptionThrown` 拿渲染层真实堆栈（含源码行号），比看主进程 stdout 有效
- `triggerRef(普通数组)` 是**静默 no-op**（内部 `isRef` 直接返回），不会报错但也不会触发更新
- 回归测试见 `tests/mqtt-message-window.test.js`（用真实 Vue 断言解包行为与容器写入）

## 页面切换性能（勿回退）

`App.vue` 的工具页**必须**用 `v-if / v-else-if` + 外层 `<KeepAlive>`，**不要**改回 `v-show`：

| 写法 | 全站 DOM | app-main DOM | 切页样式重算 |
|------|---------|-------------|-------------|
| `v-show`（旧） | 8703 | 6070 | 串口页 45.7ms + 布局 39.3ms |
| `v-if` + KeepAlive（现） | 2614 | 121 | 9/10 页 10~49ms |

```html
<!-- ✅ KeepAlive 内用 v-if 链；且绝不能插 HTML 注释（会被当成 comment vnode 报
     「KeepAlive expects exactly one child」） -->
<KeepAlive>
  <FlashView v-if="tool === 'flash'" />
  <Stc51View v-else-if="tool === 'stc51'" />
  ...
  <SettingsView v-else />
</KeepAlive>
```

长列表用 `content-visibility: auto` 跳过视口外元素的布局/绘制（`.qcard` 已启用）：

```css
.qcard { content-visibility: auto; contain-intrinsic-size: auto 118px; }
```
> 前提：祖先必须是滚动容器（`.quick-list { overflow-y:auto }` 定义在 `mqtt.css`）。
> ⚠️ 但 `content-visibility` **只省布局/绘制，不减 DOM 节点**。上百条时仍需真正虚拟化。

### 可变高度虚拟列表（`VirtualList.vue`）

串口页快捷指令（实测约 110 条 × 40 节点）已改用 `renderer/src/components/VirtualList.vue`：
**页面 DOM 4296 → 约 730，同时渲染 13~18 张卡**。

```html
<VirtualList :items="list" item-key="id" :estimate="118" :gap="8" v-slot="{ item, index }">
  <div class="card">…</div>
</VirtualList>
```

改这里时注意（都是踩过的坑）：

| 事项 | 说明 |
|------|------|
| **不要用 `content-visibility`** | 它会让视口外元素返回占位高度而非真实高度，**破坏 `offsetHeight` 测量**，条目会跳位 |
| **容器必须覆盖 `.quick-list` 的 flex** | `.quick-list` 在 `mqtt.css` 是 `display:flex`；虚拟条目是 `position:absolute`，需用更高特异性（如 `.serial-right .quick-list.vlist`）改成 `display:block` |
| **`clientHeight === 0` 要兜底** | 挂载瞬间容器可能未布局，直接用 0 计算只会渲染 overscan 条（看着像列表空了），组件内已用 600px 兜底 |
| 条目 ref 用函数式 | `:ref="(el) => setItemEl(row.index, el)"`，卸载时 el 为 null，需从 map 删除 |
| 高度实测 | 每帧 `nextTick` 后实测并回写，仅在真的变化时 `version++`，避免无限循环 |

回归测试：`tests/virtual-list.test.js`（二分定位、窗口边界、兜底逻辑、源码结构约束）。

## 内存监控（设置 → 内存监控）

- 主进程 `src/main/core/memory-monitor.js`：`collect()` / `forceGc()`，**永不抛异常**
  （跑在 IPC handler 里，抛错会带崩设置页）；`electron` 必须懒加载（函数内 require），
  否则纯 Node 测试无法 require。
- IPC `app-memory-stats` / `app-memory-gc`；preload `memoryStats()` / `memoryGc()`。
- 渲染层 `renderer/src/composables/useMemoryMonitor.js`：采样/峰值/增长对比/复制/CSV/GC。
- `MCU_EXPOSE_GC=1 npm start` → 传 `--js-flags=--expose-gc`，「触发 GC」才能回收渲染进程。
- 回归测试 `tests/memory-monitor.test.js`。

长列表用虚拟滚动，**不要**用 `content-visibility` 糊（它只省布局/绘制，DOM 节点数不降）：

- `renderer/src/components/VirtualList.vue` —— 可变高度虚拟列表（插槽式，可复用）。
  卡片内含 autosize textarea 时高度不固定，故用「估算 `estimate` + 实测 `offsetHeight` 修正」。
- 用法：`<VirtualList :items="list" item-key="id" :estimate="118" :gap="8" v-slot="{ item, index }">`
- ⚠️ **不要给条目加 `content-visibility`** —— 它会让视口外元素返回占位高度，
  破坏 `offsetHeight` 测量，导致窗口错位。
- ⚠️ 容器必须覆盖 `.quick-list` 的 `display:flex`（mqtt.css 里定义且后引入，同特异性会赢），
  用 `.serial-right .quick-list.vlist { display:block }` 这类更高特异性规则。
- 回归测试 `tests/virtual-list.test.js`。

## 本机启动注意

GPU 进程会间歇性崩溃（`exit_code=-1073741819` = 0xC0000005 访问违例 →
`GPU process isn't usable. Goodbye.`）。`MCU_DISABLE_GPU=1` 有时不够，可用逃生口追加参数：

```bash
# 实测有效：禁用 GPU 沙箱 + 强制 SwiftShader 软件渲染
MCU_DISABLE_GPU=1 MCU_ELECTRON_ARGS="--disable-gpu-sandbox --use-angle=swiftshader --disable-features=Vulkan" npm start
```

- `MCU_ELECTRON_ARGS="--a --b"` 可追加任意 Electron/Chromium 参数，便于试组合，无需改代码。
- **不要**加 `--in-process-gpu`，实测它反而会带崩应用。
- 调试端口 `MCU_DEBUG_PORT=9222`；内存 GC `MCU_EXPOSE_GC=1`。

**CDP 排查注意（踩过）**：窗口被遮挡时 `document.hidden === true`，浏览器**不派发 `scroll` 事件**
且 `requestAnimationFrame` 被节流。所以：
- 不要在页面内 `await` rAF（会让 CDP 脚本永久挂起 → SIGTERM）；改用「同步取值 + 宿主侧 sleep」。
- 测滚动逻辑时手动 `el.dispatchEvent(new Event('scroll'))` 驱动。
- 编辑中途 HMR 失败会留下半新半旧状态，验证前先 `Page.reload`。

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
