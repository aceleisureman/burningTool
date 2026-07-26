<template>
      <div class="tool-pane">
        <div class="pane-top">
          <div><div class="pt-title">硬件调试</div><div class="pt-sub">probe · reset / erase / memory read-write</div></div>
          <div class="spacer"></div>
          <div class="status-pill" :class="hw.busy ? 'busy' : (hw.lastOk === true ? 'ok' : hw.lastOk === false ? 'err' : '')"><span class="dot"></span>{{ hw.busy ? '执行中…' : (hw.lastOk === true ? '已完成' : hw.lastOk === false ? '失败' : '待连接') }}</div>
        </div>
        <div class="hw-body">
          <div class="hw-grid">
            <div class="hw-card hw-hero">
              <div>
                <div class="hw-kicker">Hardware Deck</div>
                <div class="hw-title">探针与芯片状态</div>
                <div class="hw-sub">复用当前设置里的 pyOCD、目标芯片和复位下连接参数。</div>
              </div>
              <div class="hw-actions">
                <el-button type="primary" :icon="Connection" :loading="hw.busy && hw.action === 'probe'" @click="hwCheckProbe">检测探针</el-button>
                <el-button :icon="Cpu" :loading="hw.busy && hw.action === 'chip'" @click="hwReadChip">读取芯片</el-button>
              </div>
              <div class="hw-info">
                <div><span>pyOCD</span><code>{{ hw.pyocd || '未检测' }}</code></div>
                <div><span>探针</span><code>{{ hw.probe || '未检测' }}</code></div>
                <div><span>目标</span><code>{{ hw.target || config.targetChip || '未配置' }}</code></div>
                <div><span>DEV_ID</span><code>{{ hw.devid || '未读取' }}</code></div>
              </div>
            </div>
            <div class="hw-card">
              <div class="hw-card-h"><el-icon><SwitchButton /></el-icon><span>CPU 控制</span></div>
              <div class="hw-btn-grid">
                <el-button :loading="hw.busy && hw.action === 'reset'" @click="runHwCommand('reset')">复位运行</el-button>
                <el-button :loading="hw.busy && hw.action === 'halt'" @click="runHwCommand('halt')">暂停 CPU</el-button>
                <el-button :loading="hw.busy && hw.action === 'resume'" @click="runHwCommand('resume')">继续运行</el-button>
                <el-button type="danger" plain :loading="hw.busy && hw.action === 'erase'" @click="confirmHwErase">整片擦除</el-button>
              </div>
              <div class="hw-tip">整片擦除会清空 Flash，执行前会二次确认。</div>
            </div>
            <div class="hw-card">
              <div class="hw-card-h"><el-icon><DataLine /></el-icon><span>内存读写</span></div>
              <div class="hw-form">
                <label>地址</label>
                <el-input v-model="hw.address" placeholder="0x20000000" />
                <label>读取数量 / 写入值</label>
                <div class="hw-inline">
                  <el-input-number v-model="hw.count" :min="1" :max="256" controls-position="right" />
                  <el-input v-model="hw.value" placeholder="0x12345678" />
                </div>
                <div class="hw-actions-row">
                  <el-button type="primary" :loading="hw.busy && hw.action === 'read32'" @click="runHwCommand('read32')">读取 32-bit</el-button>
                  <el-button :loading="hw.busy && hw.action === 'write32'" @click="runHwCommand('write32')">写入 32-bit</el-button>
                </div>
                <div class="hw-tip">写入仅用于 SRAM/外设寄存器调试；Flash 区请用烧录或擦除。</div>
              </div>
            </div>
            <div class="hw-card hw-result">
              <div class="hw-card-h"><el-icon><Document /></el-icon><span>执行结果</span></div>
              <pre>{{ hw.output || '暂无结果。点击左侧动作后，这里显示 pyOCD 输出。' }}</pre>
            </div>
          </div>
        </div>
      </div>
</template>

<script>
import { inject } from 'vue';

export default {
  setup() {
    const app = inject('appContext');
    if (!app) throw new Error('appContext is not available');
    return app;
  },
};
</script>
