<!-- MQTT 消息流（气泡列表）。抽成叶子组件 + inject 直读 useMqtt 状态：
     高频订阅消息只重渲染本组件，不再拖动整个 App 模板 diff。 -->
<script>
import { inject } from 'vue';

export default {
  name: 'MqttMessages',
  setup() {
    const { activeConn, mqttBox } = inject('mqtt');
    const registerEl = (el) => { mqttBox.value = el; };
    return { activeConn, registerEl };
  }
};
</script>

<template>
  <div class="mx-msgs" :ref="registerEl">
    <template v-if="activeConn">
      <template v-for="m in activeConn.messages" :key="m.id">
        <div v-if="m.dir === 'sys'" class="mx-sys">{{ m.ts }} · {{ m.text }}</div>
        <div v-else class="mx-row" :class="m.dir">
          <div class="mx-bubble" :class="m.dir" :style="{ '--mxc': m.color || '#94a3b8' }">
            <div class="mx-bubble-head">
              <span class="mx-b-dir">{{ m.dir === 'rx' ? '收' : '发' }}</span>
              <span class="mx-b-topic">{{ m.topic }}</span>
              <span v-if="m.json" class="mx-b-json">JSON</span>
              <span class="mx-b-meta">{{ m.meta }}</span>
            </div>
            <div v-if="m.json" class="mx-b-payload json" v-html="m.html"></div>
            <div v-else class="mx-b-payload">{{ m.text }}</div>
            <div class="mx-b-time" v-if="activeConn.timestamp">{{ m.ts }}</div>
          </div>
        </div>
      </template>
      <div v-if="activeConn.messages.length === 0" class="term-empty"><div class="big">⇄</div>暂无消息<br>连接并订阅后显示</div>
    </template>
  </div>
</template>
