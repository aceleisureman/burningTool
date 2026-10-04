# MCU 工具箱 — 深度优化分析报告

> 生成时间：2026-10-04
> 分析范围：`src/main/`（主进程 41 文件 / 4687 行）、`renderer/src/`（渲染层 33 文件 / 6046 行）、`packages/flash-core/`、`plugins/vscode-stm32-flash/`、构建/打包/测试/CI 配置
> 方法：三路并行深度代码调研 + 关键结论实测复核

---

## 0. 总体结论

这个项目的工程质量**明显高于一般同类 Electron 项目**：日志/串口/MQTT 三处数据攒批、job 全局互斥锁、config 内存缓存+防抖+原子写、更新包 sha512 校验、解压路径穿越防护、IPC 可信来源校验、HTTPS-only、密码 safeStorage 加密、终端窗口化渲染，都是有心之作。

问题集中在三类：**① 主进程事件循环阻塞（同步 FS / 同步子进程）、② 打包体积浪费、③ 局部高频路径的响应式开销**。以下按投入产出比排序。

---

## 一、P0 — 主进程阻塞（影响体感最直接）

主进程一旦被同步调用卡住，整个 UI（含串口数据推送）都会冻结。以下三处都在**高频路径**上。

### P0-1 工具链版本探测用 `spawnSync` 串行阻塞
**文件**：`packages/flash-core/toolchain/status.js:113-122`（`commandVersion`）

```js
const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 2500 }); // ← 同步阻塞
```

`defaultToolchainStatus()` 会**串行**对 gcc/make/pyocd/openocd/busybox 各跑一次，每次最长 2500ms。被 `installer.js`、`system-path.js:47`、IPC `default-toolchain-status`（`register-toolchain-ipc.js:27`）高频调用。

**影响**：Windows + python venv 冷启动 / 网络盘 PATH 时，主进程可冻结 **数秒~十余秒**。
**修复**：改异步 `runCapture` + 进程级缓存（版本号极少变）：
```js
const _versionCache = new Map();
async function commandVersion(cmd, args, tool) {
  const key = `${cmd}::${tool}`;
  if (_versionCache.has(key)) return _versionCache.get(key);
  const { out } = await runCapture(cmd, args, { timeoutMs: 3000 });
  const v = parseToolVersion(tool, out);
  _versionCache.set(key, v);
  return v;
}
```

### P0-2 `findExecutableOnPath` 同步遍历整个 PATH
**文件**：`packages/flash-core/toolchain/paths.js:257-264`（另见 `paths.js:5,20` 的 `execFileSync`）

```js
for (const dir of dirs) {
  const p = path.join(dir, name);
  if (fs.existsSync(p)) return p;   // ← 每个目录一次同步 stat
}
```

PATH 常含几十个目录（含 UNC 网络路径 / 离线盘符），每次都同步 stat。
**影响**：`resolveStcgalInvocation` / `resolveEsptoolInvocation` 在**每次面板状态查询与每次烧录前**都走这里。
**修复**：memoize（同 name 结果缓存）+ 优先复用已缓存的 `whichSync`；或整体异步化。

### P0-3 项目/固件扫描的同步 BFS
**文件**：
- `packages/flash-core/flash/project.js:19,38`（`readdirSync` + `existsSync`）
- `packages/flash-core/flash/makefile-startup-repair.js:107-123`（`findFile`，BFS 到 maxDepth=12，会扫 `~/STM32Cube/Repository`）
- `src/main/firmware/analyzer.js:38,51`
- `src/main/ipc/register-project-ipc.js:42-52`（`dirInfo` → `findKeilProject`）

**影响**：`check-dir` / `select-directory` / `analyze-firmware` / 每次 `detectBuildSystem` 都同步扫盘；大工程/网络盘卡数秒。
**修复**：改 `fs.promises.readdir` 异步 BFS；结果按 `dir + mtime` 缓存；`~/STM32Cube/Repository` 结果长缓存。

---

## 二、P0 — 打包体积（收益最大、成本最低）

### P0-4 2.4MB 中文字体占 renderer/dist 的 75%
实测：`renderer/dist` = 3.2MB，其中 `AlimamaFangYuanTiVF-Thin-CRaVlmrv.woff2` = **2,408,604 字节**。
来源：`renderer/src/styles/base.css:2-4` 的 `@font-face`（`../../fonts/AlimamaFangYuanTiVF-Thin.woff2`），作为 `--font-sans` 首选。

