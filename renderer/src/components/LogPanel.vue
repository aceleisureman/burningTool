<!-- 烧录/StcGal/ESP32 共用的终端日志列表。
     抽成叶子组件 + inject 直读 useLog 状态：高频日志更新只重渲染本组件，
     App 主模板不再为每批日志 diff 整个页面（样式为全局 CSS，类名不变）。 -->
<script>
import { inject } from 'vue';

export default {
  name: 'LogPanel',
  props: {
    pane: { type: String, required: true },     // 面板名：flash / stc51 / esp32（滚动容器按面板注册）
    empty: { type: String, default: '暂无日志' } // 空态提示文案
  },
  setup(props) {
    const { displayLines, logLines, showTs, setLogBox } = inject('log');
    const registerEl = (el) => setLogBox(props.pane, el);
    return { displayLines, logLines, showTs, registerEl };
  }
};
</script>

<template>
  <div class="log-content" :ref="registerEl">
    <div v-for="line in displayLines" :key="line.id" class="log-line" :class="line.type"><span class="ts" v-if="showTs">{{ line.ts }}</span><span class="msg">{{ line.text }}</span></div>
    <div v-if="logLines.length === 0" class="log-empty"><div class="big">⌁</div>{{ empty }}</div>
  </div>
</template>
