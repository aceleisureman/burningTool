import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount, triggerRef } from 'vue';
import { portMainLabel, portSubLabel, cmdDelayMs, bytesToHex, hexToBytes, copyText } from '../util.js';
import { useCommandHistory } from './useCommandHistory.js';

const SERIAL_MAX_WRITE_BYTES = 1024 * 1024;
const SERIAL_MAX_HEX_INPUT_CHARS = SERIAL_MAX_WRITE_BYTES * 8;
const SERIAL_MAX_RX_BUFFER_CHARS = 256 * 1024;
const SERIAL_MAX_LINE_CHARS = 256 * 1024;
const SERIAL_MAX_HEX_DISPLAY_BYTES = Math.floor((SERIAL_MAX_LINE_CHARS + 1) / 3);
const SERIAL_MAX_HISTORY_CHARS = 4 * 1024 * 1024;
const SERIAL_HISTORY_TRIM_CHARS = 3 * 1024 * 1024;
const SERIAL_MAX_HISTORY_LINES = 3000;
const SERIAL_HISTORY_TRIM_LINES = 2200;
// 终端最多同时挂到 DOM 上的行数。历史上限（3000）远大于屏幕容量，
// 全量渲染会让每批数据触发数千节点的 diff——只渲染尾部窗口，滚动到顶部时再按需回补。
const TERM_RENDER_WINDOW = 600;
const TERM_WINDOW_STEP = 400;

const QUICK_COMMAND_JSON_EXAMPLE = `{
  "schema": "mcu-toolbox.serial-commands",
  "version": 1,
  "mode": "append",
  "groups": [
    {
      "name": "基础指令",
      "cmds": [
      {
        "enabled": true,
        "name": "查询版本",
        "content": "AT+GMR",
        "hex": false,
        "interval": 1000,
        "unit": "ms"
      },
      {
        "enabled": false,
        "name": "二进制握手",
        "content": "AA 55 01 00 FE",
        "hex": true,
        "interval": 2,
        "unit": "s"
      }
      ]
    }
  ]
}`;

const QUICK_COMMAND_FORMAT_FIELDS = [
  { scope: '文件', name: 'schema', type: 'string', required: '是', note: '固定为 mcu-toolbox.serial-commands' },
  { scope: '文件', name: 'version', type: 'number', required: '是', note: '当前版本为 1' },
  { scope: '文件', name: 'mode', type: 'string', required: '否', note: '固定为 append；导入始终保留本地数据' },
  { scope: '文件', name: 'groups', type: 'array', required: '是', note: '需要追加的分组数组' },
  { scope: '分组', name: 'name', type: 'string', required: '是', note: '分组显示名称' },
  { scope: '分组', name: 'cmds', type: 'array', required: '是', note: '快捷指令数组' },
  { scope: '指令', name: 'name', type: 'string', required: '是', note: '指令名称或备注' },
  { scope: '指令', name: 'content', type: 'string', required: '是', note: '文本发送自动追加 CRLF；HEX 填字节' },
  { scope: '指令', name: 'enabled', type: 'boolean', required: '否', note: '是否加入循环发送，默认 false' },
  { scope: '指令', name: 'hex', type: 'boolean', required: '否', note: 'true 按 HEX 解析，默认 false' },
  { scope: '指令', name: 'interval', type: 'number', required: '否', note: '循环间隔数值，默认 1000' },
  { scope: '指令', name: 'unit', type: 'string', required: '否', note: '间隔单位：ms、s 或 min' }
];

const QUICK_COMMAND_AI_PROMPT = `请为“MCU 工具箱”的串口快捷指令生成 JSON。
只输出合法 JSON，不要使用 Markdown 代码块，不要添加解释文字。

格式要求：
1. 顶层必须包含 schema、version、mode 和 groups。
2. schema 固定为 "mcu-toolbox.serial-commands"，version 固定为 1，mode 固定为 "append"。
3. groups 是分组数组，每个分组包含 name 和 cmds。
4. 每条指令包含 name、content，可选 enabled、hex、interval、unit。
5. hex=false 时 content 填文本；程序发送时会自动追加 CRLF。
6. hex=true 时 content 只填写十六进制字节，例如 "AA 55 01 00 FE"。
7. unit 只能是 "ms"、"s" 或 "min"。
8. 不要生成 id 字段；导入只追加，不覆盖已有分组。

参考结构：
${QUICK_COMMAND_JSON_EXAMPLE}

请根据以下设备或协议需求生成：
`;

