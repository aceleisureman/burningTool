'use strict';

// 回归测试：快捷指令虚拟列表。
//
// 背景：串口页把「全部快捷指令」一次性渲染（实测该用户约 110 条，每张卡 8 个 Element Plus
// 控件 ≈ 40 节点），单页 DOM 冲到 4296，切页时样式重算 + 重排明显卡顿。
// 现改为 VirtualList 可变高度虚拟化（卡片内含 autosize textarea，高度不固定）。
//
// 这里既断言源码结构，也用纯函数复现「二分定位 + 窗口计算」的核心算法，
// 避免以后有人把它改回全量渲染，或改坏窗口边界。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const VLIST = path.join(__dirname, '..', 'renderer', 'src', 'components', 'VirtualList.vue');
const SERIAL_VIEW = path.join(__dirname, '..', 'renderer', 'src', 'views', 'SerialView.vue');
const SERIAL_CSS = path.join(__dirname, '..', 'renderer', 'src', 'styles', 'tools', 'serial.css');

const read = (p) => fs.readFileSync(p, 'utf8');
const vlistSrc = read(VLIST);
const serialSrc = read(SERIAL_VIEW);
const serialCss = read(SERIAL_CSS);

/* ── 1. 复现核心算法：二分定位 + 窗口边界 ─────────────── */

function findStart(offsets, y) {
  let lo = 0;
  let hi = offsets.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= y) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

// 复现 visible 计算
function computeVisible(heights, estimate, gap, overscan, scrollTop, viewportH) {
  const n = heights.length;
  const offs = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    offs[i] = acc;
    acc += (heights[i] || estimate) + gap;
  }
  const vh = viewportH > 0 ? viewportH : 600;      // 与组件一致：未布局时兜底
  const start = Math.max(0, findStart(offs, scrollTop) - overscan);
  const bottomY = scrollTop + vh;
  let end = start;
  while (end < n && offs[end] < bottomY) end++;
  end = Math.min(n, end + overscan);
  const rows = [];
  for (let i = start; i < end; i++) rows.push({ index: i, top: offs[i] });
  return { rows, total: n ? acc - gap : 0, offs };
}

test('虚拟列表：顶部只渲染窗口内的条目', () => {
  const heights = new Array(110).fill(0);
  const { rows, total } = computeVisible(heights, 118, 8, 4, 0, 1162);
  assert.ok(rows.length < 25, '110 条数据在 1162px 视口里应只渲染十几条，实际 ' + rows.length);
  assert.equal(rows[0].index, 0, '顶部应从第 0 条开始');
  assert.ok(total > 13000, '总高应由估算值撑起（110 * 126 ≈ 13860），实际 ' + total);
});

test('虚拟列表：滚动后窗口跟随（首条 top 应接近 scrollTop）', () => {
  const heights = new Array(110).fill(0);
  const { rows } = computeVisible(heights, 118, 8, 4, 6912, 1162);
  assert.ok(rows[0].index > 40, '滚到中部时起点应大幅前移，实际 index=' + rows[0].index);
  assert.ok(Math.abs(rows[0].top - 6912) < 118 * 8, '首条 top 应接近 scrollTop，实际 ' + rows[0].top);
});

test('虚拟列表：滚到底部能覆盖最后一条', () => {
  const heights = new Array(110).fill(0);
  const { rows, total } = computeVisible(heights, 118, 8, 4, total0(), 1162);
  function total0() { return 110 * 126 - 8; }
  const last = rows[rows.length - 1];
  assert.equal(last.index, 109, '底部窗口应包含最后一条');
  assert.ok(total > 0);
});

test('虚拟列表：已测高度会被采用，未测的用估算值', () => {
  const heights = new Array(20).fill(0);
  heights[0] = 300;                      // 第一条特别高
  const { offs } = computeVisible(heights, 118, 8, 4, 0, 600);
  assert.equal(offs[0], 0);
  assert.equal(offs[1], 308, '第二条起点 = 第一条实测高 300 + gap 8');
});

