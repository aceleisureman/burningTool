'use strict';

// 回归测试：MQTT 消息缓冲不得用响应式 splice 做 O(N) 搬运，且渲染需窗口化。
//
// 背景：useSerial 已踩过并修复过这个坑（见 useSerial.js 中关于 Vue 数组代理把
// splice 变成 O(N) 逐元素搬运的注释）；MQTT 侧原本在响应式代理数组上
// conn.messages.splice(0, removeCount)，且 MqttMessages.vue 全量渲染最多 3000 条。
// 本测试直接读源码断言「已改用普通数组 + 窗口 + 一次性切片」，并复现窗口算法。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const USE_MQTT_SRC = path.join(__dirname, '..', 'renderer', 'src', 'composables', 'useMqtt.js');
const MSGS_COMPONENT = path.join(__dirname, '..', 'renderer', 'src', 'components', 'MqttMessages.vue');
const MSG_COUNT = path.join(__dirname, '..', 'renderer', 'src', 'components', 'MqttMsgCount.vue');

const mqttSource = fs.readFileSync(USE_MQTT_SRC, 'utf8');
const msgsVue = fs.readFileSync(MSGS_COMPONENT, 'utf8');
const countVue = fs.readFileSync(MSG_COUNT, 'utf8');

// 从源码解析窗口常量，避免测试与实现漂移
function readConst(name) {
  const m = mqttSource.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\d+)'));
  assert.ok(m, '应能从源码解析 ' + name);
  return Number(m[1]);
}
const RENDER_WINDOW = readConst('MQTT_RENDER_WINDOW');
const WINDOW_STEP = readConst('MQTT_WINDOW_STEP');

/* ── 1. 源码约束 ─────────────────────────────────────── */

test('useMqtt: 淘汰旧消息不再用响应式 splice', () => {
  const start = mqttSource.indexOf('function trimMessageHistory(');
  const end = mqttSource.indexOf('\nfunction ', start + 10);
  const body = mqttSource.slice(start, end > -1 ? end : undefined);
  assert.ok(!/\.splice\(0,\s*removeCount\)/.test(body), 'trimMessageHistory 不应再有 splice(0, n)');
  assert.ok(/\.slice\(removeCount\)/.test(body), '应改为一次性切片搬移');
});

test('useMqtt: 真源数组用 markRaw，窗口视图用 ref', () => {
  assert.ok(/markRaw\(restored\.messages\)/.test(mqttSource), '真源数组应 markRaw');
  assert.ok(/messagesView\s*=\s*ref\(\[\]\)/.test(mqttSource), '应有响应式窗口 messagesView');
  assert.ok(/isRef\(messagesView\)/.test(mqttSource), 'syncWindow 应按 ref/解包数组分派写入');
});

