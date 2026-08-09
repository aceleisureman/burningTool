import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount, markRaw } from 'vue';
import { highlightJson, fmtPayload, topicMatch, bytesToHex, hexToBytes, now } from '../util.js';

const MQTT_MAX_SUBSCRIPTIONS = 256;
const MQTT_MAX_CONNECTIONS = 64;
const MQTT_MAX_PUBLISH_BYTES = 256 * 1024;
const MQTT_MAX_HEX_INPUT_CHARS = MQTT_MAX_PUBLISH_BYTES * 8;
const MQTT_MAX_MESSAGE_CHARS = 256 * 1024;
const MQTT_MAX_JSON_CHARS = 64 * 1024;
const MQTT_MAX_HISTORY_CHARS = 4 * 1024 * 1024;
const MQTT_HISTORY_TRIM_CHARS = 3 * 1024 * 1024;
const MQTT_MAX_HISTORY_MESSAGES = 3000;
const MQTT_HISTORY_TRIM_MESSAGES = 2400;
const MQTT_MAX_PERSIST_MESSAGES = 500;
const MQTT_MAX_PERSIST_TEXT_CHARS = 128 * 1024;
const MQTT_MAX_PERSIST_MESSAGE_CHARS = 16 * 1024;
const MQTT_MAX_HEX_DISPLAY_BYTES = Math.floor((MQTT_MAX_MESSAGE_CHARS + 1) / 3);
const DISPLAY_TRUNCATION_MARK = '\n… [显示内容已截断]';
const PERSIST_TRUNCATION_MARK = '\n… [历史内容已截断]';

function truncateChars(value, maxChars, marker = '') {
  const text = String(value ?? '');
  if (text.length <= maxChars) return { text, truncated: false };
  if (maxChars <= 0) return { text: '', truncated: true };
  const suffix = marker.length < maxChars ? marker : '';
  return { text: text.slice(0, maxChars - suffix.length) + suffix, truncated: true };
}

function makeMessage(data) {
  const clipped = truncateChars(data && data.text, MQTT_MAX_MESSAGE_CHARS, DISPLAY_TRUNCATION_MARK);
  const topic = truncateChars(data && data.topic, 4096, '…').text;
  const meta = truncateChars(data && data.meta, 4096, '…').text;
  const json = !!(data && data.json) && !clipped.truncated && clipped.text.length <= MQTT_MAX_JSON_CHARS;
  const html = json ? highlightJson(clipped.text) : '';
  const message = {
    id: data && data.id ? data.id : 0,
    dir: data && data.dir,
    text: clipped.text,
    html,
    topic,
    meta,
    color: data && data.color ? data.color : '',
    json,
    ts: data && data.ts ? data.ts : ''
  };
  message._weight = message.text.length + message.html.length + message.topic.length + message.meta.length;
  return markRaw(message);
}

function trimMessageHistory(conn) {
  if (!conn || !Array.isArray(conn.messages)) return;
  const overLimit = conn.messages.length > MQTT_MAX_HISTORY_MESSAGES || conn.messageChars > MQTT_MAX_HISTORY_CHARS;
  if (!overLimit) return;
  let removeCount = 0;
  while (conn.messages.length - removeCount > 1 &&
         (conn.messages.length - removeCount > MQTT_HISTORY_TRIM_MESSAGES || conn.messageChars > MQTT_HISTORY_TRIM_CHARS)) {
    const old = conn.messages[removeCount++];
    conn.messageChars -= old && old._weight ? old._weight : 0;
  }
  if (removeCount) conn.messages.splice(0, removeCount);
  if (conn.messageChars < 0) conn.messageChars = 0;
}

function restoreMessages(items) {
  const messages = (Array.isArray(items) ? items : []).slice(-MQTT_MAX_HISTORY_MESSAGES).map((m) => makeMessage(m));
  const state = { messages, messageChars: messages.reduce((sum, m) => sum + (m._weight || 0), 0) };
  trimMessageHistory(state);
  return state;
}