woff2 已压缩，gzip/brotli 无效。**建议（按性价比）**：
1. **字体子集化**（推荐）：`pyftsubset` / `subfont` 只留界面实际用到的 CJK 字，通常 2.4MB → 100~300KB。
2. 或直接用系统字体栈（`-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`），体积归零。
3. 至少补 `font-display: swap`。

### P0-5 打包 `files` 把运行时不需要的 `assets/**/*` 打进 asar
实测 asar = **16MB**（`dist/win-unpacked/resources/app.asar`），其中含完整 `assets/icons/**`（打包阶段给 electron-builder 用的图标源文件，运行时不需要）。

**`package.json:41-49`**：
```json
"files": ["src/**/*", "packages/flash-core/**/*", "renderer/dist/**/*", "assets/**/*",
          "!resources/**", "!dist", "!**/*.map"]
```
- `!resources/**`、`!dist` 是**无效排除**（本就不在 include 白名单内）。
- `assets/**/*` 建议从 `files` 移除（图标经 `directories.buildResources` 消费）。

**修复**：`files` 删 `assets/**/*` 与两个无效排除项，预计 asar −3MB。

### P0-6 asar 内打进完整 node_modules（含 253 个 `@babel` 文件）
实测 asar 的 1258 条目中 **1191 条（94.7%）是 node_modules**，其中 `@babel` **253 条**（典型构建期传递依赖泄漏，运行时不需要）。

**修复**：
- `npm ls @babel/runtime` 定位来源，确认运行时无 require 后加 `"!node_modules/@babel/**"`。
- 对 `serialport` 的 `@serialport/*` 各平台预编译二进制，用 `files` + `asarUnpack` 精准到当前平台。

### P0-7 main chunk 327KB + 告警阈值被人为抬高
实测 `main-*.js` = **333,920 字节**，`main-*.css` = 156,196 字节。
`vite.config.mjs:113` 设 `chunkSizeWarningLimit: 2000` —— **等于关闭了 chunk 过大告警**。

> 注：`renderer/src/main.js:4-9` **已经是按需引入图标**（并非全量注册），这点很好；但主 chunk 仍把 vue runtime + App.vue + 图标 + 布局逻辑打在一起。

**修复**：
```js
build: {
  sourcemap: false,              // 显式声明
  chunkSizeWarningLimit: 500,    // 恢复告警
  rollupOptions: {
    output: {
      manualChunks: {
        'vue-vendor': ['vue'],
        'element-plus': ['element-plus', '@element-plus/icons-vue'],
      }
    }
  }
}
```

---

## 三、P1 — 渲染层热点（长会话下明显）

### P1-1 MQTT 消息用响应式 `splice(0, n)` 淘汰 —— 与串口踩过的同一个坑
**文件**：`renderer/src/composables/useMqtt.js:50-62`

```js
if (removeCount) conn.messages.splice(0, removeCount);  // ← 响应式代理数组，O(N) 逐元素搬运
```

`useSerial.js:95-99` 的注释已明确记录过这个问题（实测 3000 行 splice 约 4-7ms），并改成「普通数组 + triggerRef + 窗口切片」；但 **MQTT 侧没同步修**。消息对象已 `markRaw`，但**数组本身仍是响应式代理**，`splice` 开销依旧。历史上限 3000、trim 到 2400，每批数据触顶就搬运约 600 元素。

**修复**：参照 `useSerial` 的普通数组 + `triggerRef` 方案。

### P1-2 `MqttMessages.vue` 全量渲染最多 3000 条，无窗口化
**文件**：`renderer/src/components/MqttMessages.vue:19`

```html
<template v-for="m in activeConn.messages" :key="m.id">
```
串口终端已有 `TERM_RENDER_WINDOW=600` 窗口化，MQTT **没有**等价机制。每条含多个 span + 可能 `v-html`（JSON 高亮），长会话下 DOM 上万。

**修复**：复用串口「尾部窗口 + 锚点」思路，或简易虚拟列表；至少限制渲染最近 500 条 + 「加载更早」。

### P1-3 `useGlyph.js` 每次输入/拖动滑块全量重光栅化 + 全量重绘
**文件**：`renderer/src/composables/useGlyph.js:37-76, 95-100`

- `genGlyph()` 对每个字符 `document.createElement('canvas')` + 逐像素 `getImageData`（O(n·size²)），每帧新建 canvas。
- `drawGlyphPreviews()` 用 `document.querySelectorAll('canvas.gl-canvas')` **手动操作 DOM**，再逐格 `fillRect`。
- watch 13 个字段（含 `threshold` 20~240），拖滑块每档重跑（仅 100ms 防抖）。

