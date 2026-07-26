<template>
      <div class="tool-pane">
        <div class="pane-top">
          <div><div class="pt-title">固件分析</div><div class="pt-sub">ELF / AXF · memory usage / sections / symbols</div></div>
          <div class="spacer"></div>
          <div class="status-pill" :class="fw.busy ? 'busy' : (fw.ok ? 'ok' : fw.error ? 'err' : '')"><span class="dot"></span>{{ fw.busy ? '分析中…' : (fw.ok ? '已分析' : fw.error ? '分析失败' : '等待分析') }}</div>
        </div>
        <div class="fw-body">
          <div class="fw-top-card">
            <div>
              <div class="hw-kicker">Firmware Insight</div>
              <div class="fw-title">固件占用与符号分析</div>
              <div class="fw-sub">{{ fw.firmware || '选择工程并编译后，点击分析当前 ELF/AXF/MAP 文件。' }}</div>
            </div>
            <div class="fw-actions">
              <el-button type="primary" :loading="fw.busy" :icon="DataAnalysis" @click="doAnalyzeFirmware">分析当前工程</el-button>
            </div>
          </div>
          <div v-if="fw.error" class="fw-error">{{ fw.error }}</div>
          <div class="fw-metrics">
            <div class="fw-metric"><div class="fw-mh"><span>固件大小</span><b>{{ fmtFwBytes(fw.firmwareSize) }}</b></div><div class="fw-note">{{ fw.firmwareName || '未分析' }}</div></div>
            <div class="fw-metric"><div class="fw-mh"><span>Flash</span><b>{{ fw.flash.percent || 0 }}%</b></div><el-progress :percentage="fw.flash.percent || 0" :stroke-width="9" /><div class="fw-note">{{ fw.flash.label || '0 B' }}</div></div>
            <div class="fw-metric"><div class="fw-mh"><span>RAM</span><b>{{ fw.ram.percent || 0 }}%</b></div><el-progress :percentage="fw.ram.percent || 0" :stroke-width="9" /><div class="fw-note">{{ fw.ram.label || '0 B' }}</div></div>
          </div>
          <div class="fw-tables">
            <div class="fw-card">
              <div class="hw-card-h"><el-icon><Document /></el-icon><span>段大小</span></div>
              <div class="fw-table">
                <div class="fw-tr head"><span>Section</span><span>地址</span><span>大小</span></div>
                <div v-for="s in fw.sections" :key="s.name + s.addr" class="fw-tr"><span>{{ s.name }}</span><span>{{ s.addr }}</span><span>{{ s.sizeLabel || fmtFwBytes(s.size) }}</span></div>
                <div v-if="!fw.sections.length" class="fw-empty">暂无数据</div>
              </div>
            </div>
            <div class="fw-card">
              <div class="hw-card-h"><el-icon><DataLine /></el-icon><span>最大符号</span></div>
              <div class="fw-table">
                <div class="fw-tr head"><span>Symbol</span><span>类型</span><span>大小</span></div>
                <div v-for="s in fw.symbols.slice(0, 20)" :key="s.name + s.addr" class="fw-tr"><span>{{ s.name }}</span><span>{{ s.type || '-' }}</span><span>{{ s.sizeLabel || fmtFwBytes(s.size) }}</span></div>
                <div v-if="!fw.symbols.length" class="fw-empty">暂无数据</div>
              </div>
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
