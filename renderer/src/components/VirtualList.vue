<!-- 可变高度虚拟列表。
     只渲染「视口内 + overscan」的条目，其余用占位高度撑起滚动条，
     因此上万条数据也只维持几十个 DOM 节点。

     为什么不用固定高度方案：本项目的快捷指令卡片内含 autosize textarea（1~4 行），
     高度随内容变化，固定高度会导致文字被裁切或留白，所以采用「估算 + 实测修正」：
       1. 未测量的条目先用 estimate 占位；
       2. 渲染后实测 offsetHeight 并回写，重算累计偏移；
       3. 已测过的条目高度被记住，滚动时不再跳动。

     用法：
       <VirtualList :items="list" item-key="id" :estimate="118" :gap="8" v-slot="{ item, index }">
         <div class="card">…</div>
       </VirtualList>
-->
<script>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';

// 在有序数组里找最后一个 <= y 的下标（二分）
function findStart(offsets, y) {
  let lo = 0;
  let hi = offsets.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= y) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

export default {
  name: 'VirtualList',
  props: {
    items: { type: Array, required: true },
    // 唯一键字段名，或 (item, index) => key 的函数
    itemKey: { type: [String, Function], default: 'id' },
    // 未测量条目的估算高度（px）
    estimate: { type: Number, default: 120 },
    // 条目间距（px），与 CSS gap 保持一致
    gap: { type: Number, default: 8 },
    // 视口上下各多渲染几条，避免快速滚动露白
    overscan: { type: Number, default: 4 }
  },
  setup(props) {
    const boxRef = ref(null);
    const scrollTop = ref(0);
    const viewportH = ref(0);
    // 已实测的条目高度；0 表示尚未测量（用 estimate 兜底）
    const heights = ref([]);
    // 测量结果变更计数：驱动 offsets/visible 重算
    const version = ref(0);

    const itemEls = new Map();

    const keyOf = (item, index) => (
      typeof props.itemKey === 'function' ? props.itemKey(item, index) : item[props.itemKey]
    );

    // 累计偏移 + 总高
    const layout = computed(() => {
      void version.value; // 建立依赖：测量结果变化时重算偏移
      const n = props.items.length;
      const offs = new Array(n);
      let acc = 0;
      for (let i = 0; i < n; i++) {
        offs[i] = acc;
        acc += (heights.value[i] || props.estimate) + props.gap;
      }
      return { offs, total: n ? acc - props.gap : 0 };
    });

    // 视口内条目（含 overscan）
    const visible = computed(() => {
      const { offs } = layout.value;
      const n = props.items.length;
      if (!n) return [];
      // 挂载瞬间容器可能还没布局（clientHeight=0），此时用一个保守高度兜底，
      // 否则只会渲染 overscan 条，看起来像「列表空了」。
      const vh = viewportH.value > 0 ? viewportH.value : 600;
      const startIdx = Math.max(0, findStart(offs, scrollTop.value) - props.overscan);
      const bottomY = scrollTop.value + vh;
      let endIdx = startIdx;
      while (endIdx < n && offs[endIdx] < bottomY) endIdx++;
      endIdx = Math.min(n, endIdx + props.overscan);
      const rows = [];
      for (let i = startIdx; i < endIdx; i++) {
        rows.push({ index: i, item: props.items[i], top: offs[i], key: keyOf(props.items[i], i) });
      }
      return rows;
    });

    const totalHeight = computed(() => layout.value.total);

    function setItemEl(index, el) {
      if (el) itemEls.set(index, el);
      else itemEls.delete(index);
    }

    // 实测当前渲染出的条目高度，变化则触发重算
    function measure() {
      nextTick(() => {
        syncViewport();
        let changed = false;
        // 条目数量变化时同步数组长度（保留已测高度）
        if (heights.value.length !== props.items.length) {
          const next = heights.value.slice(0, props.items.length);
          while (next.length < props.items.length) next.push(0);
          heights.value = next;
          changed = true;
        }
        for (const [i, el] of itemEls) {
          if (!el || typeof el.offsetHeight !== 'number') continue;
          const h = Math.round(el.offsetHeight);
          if (h > 0 && heights.value[i] !== h) { heights.value[i] = h; changed = true; }
        }
        if (changed) version.value++;
      });
    }

    function onScroll() {
      const el = boxRef.value;
      if (el) scrollTop.value = el.scrollTop;
    }

    function syncViewport() {
      const el = boxRef.value;
      if (el) viewportH.value = el.clientHeight;
    }

    let ro = null;
    onMounted(() => {
      syncViewport();
      measure();
      if (typeof ResizeObserver === 'function' && boxRef.value) {
        ro = new ResizeObserver(() => { syncViewport(); measure(); });
        ro.observe(boxRef.value);
      }
    });
    onBeforeUnmount(() => {
      if (ro) { ro.disconnect(); ro = null; }
      itemEls.clear();
    });

    // 换数据集（如切换指令分组）：清空测量结果并回到顶部
    watch(() => props.items, () => {
      heights.value = [];
      version.value++;
      if (boxRef.value) boxRef.value.scrollTop = 0;
      scrollTop.value = 0;
      itemEls.clear();
      measure();
    });
    // 同组内增删条目：重新测量
    watch(() => props.items.length, () => { measure(); });

    return { boxRef, onScroll, visible, totalHeight, setItemEl };
  }
};
</script>

<template>
  <div ref="boxRef" class="vlist" @scroll.passive="onScroll">
    <div class="vlist-inner" :style="{ height: totalHeight + 'px' }">
      <div
        v-for="row in visible"
        :key="row.key"
        :ref="(el) => setItemEl(row.index, el)"
        class="vlist-item"
        :style="{ top: row.top + 'px' }"
      >
        <slot :item="row.item" :index="row.index"></slot>
      </div>
    </div>
  </div>
</template>
