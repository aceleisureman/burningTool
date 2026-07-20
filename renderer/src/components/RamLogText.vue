<!-- 内存日志文本视图。抽成叶子组件 + inject 直读 useRamLog 状态：
     轮询更新（最快 200ms 一次）只重建本组件的文本节点。 -->
<script>
import { inject } from 'vue';

export default {
  name: 'RamLogText',
  setup() {
    const { ramLog, ramLogBox } = inject('ramlog');
    const registerEl = (el) => { ramLogBox.value = el; };
    return { ramLog, registerEl };
  }
};
</script>

<template>
  <pre :ref="registerEl" class="ram-log">{{ ramLog.text || '等待读取 RAM 日志。请确认固件已在同一基地址放置 RLOG 结构。' }}</pre>
</template>
