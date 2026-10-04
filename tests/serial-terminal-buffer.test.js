'use strict';

// 串口终端行缓冲回归测试。
//
// 背景：原先 serialLines 是 ref([])，每批数据淘汰旧行时走 splice(0, n)。
// Vue 的数组代理会把 splice 变成 O(N) 逐元素搬运（3000 行时单次约 4-7ms），
// 高波特率下每批都触发一次，直接卡死界面。
// 修复方案：普通数组做缓冲 + 尾部追加 + 渲染窗口切片 + triggerRef 提交。
//
// 本测试直接执行与 useSerial.js 中相同的算法（常量从源码里解析，避免两处漂移），
// 覆盖窗口边界、缓冲淘汰、跟随/锚定切换以及突发吞吐。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'src', 'composables', 'useSerial.js'),
  'utf8'
);

function num(name) {
  const m = src.match(new RegExp(`const ${name} = ([0-9 *]+);`));
  assert.ok(m, `missing constant ${name} in useSerial.js`);
  return Function(`return (${m[1]});`)();
}

const MAX_LINES = num('SERIAL_MAX_HISTORY_LINES');
const TRIM_LINES = num('SERIAL_HISTORY_TRIM_LINES');
const MAX_CHARS = num('SERIAL_MAX_HISTORY_CHARS');
const TRIM_CHARS = num('SERIAL_HISTORY_TRIM_CHARS');
const WINDOW = num('TERM_RENDER_WINDOW');
const STEP = num('TERM_WINDOW_STEP');

// 与 useSerial.js 中 commitLines / trimLineBuffer / computeWindow 等价的纯函数实现
function makeTerminal() {
  let lineBuf = [];
  let chars = 0;
  let seq = 0;
  let dirty = false;
  let followTail = true;
  let anchorId = 0;
  let winFrom = -1;
  let winTo = -1;
  let rendered = [];

  const lineCount = () => lineBuf.length;

  function findIndexById(id) {
    let lo = 0;
    let hi = lineBuf.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineBuf[mid].id < id) lo = mid + 1; else hi = mid - 1;
    }
    return lo;
  }

  function computeWindow() {
    if (followTail) {
      const winEnd = lineBuf.length;
      return { start: Math.max(0, winEnd - WINDOW), end: winEnd };
    }
    const anchorAlive = lineBuf.length > 0
      && anchorId >= lineBuf[0].id
      && anchorId <= lineBuf[lineBuf.length - 1].id;
    if (!anchorAlive) {
      followTail = true;
      const winEnd = lineBuf.length;
      return { start: Math.max(0, winEnd - WINDOW), end: winEnd };
    }
    const i = findIndexById(anchorId);
    let start = Math.max(0, i - Math.floor(WINDOW / 2));
    const end = Math.min(lineBuf.length, start + WINDOW);
    start = Math.max(0, end - WINDOW);
    return { start, end };
  }

  function commitLines() {
    if (!dirty) return;
    dirty = false;
    const { start, end } = computeWindow();
    if (start !== winFrom || end !== winTo) {
      rendered = lineBuf.slice(start, end);
      winFrom = start;
      winTo = end;
    }
  }

  function trimLineBuffer() {
    if (lineBuf.length <= MAX_LINES && chars <= MAX_CHARS) return;
    let drop = 0;
    let c = chars;
    while (lineBuf.length - drop > 1 &&
           (lineBuf.length - drop > TRIM_LINES || c > TRIM_CHARS)) {
      const old = lineBuf[drop++];
      c -= old && old._weight ? old._weight : 0;
    }
    if (!drop) return;
    lineBuf = lineBuf.slice(drop);
    chars = c < 0 ? 0 : c;
  }

  function push(text) {
    const line = { id: ++seq, text, _weight: text.length };
    lineBuf.push(line);
    chars += line._weight;
    dirty = true;
    if (lineBuf.length > MAX_LINES || chars > MAX_CHARS) trimLineBuffer();
  }

  function detachFromTail() {
    if (!followTail) return;
    const first = rendered[0];
    if (!first) return;
    followTail = false;
    anchorId = first.id;
  }

  function followTailNow() {
    followTail = true;
    dirty = true;
    commitLines();
  }

  function expandTermWindow() {
    const { start } = computeWindow();
    if (start <= 0) return false;
    const nextStart = Math.max(0, start - STEP);
    followTail = false;
    anchorId = lineBuf[nextStart].id;
    dirty = true;
    commitLines();
    return true;
  }

  function atStart() {
    if (!lineBuf.length) return true;
    if (followTail) return lineBuf.length <= WINDOW;
    const alive = anchorId >= lineBuf[0].id && anchorId <= lineBuf[lineBuf.length - 1].id;
    if (!alive) return true;
    return computeWindow().start <= 0;
  }

  return {
    push, commitLines, detachFromTail, followTailNow, expandTermWindow, atStart,
    get buffer() { return lineBuf; },
    get rendered() { return rendered; },
    get following() { return followTail; },
    get anchorId() { return anchorId; },
    get lineCount() { return lineCount(); },
  };
}

const ordered = (arr) => arr.every((x, i) => i === 0 || x.id > arr[i - 1].id);

