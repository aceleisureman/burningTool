<!-- 清空日志按钮：:disabled 依赖 logLines.length，抽成组件避免 App 订阅 logLines -->
<script>
import { inject, computed } from 'vue';
export default {
  name: 'LogClearBtn',
  props: {
    busy: { type: Boolean, default: false },
    icon: { default: null }
  },
  emits: ['clear'],
  setup() {
    const { logLines } = inject('log');
    const empty = computed(() => logLines.value.length === 0);
    return { empty };
  }
};
</script>
<template>
  <el-button class="danger-tool" :icon="icon" :disabled="busy || empty" plain @click="$emit('clear')">清空日志</el-button>
</template>
