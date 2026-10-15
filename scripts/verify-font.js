#!/usr/bin/env node
/**
 * 字体可用性校验：用 Electron 自带的 Chromium 实际跑一遍 @font-face 解析。
 *
 * 为什么需要它：Chromium 的 OTS 比 fontTools 严格得多。本项目就踩过一次——
 * 字体 STAT 表里 AxisValue 的轴索引越界，fontTools 能正常读写，OTS 却直接拒绝整个
 * 字体，表现为渲染进程控制台两句：
 *     Failed to decode downloaded font: .../AlimamaFangYuanTiVF-Thin.woff2
 *     OTS parsing error: Unable to instantiate font face from font data.
 * 而界面只是悄悄回退到系统字体，肉眼不容易察觉，换字号/字体时极易复发。
 *
 * 用法（在工程根目录）：
 *     npx electron scripts/verify-font.js                     # 校验默认字体
 *     npx electron scripts/verify-font.js path/to/font.woff2  # 校验指定字体
 *
 * ⚠️ 若环境里设了 ELECTRON_RUN_AS_NODE=1，Electron 会退化成纯 Node 启动、报
 *    "Cannot find module 'electron'"。此时先清掉该变量再跑，例如 Git Bash：
 *     env -u ELECTRON_RUN_AS_NODE npx electron scripts/verify-font.js
 *
 * 注意实现细节：探针页与字体必须同源。字体受 CORS 约束，用 file:// 直接加载会被
 * 拦成 "network error"，伪装成 OTS 失败，得出错误结论。所以这里起一个本地 HTTP
 * 服务同时提供页面与字体。
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

app.disableHardwareAcceleration();

const ROOT = path.resolve(__dirname, '..');
const fontPath = path.resolve(process.argv[2] || path.join(ROOT, 'renderer', 'fonts', 'AlimamaFangYuanTiVF-Thin.woff2'));

if (!fs.existsSync(fontPath)) {
  console.error('找不到字体文件:', fontPath);
  process.exit(1);
}

const fontBuf = fs.readFileSync(fontPath);
const ext = path.extname(fontPath).toLowerCase();
const MIME = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };

app.whenReady().then(async () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'PROBE'; src: url('/font${ext}'); }
body { font-family: 'PROBE', sans-serif; font-size: 20px; }
</style></head><body><div>探针 ABC 123</div></body></html>`;

  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else if (req.url.startsWith('/font')) {
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': fontBuf.length });
      res.end(fontBuf);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const win = new BrowserWindow({ show: false, width: 400, height: 100 });
  const msgs = [];
  win.webContents.on('console-message', (...args) => {
    const m = args.length >= 5 ? args[2] : (args[1] && args[1].message);
    if (m) msgs.push(String(m));
  });

  let status;
  try {
    await win.loadURL(`http://127.0.0.1:${port}/`);
    status = await win.webContents.executeJavaScript(`
      (async () => {
        try { await document.fonts.load('20px PROBE'); }
        catch (e) { return 'error: ' + e.message; }
        const ff = [...document.fonts][0];
        return ff ? ff.status : 'no-face';
      })()
    `);
  } catch (e) {
    status = 'probe-failed: ' + e.message;
  }

  const ots = msgs.filter((m) => /OTS|decode downloaded font/i.test(m));
  const ok = status === 'loaded' && ots.length === 0;

  console.log('');
  console.log('字体:', fontPath);
  console.log('大小:', fontBuf.length, '字节');
  console.log('状态:', status);
  if (ots.length) ots.forEach((m) => console.log('  ✗', m));
  console.log(ok ? '\n✓ 通过：Chromium 可以正常解析该字体' : '\n✗ 未通过：Chromium 拒绝该字体');

  server.close();
  app.exit(ok ? 0 : 1);
});