**影响**：32 字 × 32×32 ≈ 3.2 万像素判定 + 3.2 万 `fillRect`，拖动明显掉帧。
**修复**：字符级 raster 缓存（`Map`，key = `ch|size|font|bold|threshold|offX|offY`）；复用单个离屏 canvas；预览用模板 `ref` 收集 canvas 而非全局查询 DOM；拖动类参数节流 ~60ms。

### P1-4 `App.vue` 顶层 `appContext` 全量 provide，视图全量 inject
**文件**：`renderer/src/App.vue:335-342`；各视图（FlashView:172 / GlyphView:178 / CrcView:162 / Esp32View:219 / Stc51View:161 / HardwareView:66 / RamLogView:93 / SettingsView:246）

`appContext` 是 12 个域（theme/log/glyph/crc/settings/flash/serial/mqtt/update…）全量合并对象，每个视图 `const app = inject('appContext'); return app;` —— 即**每个视图订阅了全部域的响应式状态**。任意域变化（如 log 每秒几十次、serial rx 计数）都会让所有 mounted 视图参与依赖收集。这抵消了叶子组件隔离订阅的效果。

**修复**：按域拆 provide key（已有 `log/serial/mqtt/ramlog` 四个，应补齐其余），视图只 inject 自己需要的域；`appContext` 仅留外壳用途。

### P1-5 `SerialView` 展开整个 serial 域，抵消终端叶子组件隔离
**文件**：`renderer/src/views/SerialView.vue:225-239`

`setup()` 里 `return { ...serialDomain, ... }` 展开**所有** ref/computed（含高频的 `serialLines`）。高波特率下终端行提交（每批 30ms 一次 `triggerRef`）会让 `SerialView` 也重渲染一遍。
**修复**：只解构模板真正用到的字段，**不要展开 `serialLines`**。

### P1-6 `useLog.js` 倒序每次 `slice().reverse()` 复制整数组
**文件**：`renderer/src/composables/useLog.js:32`

```js
const displayLines = computed(() => reverse.value ? logLines.value.slice().reverse() : logLines.value);
```
默认倒序下每批日志都复制最多 2000 行 + reverse，`LogPanel` `v-for` 全量 diff。
**修复**：正序数组 + CSS `flex-direction: column-reverse` 实现视觉倒序。

### P1-7 `useSettings.js` `defaultTc` 有未声明的响应式字段
**文件**：`renderer/src/composables/useSettings.js:16`（定义）、`379-388`、`392-427`（读取）

初始 `reactive` 只声明了 7 个字段，但 `toolVersionText()` / `openToolDetail()` 读取 `gccVersion/makeVersion/pyocdVersion/openocdVersion/busyboxVersion/commandTools` —— 这些**从未声明**，仅在 `Object.assign(defaultTc, r)` 时才动态出现。
**影响**：`toolDetail.commands.length` 一直为 0；`defaultToolchainItems` computed 对这些字段**不建立依赖**，后续动态加入也不重算。
**修复**：初始化时显式声明全部预期字段。

---

## 四、P1 — 稳定 / 安全 / 一致性

### P1-8 调试类 IPC 未走 `jobLock`，会与烧录抢 SWD 探针
**文件**：`src/main/ipc/register-debug-ipc.js:16-20`

`read-chip-info`、`hardware-debug-command`、`read-ram-log` **不走 jobLock**，而 flash/build 走。用户烧录中点「识别芯片」→ 两路 pyocd 同时连 SWD → 探针争抢、烧录失败。
**修复**：这三者包进 `jobLock.runExclusive`（或只读共享锁），busy 时明确提示。

### P1-9 HTTP API 无速率限制，队列无上限
**文件**：`src/main/core/http-server.js:341-355`

本机三层来源校验（remoteAddress/Host/Sec-Fetch-Site/Origin）很扎实，但 `POST /api/build-flash` 无频率限制，`_queue` 无上限。
**修复**：加令牌桶；`_queue.length > N` 返回 429。

### P1-10 `windows.js` 用 `ipcMain.removeAllListeners('serial-pick')` 全局清空
**文件**：`src/main/windows.js:200`

每次 `createWindow` 都 `removeAllListeners` 会误清其它模块在该 channel 的监听。
**修复**：保存 handler 引用，用 `removeListener(ch, handler)` 精准移除。

### P1-11 `stop-electron.js` Windows 分支未过滤 electron → 可能误杀
**文件**：`scripts/stop-electron.js:14`

Windows 用 `$_.CommandLine -like '*${root}*'` 匹配杀进程，**不检查进程名是否 electron**；POSIX 分支检查了（`/electron/i`）。任何命令行含项目路径的无关进程（编辑器、终端）可能被误杀。
**修复**：Windows 分支补 `Name -match 'electron'`；或 dev 启动写 `.dev.pid`，stop 只杀该 PID 树。

