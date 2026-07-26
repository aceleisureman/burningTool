<template>
      <div class="tool-pane">
        <div class="pane-top">
          <div><div class="pt-title">MQTT 调试</div><div class="pt-sub">mqtt.js · 多连接 · 订阅 / 发布</div></div>
          <div class="spacer"></div>
          <div class="status-pill" :class="activeConn && activeConn.connected ? 'ok' : ''"><span class="dot"></span>{{ activeConn ? (activeConn.connecting ? '连接中…' : (activeConn.connected ? '已连接' : '未连接')) : '无连接' }}</div>
        </div>

        <div class="mx-layout">
          <!-- 一列：连接列表 -->
          <div class="mx-conns">
            <div class="mx-conns-head">
              <span>连接 <span class="qh-count">{{ mqttConns.length }}</span></span>
              <el-button size="small" :icon="Plus" circle @click="openConnDlg(null)" title="新建连接" />
            </div>
            <div class="mx-conn-list">
              <div v-for="c in mqttConns" :key="c.id" class="mx-conn" :class="{ active: c.id === activeConnId }" @click="selectConn(c)">
                <span class="mx-conn-dot" :class="{ on: c.connected, ing: c.connecting }"></span>
                <div class="mx-conn-meta">
                  <div class="mx-conn-name">{{ c.name }}</div>
                  <div class="mx-conn-url">{{ c.url }}</div>
                </div>
              </div>
              <div v-if="mqttConns.length === 0" class="mx-conns-empty">暂无连接<br>点 ＋ 新建</div>
            </div>
          </div>

          <!-- 选中连接：订阅 + 消息 + 发布 -->
          <div class="mx-main" v-if="activeConn">
            <div class="mx-main-head">
              <span class="mx-conn-dot" :class="{ on: activeConn.connected, ing: activeConn.connecting }"></span>
              <span class="mx-main-name">{{ activeConn.name }}</span>
              <span class="mx-main-url">{{ activeConn.url }}</span>
              <div class="spacer"></div>
              <el-button size="small" @click="openConnDlg(activeConn)"><el-icon><EditPen /></el-icon>编辑</el-button>
              <el-button v-if="!activeConn.connected" size="small" type="primary" :loading="activeConn.connecting" :icon="Connection" @click="connConnect(activeConn)">连接</el-button>
              <el-button v-else size="small" type="danger" plain :icon="SwitchButton" @click="connDisconnect(activeConn)">断开</el-button>
              <el-button size="small" plain :icon="Delete" @click="delConn(activeConn)" title="删除连接" />
            </div>

            <div class="mx-main-body">
              <!-- 订阅侧栏 -->
              <div class="mx-subs">
                <div class="mx-subs-head">订阅主题 <span class="qh-count">{{ activeConn.subs.length }}</span></div>
                <div class="mx-sub-add">
                  <el-input v-model="subDraft.topic" size="small" placeholder="主题 test/#" @keyup.enter="addSub" />
                  <el-select v-model.number="subDraft.qos" size="small" style="width:64px;flex-shrink:0;">
                    <el-option label="Q0" :value="0" /><el-option label="Q1" :value="1" /><el-option label="Q2" :value="2" />
                  </el-select>
                  <el-button size="small" type="primary" :icon="Plus" @click="addSub">订阅</el-button>
                </div>
                <div class="mx-sub-list">
                  <div v-for="(s, i) in activeConn.subs" :key="s.topic" class="mx-sub" :class="{ paused: s.active === false }" :style="{ borderLeftColor: s.color }">
                    <span class="mx-sub-color" :style="{ background: s.active === false ? '#94a3b8' : s.color }" @click="toggleSub(i)" :title="s.active === false ? '点击恢复订阅' : '点击暂停订阅'"></span>
                    <span class="mx-sub-topic">{{ s.topic }}</span>
                    <span class="mx-sub-qos">Q{{ s.qos }}</span>
                    <el-icon class="mx-sub-del" @click="removeSub(i)" title="退订并删除"><Close /></el-icon>
                  </div>
                  <div v-if="activeConn.subs.length === 0" class="mx-subs-empty">暂无订阅<br>输入主题点「订阅」</div>
                </div>
              </div>

              <!-- 消息流 + 发布 -->
              <div class="mx-chat">
                <div class="mx-chat-bar">
                  <span class="tb-toggle" :class="{ on: activeConn.rxHex }" @click="activeConn.rxHex = !activeConn.rxHex" title="以十六进制显示接收内容">接收 HEX</span>
                  <span class="tb-toggle" :class="{ on: activeConn.autoScroll }" @click="activeConn.autoScroll = !activeConn.autoScroll" :title="activeConn.autoScroll ? '关闭自动滚动' : '开启自动滚动'">
                    <el-icon><component :is="activeConn.autoScroll ? 'Bottom' : 'Minus'" /></el-icon>{{ activeConn.autoScroll ? '自动滚动' : '已暂停' }}
                  </span>
                  <span class="tb-toggle" :class="{ on: activeConn.timestamp }" @click="activeConn.timestamp = !activeConn.timestamp" :title="activeConn.timestamp ? '隐藏时间戳' : '显示时间戳'">
                    <el-icon><Clock /></el-icon>{{ activeConn.timestamp ? '时间戳' : '隐藏时间' }}
                  </span>
                  <span class="spacer"></span>
                  <MqttMsgCount />
                  <span class="tb-toggle" @click="clearMqtt" title="清空当前连接消息"><el-icon><Delete /></el-icon>清空</span>
                </div>
                <MqttMessages />
                <div class="mx-pub">
                  <div class="mx-pub-row">
                    <el-input v-model="activeConn.pubTopic" size="small" placeholder="发布主题，如 test/topic">
                      <template #prepend>主题</template>
                    </el-input>
                    <el-select v-model.number="activeConn.pubQos" size="small" style="width:90px;flex-shrink:0;">
                      <el-option label="QoS 0" :value="0" /><el-option label="QoS 1" :value="1" /><el-option label="QoS 2" :value="2" />
                    </el-select>
                    <el-checkbox v-model="activeConn.pubRetain" size="small">Retain</el-checkbox>
                    <el-checkbox v-model="activeConn.pubHex" size="small">HEX</el-checkbox>
                    <el-checkbox v-model="activeConn.pubSub" size="small" @change="onPubSubToggle" title="勾选后自动订阅当前发布主题">订阅消息</el-checkbox>
                  </div>
                  <div class="send-bar">
                    <el-input v-model="activeConn.pubText" type="textarea" :rows="5" resize="none"
                              :placeholder="activeConn.pubHex ? '输入 HEX，如 01 02 0A · 回车发送' : '发布内容…（回车发送 · Shift+Enter 换行）'"
                              @keydown.enter="mqttSendKey"></el-input>
                    <el-button class="mx-send-btn" type="primary" :icon="Promotion" :disabled="!activeConn.connected" @click="mqttPublish">发送</el-button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 无连接占位 -->
          <div class="mx-empty" v-else>
            <div class="big">⇆</div>
            还没有连接，点左侧 ＋ 新建一个 MQTT 连接
            <div v-if="!mqttSupported" style="color:var(--danger);margin-top:12px;font-size:12px;line-height:1.6;">MQTT 后端不可用：{{ mqttErrMsg || 'mqtt 未安装' }}<br/>请在工程目录执行 npm install mqtt 并重启。</div>
          </div>
        </div>

        <!-- 连接编辑弹窗 -->
        <el-dialog v-model="connDlg.visible" :title="connDlg.editing ? '编辑连接' : '新建连接'" width="440px" append-to-body>
          <div class="field"><label>名称</label><el-input v-model="connDlg.name" placeholder="连接名称" /></div>
          <div class="field"><label>Broker 地址</label><el-input v-model="connDlg.url" placeholder="mqtt://broker.emqx.io:1883" /></div>
          <div class="field"><label>Client ID</label><el-input v-model="connDlg.clientId" placeholder="留空自动生成" /></div>
          <div class="field"><label>用户名</label><el-input v-model="connDlg.username" placeholder="可选" /></div>
          <div class="field"><label>密码</label><el-input v-model="connDlg.password" type="password" show-password placeholder="可选" /></div>
          <div class="field"><label>Keepalive（秒）</label><el-input v-model.number="connDlg.keepalive" type="number" :min="0" /></div>
          <div class="field"><el-checkbox v-model="connDlg.clean">Clean Session</el-checkbox></div>
          <template #footer>
            <el-button @click="connDlg.visible = false">取消</el-button>
            <el-button type="primary" @click="saveConnDlg">保存</el-button>
          </template>
        </el-dialog>
      </div>
</template>

<script>
import { inject } from 'vue';
import MqttMessages from '../components/MqttMessages.vue';
import MqttMsgCount from '../components/MqttMsgCount.vue';

export default {
  components: { MqttMessages, MqttMsgCount },
  setup() {
    const app = inject('appContext');
    if (!app) throw new Error('appContext is not available');
    return app;
  },
};
</script>