test('渲染窗口只暴露尾部有限行，且末行始终是最新行', () => {
  const t = makeTerminal();
  for (let i = 0; i < 100; i++) t.push('l' + i);
  t.commitLines();
  assert.equal(t.rendered.length, 100, '不足一屏时应全量渲染');

  for (let i = 0; i < 2000; i++) t.push('l' + (100 + i));
  t.commitLines();
  assert.equal(t.rendered.length, WINDOW, `超过一屏后只应渲染 ${WINDOW} 行`);
  assert.equal(t.rendered.at(-1), t.buffer.at(-1), '窗口末行必须是缓冲最新行');
  assert.ok(ordered(t.rendered), '窗口内行必须按 id 递增有序');
});

test('缓冲淘汰旧行后窗口仍贴住末尾，且不超上限', () => {
  const t = makeTerminal();
  for (let i = 0; i < 8000; i++) t.push('l' + i);
  t.commitLines();
  assert.ok(t.buffer.length <= MAX_LINES, '缓冲行数不得超过上限');
  assert.equal(t.rendered.length, WINDOW, '淘汰后窗口仍应保持满窗口');
  assert.equal(t.rendered.at(-1), t.buffer.at(-1), '淘汰后窗口末行仍是缓冲末行');
  assert.ok(ordered(t.rendered), '淘汰后窗口仍须有序');
});

test('脱离跟随：上滑看历史时新数据不会拽动视野', () => {
  const t = makeTerminal();
  for (let i = 0; i < 4000; i++) t.push('l' + i);
  t.commitLines();

  // 上翻一次，锚点落在缓冲中段（远离尾部，短时间内不会被淘汰）
  assert.equal(t.expandTermWindow(), true);
  assert.equal(t.following, false, '上翻后应脱离跟随');
  const anchor = t.anchorId;
  const anchorIdx = t.buffer.findIndex((x) => x.id === anchor);
  assert.ok(anchorIdx > 100 && t.buffer.length - anchorIdx > 100, '锚点应在缓冲中段');

  for (let i = 0; i < 300; i++) t.push('l' + (4000 + i));
  t.commitLines();
  assert.ok(t.rendered.some((x) => x.id === anchor), '收新数据后锚点行仍应可见');
  assert.notEqual(t.rendered.at(-1), t.buffer.at(-1), '脱离跟随时窗口不应贴尾');
  assert.ok(ordered(t.rendered), '脱离跟随时窗口仍须有序');

  // 继续上翻应仍然有效（锚点尚未到达缓冲起点）
  assert.equal(t.expandTermWindow(), true, '锚点未到起点时应能继续上翻');
});

test('恢复跟随：回到最新后窗口贴尾并持续跟随', () => {
  const t = makeTerminal();
  for (let i = 0; i < 4000; i++) t.push('l' + i);
  t.commitLines();
  for (let i = 0; i < 3; i++) t.expandTermWindow();
  assert.equal(t.following, false);

  t.followTailNow();
  assert.equal(t.following, true, '回到最新后应恢复跟随');
  assert.equal(t.rendered.at(-1), t.buffer.at(-1), '恢复跟随后窗口应贴尾');
  assert.ok(ordered(t.rendered));

  for (let i = 0; i < 2000; i++) t.push('l' + (4000 + i));
  t.commitLines();
  assert.equal(t.rendered.at(-1), t.buffer.at(-1), '跟随状态下持续收数应始终贴尾');
});

test('锚点被淘汰后自动恢复跟随，不会卡在过期位置', () => {
  const t = makeTerminal();
  for (let i = 0; i < 3000; i++) t.push('l' + i);
  t.commitLines();

  let steps = 0;
  while (t.expandTermWindow() && steps < 200) steps++;
  assert.equal(t.rendered[0], t.buffer[0], '应能一路回补到缓冲起点');
  assert.equal(t.expandTermWindow(), false, '到达起点后不再回补');
  assert.equal(t.atStart(), true, '到达起点时应报告 atStart');

  // 推入远超缓冲容量的数据，使旧锚点被淘汰
  for (let i = 0; i < 30000; i++) t.push('l' + (3000 + i));
  t.commitLines();
  assert.equal(t.following, true, '锚点淘汰后应自动恢复跟随');
  assert.equal(t.rendered.at(-1), t.buffer.at(-1), '恢复跟随后窗口应贴尾');
  assert.ok(ordered(t.rendered));
});

test('超长行按字符上限淘汰，不撑爆内存', () => {
  const t = makeTerminal();
  for (let i = 0; i < 40; i++) {
    t.push('A'.repeat(200 * 1024));
    t.commitLines();
  }
  assert.ok(t.buffer.length < 40, '超长行应按字符上限淘汰');
});

test('突发吞吐：5 万行 < 500ms（原 splice 实现会到秒级）', () => {
  const t = makeTerminal();
  const t0 = process.hrtime.bigint();
  for (let batch = 0; batch < 400; batch++) {
    for (let i = 0; i < 130; i++) t.push('x'.repeat(45));
    t.commitLines();
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 500, `5.2 万行耗时 ${ms.toFixed(1)}ms，应低于 500ms`);
});

test('实现不再对响应式数组做 splice 淘汰', () => {
  assert.doesNotMatch(src, /serialLines\.value\.splice\(/, '不应再在响应式数组上 splice 淘汰');
  assert.doesNotMatch(src, /serialLines\.value\.push\(/, '追加应走普通数组缓冲');
  assert.match(src, /triggerRef\(serialLines\)/, '应通过 triggerRef 显式提交更新');
  assert.match(src, /let lineBuf = \[\];/, 'lineBuf 应为普通数组（非响应式）');
});
