<!-- 日志行数角标：隔离 logLines 订阅，避免 App 主模板因每批日志重跑 -->
<script>
import { inject, computed } from 'vue';
export default {
  name: 'LogLineCount',
  setup() {
    const { logLines } = inject('log');
    const count = computed(() => logLines.value.length);
    return { count };
  }
};
</script>
<template><span>({{ count }})</span></template>