// 串口调试（serialport 后端）：枚举/连接/收发 + 快捷指令分组 + 循环发送
export function useSerial() {
  const serialSupported = ref(true);     // 由 serialList 在挂载时探测后端是否可用
  const serialErrMsg = ref('');
  const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1500000];
  const serial = reactive({
    baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1,
    connected: false, connecting: false, portPath: '', portLabel: '', portSub: '',
    autoReconnect: false, reconnecting: false, reconnectAttempt: 0, reconnectWait: 0,
    rxHex: false, txHex: false, autoScroll: true, timestamp: true,
    sendText: '', appendNewline: true, tx: 0, rx: 0
  });
  // ── 终端行缓冲 ──
  // 性能要点：行对象只写入不再修改，且渲染层只读，因此用一个普通数组做缓冲区，
  // 通过 triggerRef 决定何时提交给 Vue。若直接用 ref([]) + splice(0, n) 淘汰旧行，
  // Vue 的数组代理会把 splice 变成 O(N) 逐元素搬运（实测 3000 行时单次约 4-7ms），
  // 高波特率下每批数据都触发一次，直接卡死界面。这里改为「尾部追加 + 窗口切片」，
  // 每批只提交一次更新，且既有行对象引用不变，v-for 的 diff 只需处理新增行。
  const serialLines = ref([]);
  let lineBuf = [];                           // 原始（未代理）数组，作为唯一真源
  let serialLineChars = 0;
  let serialSeq = 0;
  let lineDirty = false;                      // 已写入 lineBuf 但尚未提交给渲染层
  // 两种状态：follow=true 时窗口贴着末尾（正常收数）；follow=false 时窗口锚定在
  // anchorId 这一行（用户上滑在看历史），此时新数据不会把用户视野往前拽。
  let followTail = true;
  let anchorId = 0;
  let winFrom = -1;                           // 上一帧渲染段的起止（buffer 内下标），用于跳过无谓重建
  let winTo = -1;
  const termWindowAtStart = ref(true);
  const termLineTotal = ref(0);
  const termFollowing = ref(true);
  function findIndexById(id) {
    // 锚点在淘汰后可能已不存在；二分即可（id 单调递增）
    let lo = 0, hi = lineBuf.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineBuf[mid].id < id) lo = mid + 1; else hi = mid - 1;
    }
    return lo;
  }
  function computeWindow() {
    if (followTail) {
      const winEnd = lineBuf.length;
      return { start: Math.max(0, winEnd - TERM_RENDER_WINDOW), end: winEnd };
    }
    // 锚点在淘汰后可能已不存在：先判断是否落在当前缓冲区间内，否则恢复跟随
    const anchorAlive = lineBuf.length > 0 && anchorId >= lineBuf[0].id && anchorId <= lineBuf[lineBuf.length - 1].id;
    if (!anchorAlive) {
      followTail = true;
      const winEnd = lineBuf.length;
      return { start: Math.max(0, winEnd - TERM_RENDER_WINDOW), end: winEnd };
    }
    // 锚定模式：让 anchorId 那一行落在窗口上部，便于向下阅读
    const i = findIndexById(anchorId);
    let start = Math.max(0, i - Math.floor(TERM_RENDER_WINDOW / 2));
    const end = Math.min(lineBuf.length, start + TERM_RENDER_WINDOW);
    start = Math.max(0, end - TERM_RENDER_WINDOW);
    return { start, end };
  }
  function commitLines() {
    if (!lineDirty) return;
    lineDirty = false;
    const { start, end } = computeWindow();
    if (start !== winFrom || end !== winTo) {
      serialLines.value = lineBuf.slice(start, end);
      winFrom = start;
      winTo = end;
    }
    termWindowAtStart.value = start === 0;
    termLineTotal.value = lineBuf.length;
    termFollowing.value = followTail;
    triggerRef(serialLines);                  // ref.value 可能未变，显式提交一次更新
  }
  function trimLineBuffer() {
    if (lineBuf.length <= SERIAL_MAX_HISTORY_LINES && serialLineChars <= SERIAL_MAX_HISTORY_CHARS) return;
    let drop = 0;
    let chars = serialLineChars;
    while (lineBuf.length - drop > 1 &&
           (lineBuf.length - drop > SERIAL_HISTORY_TRIM_LINES || chars > SERIAL_HISTORY_TRIM_CHARS)) {
      const old = lineBuf[drop++];
      chars -= old && old._weight ? old._weight : 0;
    }
    if (!drop) return;
    lineBuf = lineBuf.slice(drop);            // 一次性搬移，不在代理上做 shift
    serialLineChars = chars < 0 ? 0 : chars;
  }
  // 用户上滑离开末尾：把窗口锚定到当前可见的行，之后不再跟随新数据
  function detachFromTail() {
    if (!followTail) return;
    const first = serialLines.value[0];
    if (!first) return;
    followTail = false;
    anchorId = first.id;
    termFollowing.value = false;
  }
  // 用户滑回末尾：恢复跟随，窗口贴回最新数据
  function followTailNow() {
    if (followTail) { lineDirty = true; commitLines(); return; }
    followTail = true;
    lineDirty = true;
    commitLines();
  }
  // 向上翻看更早的记录：锚点前移一段
  function expandTermWindow() {
    const { start } = computeWindow();
    if (start <= 0) return false;
    const nextStart = Math.max(0, start - TERM_WINDOW_STEP);
    followTail = false;
    anchorId = lineBuf[nextStart].id;
    lineDirty = true;
    commitLines();
    return true;
  }
  const { items: sendHistory, record: recordSendHistory, clear: clearSendHistory } = useCommandHistory(30);
  let rxTextBuffer = '';
  let rxFlushTimer = null;
  let rxDecoder = new TextDecoder();
  let reconnectTimer = null;
  let reconnectEpoch = 0;
  let reconnectAttempts = 0;
  let manualDisconnect = false;
  const reconnectDelays = [1000, 2000, 4000, 8000];
  const termBox = ref(null);
  const portChooser = reactive({ visible: false, list: [], loading: false });
  const quickFormatVisible = ref(false);
  const quickFormatTab = ref('fields');
  const serialReconnectStatus = computed(() => {
    if (serial.reconnecting) {
      return serial.reconnectWait
        ? `第 ${serial.reconnectAttempt} 次 · ${serial.reconnectWait} 秒后重试`
        : `第 ${serial.reconnectAttempt} 次 · 正在连接`;
    }
    if (serial.autoReconnect) return serial.connected ? '已启用' : '等待连接';
    return '未启用';
  });

  function normCmd(c) {
    c = c || {};
    return { id: ++serialSeq, enabled: !!c.enabled, name: c.name || '', content: c.content || '',
             hex: !!c.hex, interval: Number(c.interval) || 1000, unit: c.unit || 'ms' };
  }
  // ── 快捷指令分组（多个选项卡，按组持久化）──
  let groupSeq = 0;
  function normGroup(g) {
    g = g || {};
    const cmds = Array.isArray(g.cmds) ? g.cmds : [];
    return { id: ++groupSeq, name: g.name || '分组', cmds: cmds.map(normCmd) };
  }
  const cmdGroups = ref([
    normGroup({ name: '默认', cmds: [
      normCmd({ enabled: true,  name: '握手', content: 'AT' }),
      normCmd({ enabled: false, name: '版本', content: 'AT+GMR' })
    ] })
  ]);
  const activeGid = ref(cmdGroups.value[0].id);
  const activeGroup = computed(() => cmdGroups.value.find((g) => g.id === activeGid.value) || cmdGroups.value[0]);
  const quickCmds = computed(() => (activeGroup.value ? activeGroup.value.cmds : []));
  const looping = ref(false);
  let loopStop = false;
  let loopSleepTimer = null;
  let wakeLoopSleep = null;

  function stopLooping() {
    looping.value = false;
    loopStop = true;
    if (wakeLoopSleep) wakeLoopSleep();
  }

  function cancelReconnect(closeOpening = false) {
    const wasOpening = serial.reconnecting && serial.connecting;
    reconnectEpoch++;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempts = 0;
    serial.reconnecting = false;
    serial.reconnectAttempt = 0;
    serial.reconnectWait = 0;
    if (closeOpening && wasOpening) window.api.serialClose().catch(() => {});
  }

  function setAutoReconnect(enabled) {
    serial.autoReconnect = enabled === true;
    if (!serial.autoReconnect) cancelReconnect(true);
    window.api.saveConfig({ serialAutoReconnect: serial.autoReconnect }).catch(() => {});
  }

  function openQuickFormat() {
    quickFormatTab.value = 'fields';
    quickFormatVisible.value = true;
  }

  async function copyQuickCommandExample() {
    try { await copyText(QUICK_COMMAND_JSON_EXAMPLE); ElMessage.success('JSON 示例已复制'); }
    catch { ElMessage.error('复制失败'); }
  }

  async function copyQuickCommandAiPrompt() {
    try { await copyText(QUICK_COMMAND_AI_PROMPT); ElMessage.success('AI 提示词已复制'); }
    catch { ElMessage.error('复制失败'); }
  }

  function waitLoopDelay(ms) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(loopSleepTimer);
        loopSleepTimer = null;
        wakeLoopSleep = null;
        resolve();
      };
      wakeLoopSleep = finish;
      loopSleepTimer = setTimeout(finish, Math.max(0, ms | 0));
    });
  }

  function switchGroup(id) { if (looping.value) stopLooping(); activeGid.value = id; }
  function addGroup() {
    const g = normGroup({ name: '分组' + (cmdGroups.value.length + 1), cmds: [] });
    cmdGroups.value.push(g); activeGid.value = g.id;
  }
  // 分组重命名：单击选中、双击或点笔图标就地编辑
  const editingGid = ref(null);
  const editName = ref('');
  function startRename(g) {
    activeGid.value = g.id; editingGid.value = g.id; editName.value = g.name;
    nextTick(() => { const el = document.getElementById('qgedit-' + g.id); if (el) { el.focus(); el.select(); } });
  }
  function commitRename(g) {
    if (editingGid.value !== g.id) return;
    const v = (editName.value || '').trim();
    if (v) g.name = v;
    editingGid.value = null;
  }
  function cancelRename() { editingGid.value = null; }
  async function delGroup(g) {
    if (cmdGroups.value.length <= 1) { ElMessage.warning('至少保留一个分组'); return; }
    try {
      await ElMessageBox.confirm(`删除分组「${g.name}」及其 ${g.cmds.length} 条指令？`, '删除分组', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
      const i = cmdGroups.value.findIndex((x) => x.id === g.id);
      if (i >= 0) cmdGroups.value.splice(i, 1);
      if (activeGid.value === g.id) activeGid.value = cmdGroups.value[0].id;
    } catch (_e) {}
  }

  // 持久化到 config.json（防抖）
  let qcSaveT = null;
  let stopQuickCmdWatch = null;
  function plainGroups() { return cmdGroups.value.map((g) => ({ name: g.name, cmds: g.cmds.map((q) => ({ enabled: q.enabled, name: q.name, content: q.content, hex: q.hex, interval: q.interval, unit: q.unit })) })); }
  function saveQuickCmdsNow() {
    qcSaveT = null;
    window.api.saveConfig({ serialCmdGroups: plainGroups() }).catch(() => {});
  }
  function persistQuickCmds() { clearTimeout(qcSaveT); qcSaveT = setTimeout(saveQuickCmdsNow, 400); }
  async function exportQuickCmds() {
    const payload = { schema: 'mcu-toolbox.serial-commands', version: 1, mode: 'append', groups: plainGroups() };
    try { const r = await window.api.exportQuickCmds(payload); if (r && r.ok) ElMessage.success('已导出: ' + r.path); else if (r && r.error) ElMessage.error('导出失败: ' + r.error); }
    catch (_e) { ElMessage.error('导出失败'); }
  }
  async function importQuickCmds() {
    try {
      const r = await window.api.importQuickCmds();
      if (!r || !r.ok) { if (r && r.error) ElMessage.error('导入失败: ' + r.error); return; }
      const d = r.data;
      let groups = null;
      if (d && d.schema === 'mcu-toolbox.serial-commands' && d.version === 1 && Array.isArray(d.groups)) groups = d.groups;
      else if (Array.isArray(d) && d.length && d[0] && Array.isArray(d[0].cmds)) groups = d;      // 旧版分组数组
      else if (d && Array.isArray(d.serialCmdGroups)) groups = d.serialCmdGroups;                  // {serialCmdGroups:[...]}
      else if (Array.isArray(d)) groups = [{ name: '导入', cmds: d }];                             // 旧版扁平指令数组
      else if (d && Array.isArray(d.serialQuickCmds)) groups = [{ name: '导入', cmds: d.serialQuickCmds }];
      if (!groups) { ElMessage.error('文件格式不对，请按 JSON 格式说明生成'); openQuickFormat(); return; }
      const imported = groups.map(normGroup);
      const usedNames = new Set(cmdGroups.value.map((g) => g.name));
      for (const group of imported) {
        const originalName = group.name;
        if (usedNames.has(group.name)) {
          let suffix = 1;
          do {
            group.name = `${originalName} (导入${suffix > 1 ? ` ${suffix}` : ''})`;
            suffix += 1;
          } while (usedNames.has(group.name));
        }
        usedNames.add(group.name);
      }
      cmdGroups.value.push(...imported);
      if (imported.length) activeGid.value = imported[0].id;
      await window.api.saveConfig({ serialCmdGroups: plainGroups() });
      ElMessage.success('已追加导入 ' + imported.length + ' 个分组，原有指令已保留');
    } catch (_e) { ElMessage.error('导入失败'); }
  }

  function serialNow() {
    const d = new Date();
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  }
  function serialLineMeta(dir, text) {
    const raw = String(text || '');
    const t = raw.trim();
    const meta = {
      level: dir === 'sys' ? 'sys' : dir,
      badge: dir === 'rx' ? 'RX>' : dir === 'tx' ? 'TX>' : 'SYS>',
      continuation: /^\s+/.test(raw)
    };
    if (dir === 'rx') {
      if (/traceback|exception|error|failed|valueerror|err[_\b-]?/i.test(t)) {
        meta.level = 'error';
        meta.badge = 'RX>';
      } else if (/^(file\s+|line\s+\d+|at\s+)|^\^/i.test(t)) {
        meta.level = 'trace';
      }
    }
    return meta;
  }
  function pushTermLine(dir, text) {
    // 行对象写入后字段不再变化，直接进普通数组缓冲；提交由 commitLines 统一做
    const raw = String(text ?? '');
    const clipped = raw.length > SERIAL_MAX_LINE_CHARS ? raw.slice(0, SERIAL_MAX_LINE_CHARS) + '\n… [显示内容已截断]' : raw;
    const line = { id: ++serialSeq, dir, text: clipped, ts: serialNow(), _weight: clipped.length,
                   ...serialLineMeta(dir, clipped) };
    lineBuf.push(line);
    serialLineChars += line._weight;
    lineDirty = true;
    if (lineBuf.length > SERIAL_MAX_HISTORY_LINES || serialLineChars > SERIAL_MAX_HISTORY_CHARS) trimLineBuffer();
  }
  function addTerm(dir, text) {
    // 系统/发送消息一次性多行时也只滚动一次
    String(text ?? '').replace(/\r/g, '').split('\n').forEach((line) => pushTermLine(dir, line));
    scheduleTermScroll();
  }
  function flushRxBuffer() {
    if (!rxTextBuffer) return;
    pushTermLine('rx', rxTextBuffer);
    rxTextBuffer = '';
    scheduleTermScroll();
  }
  // 主进程已 30ms 攒批，渲染端把「提交行缓冲 + 滚动」合并到同一帧：
  // 同一帧内多次 addRx/pushTermLine 只触发一次 Vue 更新、一次 scrollTop 写入。
  let scrollPending = false;
  function scheduleTermScroll() {
    if (scrollPending) return;
    scrollPending = true;
    nextTick(() => {
      scrollPending = false;
      commitLines();                        // 唯一提交点：每帧最多一次
      const el = termBox.value;
      // 用户上滑查看历史时（followTail=false）不得把视野拽回底部
      if (el && serial.autoScroll && followTail) el.scrollTop = el.scrollHeight;
    });
  }
  function addRxText(text) {
    clearTimeout(rxFlushTimer);
    rxTextBuffer += String(text || '').replace(/\r/g, '');
    while (rxTextBuffer.length > SERIAL_MAX_RX_BUFFER_CHARS) {
      pushTermLine('rx', rxTextBuffer.slice(0, SERIAL_MAX_RX_BUFFER_CHARS));
      rxTextBuffer = rxTextBuffer.slice(SERIAL_MAX_RX_BUFFER_CHARS);
    }
    const parts = rxTextBuffer.split('\n');
    rxTextBuffer = parts.pop() || '';
    for (const line of parts) pushTermLine('rx', line);
    rxFlushTimer = setTimeout(flushRxBuffer, 120);
    scheduleTermScroll();
  }
  function resetRxTextState() {
    rxTextBuffer = '';
    clearTimeout(rxFlushTimer);
    rxFlushTimer = null;
    rxDecoder = new TextDecoder();
  }
  function clearTerm() {
    lineBuf = [];
    serialLineChars = 0;
    followTail = true;
    anchorId = 0;
    winFrom = -1;
    winTo = -1;
    lineDirty = false;
    serialLines.value = [];
    termWindowAtStart.value = true;
    termLineTotal.value = 0;
    termFollowing.value = true;
    triggerRef(serialLines);
    serial.tx = 0;
    serial.rx = 0;
    resetRxTextState();
  }
  async function copyTerm() {
    // 复制走完整缓冲，不受渲染窗口限制
    const text = lineBuf.map((l) => `[${l.ts}] ${l.badge || l.dir.toUpperCase() + '>'} ${l.text}`).join('\n');
    try { await copyText(text); ElMessage.success('已复制'); } catch { ElMessage.error('复制失败'); }
  }

  // 选择串口：主进程枚举所有 COM 口 → 弹出列表（含芯片识别）
  async function refreshPorts() {
    portChooser.loading = true;
    try {
      const r = await window.api.serialList();
      if (!r || !r.ok) {
        portChooser.list = [];
        if (r && /未安装|重建/.test(r.error || '')) { serialSupported.value = false; serialErrMsg.value = r.error; }
        addTerm('sys', '枚举串口失败: ' + ((r && r.error) || '未知错误'));
        ElMessage.error('枚举串口失败');
      } else {
        serialSupported.value = true; serialErrMsg.value = '';
        portChooser.list = r.ports || [];
      }
    } catch (e) { addTerm('sys', '枚举串口异常: ' + (e.message || e)); }
    finally { portChooser.loading = false; }
  }
  async function selectPort() {
    cancelReconnect(true);
    addTerm('sys', '正在枚举系统串口…');
    await refreshPorts();
    portChooser.visible = true;
    if (!portChooser.list.length) addTerm('sys', '未检测到任何 COM 串口：请插好 USB 转串口设备并装好驱动（PWLink2 / ST-Link 调试探针不是串口，不会出现在列表里）');
    else addTerm('sys', '检测到 ' + portChooser.list.length + ' 个串口');
  }
  async function openSerial(isReconnect, epoch) {
    if (serial.connecting) return false;
    if (!serial.portPath) { ElMessage.warning('请先选择串口'); selectPort(); return; }
    serial.connecting = true;
    try {
      const r = await window.api.serialOpen({
        path: serial.portPath, baudRate: Number(serial.baudRate),
        dataBits: Number(serial.dataBits), stopBits: Number(serial.stopBits), parity: serial.parity
      });
      if (!r || !r.ok) throw new Error((r && r.error) || '打开失败');
      if (epoch !== reconnectEpoch) return false;
      serial.connected = true;
      serial.reconnecting = false;
      serial.reconnectAttempt = 0;
      serial.reconnectWait = 0;
      reconnectAttempts = 0;
      addTerm('sys', `${isReconnect ? '已自动重连' : '已连接'} ${serial.portPath} · ${serial.baudRate} ${serial.dataBits}${serial.parity[0].toUpperCase()}${serial.stopBits}`);
      return true;
    } catch (e) {
      addTerm('sys', (isReconnect ? '自动重连失败: ' : '连接失败: ') + (e.message || e));
      if (!isReconnect) ElMessage.error('连接失败: ' + (e.message || e));
      return false;
    } finally {
      serial.connecting = false;
    }
  }

  function scheduleReconnect() {
    if (!serial.autoReconnect || manualDisconnect || serial.connected || serial.connecting || reconnectTimer || !serial.portPath) return;
    const epoch = reconnectEpoch;
    const delay = reconnectDelays[Math.min(reconnectAttempts, reconnectDelays.length - 1)];
    serial.reconnecting = true;
    serial.reconnectAttempt = reconnectAttempts + 1;
    serial.reconnectWait = Math.ceil(delay / 1000);
    addTerm('sys', `将在 ${serial.reconnectWait} 秒后进行第 ${serial.reconnectAttempt} 次自动重连`);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (epoch !== reconnectEpoch || !serial.autoReconnect || manualDisconnect) return;
      serial.reconnectWait = 0;
      reconnectAttempts++;
      const ok = await openSerial(true, epoch);
      if (!ok && epoch === reconnectEpoch && serial.autoReconnect && !manualDisconnect) scheduleReconnect();
    }, delay);
  }

  async function serialConnect() {
    const keepRetrying = serial.reconnecting && serial.autoReconnect;
    cancelReconnect(true);
    const epoch = reconnectEpoch;
    if (keepRetrying) {
      serial.reconnecting = true;
      serial.reconnectAttempt = 1;
      reconnectAttempts = 1;
    }
    const ok = await openSerial(keepRetrying, epoch);
    if (!ok && keepRetrying && epoch === reconnectEpoch && serial.autoReconnect) scheduleReconnect();
    return ok;
  }
  async function serialDisconnect() {
    manualDisconnect = true;
    cancelReconnect(false);
    stopLooping();
    try { await window.api.serialClose(); } catch {}
    serial.connected = false;
    resetRxTextState();
    addTerm('sys', '已断开连接');
    manualDisconnect = false;
  }
  async function writeBytes(u8) {
    if (!u8 || u8.byteLength > SERIAL_MAX_WRITE_BYTES) throw new Error(`单次写入不能超过 ${SERIAL_MAX_WRITE_BYTES} 字节`);
    const r = await window.api.serialWrite(u8);
    if (!r || !r.ok) throw new Error((r && r.error) || '写入失败');
  }
  // 回车发送，Shift+Enter 换行
  function onSendKey(e) {
    if (e.shiftKey || e.isComposing) return;   // Shift+Enter 换行；输入法组合中不触发
    e.preventDefault();
    serialSend();
  }
  async function serialSend() {
    if (!serial.connected) return;
    const raw = serial.sendText;
    if (!raw) return;
    try {
      let bytes;
      let shown;
      if (serial.txHex) {
        if (raw.length > SERIAL_MAX_HEX_INPUT_CHARS) throw new Error('HEX 输入过长');
        bytes = hexToBytes(raw);
        const displayBytes = bytes.length > SERIAL_MAX_HEX_DISPLAY_BYTES ? bytes.subarray(0, SERIAL_MAX_HEX_DISPLAY_BYTES) : bytes;
        shown = bytesToHex(displayBytes) + (displayBytes.length < bytes.length ? '\n… [显示内容已截断]' : '');
      }
      else {
        if (raw.length > SERIAL_MAX_WRITE_BYTES) throw new Error(`单次写入不能超过 ${SERIAL_MAX_WRITE_BYTES} 字节`);
        let s = raw; if (serial.appendNewline) s += '\r\n'; bytes = new TextEncoder().encode(s); shown = raw;
      }
      await writeBytes(bytes);
      addTerm('tx', shown); serial.tx += bytes.length; recordSendHistory(raw, serial.txHex);
    } catch (e) { addTerm('sys', '发送失败: ' + (e.message || e)); ElMessage.error(e.message || '发送失败'); }
  }
  async function sendQuickCmd(q) {
    if (!serial.connected || !q.content) return;
    try {
      let bytes;
      let shown;
      if (q.hex) {
        if (String(q.content || '').length > SERIAL_MAX_HEX_INPUT_CHARS) throw new Error('HEX 输入过长');
        bytes = hexToBytes(q.content);
        const displayBytes = bytes.length > SERIAL_MAX_HEX_DISPLAY_BYTES ? bytes.subarray(0, SERIAL_MAX_HEX_DISPLAY_BYTES) : bytes;
        shown = bytesToHex(displayBytes) + (displayBytes.length < bytes.length ? '\n… [显示内容已截断]' : '');
      }
      else {
        if (String(q.content).length > SERIAL_MAX_WRITE_BYTES) throw new Error(`单次写入不能超过 ${SERIAL_MAX_WRITE_BYTES} 字节`);
        bytes = new TextEncoder().encode(q.content + '\r\n'); shown = q.content;
      }
      await writeBytes(bytes); addTerm('tx', shown); serial.tx += bytes.length;
    } catch (e) { addTerm('sys', '发送失败: ' + (e.message || e)); }
  }
  function addQuickCmd() { quickCmds.value.push(normCmd({})); }
  function delQuickCmd(i) { quickCmds.value.splice(i, 1); }
  async function toggleLoop() {
    if (looping.value) { stopLooping(); return; }
    const enabled = quickCmds.value.filter((q) => q.enabled && q.content);
    if (!enabled.length) { ElMessage.warning('请先勾选要循环发送的指令'); return; }
    looping.value = true; loopStop = false;
    addTerm('sys', `开始循环发送 ${enabled.length} 条指令`);
    while (!loopStop && serial.connected) {
      for (const q of quickCmds.value) {
        if (loopStop || !serial.connected) break;
        if (!q.enabled || !q.content) continue;
        await sendQuickCmd(q);
        if (loopStop || !serial.connected) break;
        await waitLoopDelay(cmdDelayMs(q) || 1000);
      }
    }
    looping.value = false;
    addTerm('sys', '已停止循环发送');
  }
  function pickPort(p) {
    if (!p || !p.path) return;
    cancelReconnect(true);
    serial.portPath = p.path;
    serial.portLabel = portMainLabel(p);
    serial.portSub = portSubLabel(p);
    portChooser.visible = false;
    addTerm('sys', '已选择串口: ' + serial.portPath + (serial.portSub ? '（' + serial.portSub + '）' : ''));
  }
  function cancelPortChoose() { portChooser.visible = false; }

  // 由 loadConfig 在读取配置后调用：恢复快捷指令分组并开启持久化
  function initFromConfig(cfg) {
    serial.autoReconnect = cfg.serialAutoReconnect === true;
    if (Array.isArray(cfg.serialCmdGroups) && cfg.serialCmdGroups.length) cmdGroups.value = cfg.serialCmdGroups.map(normGroup);
    else if (Array.isArray(cfg.serialQuickCmds) && cfg.serialQuickCmds.length) cmdGroups.value = [normGroup({ name: '默认', cmds: cfg.serialQuickCmds })];
    activeGid.value = cmdGroups.value[0].id;
    if (typeof stopQuickCmdWatch === 'function') stopQuickCmdWatch();
    stopQuickCmdWatch = watch(cmdGroups, persistQuickCmds, { deep: true });
  }

  const serialEventOffs = [];
  onMounted(() => {
    // 串口数据/关闭/错误（serialport 后端推送，主进程已按 30ms 攒批合并）
    const offData = window.api.onSerialData((arr) => {
      const u8 = arr instanceof Uint8Array ? arr : Uint8Array.from(arr || []);
      if (!u8.length) return;
      serial.rx += u8.length;
      if (serial.rxHex) addTerm('rx', bytesToHex(u8));
      else addRxText(rxDecoder.decode(u8, { stream: true }));
    });
    const offClosed = window.api.onSerialClosed(() => {
      const wasActive = serial.connected || serial.connecting;
      serial.connected = false;
      serial.connecting = false;
      if (!wasActive) return;
      stopLooping();
      resetRxTextState();
      addTerm('sys', '串口已关闭/掉线');
      reconnectEpoch++;
      if (serial.autoReconnect && !manualDisconnect) {
        reconnectAttempts = 0;
        scheduleReconnect();
      }
    });
    const offError = window.api.onSerialError((msg) => { addTerm('sys', '串口错误: ' + msg); });
    for (const off of [offData, offClosed, offError]) if (typeof off === 'function') serialEventOffs.push(off);
  });

  onBeforeUnmount(() => {
    for (const off of serialEventOffs.splice(0)) { try { off(); } catch {} }
    cancelReconnect(true);
    stopLooping();
    resetRxTextState();
    if (qcSaveT) {
      clearTimeout(qcSaveT);
      saveQuickCmdsNow();
    }
    if (typeof stopQuickCmdWatch === 'function') stopQuickCmdWatch();
    stopQuickCmdWatch = null;
  });

  return {
    serialSupported, serialErrMsg, baudRates, serial, serialReconnectStatus, serialLines, termBox, portChooser,
    termWindowAtStart, termLineTotal, termFollowing, expandTermWindow, detachFromTail, followTailNow, commitLines, TERM_RENDER_WINDOW,
    quickFormatVisible, quickFormatTab, quickCommandFormatFields: QUICK_COMMAND_FORMAT_FIELDS,
    quickCommandJsonExample: QUICK_COMMAND_JSON_EXAMPLE, quickCommandAiPrompt: QUICK_COMMAND_AI_PROMPT,
    refreshPorts, portMainLabel, portSubLabel, quickCmds, looping, sendHistory, clearSendHistory,
    serialConnect, serialDisconnect, setAutoReconnect, serialSend, onSendKey, clearTerm, copyTerm, sendQuickCmd, addQuickCmd, delQuickCmd, toggleLoop, pickPort, cancelPortChoose, selectPort, exportQuickCmds, importQuickCmds,
    openQuickFormat, copyQuickCommandExample, copyQuickCommandAiPrompt,
    cmdGroups, activeGid, switchGroup, addGroup, delGroup,
    editingGid, editName, startRename, commitRename, cancelRename,
    initFromConfig
  };
}