### P1-12 `safeStorage` 加密失败静默明文回退
**文件**：`src/main/core/config.js:123-137`

`canEncryptSecrets()` 为 false 时**直接返回明文 cfg**，无提示。Linux 无 keyring 时 MQTT 密码明文落盘。
**修复**：不可加密时 `bus.send(..., 'warn')` 提示。

### P1-13 CI：三平台重复构建 + rerun 版本重复 + 并发发布
**文件**：`.github/workflows/build.yml`

- verify 与 build 是独立 job，**三平台各自又 `vite build` 一遍**，前端重复构建 3 次。
- 版本用 `github.run_number`，**rerun workflow 时不变** → 重复版本 → updater 误判。
- 三平台并行 `--publish always` 写同一 Release，是常见竞态点。

**修复**：verify 上传 `renderer/dist` artifact，build 下载复用；版本加 `run_attempt`；加 `concurrency` 组；发布改为「先建 Release 再追加」。

### P1-14 dev 脚本固定端口 + 等待逻辑缺陷
**文件**：`scripts/dev.js:8,24,31`、`vite.config.mjs:109`（`strictPort: true`）

端口被占用时 vite 直接退出，但 `waitPort` 仍盲等 30s，**可能连到别的进程占用的 5173**，Electron 加载错误页。vite 在 Electron 启动后崩溃时也不清理。
**修复**：dev 用动态端口（从 vite 输出解析）；`waitPort` 加进程存活检查（`vite.exitCode != null` 即报错）；清理逻辑用 `finally` 统一。

---

## 五、P2 — 代码质量与工程

| # | 问题 | 文件:行 | 建议 |
|---|------|---------|------|
| P2-1 | `loadConfig()` 缓存未命中同步读盘；`transformMqttPasswords` 无 MQTT 时也整树深拷贝 | `config.js:140-149,111` | 启动时异步预填充缓存；无 MQTT 配置跳过克隆 |
| P2-2 | `subscribeTopic` / 工具链子进程 `buildEnv` 每次构造大 env 对象 | `status.js:156` | 缓存 base env，仅覆盖 PATH |
| P2-3 | `mqtt-history-store.js` 全同步 FS，无缓存无防抖 | `mqtt-history-store.js:25-50` | 改 `fs.promises` + 防抖 |
| P2-4 | `electronic-api.js:157` `_ipcCh.on('renderer:.*', ...)` 字面通配是**死代码**；invoke 超时 `resolve(undefined)` 会吞错 | `electron-api.js:56-68,157` | 删除死行；超时改 `reject` |
| P2-5 | `updater.js:729-731` 条件 `'verifyUpdateCodeSignature' in autoUpdater` 恒真（冗余） | `updater.js:729-731` | 简化为直接赋值 |
| P2-6 | mac 更新强退 `scheduleForceExit(8000)` 早于脚本等待窗口 | `updater.js:689` | 调大到 12s（与默认一致） |
| P2-7 | `useCrc.js` watch 无防抖；一次变更解析两遍（recompute + crcPreviewBytes） | `useCrc.js:92-94` | 加 120ms 防抖；共享解析缓存 |
| P2-8 | `useTheme.js` `documentElement.className = mode` 覆盖所有 class | `useTheme.js:113` | 用 `classList.add/remove` |
| P2-9 | `Esp32View.vue:157` / `GlyphView.vue:56` 用 index 作 `:key`，删除中间项会错位 | 两文件 | 加稳定 id |
| P2-10 | 三视图日志工具栏逐字重复 | `Stc51View.vue:140` / `Esp32View.vue:198` / `FlashView.vue:130` | 抽 `<LogToolbar>` 组件 |
| P2-11 | 22 个 `src/main/**` 纯 re-export 壳文件（无逻辑），仍被打进 asar | 全 `src/main` | 统一入口 `require('@mcu-toolbox/flash-core')`，删壳 |
| P2-12 | `vscode-stm32-flash/vendor/flash-core` 是**物理拷贝**，易漂移 | `scripts/sync-ext-vendor.js` | 引入 npm workspaces，或用 esbuild 内联替代拷贝 |
| P2-13 | `scripts/package-ext.js:108` `npx --yes @vscode/vsce` 不锁版本、依赖网络 | `package-ext.js:106-111` | 固化为 devDependency |
| P2-14 | ESLint 用 `flat/essential`（最低档）；`no-unused-vars` 是 `warn`（不阻断 CI）；`no-empty` 全关 | `eslint.config.mjs:20,58-67` | 升 `flat/recommended`；`no-unused-vars` 改 error；`no-empty` 用 `allowEmptyCatch` |
| P2-15 | `eslint-plugin-vue` **未安装**，`npm run lint` 必然崩溃（已实测 node_modules 无此包） | `eslint.config.mjs:3` | `rm -rf node_modules package-lock.json && npm install` |
| P2-16 | 高风险逻辑**零测试**：`installer.js`（装工具链）、`system-path.js`（改系统 PATH）、`runner.js` | `tests/` | 用临时目录 + mock PATH 补测试 |
| P2-17 | 依赖版本全用 `^`，Electron/serialport 主版本升级有 ABI 风险 | `package.json:105-128` | 收紧 `electron`/`serialport`/`electron-builder` 到 `~` 或精确 |
| P2-18 | `dist/`（~500MB）+ `toolchain/`（gcc.zip 323MB）残留污染工作区 | 工作区 | 定期清理（已 gitignore） |
| P2-19 | `plugins/vscode-stm32-flash/eslint.config.mjs` 与根配置并存，构成双份 lint 标准 | 两配置文件 | 插件配置 re-export 根配置 |

