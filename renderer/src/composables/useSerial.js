import { ref, reactive, computed, watch, nextTick, onMounted } from 'vue';
import { portMainLabel, portSubLabel, cmdDelayMs, bytesToHex, hexToBytes, copyText } from '../util.js';

// 串口调试（serialport 后端）：枚举/连接/收发 + 快捷指令分组 + 循环发送
export function useSerial() {
  const serialSupported = ref(true);     // 由 serialList 在挂载时探测后端是否可用
  const serialErrMsg = ref('');
  const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1500000];
  const serial = reactive({
    baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1,
    connected: false, connecting: false, portPath: '', portLabel: '', portSub: '',
    rxHex: false, txHex: false, autoScroll: true, timestamp: true,
    sendText: '', appendNewline: true, tx: 0, rx: 0
  });
  const serialLines = ref([]);
  let serialSeq = 0;
  let rxTextBuffer = '';
  let rxFlushTimer = null;
  let rxDecoder = new TextDecoder();
  const termBox = ref(null);
  const portChooser = reactive({ visible: false, list: [], loading: false });

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

  function switchGroup(id) { if (looping.value) { looping.value = false; loopStop = true; } activeGid.value = id; }
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
    } catch (e) {}
  }

  // 持久化到 config.json（防抖）
  let qcSaveT = null;
  function plainGroups() { return cmdGroups.value.map((g) => ({ name: g.name, cmds: g.cmds.map((q) => ({ enabled: q.enabled, name: q.name, content: q.content, hex: q.hex, interval: q.interval, unit: q.unit })) })); }
  function persistQuickCmds() { clearTimeout(qcSaveT); qcSaveT = setTimeout(() => { window.api.saveConfig({ serialCmdGroups: plainGroups() }).catch(() => {}); }, 400); }
  async function exportQuickCmds() {
    try { const r = await window.api.exportQuickCmds(plainGroups()); if (r && r.ok) ElMessage.success('已导出: ' + r.path); else if (r && r.error) ElMessage.error('导出失败: ' + r.error); }
    catch (e) { ElMessage.error('导出失败'); }
  }
  async function importQuickCmds() {
    try {
      const r = await window.api.importQuickCmds();
      if (!r || !r.ok) { if (r && r.error) ElMessage.error('导入失败: ' + r.error); return; }
      const d = r.data;
      let groups = null;
      if (Array.isArray(d) && d.length && d[0] && Array.isArray(d[0].cmds)) groups = d;           // 分组数组
      else if (d && Array.isArray(d.serialCmdGroups)) groups = d.serialCmdGroups;                  // {serialCmdGroups:[...]}
      else if (Array.isArray(d)) groups = [{ name: '导入', cmds: d }];                             // 旧版扁平指令数组
      else if (d && Array.isArray(d.serialQuickCmds)) groups = [{ name: '导入', cmds: d.serialQuickCmds }];
      if (!groups) { ElMessage.error('文件格式不对'); return; }
      cmdGroups.value = groups.map(normGroup);
      if (!cmdGroups.value.length) cmdGroups.value = [normGroup({ name: '默认', cmds: [] })];
      activeGid.value = cmdGroups.value[0].id;
      ElMessage.success('已导入 ' + cmdGroups.value.length + ' 个分组');
    } catch (e) { ElMessage.error('导入失败'); }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms | 0)));
  function termScroll() { nextTick(() => { const el = termBox.value; if (el && serial.autoScroll) el.scrollTop = el.scrollHeight; }); }
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
    serialLines.value.push({ id: ++serialSeq, dir, text: String(text ?? ''), ts: serialNow(), ...serialLineMeta(dir, text) });
    if (serialLines.value.length > 3000) serialLines.value.splice(0, 800);
  }
  function addTerm(dir, text) {
    String(text ?? '').replace(/\r/g, '').split('\n').forEach((line) => pushTermLine(dir, line));
    termScroll();
  }
  function flushRxBuffer() {
    if (!rxTextBuffer) return;
    pushTermLine('rx', rxTextBuffer);
    rxTextBuffer = '';
    termScroll();
  }
  function addRxText(text) {
    clearTimeout(rxFlushTimer);
    rxTextBuffer += String(text || '').replace(/\r/g, '');
    const parts = rxTextBuffer.split('\n');
    rxTextBuffer = parts.pop() || '';
    parts.forEach((line) => pushTermLine('rx', line));
    rxFlushTimer = setTimeout(flushRxBuffer, 120);
    termScroll();
  }
  function resetRxTextState() {
    rxTextBuffer = '';
    clearTimeout(rxFlushTimer);
    rxDecoder = new TextDecoder();
  }
  function clearTerm() { serialLines.value = []; serial.tx = 0; serial.rx = 0; resetRxTextState(); }
  async function copyTerm() {
    const text = serialLines.value.map((l) => `[${l.ts}] ${l.badge || l.dir.toUpperCase() + '>'} ${l.text}`).join('\n');
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
    addTerm('sys', '正在枚举系统串口…');
    await refreshPorts();
    portChooser.visible = true;
    if (!portChooser.list.length) addTerm('sys', '未检测到任何 COM 串口：请插好 USB 转串口设备并装好驱动（PWLink2 / ST-Link 调试探针不是串口，不会出现在列表里）');
    else addTerm('sys', '检测到 ' + portChooser.list.length + ' 个串口');
  }
  async function serialConnect() {
    if (!serial.portPath) { ElMessage.warning('请先选择串口'); selectPort(); return; }
    serial.connecting = true;
    try {
      const r = await window.api.serialOpen({
        path: serial.portPath, baudRate: Number(serial.baudRate),
        dataBits: Number(serial.dataBits), stopBits: Number(serial.stopBits), parity: serial.parity
      });
      if (!r || !r.ok) throw new Error((r && r.error) || '打开失败');
      serial.connected = true;
      addTerm('sys', `已连接 ${serial.portPath} · ${serial.baudRate} ${serial.dataBits}${serial.parity[0].toUpperCase()}${serial.stopBits}`);
    } catch (e) {
      addTerm('sys', '连接失败: ' + (e.message || e)); ElMessage.error('连接失败: ' + (e.message || e));
    } finally {
      serial.connecting = false;
    }
  }
  async function serialDisconnect() {
    looping.value = false; loopStop = true;
    try { await window.api.serialClose(); } catch {}
    serial.connected = false;
    resetRxTextState();
    addTerm('sys', '已断开连接');
  }
  async function writeBytes(u8) {
    const r = await window.api.serialWrite(Array.from(u8));
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
      if (serial.txHex) { bytes = hexToBytes(raw); addTerm('tx', bytesToHex(bytes)); }
      else { let s = raw; if (serial.appendNewline) s += '\r\n'; bytes = new TextEncoder().encode(s); addTerm('tx', raw); }
      await writeBytes(bytes); serial.tx += bytes.length; serial.sendText = '';
    } catch (e) { addTerm('sys', '发送失败: ' + (e.message || e)); ElMessage.error(e.message || '发送失败'); }
  }
  async function sendQuickCmd(q) {
    if (!serial.connected || !q.content) return;
    try {
      let bytes;
      if (q.hex) { bytes = hexToBytes(q.content); addTerm('tx', bytesToHex(bytes)); }
      else { bytes = new TextEncoder().encode(q.content + '\r\n'); addTerm('tx', q.content); }
      await writeBytes(bytes); serial.tx += bytes.length;
    } catch (e) { addTerm('sys', '发送失败: ' + (e.message || e)); }
  }
  function addQuickCmd() { quickCmds.value.push(normCmd({})); }
  function delQuickCmd(i) { quickCmds.value.splice(i, 1); }
  async function toggleLoop() {
    if (looping.value) { looping.value = false; loopStop = true; return; }
    const enabled = quickCmds.value.filter((q) => q.enabled && q.content);
    if (!enabled.length) { ElMessage.warning('请先勾选要循环发送的指令'); return; }
    looping.value = true; loopStop = false;
    addTerm('sys', `开始循环发送 ${enabled.length} 条指令`);
    while (!loopStop && serial.connected) {
      for (const q of quickCmds.value) {
        if (loopStop || !serial.connected) break;
        if (!q.enabled || !q.content) continue;
        await sendQuickCmd(q);
        await sleep(cmdDelayMs(q) || 1000);
      }
    }
    looping.value = false;
    addTerm('sys', '已停止循环发送');
  }
  function pickPort(p) {
    if (!p || !p.path) return;
    serial.portPath = p.path;
    serial.portLabel = portMainLabel(p);
    serial.portSub = portSubLabel(p);
    portChooser.visible = false;
    addTerm('sys', '已选择串口: ' + serial.portPath + (serial.portSub ? '（' + serial.portSub + '）' : ''));
  }
  function cancelPortChoose() { portChooser.visible = false; }

  // 由 loadConfig 在读取配置后调用：恢复快捷指令分组并开启持久化
  function initFromConfig(cfg) {
    if (Array.isArray(cfg.serialCmdGroups) && cfg.serialCmdGroups.length) cmdGroups.value = cfg.serialCmdGroups.map(normGroup);
    else if (Array.isArray(cfg.serialQuickCmds) && cfg.serialQuickCmds.length) cmdGroups.value = [normGroup({ name: '默认', cmds: cfg.serialQuickCmds })];
    activeGid.value = cmdGroups.value[0].id;
    watch(cmdGroups, persistQuickCmds, { deep: true });
  }

  onMounted(() => {
    // 串口数据/关闭/错误（serialport 后端推送）
    window.api.onSerialData((arr) => {
      const u8 = Uint8Array.from(arr || []);
      if (!u8.length) return;
      serial.rx += u8.length;
      if (serial.rxHex) addTerm('rx', bytesToHex(u8));
      else addRxText(rxDecoder.decode(u8, { stream: true }));
    });
    window.api.onSerialClosed(() => { if (serial.connected) { serial.connected = false; looping.value = false; loopStop = true; resetRxTextState(); addTerm('sys', '串口已关闭/掉线'); } });
    window.api.onSerialError((msg) => { addTerm('sys', '串口错误: ' + msg); });
  });

  return {
    serialSupported, serialErrMsg, baudRates, serial, serialLines, termBox, portChooser,
    refreshPorts, portMainLabel, portSubLabel, quickCmds, looping,
    serialConnect, serialDisconnect, serialSend, onSendKey, clearTerm, copyTerm, sendQuickCmd, addQuickCmd, delQuickCmd, toggleLoop, pickPort, cancelPortChoose, selectPort, exportQuickCmds, importQuickCmds,
    cmdGroups, activeGid, switchGroup, addGroup, delGroup,
    editingGid, editName, startRename, commitRename, cancelRename,
    initFromConfig
  };
}