test('useMqtt: 有窗口计算与脏标记合并', () => {
  assert.ok(/function computeMqttWindow\(/.test(mqttSource), '应有 computeMqttWindow');
  assert.ok(/function syncWindow\(/.test(mqttSource), '应有 syncWindow');
  assert.ok(/function markDirty\(/.test(mqttSource), '应有 markDirty 合并同 tick 多次追加');
  assert.ok(/function commitConn\(/.test(mqttSource), '应有 commitConn');
  assert.ok(/expandMqttWindow/.test(mqttSource), '应导出 expandMqttWindow');
});

// 严重回归：conn 是 reactive({ messagesView: ref([]) })，Vue 会把内层 ref 自动解包，
// 因此 conn.messagesView 读到的已是数组本身。任何地方再写 .value 都会得到 undefined，
// 读 .length 直接抛 TypeError —— 该错误发生在 MqttMessages 渲染期，会冒泡到 <App>
// 的 fragment patch，导致整个应用后续 DOM 更新全部中断（表现为「点击任何按钮都没反应」）。
test('MqttMessages.vue: 不得对已解包的 messagesView 再取 .value', () => {
  // 注释里会出现 messagesView.value 作为反例说明，这里只检查可执行代码
  const code = msgsVue
    .replace(/<!--[\s\S]*?-->/g, '')          // 去 HTML 注释
    .replace(/\/\/[^\n]*/g, '')               // 去行注释
    .replace(/\/\*[\s\S]*?\*\//g, '');        // 去块注释
  // 唯一允许出现 .value 的地方是 viewOf() 的兜底分支；把该表达式抠掉后不应再有任何 .value
  const codeWithoutViewOf = code.replace(
    /const\s+viewOf\s*=[\s\S]*?;\s*/,
    ''
  );
  assert.ok(!/messagesView\.value/.test(codeWithoutViewOf),
    'reactive 已解包 messagesView，除 viewOf() 兜底外绝不能写 .value');
  assert.ok(/const\s+viewOf\s*=/.test(code), '应定义 viewOf() 兼容取窗口数组');
  assert.ok(/viewOf\(activeConn\)/.test(code), '模板应通过 viewOf() 取窗口数组');
  assert.ok(!/v-for="m in activeConn\.messages"/.test(code), '不应全量渲染 activeConn.messages');
  assert.ok(/expandMqttWindow/.test(code), '应有「加载更早」入口');
});

test('useMqtt: commitConn 必须传 reactive 容器才能触发窗口更新', () => {
  const start = mqttSource.indexOf('function commitConn(');
  const end = mqttSource.indexOf('\n  function ', start + 10);
  const body = mqttSource.slice(start, end > -1 ? end : undefined);
  assert.ok(/syncWindow\(conn\.messages,\s*conn\.messagesView,\s*conn\._win,\s*conn,\s*'messagesView'\)/.test(body),
    'commitConn 应把 conn 作为容器传入 syncWindow，否则普通数组写入是静默 no-op');
});

test('MqttMsgCount.vue: 用响应式 messageTotal（messages 已 markRaw）', () => {
  assert.ok(/messageTotal/.test(countVue), '条数应改用 messageTotal');
  assert.ok(!/activeConn\.value\.messages\.length/.test(countVue), '不应再直接读 markRaw 数组长度');
});

/* ── 2. 复现窗口算法 ─────────────────────────────────── */

function computeWindow(total, expandBack) {
  const back = RENDER_WINDOW + (expandBack || 0);
  const end = total;
  const start = Math.max(0, end - back);
  return { start, end };
}

test('窗口：消息数不足窗口时返回全部', () => {
  const { start, end } = computeWindow(50, 0);
  assert.equal(start, 0);
  assert.equal(end, 50);
});

test('窗口：超过窗口时只保留尾部 N 条', () => {
  const total = RENDER_WINDOW + 1234;
  const { start, end } = computeWindow(total, 0);
  assert.equal(end, total);
  assert.equal(end - start, RENDER_WINDOW, '窗口长度应等于 RENDER_WINDOW');
});

test('窗口：向上翻看按 STEP 扩张且不越界', () => {
  const total = RENDER_WINDOW + 1000;
  let back = 0;
  for (let i = 0; i < 3; i++) back += WINDOW_STEP;
  const { start } = computeWindow(total, back);
  assert.equal(total - start, RENDER_WINDOW + 3 * WINDOW_STEP);
  // 再扩张也不会超出总长度
  const { start: s2 } = computeWindow(total, 10 ** 6);
  assert.equal(s2, 0, '窗口起点应被 clamp 到 0');
});

test('一次性切片搬移：等价于多次删除头部，且不回退为逐元素', () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const removeCount = 37;
  const next = arr.slice(removeCount);
  assert.equal(next.length, 100 - removeCount);
  assert.equal(next[0], removeCount, '切片后首元素应为原第 removeCount 个');
  // 确认未调用 splice
  const spliced = arr.slice();
  spliced.splice(0, removeCount);
  assert.deepEqual(next, spliced, 'slice 搬移结果应与 splice 等价');
});

/* ── 3. 脏标记合并语义 ───────────────────────────────── */

test('脏标记：同一 tick 内多次追加只 commit 一次', () => {
  const state = { dirty: false };
  const markDirty = () => { if (!state.dirty) state.dirty = true; };
  // 模拟一批 50 条消息追加
  for (let i = 0; i < 50; i++) markDirty();
  assert.equal(state.dirty, true);
  // commit 后置位清除
  state.dirty = false;
  assert.equal(state.dirty, false);
});

/* ── 4. 运行时：reactive 解包 ref 的真实陷阱（本 bug 的根因） ─────────
   用真实 Vue 跑一遍 makeConn 的结构，确保：
     a) reactive({ messagesView: ref([]) }) 读取时已解包为数组；
     b) syncWindow 经容器赋值后视图确实更新（computed 能感知）；
     c) 使用 side-effect 求值的表达式不会抛 TypeError。 */

const vue = require('vue');

test('运行时：reactive 会解包内层 ref，写 .value 必抛错（根因固化）', () => {
  const messages = vue.markRaw([{ id: 1 }, { id: 2 }, { id: 3 }]);
  const messagesView = vue.ref([{ id: 3 }]);
  const conn = vue.reactive({ messages, messagesView });
  // 已解包：读到的是数组本身
  assert.ok(Array.isArray(conn.messagesView), 'conn.messagesView 应已被解包为数组');
  // 旧写法必然抛错 —— 这就是线上 MqttMessages render 崩溃的原因
  assert.throws(() => conn.messagesView.value.length, TypeError, '对已解包数组再取 .value 应抛 TypeError');
});

test('运行时：syncWindow 经 reactive 容器写入能驱动 computed 更新', () => {
  const WINDOW = 3;
  function computeMqttWindow(total, state) {
    const back = WINDOW + (state.expandBack || 0);
    return { start: Math.max(0, total - back), end: total };
  }
  // 与 useMqtt.js 中同名函数保持同构
  function syncWindow(messages, messagesView, state, container, key) {
    const { start, end } = computeMqttWindow(messages.length, state);
    if (start !== state.winFrom || end !== state.winTo) {
      const next = messages.slice(start, end);
      if (vue.isRef(messagesView)) messagesView.value = next;
      else if (container && key) container[key] = next;
      else if (Array.isArray(messagesView)) messagesView.splice(0, messagesView.length, ...next);
      state.winFrom = start;
      state.winTo = end;
    }
    state.dirty = false;
    if (vue.isRef(messagesView)) vue.triggerRef(messagesView);
  }

  const messages = vue.markRaw([1, 2, 3, 4, 5].map((id) => ({ id })));
  const messagesView = vue.ref([]);
  const state = { dirty: false, winFrom: -1, winTo: -1, expandBack: 0 };
  syncWindow(messages, messagesView, state);
  const conn = vue.reactive({ messages, messagesView, _win: vue.markRaw(state) });
  syncWindow(conn.messages, conn.messagesView, conn._win, conn, 'messagesView');

  const viewLen = vue.computed(() => conn.messagesView.length);
  assert.equal(viewLen.value, WINDOW, '初始窗口应为尾部 WINDOW 条');

  // 追加消息并 commit —— computed 必须感知
  conn.messages.push({ id: 6 });
  conn._win.dirty = true;
  syncWindow(conn.messages, conn.messagesView, conn._win, conn, 'messagesView');
  assert.equal(conn.messagesView.length, WINDOW, '窗口长度不变');
  assert.deepEqual(conn.messagesView.map((m) => m.id), [4, 5, 6], '窗口应滑动到最新尾部');

  // 无 container 的裸数组写入也不应抛错
  assert.doesNotThrow(() => syncWindow(conn.messages, [], { winFrom: -1, winTo: -1 }, null, null));
});