test('虚拟列表：视口高度为 0 时兜底渲染，不会只渲染 overscan 条', () => {
  const heights = new Array(110).fill(0);
  const { rows } = computeVisible(heights, 118, 8, 4, 0, 0);
  assert.ok(rows.length > 4, '视口为 0 时应走 600px 兜底，实际只渲染 ' + rows.length + ' 条');
});

test('二分定位：边界与越界都正确', () => {
  const offs = [0, 126, 252, 378, 504];
  assert.equal(findStart(offs, 0), 0);
  assert.equal(findStart(offs, 125), 0);
  assert.equal(findStart(offs, 126), 1);
  assert.equal(findStart(offs, 505), 4, '超过最大值应返回末位');
  assert.equal(findStart([0], 999), 0, '单元素数组');
});

/* ── 2. 源码结构约束 ───────────────────────────────── */

test('VirtualList: 具备可变高度虚拟化的必要机制', () => {
  assert.ok(/offsetHeight/.test(vlistSrc), '应实测条目高度（offsetHeight）');
  assert.ok(/ResizeObserver/.test(vlistSrc), '应监听容器尺寸变化');
  assert.ok(/onBeforeUnmount/.test(vlistSrc), '应清理 ResizeObserver');
  assert.ok(/ro\.disconnect\(\)/.test(vlistSrc), '卸载时应 disconnect');
  assert.ok(/@scroll\.passive/.test(vlistSrc), '滚动监听应用 passive');
  assert.ok(/estimate/.test(vlistSrc) && /overscan/.test(vlistSrc), '应支持估算高度与 overscan');
  assert.ok(/position:\s*absolute|class="vlist-item"/.test(vlistSrc), '条目应绝对定位');
});

test('VirtualList: 不引入 content-visibility（会破坏高度测量）', () => {
  // content-visibility 会让视口外元素返回占位高度，实测 offsetHeight 会失真
  assert.ok(!/content-visibility\s*:/.test(vlistSrc), 'VirtualList 内不应使用 content-visibility');
});

test('SerialView: 快捷指令已改用虚拟列表，不再全量 v-for', () => {
  assert.ok(/<VirtualList/.test(serialSrc), '应使用 VirtualList');
  assert.ok(/import VirtualList from '\.\.\/components\/VirtualList\.vue'/.test(serialSrc), '应引入 VirtualList');
  assert.ok(/components:\s*\{[^}]*VirtualList/.test(serialSrc), '应注册 VirtualList');
  // 旧的写法：直接 v-for 渲染 quickCmds
  assert.ok(!/v-for="\(q, i\) in quickCmds"/.test(serialSrc), '不应再全量渲染 quickCmds');
  assert.ok(/<template #default="\{ item: q, index: i \}">/.test(serialSrc), '应通过插槽把 item/index 传给卡片');
});

test('serial.css: 虚拟列表容器覆盖了 .quick-list 的 flex 布局', () => {
  // .quick-list 在 mqtt.css 里是 display:flex（同特异性且后引入会赢），
  // 虚拟条目是绝对定位，必须用更高特异性覆盖成 block。
  assert.ok(/\.serial-right \.quick-list\.vlist\s*\{/.test(serialCss), '应有 .quick-list.vlist 覆盖规则');
  const block = serialCss.match(/\.serial-right \.quick-list\.vlist\s*\{[\s\S]*?\}/);
  assert.ok(block, '应能取到该规则');
  assert.ok(/display:\s*block/.test(block[0]), '应覆盖为 display:block');
  assert.ok(/position:\s*relative/.test(block[0]), '应为定位上下文');
  assert.ok(/overflow-y:\s*auto/.test(block[0]), '应保持可滚动');
  // .qcard 上不能残留 content-visibility 声明（注释里提到是允许的，先去掉注释再查）
  const cssNoComment = serialCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const qcardBlock = cssNoComment.match(/\.serial-right \.qcard\s*\{[\s\S]*?\}/);
  assert.ok(qcardBlock, '应能取到 .qcard 规则');
  assert.ok(!/content-visibility\s*:/.test(qcardBlock[0]), '.qcard 不应有 content-visibility 声明');
});
