<!-- 串口终端收发列表。抽成叶子组件 + inject 直读 useSerial 状态：
     高波特率连续收数（主进程 30ms 攒批后约 33 次/秒）只重渲染本组件。
     渲染的 serialLines 是「渲染窗口」（最多 TERM_RENDER_WINDOW 行），
     既有行对象引用不变，因此每批只需 diff 新增的少数节点。
     上滑离开底部 => 脱离跟随、锚定当前首行（新数据不再拽动视野）；
     滑回底部 => 恢复跟随。 -->
<script>
import { inject } from 'vue';

export default {
  name: 'SerialTerminal',
  setup() {
    const { serial, serialLines, termBox, termWindowAtStart, termLineTotal, termFollowing,
            expandTermWindow, detachFromTail, followTailNow } = inject('serial');
    const registerEl = (el) => { termBox.value = el; };
    const atBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
    const onScroll = () => {
      const el = termBox.value;
      if (!el) return;
      if (atBottom(el)) { followTailNow(); return; }   // 回到底部 -> 恢复跟随
      detachFromTail();                                // 离开底部 -> 锚定当前视野
      if (el.scrollTop <= 24) expandTermWindow();      // 贴顶 -> 回补更早记录
    };
    const loadOlder = () => { expandTermWindow(); };
    const backToLatest = () => {
      followTailNow();
      const el = termBox.value;
      if (el) el.scrollTop = el.scrollHeight;
    };
    return { serial, serialLines, termBox, registerEl, onScroll, termWindowAtStart, termLineTotal, termFollowing, loadOlder, backToLatest };
  }
};
</script>

<template>
  <div class="term-content" :ref="registerEl" @scroll.passive="onScroll">
    <div v-if="!termWindowAtStart" class="term-more" @click="loadOlder">
      ↑ 上方还有更早的记录，点击或继续上滑加载
    </div>
    <div v-for="ln in serialLines" :key="ln.id" class="s-line" :class="[ln.dir, ln.level, { continuation: ln.continuation }]">
      <span class="s-meta">
        <span class="ts" v-if="serial.timestamp">[{{ ln.ts }}]</span>
        <span class="s-badge">{{ ln.badge }}</span>
      </span>
      <span class="msg">{{ ln.text }}</span>
    </div>
    <div v-if="termLineTotal === 0" class="term-empty"><div class="big">⇄</div>暂无收发记录<br>连接串口后开始通信</div>
    <button v-if="!termFollowing" class="term-latest" type="button" @click="backToLatest">↓ 回到最新</button>
  </div>
</template>