function persistableMessages(messages) {
  const result = [];
  let remaining = MQTT_MAX_PERSIST_TEXT_CHARS;
  const source = Array.isArray(messages) ? messages : [];
  for (let i = source.length - 1; i >= 0 && result.length < MQTT_MAX_PERSIST_MESSAGES; i--) {
    const m = source[i];
    const rawText = String((m && m.text) ?? '');
    const allowed = Math.min(MQTT_MAX_PERSIST_MESSAGE_CHARS, remaining);
    if (rawText.length && allowed <= 0) break;
    const text = truncateChars(rawText, allowed, PERSIST_TRUNCATION_MARK).text;
    remaining -= text.length;
    result.push({ id: m.id, dir: m.dir, text, topic: m.topic, meta: m.meta, color: m.color, json: !!m.json && text === rawText, ts: m.ts });
  }
  result.reverse();
  return result;
}

function formatBytes(value) {
  const n = Number(value) || 0;
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MiB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KiB';
  return n + ' B';
}

function configString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function validateConnectionDraft(draft) {
  const fields = [
    ['Broker 地址', draft.url, 4096],
    ['Client ID', draft.clientId, 4096],
    ['用户名', draft.username, 4096],
    ['密码', draft.password, 4096]
  ];
  if (String(draft.name || '').length > 128) return '连接名称不能超过 128 个字符';
  const encoder = new TextEncoder();
  for (const [name, value, maxBytes] of fields) {
    if (encoder.encode(String(value || '')).byteLength > maxBytes) return `${name}不能超过 ${maxBytes} 字节`;
  }
  return '';
}

