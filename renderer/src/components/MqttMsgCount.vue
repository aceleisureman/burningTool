<!-- MQTT 消息条数：隔离订阅，避免 App 主模板被每条消息拖动。
     注意 messages 现在是 markRaw 普通数组（长度变化不响应式），改用响应式的 messageTotal。 -->
<script>
import { inject, computed } from 'vue';
export default {
  name: 'MqttMsgCount',
  setup() {
    const { activeConn } = inject('mqtt');
    const count = computed(() => (activeConn.value ? (activeConn.value.messageTotal || 0) : 0));
    return { count };
  }
};
</script>
<template>
  <span v-if="count" class="tb-count">{{ count }} 条</span>
</template>
