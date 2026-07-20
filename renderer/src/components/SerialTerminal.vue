<!-- 串口终端收发列表。抽成叶子组件 + inject 直读 useSerial 状态：
     高波特率连续收数（主进程 30ms 攒批后约 33 次/秒）只重渲染本组件。 -->
<script>
import { inject } from 'vue';

export default {
  name: 'SerialTerminal',
  setup() {
    const { serial, serialLines, termBox } = inject('serial');
    const registerEl = (el) => { termBox.value = el; };
    return { serial, serialLines, registerEl };
  }
};
</script>

<template>
  <div class="term-content" :ref="registerEl">
    <div v-for="ln in serialLines" :key="ln.id" class="s-line" :class="[ln.dir, ln.level, { continuation: ln.continuation }]">
      <span class="s-meta">
        <span class="ts" v-if="serial.timestamp">[{{ ln.ts }}]</span>
        <span class="s-badge">{{ ln.badge }}</span>
      </span>
      <span class="msg">{{ ln.text }}</span>
    </div>
    <div v-if="serialLines.length === 0" class="term-empty"><div class="big">⇄</div>暂无收发记录<br>连接串口后开始通信</div>
  </div>
</template>
