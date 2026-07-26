<template>
  <div class="tool-pane glyph-pane">
    <div class="pane-top">
      <div>
        <div class="pt-title">
          <span class="glyph-title-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/><rect x="4" y="7" width="16" height="13" rx="2"/></svg>
            字模生成
          </span>
        </div>
        <div class="pt-sub">点阵字模 · PCtoLCD2002 风格 · 实时预览</div>
      </div>
      <div class="spacer"></div>
      <div class="status-pill" :class="gl.glyphs.length ? 'ok' : ''">
        <span class="dot"></span>
        {{ gl.glyphs.length ? (gl.glyphs.length + ' 字 · ' + gl.size + '×' + gl.size) : '无字模' }}
      </div>
    </div>

    <div class="gl-body">
      <div class="gl-main">
        <div class="gl-card gl-input-card">
          <div class="gl-card-head">
            <span class="gl-card-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
              输入文字
            </span>
            <span class="gl-card-meta">{{ (gl.text || '').length }} 字</span>
          </div>
          <div class="gl-card-body">
            <el-input
              v-model="gl.text"
              class="gl-textarea"
              type="textarea"
              :rows="3"
              resize="none"
              placeholder="输入要生成字模的文字…（可多字，含中英文/符号）"
            />
          </div>
        </div>

        <div class="gl-card gl-preview-card">
          <div class="gl-card-head">
            <span class="gl-card-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="2" width="20" height="20" rx="3"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>
              点阵预览
            </span>
            <span v-if="gl.glyphs.length" class="gl-card-meta gl-accent-meta">{{ gl.size }}×{{ gl.size }} · {{ gl.glyphs.length }} 个字模</span>
          </div>
          <div class="gl-preview">
            <div v-if="!gl.glyphs.length" class="gl-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
              <div>输入文字后自动生成点阵预览</div>
              <small>试试输入“你好世界”</small>
            </div>
            <div v-for="(g, gi) in gl.glyphs" :key="gi" class="gl-cell">
              <div class="gl-canvas-shell">
                <canvas :data-gi="gi" class="gl-canvas"></canvas>
              </div>
              <span class="gl-ch">{{ g.ch }}</span>
              <span class="gl-index">字模 {{ String(gi + 1).padStart(2, '0') }}</span>
            </div>
          </div>
        </div>

        <div class="gl-card gl-out-card">
          <div class="gl-card-head">
            <span class="gl-card-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
              生成结果
            </span>
            <span class="gl-card-meta gl-byte-count">{{ gl.output ? gl.output.length + ' B' : '' }}</span>
          </div>
          <div class="gl-out-head">
            <span class="gl-out-summary">字模代码 · {{ gl.negative ? '阴码' : '阳码' }} · {{ {col:'逐列式',row:'逐行式',colrow:'列行式',rowcol:'行列式'}[gl.scan] }}</span>
            <div class="gl-out-actions">
              <el-button size="small" :icon="CopyDocument" @click="copyGlyph" :disabled="!gl.output" round>复制</el-button>
              <el-button size="small" type="primary" :icon="Download" @click="downloadGlyph" :disabled="!gl.output" round>导出 .h</el-button>
            </div>
          </div>
          <pre class="gl-out">{{ gl.output || '/* 输入文字后自动生成字模代码 */' }}</pre>
        </div>
      </div>

      <div class="gl-side gl-control-rail">
        <div class="gl-card gl-settings-card">
          <div class="gl-card-head">
            <span class="gl-card-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              字体设置
            </span>
            <span class="gl-header-note">渲染参数</span>
          </div>
          <div class="gl-card-body">
            <div class="gl-field"><label>字体</label>
              <el-select v-model="gl.font" size="small">
                <el-option label="宋体 SimSun" value="SimSun" />
                <el-option label="黑体 SimHei" value="SimHei" />
                <el-option label="微软雅黑 YaHei" value="Microsoft YaHei" />
                <el-option label="楷体 KaiTi" value="KaiTi" />
                <el-option label="新宋体 NSimSun" value="NSimSun" />
                <el-option label="等宽 Consolas" value="Consolas" />
                <el-option label="Arial" value="Arial" />
              </el-select>
            </div>
            <div class="gl-field"><label>点阵大小</label>
              <el-select v-model.number="gl.size" size="small">
                <el-option label="8 × 8" :value="8" />
                <el-option label="12 × 12" :value="12" />
                <el-option label="16 × 16" :value="16" />
                <el-option label="24 × 24" :value="24" />
                <el-option label="32 × 32" :value="32" />
              </el-select>
            </div>
            <div class="gl-inline-field"><el-checkbox v-model="gl.bold" size="small">加粗</el-checkbox></div>
            <div class="gl-field"><label>二值化阈值 <strong>{{ gl.threshold }}</strong></label>
              <el-slider v-model="gl.threshold" :min="20" :max="240" size="small" />
            </div>
            <div class="gl-field"><label>位置微调 <strong>X / Y</strong></label>
              <div class="gl-number-row">
                <el-input-number v-model="gl.offX" :min="-16" :max="16" size="small" controls-position="right" />
                <el-input-number v-model="gl.offY" :min="-16" :max="16" size="small" controls-position="right" />
              </div>
            </div>
          </div>
        </div>

        <div class="gl-card gl-options-card">
          <div class="gl-card-head">
            <span class="gl-card-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              取模选项
            </span>
            <span class="gl-header-note">编码输出</span>
          </div>
          <div class="gl-card-body">
            <div class="gl-field"><label>点阵格式</label>
              <el-radio-group v-model="gl.negative" size="small">
                <el-radio-button :value="true">阴码</el-radio-button>
                <el-radio-button :value="false">阳码</el-radio-button>
              </el-radio-group>
            </div>
            <div class="gl-field"><label>取模方式</label>
              <el-radio-group v-model="gl.scan" size="small" class="gl-scan-grid">
                <el-radio-button value="col">逐列式</el-radio-button>
                <el-radio-button value="row">逐行式</el-radio-button>
                <el-radio-button value="colrow">列行式</el-radio-button>
                <el-radio-button value="rowcol">行列式</el-radio-button>
              </el-radio-group>
            </div>
            <div class="gl-field"><label>取模走向</label>
              <el-radio-group v-model="gl.msb" size="small" class="gl-direction-group">
                <el-radio-button :value="true">顺向（高位在前）</el-radio-button>
                <el-radio-button :value="false">逆向（低位在前）</el-radio-button>
              </el-radio-group>
            </div>
            <div class="gl-field"><label>输出数制</label>
              <el-radio-group v-model="gl.radix" size="small">
                <el-radio-button value="hex">十六进制</el-radio-button>
                <el-radio-button value="dec">十进制</el-radio-button>
              </el-radio-group>
            </div>
            <div class="gl-field"><label>每行数据个数</label>
              <el-input-number v-model.number="gl.perLine" :min="1" :max="64" size="small" controls-position="right" />
            </div>
            <div class="gl-inline-field"><el-checkbox v-model="gl.comment" size="small">输出索引注释 /*"字",序号*/</el-checkbox></div>
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
