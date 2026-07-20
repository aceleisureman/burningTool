<!-- MQTT 消息条数：隔离 activeConn.messages 订阅，避免 App 主模板被每条消息拖动 -->
<script>
import { inject, computed } from 'vue';
export default {
  name: 'MqttMsgCount',
  setup() {
    const { activeConn } = inject('mqtt');
    const count = computed(() => (activeConn.value && activeConn.value.messages ? activeConn.value.messages.length : 0));
    return { count };
  }
};
</script>
<template>
  <span v-if="count" class="tb-count">{{ count }} 条</span>
</template>
