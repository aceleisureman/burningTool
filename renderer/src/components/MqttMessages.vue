<!-- MQTT 消息流（气泡列表）。抽成叶子组件 + inject 直读 useMqtt 状态：
     高频订阅消息只重渲染本组件，不再拖动整个 App 模板 diff。
     只渲染窗口内（尾部 N 条）消息，避免长会话下上万 DOM 节点的全量 diff。 -->
<script>
import { inject, computed } from 'vue';

export default {
  name: 'MqttMessages',
  setup() {
    const { activeConn, mqttBox, expandMqttWindow, MQTT_RENDER_WINDOW } = inject('mqtt');
    const registerEl = (el) => { mqttBox.value = el; };
    // 注意：conn 是 reactive({... messagesView: ref([]) ... })，Vue 会自动「解包」内层 ref，
    // 因此 c.messagesView 拿到的已经是数组本身，绝不能再写 .value（否则 undefined.length 抛错，
    // 会让本组件 render 崩溃 → 冒泡到 <App> 的 fragment patch 失败 → 全站 DOM 更新被中断）。
    const viewOf = (c) => (Array.isArray(c.messagesView) ? c.messagesView : (c.messagesView ? c.messagesView.value : []));
    // 窗口起点 > 0 表示上方仍有更早的历史可加载
    const hasEarlier = computed(() => {
      const c = activeConn.value;
      if (!c || !c.messagesView) return false;
      return viewOf(c).length < c.messages.length;
    });
    return { activeConn, registerEl, expandMqttWindow, MQTT_RENDER_WINDOW, hasEarlier, viewOf };
  }
};
</script>

<template>
  <div class="mx-msgs" :ref="registerEl">
    <template v-if="activeConn">
      <div v-if="hasEarlier" class="mx-more" @click="expandMqttWindow()">↑ 上方还有更早的消息，点击加载</div>
      <template v-for="m in viewOf(activeConn)" :key="m.id">
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
      <div v-if="!activeConn.messageTotal" class="term-empty"><div class="big">⇄</div>暂无消息<br>连接并订阅后显示</div>
    </template>
  </div>
</template>