---

## 六、战略建议：TypeScript 分阶段迁移

**最高价值点**：`src/preload/index.js` 的 `window.api` 与 `vite.config.mjs:14-91` 那份 80 行 polyfill 是**手写镜像**，极易漂移。TS 化可自动同步契约、消除这类 bug。

**分阶段（低风险）**：
1. **第一步（高收益低成本）**：只为 `window.api` 写一份 `.d.ts`（或 JSDoc `@typedef`），renderer 用 `/// <reference>` 引用 —— 立刻获得 API 类型提示。
2. **第二步**：`flash-core` 加 `checkJs` + JSDoc，`tsc --noEmit` 类型检查（不改后缀）。
3. **第三步**：新代码用 `.ts`，旧代码渐进。
4. **不建议**现在全量重写。

---

## 七、优先级执行清单（按投入产出比）

| 顺序 | 动作 | 关键文件 | 预估收益 |
|------|------|----------|----------|
| 1 | 字体子集化 | `base.css:2` + `fonts/` | renderer/dist −2MB+（75%） |
| 2 | `files` 去 assets + 排查 `@babel` | `package.json:41-49` | asar −3~5MB |
| 3 | vite `manualChunks` 分包 + 恢复告警阈值 | `vite.config.mjs:110-119` | main chunk −30~50% |
| 4 | 版本探测异步化 + PATH memoize | `status.js:113`、`paths.js:257` | 消除数秒 UI 冻结 |
| 5 | 项目扫描异步 BFS | `project.js:19`、`analyzer.js:38` | 大工程不卡 |
| 6 | MQTT 消息改普通数组 + 窗口化 | `useMqtt.js:60`、`MqttMessages.vue:19` | 长会话不卡 |
| 7 | 调试 IPC 走 jobLock | `register-debug-ipc.js:16` | 修复探针争抢 |
| 8 | 补 `eslint-plugin-vue` + 收紧规则 | `eslint.config.mjs` | 校验链可靠 |
| 9 | 补 installer/system-path 测试 | `tests/` | 保护高风险逻辑 |
| 10 | CI 复用产物 + 版本唯一 | `build.yml` | CI 稳定 |

---

## 附：经复核确认的「非问题」（避免误改）

- 日志/串口/MQTT 三处**数据攒批**设计优秀（字节+条数双上限）。
- `config` 原子写 + 防抖 + `unref` 规范。
- 命令注入防护到位：`runProcess`/`runCapture` 全 `shell:false` + 数组 args；OpenOCD TCL 路径有 `quoteOpenocdTclPath`；UV4 用 `psq` 单引号转义。
- 路径穿越防护：`validateArchiveEntryNames` / `getArtifactFileName` 已覆盖。
- IPC 安全：`trusted-ipc.js` 校验 sender；`nodeIntegration:false` + `contextIsolation:true`。
- 并发锁：`jobLock` + `serialGeneration` 代际号 + `ramlog activeRead` 覆盖主要竞态。
- `useSerial` 终端窗口化、`useLog` 50ms 攒批 + `progressByKey`、叶子组件隔离，方向都对。
- `tests/` **无真实网络/固定端口/真实时钟硬依赖**（`http-server.test.js` 用 `port:0`；`updater-async.test.js` 用注入式 `tick(now)`），测试本身可靠，问题只在覆盖广度。
- `devDependencies` / `dependencies` 划分**整体正确**。