// MQTT 调试（MQTTX 风格 · 多连接）：连接/订阅/发布 + 消息流，按连接 id 路由后端推送
export function useMqtt() {
  const mqttSupported = ref(true);
  const mqttErrMsg = ref('');
  const MQTT_COLORS = ['#34b27b', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];
  let mqttColorIdx = 0;
  function nextMqttColor() { const c = MQTT_COLORS[mqttColorIdx % MQTT_COLORS.length]; mqttColorIdx++; return c; }
  let connSeq = 0;
  function genConnId() { return 'c' + Date.now().toString(36) + (++connSeq).toString(36); }
  function makeConn(init) {
    init = init || {};
    const restored = restoreMessages(init.messages);
    const initialId = typeof init.id === 'string' && init.id.trim().length <= 128 ? init.id.trim() : genConnId();
    return reactive({
      id: initialId,
      name: configString(init.name, '新建连接') || '新建连接',
      url: configString(init.url, 'mqtt://broker.emqx.io:1883') || 'mqtt://broker.emqx.io:1883',
      clientId: configString(init.clientId),
      username: configString(init.username),
      password: configString(init.password),
      keepalive: init.keepalive != null ? init.keepalive : 60,
      clean: init.clean !== false,
      subs: Array.isArray(init.subs) ? init.subs.map((s) => { s = s || {}; return { topic: configString(s.topic), qos: Number(s.qos) || 0, color: s.color || nextMqttColor(), active: s.active !== false }; }) : [],
      connected: false, connecting: false,
      messages: restored.messages,
      messageChars: restored.messageChars,
      seq: restored.messages.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0),
      pubTopic: configString(init.pubTopic), pubQos: init.pubQos != null ? Number(init.pubQos) : 0,
      pubRetain: !!init.pubRetain, pubHex: !!init.pubHex, pubSub: !!init.pubSub, pubText: '',
      rxHex: !!init.rxHex, autoScroll: true, timestamp: true
    });
  }
  const mqttConns = ref([]);
  const activeConnId = ref(null);
  const activeConn = computed(() => mqttConns.value.find((c) => c.id === activeConnId.value) || null);
  const mqttBox = ref(null);
  const subDraft = reactive({ topic: '', qos: 0 });
  const connDlg = reactive({ visible: false, editing: null, name: '', url: '', clientId: '', username: '', password: '', keepalive: 60, clean: true });
  function connById(id) { return mqttConns.value.find((c) => c.id === id) || null; }

  function mqttScroll() { nextTick(() => { const el = mqttBox.value; const c = activeConn.value; if (el && c && c.autoScroll) el.scrollTop = el.scrollHeight; }); }
  // 只落数据不触发滚动/持久化（批量接收时由调用方统一做一次）；
  // 消息对象入列后字段不再变化，markRaw 避免 3000 条消息被逐个深度代理
  function pushMsg(conn, dir, text, topic, meta, color, json) {
    const message = makeMessage({ id: ++conn.seq, dir, text, topic, meta, color, json, ts: now() });
    conn.messages.push(message);
    conn.messageChars = (Number(conn.messageChars) || 0) + (message._weight || 0);
    trimMessageHistory(conn);
  }
  function addMsg(conn, dir, text, topic, meta, color, json) {
    if (!conn) return;
    pushMsg(conn, dir, text, topic, meta, color, json);
    if (conn === activeConn.value) mqttScroll();
    persistMqtt();
  }
  function clearMqtt() {
    if (activeConn.value) {
      activeConn.value.messages = [];
      activeConn.value.messageChars = 0;
      persistMqtt();
    }
  }
  function subColorFor(conn, topic) { const s = conn.subs.find((x) => x.active !== false && topicMatch(x.topic, topic)); return s ? s.color : '#94a3b8'; }

  // 防抖 + 最大等待：纯尾沿防抖在持续消息流（间隔 <400ms）下会被不断重置、一直存不上；
  // 改为静默 400ms 后落盘，且从首次请求起最迟 3s 强制落一次，避免高频流量下反复重写 config.json
  let mqttSaveT = null;
  let mqttSaveFirstReq = 0;
  function doPersistMqtt() {
    mqttSaveT = null;
    mqttSaveFirstReq = 0;
    const data = mqttConns.value.map((c) => ({
      id: c.id, name: c.name, url: c.url, clientId: c.clientId, username: c.username, password: c.password,
      keepalive: c.keepalive, clean: c.clean,
      subs: c.subs.map((s) => ({ topic: s.topic, qos: s.qos, color: s.color, active: s.active !== false })),
      pubTopic: c.pubTopic, pubQos: c.pubQos, pubRetain: c.pubRetain, pubHex: c.pubHex, pubSub: c.pubSub, rxHex: c.rxHex
    }));
    window.api.saveConfig({ mqttConns: data }).catch(() => {});
    const history = mqttConns.value.map((c) => ({ id: c.id, messages: persistableMessages(c.messages) }));
    window.api.saveMqttHistory(history).catch(() => {});
  }
  function persistMqtt() {
    const t = Date.now();
    if (!mqttSaveFirstReq) mqttSaveFirstReq = t;
    clearTimeout(mqttSaveT);
    mqttSaveT = setTimeout(doPersistMqtt, Math.min(400, Math.max(0, mqttSaveFirstReq + 3000 - t)));
  }
  function selectConn(c) { activeConnId.value = c.id; mqttScroll(); }
  function openConnDlg(c) {
    if (c) { connDlg.editing = c.id; connDlg.name = c.name; connDlg.url = c.url; connDlg.clientId = c.clientId; connDlg.username = c.username; connDlg.password = c.password; connDlg.keepalive = c.keepalive; connDlg.clean = c.clean; }
    else { connDlg.editing = null; connDlg.name = 'MQTT-' + (mqttConns.value.length + 1); connDlg.url = 'mqtt://broker.emqx.io:1883'; connDlg.clientId = ''; connDlg.username = ''; connDlg.password = ''; connDlg.keepalive = 60; connDlg.clean = true; }
    connDlg.visible = true;
  }
  function saveConnDlg() {
    if (!connDlg.url) { ElMessage.warning('请填写 Broker 地址'); return; }
    const invalid = validateConnectionDraft(connDlg);
    if (invalid) { ElMessage.warning(invalid); return; }
    if (connDlg.editing) {
      const c = connById(connDlg.editing);
      if (c) {
        c.name = connDlg.name || c.name;
        c.url = connDlg.url;
        c.clientId = connDlg.clientId;
        c.username = connDlg.username;
        c.password = connDlg.password;
        c.keepalive = connDlg.keepalive;
        c.clean = connDlg.clean;
      }
    } else {
      if (mqttConns.value.length >= MQTT_MAX_CONNECTIONS) {
        ElMessage.warning(`最多保存 ${MQTT_MAX_CONNECTIONS} 个 MQTT 连接`);
        return;
      }
      const c = makeConn({ name: connDlg.name, url: connDlg.url, clientId: connDlg.clientId, username: connDlg.username, password: connDlg.password, keepalive: connDlg.keepalive, clean: connDlg.clean });
      mqttConns.value.push(c); activeConnId.value = c.id;
    }
    connDlg.visible = false; persistMqtt();
  }
  async function delConn(c) {
    try { await ElMessageBox.confirm('确定删除连接「' + c.name + '」？', '删除连接', { type: 'warning' }); } catch { return; }
    if (c.connected || c.connecting) { try { await window.api.mqttDisconnect({ id: c.id }); } catch {} }
    const i = mqttConns.value.findIndex((x) => x.id === c.id);
    if (i >= 0) mqttConns.value.splice(i, 1);
    if (activeConnId.value === c.id) activeConnId.value = mqttConns.value.length ? mqttConns.value[0].id : null;
    persistMqtt();
  }
  async function connConnect(c) {
    if (!c || !c.url) { ElMessage.warning('请填写 Broker 地址'); return; }
    c.connecting = true;
    addMsg(c, 'sys', '正在连接 ' + c.url + ' …');
    try {
      const r = await window.api.mqttConnect({ id: c.id, url: c.url, clientId: c.clientId, username: c.username, password: c.password, keepalive: Number(c.keepalive), clean: c.clean });
      if (!r || !r.ok) {
        c.connecting = false;
        if (r && /未安装/.test(r.error || '')) { mqttSupported.value = false; mqttErrMsg.value = r.error; }
        addMsg(c, 'sys', '连接失败: ' + ((r && r.error) || '未知错误'));
        ElMessage.error('连接失败');
      } else { mqttSupported.value = true; mqttErrMsg.value = ''; }
    } catch (e) { c.connecting = false; addMsg(c, 'sys', '连接异常: ' + (e.message || e)); }
  }
  async function connDisconnect(c) {
    try { await window.api.mqttDisconnect({ id: c.id }); } catch {}
    c.connected = false; c.connecting = false;
    addMsg(c, 'sys', '已断开');
  }
  async function addSub() {
    const c = activeConn.value;
    if (!c) return;
    const topic = (subDraft.topic || '').trim();
    if (!topic) return;
    if (c.subs.some((s) => s.topic === topic)) { ElMessage.info('已订阅该主题'); return; }
    if (c.subs.length >= MQTT_MAX_SUBSCRIPTIONS) { ElMessage.warning(`每个连接最多保存 ${MQTT_MAX_SUBSCRIPTIONS} 个订阅`); return; }
    if (c.connected) {
      const r = await window.api.mqttSubscribe({ id: c.id, topic, qos: Number(subDraft.qos) });
      if (!r || !r.ok) { addMsg(c, 'sys', '订阅失败 ' + topic + ': ' + ((r && r.error) || '')); ElMessage.error('订阅失败'); return; }
    }
    c.subs.push({ topic, qos: Number(subDraft.qos), color: nextMqttColor(), active: true });
    subDraft.topic = '';
    addMsg(c, 'sys', '已订阅 ' + topic + ' (QoS ' + Number(subDraft.qos) + ')');
    persistMqtt();
  }
  async function removeSub(i) {
    const c = activeConn.value;
    if (!c) return;
    const s = c.subs[i];
    if (!s) return;
    if (c.connected) { try { await window.api.mqttUnsubscribe({ id: c.id, topic: s.topic }); } catch {} }
    c.subs.splice(i, 1);
    addMsg(c, 'sys', '已退订 ' + s.topic);
    persistMqtt();
  }
  // 暂停/恢复订阅：不删除订阅，只在 broker 端退订/重订，并切换灰/彩色图标
  function setSubActive(c, s, active) {
    if (!c || !s) return;
    s.active = active;
    if (c.connected) {
      if (active) window.api.mqttSubscribe({ id: c.id, topic: s.topic, qos: Number(s.qos) || 0 }).catch(() => {});
      else window.api.mqttUnsubscribe({ id: c.id, topic: s.topic }).catch(() => {});
    }
    addMsg(c, 'sys', (active ? '已恢复订阅 ' : '已暂停订阅 ') + s.topic);
    persistMqtt();
  }
  function toggleSub(i) { const c = activeConn.value; if (!c) return; const s = c.subs[i]; if (s) setSubActive(c, s, s.active === false); }
  // 自动订阅当前发布主题（勾选「订阅消息」时）
  function ensurePubSub(c) {
    if (!c || !c.pubSub) return;
    const topic = (c.pubTopic || '').trim();
    if (!topic || /[#+]/.test(topic)) return;
    const ex = c.subs.find((s) => s.topic === topic);
    if (ex) { if (ex.active === false) setSubActive(c, ex, true); return; }
    if (c.subs.length >= MQTT_MAX_SUBSCRIPTIONS) { ElMessage.warning(`订阅数量已达到 ${MQTT_MAX_SUBSCRIPTIONS} 条上限`); return; }
    c.subs.push({ topic, qos: Number(c.pubQos) || 0, color: nextMqttColor(), active: true });
    if (c.connected) window.api.mqttSubscribe({ id: c.id, topic, qos: Number(c.pubQos) || 0 }).catch(() => {});
    addMsg(c, 'sys', '已自动订阅 ' + topic);
    persistMqtt();
  }
  function onPubSubToggle(val) {
    const c = activeConn.value; if (!c) return;
    if (val) { ensurePubSub(c); return; }
    const topic = (c.pubTopic || '').trim();
    const ex = topic ? c.subs.find((s) => s.topic === topic) : null;
    if (ex && ex.active !== false) setSubActive(c, ex, false);
    else persistMqtt();
  }
  async function mqttPublish() {
    const c = activeConn.value;
    if (!c) return;
    if (!c.connected) { ElMessage.warning('请先连接'); return; }
    const topic = (c.pubTopic || '').trim();
    if (!topic) { ElMessage.warning('请填写发布主题'); return; }
    ensurePubSub(c);
    try {
      let bytes, shown, displayTruncated = false;
      if (c.pubHex) {
        if (String(c.pubText || '').length > MQTT_MAX_HEX_INPUT_CHARS) throw new Error('HEX 输入过长');
        bytes = hexToBytes(c.pubText);
        const displayBytes = bytes.length > MQTT_MAX_HEX_DISPLAY_BYTES ? bytes.subarray(0, MQTT_MAX_HEX_DISPLAY_BYTES) : bytes;
        shown = bytesToHex(displayBytes);
        displayTruncated = displayBytes.length < bytes.length;
      } else {
        const pubText = String(c.pubText || '');
        if (pubText.length > MQTT_MAX_PUBLISH_BYTES) throw new Error(`消息载荷不能超过 ${formatBytes(MQTT_MAX_PUBLISH_BYTES)}`);
        bytes = new TextEncoder().encode(pubText);
        const clipped = truncateChars(pubText, MQTT_MAX_MESSAGE_CHARS, DISPLAY_TRUNCATION_MARK);
        shown = clipped.text;
        displayTruncated = clipped.truncated;
      }
      if (bytes.byteLength > MQTT_MAX_PUBLISH_BYTES) throw new Error(`消息载荷不能超过 ${formatBytes(MQTT_MAX_PUBLISH_BYTES)}`);
      // 先记录发送（保证发显示在 broker 回显的收之前），再发布
      const fp = fmtPayload(shown, c.pubHex, MQTT_MAX_JSON_CHARS);
      const meta = 'QoS' + Number(c.pubQos) + (c.pubRetain ? ' ·R' : '') + (displayTruncated ? ' · 显示已截断' : '');
      addMsg(c, 'tx', fp.text, topic, meta, '#3b82f6', fp.json);
      const r = await window.api.mqttPublish({ id: c.id, topic, payload: bytes, qos: Number(c.pubQos), retain: c.pubRetain });
      if (!r || !r.ok) throw new Error((r && r.error) || '发布失败');
    } catch (e) { addMsg(c, 'sys', '发布失败: ' + (e.message || e)); ElMessage.error(e.message || '发布失败'); }
  }
  // 回车发布，Shift+Enter 换行；输入法组合中不触发
  function mqttSendKey(e) {
    if (e.shiftKey || e.isComposing) return;
    e.preventDefault();
    mqttPublish();
  }

  // 由 loadConfig 在读取配置后调用：恢复多连接（兼容旧的单连接配置）
  async function initFromConfig(cfg) {
    if (Array.isArray(cfg.mqttConns) && cfg.mqttConns.length) {
      mqttConns.value = cfg.mqttConns.slice(0, MQTT_MAX_CONNECTIONS).map((c) => makeConn(c));
    } else if (cfg.mqttConfig && typeof cfg.mqttConfig === 'object') {
      const mc = cfg.mqttConfig;   // 兼容旧的单连接配置
      mqttConns.value = [makeConn({ name: 'MQTT-1', url: mc.url, clientId: mc.clientId, username: mc.username, password: mc.password, keepalive: mc.keepalive, clean: mc.clean, subs: mc.subs, pubTopic: mc.pubTopic, pubQos: mc.pubQos, pubRetain: mc.pubRetain, pubHex: mc.pubHex })];
    }
    if (mqttConns.value.length) activeConnId.value = mqttConns.value[0].id;
    try {
      const stored = await window.api.getMqttHistory();
      const byId = new Map((Array.isArray(stored) ? stored : []).map((entry) => [entry.id, entry.messages]));
      for (const conn of mqttConns.value) {
        const messages = byId.get(conn.id);
        if (!Array.isArray(messages)) continue;
        const restored = restoreMessages(messages);
        conn.messages = restored.messages;
        conn.messageChars = restored.messageChars;
      }
    } catch {}
  }

  const mqttEventOffs = [];
  onMounted(() => {
    // MQTT 状态/消息（mqtt.js 后端推送，按连接 id 路由）
    const offStatus = window.api.onMqttStatus((s) => {
      if (!s) return;
      const c = connById(s.id);
      if (!c) return;
      if (s.state === 'connected') {
        c.connected = true; c.connecting = false;
        addMsg(c, 'sys', '已连接 ' + c.url);
        c.subs.slice(0, MQTT_MAX_SUBSCRIPTIONS).forEach((sub) => { if (sub.active !== false && sub.topic) window.api.mqttSubscribe({ id: c.id, topic: sub.topic, qos: Number(sub.qos) }).catch(() => {}); });
        if (c.subs.length > MQTT_MAX_SUBSCRIPTIONS) addMsg(c, 'sys', `已保留全部订阅配置；本次连接仅启用前 ${MQTT_MAX_SUBSCRIPTIONS} 条`);
      } else if (s.state === 'reconnecting') { c.connecting = true; addMsg(c, 'sys', '正在重连…'); }
      else if (s.state === 'offline') { addMsg(c, 'sys', '连接离线'); }
      else if (s.state === 'closed') { if (c.connected || c.connecting) addMsg(c, 'sys', '连接已关闭'); c.connected = false; c.connecting = false; }
      else if (s.state === 'error') { addMsg(c, 'sys', '错误: ' + (s.error || '')); }
    });
    // 消息批量接收（主进程按 30ms 攒批推送数组；兼容单条对象），
    // 一批只滚动/持久化一次；TextDecoder 模块内复用
    const rxDecoder = new TextDecoder();
    const offMessage = window.api.onMqttMessage((data) => {
      const batch = Array.isArray(data) ? data : (data ? [data] : []);
      if (!batch.length) return;
      let touchedActive = false;
      for (const m of batch) {
        const c = connById(m.id);
        if (!c) continue;
        let incoming;
        let incomingSize = 0;
        if (m.payload instanceof Uint8Array) { incoming = m.payload; incomingSize = m.payload.byteLength; }
        else if (m.payload instanceof ArrayBuffer) { incoming = new Uint8Array(m.payload); incomingSize = m.payload.byteLength; }
        else if (Array.isArray(m.payload)) { incomingSize = m.payload.length; incoming = Uint8Array.from(m.payload.slice(0, MQTT_MAX_PUBLISH_BYTES)); }
        else incoming = new Uint8Array(0);
        const locallyTruncated = incomingSize > MQTT_MAX_PUBLISH_BYTES;
        const u8 = locallyTruncated ? incoming.subarray(0, MQTT_MAX_PUBLISH_BYTES) : incoming;
        let raw;
        let displayTruncated = false;
        if (c.rxHex) {
          const displayBytes = u8.length > MQTT_MAX_HEX_DISPLAY_BYTES ? u8.subarray(0, MQTT_MAX_HEX_DISPLAY_BYTES) : u8;
          raw = bytesToHex(displayBytes);
          displayTruncated = displayBytes.length < u8.length;
        } else {
          const clipped = truncateChars(rxDecoder.decode(u8), MQTT_MAX_MESSAGE_CHARS, DISPLAY_TRUNCATION_MARK);
          raw = clipped.text;
          displayTruncated = clipped.truncated;
        }
        const fp = fmtPayload(raw, c.rxHex, MQTT_MAX_JSON_CHARS);
        const metaParts = ['QoS' + (m.qos || 0) + (m.retain ? ' ·R' : '')];
        if (m.truncated || locallyTruncated) metaParts.push(`载荷已截断（原始 ${formatBytes(m.originalSize || incomingSize || incoming.length)}）`);
        if (displayTruncated) metaParts.push('显示已截断');
        if (m.topicTruncated) metaParts.push('主题已截断');
        const topic = String(m.topic || '');
        pushMsg(c, 'rx', fp.text, topic, metaParts.join(' · '), subColorFor(c, topic), fp.json);
        if (c === activeConn.value) touchedActive = true;
      }
      if (touchedActive) mqttScroll();
      persistMqtt();
    });
    if (typeof offStatus === 'function') mqttEventOffs.push(offStatus);
    if (typeof offMessage === 'function') mqttEventOffs.push(offMessage);
  });

  onBeforeUnmount(() => {
    for (const off of mqttEventOffs.splice(0)) { try { off(); } catch {} }
    if (mqttSaveT) {
      clearTimeout(mqttSaveT);
      doPersistMqtt();
    } else {
      mqttSaveFirstReq = 0;
    }
  });

  return {
    mqttSupported, mqttErrMsg, mqttConns, activeConnId, activeConn, mqttBox, subDraft, connDlg,
    selectConn, openConnDlg, saveConnDlg, delConn, connConnect, connDisconnect, addSub, removeSub, toggleSub, mqttPublish, mqttSendKey, clearMqtt, onPubSubToggle,
    initFromConfig
  };
}
