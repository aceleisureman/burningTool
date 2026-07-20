import { ref, reactive, computed, nextTick, onMounted, markRaw } from 'vue';
import { highlightJson, fmtPayload, topicMatch, bytesToHex, hexToBytes, now } from '../util.js';

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
    return reactive({
      id: init.id || genConnId(),
      name: init.name || '新建连接',
      url: init.url || 'mqtt://broker.emqx.io:1883',
      clientId: init.clientId || '', username: init.username || '', password: init.password || '',
      keepalive: init.keepalive != null ? init.keepalive : 60,
      clean: init.clean !== false,
      subs: Array.isArray(init.subs) ? init.subs.map((s) => ({ topic: s.topic, qos: Number(s.qos) || 0, color: s.color || nextMqttColor(), active: s.active !== false })) : [],
      connected: false, connecting: false,
      messages: Array.isArray(init.messages) ? init.messages.map((m) => markRaw({ id: m.id || 0, dir: m.dir, text: m.text || '', html: m.json ? highlightJson(m.text || '') : '', topic: m.topic || '', meta: m.meta || '', color: m.color || '', json: !!m.json, ts: m.ts || '' })) : [],
      seq: (Array.isArray(init.messages) && init.messages.length) ? Math.max.apply(null, init.messages.map((m) => m.id || 0)) : 0,
      pubTopic: init.pubTopic || '', pubQos: init.pubQos != null ? Number(init.pubQos) : 0,
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
    conn.messages.push(markRaw({ id: ++conn.seq, dir, text: text || '', html: json ? highlightJson(text || '') : '', topic: topic || '', meta: meta || '', color: color || '', json: !!json, ts: now() }));
    if (conn.messages.length > 3000) conn.messages.splice(0, 800);
  }
  function addMsg(conn, dir, text, topic, meta, color, json) {
    if (!conn) return;
    pushMsg(conn, dir, text, topic, meta, color, json);
    if (conn === activeConn.value) mqttScroll();
    persistMqtt();
  }
  function clearMqtt() { if (activeConn.value) { activeConn.value.messages = []; persistMqtt(); } }
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
      pubTopic: c.pubTopic, pubQos: c.pubQos, pubRetain: c.pubRetain, pubHex: c.pubHex, pubSub: c.pubSub, rxHex: c.rxHex,
      messages: c.messages.slice(-500).map((m) => ({ id: m.id, dir: m.dir, text: m.text, topic: m.topic, meta: m.meta, color: m.color, json: m.json, ts: m.ts }))
    }));
    window.api.saveConfig({ mqttConns: data }).catch(() => {});
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
    if (connDlg.editing) {
      const c = connById(connDlg.editing);
      if (c) { c.name = connDlg.name || c.name; c.url = connDlg.url; c.clientId = connDlg.clientId; c.username = connDlg.username; c.password = connDlg.password; c.keepalive = connDlg.keepalive; c.clean = connDlg.clean; }
    } else {
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
      let bytes, shown;
      if (c.pubHex) { bytes = hexToBytes(c.pubText); shown = bytesToHex(bytes); }
      else { bytes = new TextEncoder().encode(c.pubText || ''); shown = c.pubText || ''; }
      // 先记录发送（保证发显示在 broker 回显的收之前），再发布
      const fp = fmtPayload(shown, c.pubHex);
      addMsg(c, 'tx', fp.text, topic, 'QoS' + Number(c.pubQos) + (c.pubRetain ? ' ·R' : ''), '#3b82f6', fp.json);
      const r = await window.api.mqttPublish({ id: c.id, topic, payload: Array.from(bytes), qos: Number(c.pubQos), retain: c.pubRetain });
      if (!r || !r.ok) throw new Error((r && r.error) || '发布失败');
      persistMqtt();
    } catch (e) { addMsg(c, 'sys', '发布失败: ' + (e.message || e)); ElMessage.error(e.message || '发布失败'); }
  }
  // 回车发布，Shift+Enter 换行；输入法组合中不触发
  function mqttSendKey(e) {
    if (e.shiftKey || e.isComposing) return;
    e.preventDefault();
    mqttPublish();
  }

  // 由 loadConfig 在读取配置后调用：恢复多连接（兼容旧的单连接配置）
  function initFromConfig(cfg) {
    if (Array.isArray(cfg.mqttConns) && cfg.mqttConns.length) {
      mqttConns.value = cfg.mqttConns.map((c) => makeConn(c));
    } else if (cfg.mqttConfig && typeof cfg.mqttConfig === 'object') {
      const mc = cfg.mqttConfig;   // 兼容旧的单连接配置
      mqttConns.value = [makeConn({ name: 'MQTT-1', url: mc.url, clientId: mc.clientId, username: mc.username, password: mc.password, keepalive: mc.keepalive, clean: mc.clean, subs: mc.subs, pubTopic: mc.pubTopic, pubQos: mc.pubQos, pubRetain: mc.pubRetain, pubHex: mc.pubHex })];
    }
    if (mqttConns.value.length) activeConnId.value = mqttConns.value[0].id;
  }

  onMounted(() => {
    // MQTT 状态/消息（mqtt.js 后端推送，按连接 id 路由）
    window.api.onMqttStatus((s) => {
      if (!s) return;
      const c = connById(s.id);
      if (!c) return;
      if (s.state === 'connected') {
        c.connected = true; c.connecting = false;
        addMsg(c, 'sys', '已连接 ' + c.url);
        c.subs.forEach((sub) => { if (sub.active !== false) window.api.mqttSubscribe({ id: c.id, topic: sub.topic, qos: Number(sub.qos) }).catch(() => {}); });
      } else if (s.state === 'reconnecting') { c.connecting = true; addMsg(c, 'sys', '正在重连…'); }
      else if (s.state === 'offline') { addMsg(c, 'sys', '连接离线'); }
      else if (s.state === 'closed') { if (c.connected || c.connecting) addMsg(c, 'sys', '连接已关闭'); c.connected = false; c.connecting = false; }
      else if (s.state === 'error') { addMsg(c, 'sys', '错误: ' + (s.error || '')); }
    });
    // 消息批量接收（主进程按 30ms 攒批推送数组；兼容单条对象），
    // 一批只滚动/持久化一次；TextDecoder 模块内复用
    const rxDecoder = new TextDecoder();
    window.api.onMqttMessage((data) => {
      const batch = Array.isArray(data) ? data : (data ? [data] : []);
      if (!batch.length) return;
      let touchedActive = false;
      for (const m of batch) {
        const c = connById(m.id);
        if (!c) continue;
        const u8 = m.payload instanceof Uint8Array ? m.payload : Uint8Array.from(m.payload || []);
        const raw = c.rxHex ? bytesToHex(u8) : rxDecoder.decode(u8);
        const fp = fmtPayload(raw, c.rxHex);
        pushMsg(c, 'rx', fp.text, m.topic, 'QoS' + (m.qos || 0) + (m.retain ? ' ·R' : ''), subColorFor(c, m.topic), fp.json);
        if (c === activeConn.value) touchedActive = true;
      }
      if (touchedActive) mqttScroll();
      persistMqtt();
    });
  });

  return {
    mqttSupported, mqttErrMsg, mqttConns, activeConnId, activeConn, mqttBox, subDraft, connDlg,
    selectConn, openConnDlg, saveConnDlg, delConn, connConnect, connDisconnect, addSub, removeSub, toggleSub, mqttPublish, mqttSendKey, clearMqtt, onPubSubToggle,
    initFromConfig
  };
}
