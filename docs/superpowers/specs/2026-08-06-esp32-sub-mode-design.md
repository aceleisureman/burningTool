# ESP32 子模式交互设计

## 背景

当前 VS Code 扩展在 ESP32 模式下提供四个子模式按钮：PlatformIO、Arduino、ESP-IDF、MicroPython。其中只有 PlatformIO 可用，其余三个显示"即将支持"且 disabled。

实际上 PlatformIO IDE 本身支持全部四个 framework（通过 `platformio.ini` 的 `framework` 字段区分）。四个子模式应该是同一套 PlatformIO 工作流上的"标签"，而非四个独立实现。

## 目标

- 四个子模式按钮全部启用，可自由切换
- 切换时自动修改 `platformio.ini` 的 `framework` 字段
- 自动识别当前工程的 framework 并在 UI 展示
- build / flash / build-and-flash 统一走 `platformio-ide.build` / `platformio-ide.upload`
- 用户感知：选 ESP32 → 选 framework → 一键编译烧录，PlatformIO IDE 负责底层细节

## 交互流程

```
用户打开 PlatformIO 工程
    │
    ▼
detect() 读取 platformio.ini → 识别 framework（arduino / espidf / esp32 / etc.）
    │
    ▼
侧边栏 ESP32 子模式栏高亮对应按钮
工程卡片显示 "PlatformIO + Arduino" 等标签
    │
    ▼
用户点击另一个子模式（如 Arduino → ESP-IDF）
    │
    ├─ 扩展修改 platformio.ini：framework = espidf
    ├─ 如需要，提示 PlatformIO 自动安装对应 platform
    └─ 刷新 readiness → build/flash 就绪
    │
    ▼
用户点击 Build / Flash / 一键
    │
    └─ runPioViaExtension('build'|'upload') → 与当前 PlatformIO 子模式完全相同
```

## 状态说明

| 条件 | 编译器 | 烧录设备 | UI 表现 |
|------|--------|---------|---------|
| pio 找到 + platformio.ini 存在 + 扩展已激活 | ok | online | 绿色就绪，可操作 |
| pio 找到 + platformio.ini 存在 + 扩展已安装未激活 | ok（提示需重启） | offline | 黄色警告"请重启 VS Code" |
| pio 找到 + 无 platformio.ini | not ready | not ready | 红色"未找到 platformio.ini" |
| pio 未找到 + 扩展未安装 | not ready | not ready | 红色 + 自动安装按钮 |
| 子模式切换中 | checking | checking | 短暂 checking 状态 |

## 文件改动清单

### 1. `src/platforms/esp32.js`

**`detect(dir)`** — 新增 framework 识别：

```js
detect(dir) {
  // 现有检测逻辑...
  const hasPlatformIO = fs.existsSync(path.join(dir, 'platformio.ini'));

  // 新增：读取 platformio.ini 识别当前 framework
  let pioFramework = '';
  if (hasPlatformIO) {
    try {
      const ini = fs.readFileSync(path.join(dir, 'platformio.ini'), 'utf8');
      const m = ini.match(/^\s*framework\s*=\s*(\S+)/im);
      if (m) pioFramework = m[1].toLowerCase();
    } catch { /* ignore */ }
  }

  return {
    // ...现有字段
    hasPlatformIO, hasArduino, hasEspIdf, hasMicroPython, esp32SubKind,
    pioFramework  // 新增：'arduino' | 'espidf' | 'esp32' | 'espotartu' | '' 等
  };
}
```

**`checkReadiness(cfg, dir)`** — 简化：

```js
if (subMode === 'platformio') {
  // 原有 pio 检测逻辑（不变）
  // 去掉 else { subMode 即将支持 } 分支
}
```

四个子模式共用同一套 readiness 逻辑，因为底层都是 PlatformIO IDE。

**`build/flash/buildAndFlash`** — 不变，继续走 `runPioViaExtension`。

### 2. `src/webview/panel.js`

**HTML 部分** — 子模式按钮去掉 disabled：

```html
<div class="esp32-sub-bar" id="esp32SubBar">
  <button data-sub="platformio" class="active">PlatformIO</button>
  <button data-sub="arduino">Arduino</button>
  <button data-sub="idf">ESP-IDF</button>
  <button data-sub="micropython">MicroPython</button>
</div>
```

**`render()` — 工程信息卡片** — 新增 framework 展示：

在 `renderProjectInfo()` 中，ESP32 模式下显示：
- 工程类型：`PlatformIO + Arduino`（根据 `pioFramework` 拼接）
- 子模式高亮：当前 framework 对应按钮高亮

**`render()` — 子模式切换** — 新增自动修改 `platformio.ini`：

```js
case 'setEsp32SubMode':
  const newSub = msg.value;
  await updateSetting('esp32SubMode', newSub);
  // 自动修改 platformio.ini 的 framework 字段
  const dir = getProjectDir();
  if (dir) {
    const iniPath = path.join(dir, 'platformio.ini');
    try {
      let ini = fs.readFileSync(iniPath, 'utf8');
      const frameworkMap = {
        platformio: '',      // 默认，不写 framework
        arduino: 'arduino',
        idf: 'espidf',
        micropython: 'micropython'
      };
      const target = frameworkMap[newSub] || '';
      if (target) {
        // 替换或追加 framework 行
        if (/^\s*framework\s*=/im.test(ini)) {
          ini = ini.replace(/^\s*framework\s*=\s*\S+/im, `framework = ${target}`);
        } else {
          ini += `\nframework = ${target}\n`;
        }
        fs.writeFileSync(iniPath, ini, 'utf8');
      }
    } catch (e) {
      vscode.window.showWarningMessage(`更新 platformio.ini 失败: ${e.message}`);
    }
  }
  await this._service.refreshState();
  break;
```

**hint 区域** — 去掉"即将支持"分支，改为 framework 相关提示。

### 3. `i18n/zh-cn.json` / `i18n/en.json`

新增 key：

```json
"esp32.framework": "Framework",
"esp32.framework.arduino": "Arduino",
"esp32.framework.espidf": "ESP-IDF",
"esp32.framework.micropython": "MicroPython",
"esp32.framework.unknown": "未识别",
"esp32.sub.switch_hint": "切换 framework 将修改 platformio.ini",
"esp32.sub.switching": "正在切换 framework…"
```

## 不支持的场景（本次不改）

- 非 PlatformIO 的纯 Arduino 工程（无 `platformio.ini`，只有 `.ino` 文件）— 用户需要先在 PlatformIO 中创建工程
- 非 PlatformIO 的纯 ESP-IDF 工程（只有 `CMakeLists.txt`，无 `platformio.ini`）— 同上
- MicroPython 脚本（只有 `main.py`）— 同上

这些场景仍显示"即将支持"，后续可单独支持。

## 验证方式

1. 打开含 `platformio.ini` 的 PlatformIO 工程，侧边栏自动识别 framework 并高亮对应子模式按钮
2. 点击不同子模式按钮，验证 `platformio.ini` 的 `framework` 字段被正确修改
3. 切换后点击 Build，验证 PlatformIO IDE 正常执行编译
4. 打开无 `platformio.ini` 的 ESP32 工程，验证仍显示原有提示
