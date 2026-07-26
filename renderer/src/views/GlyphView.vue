<template>
      <div class="tool-pane">
        <div class="pane-top">
          <div>
            <div class="pt-title">
              <span style="display:inline-flex;align-items:center;gap:7px;">
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
            <!-- 输入区 - 新卡片设计 -->
            <div class="gl-card" style="overflow:hidden;">
              <div class="gl-card-head" style="display:flex;align-items:center;gap:8px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
                输入文字
                <span style="flex:1;"></span>
                <span style="font-size:11px;font-weight:400;color:var(--text-dim);">{{ (gl.text || '').length }} 字</span>
              </div>
              <div class="gl-card-body" style="gap:8px;">
                <div class="gl-input">
                  <el-input v-model="gl.text" type="textarea" :rows="3" resize="none"
                    placeholder="输入要生成字模的文字…（可多字，含中英文/符号）"
                    style="font-size:15px;" />
                </div>
              </div>
            </div>

            <!-- 预览区 - 新卡片设计 -->
            <div class="gl-card" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;">
              <div class="gl-card-head" style="display:flex;align-items:center;gap:8px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="2" width="20" height="20" rx="3"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>
                点阵预览
                <span style="flex:1;"></span>
                <span v-if="gl.glyphs.length" style="font-size:11px;color:var(--accent);">{{ gl.size }}×{{ gl.size }} · {{ gl.glyphs.length }} 个字模</span>
              </div>
              <div class="gl-preview" style="flex:1;min-height:0;overflow:auto;padding:16px;display:flex;flex-wrap:wrap;gap:14px;align-content:flex-start;background:var(--bg);border:none;border-radius:0;">
                <div v-if="!gl.glyphs.length" class="gl-empty" style="margin:auto;text-align:center;padding:32px;">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".25" style="display:block;margin:0 auto 12px;"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
                  <div style="font-size:13px;color:var(--text-dim);">输入文字后自动生成点阵预览</div>
                  <div style="font-size:11px;color:var(--text-dim);margin-top:4px;">试试输入"你好世界"</div>
                </div>
                <div v-for="(g, gi) in gl.glyphs" :key="gi" class="gl-cell">
                  <canvas :data-gi="gi" class="gl-canvas" style="background:#0b1220;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.18);image-rendering:pixelated;"></canvas>
                  <span class="gl-ch" style="font-size:12px;color:var(--text-soft);">{{ g.ch }}</span>
                </div>
              </div>
            </div>

            <!-- 输出区 - 新卡片设计 -->
            <div class="gl-card gl-out-card" style="display:flex;flex-direction:column;min-height:160px;max-height:32%;overflow:hidden;">
              <div class="gl-card-head" style="display:flex;align-items:center;gap:8px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                <span>生成结果</span>
                <span style="flex:1;"></span>
                <span style="font-size:11px;color:var(--text-dim);font-family:var(--mono);">{{ gl.output ? gl.output.length + ' B' : '' }}</span>
              </div>
              <div class="gl-out-head" style="display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid var(--border);background:var(--panel-2);">
                <span style="font-size:12px;color:var(--text-soft);flex:1;">字模代码 · {{ gl.negative ? '阴码' : '阳码' }} · {{ {col:'逐列式',row:'逐行式',colrow:'列行式',rowcol:'行列式'}[gl.scan] }}</span>
                <el-button size="small" :icon="CopyDocument" @click="copyGlyph" :disabled="!gl.output" round>复制</el-button>
                <el-button size="small" type="primary" :icon="Download" @click="downloadGlyph" :disabled="!gl.output" round>导出 .h</el-button>
              </div>
              <pre class="gl-out" style="flex:1;overflow:auto;margin:0;padding:11px 13px;font-family:var(--mono);font-size:12.5px;line-height:1.5;color:var(--text);white-space:pre;user-select:text;background:var(--term-bg);">{{ gl.output || '/* 输入文字后自动生成字模代码 */' }}</pre>
            </div>
          </div>

          <div class="gl-side">
            <div class="gl-card" style="border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04);">
              <div class="gl-card-head" style="display:flex;align-items:center;gap:7px;padding:9px 13px;font-size:13px;font-weight:600;color:var(--text);border-bottom:1px solid var(--border);background:var(--panel-2);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                字体设置
              </div>
              <div class="gl-card-body" style="padding:12px 13px;display:flex;flex-direction:column;gap:12px;">
                <div class="gl-field"><label style="font-size:12px;color:var(--text-soft);">字体</label>
                  <el-select v-model="gl.font" size="small" style="width:100%;">
                    <el-option label="宋体 SimSun" value="SimSun" />
                    <el-option label="黑体 SimHei" value="SimHei" />
                    <el-option label="微软雅黑 YaHei" value="Microsoft YaHei" />
                    <el-option label="楷体 KaiTi" value="KaiTi" />
                    <el-option label="新宋体 NSimSun" value="NSimSun" />
                    <el-option label="等宽 Consolas" value="Consolas" />
                    <el-option label="Arial" value="Arial" />
                  </el-select>
                </div>
                <div class="gl-field"><label style="font-size:12px;color:var(--text-soft);">点阵大小</label>
                  <el-select v-model.number="gl.size" size="small" style="width:100%;">
                    <el-option label="8 × 8" :value="8" />
                    <el-option label="12 × 12" :value="12" />
                    <el-option label="16 × 16" :value="16" />
                    <el-option label="24 × 24" :value="24" />
                    <el-option label="32 × 32" :value="32" />
                  </el-select>
                </div>
                <div class="gl-field" style="flex-direction:row;align-items:center;gap:10px;">
                  <el-checkbox v-model="gl.bold" size="small">加粗</el-checkbox>
                </div>
                <div class="gl-field"><label style="font-size:12px;color:var(--text-soft);">二值化阈值 {{ gl.threshold }}</label>
                  <el-slider v-model="gl.threshold" :min="20" :max="240" size="small" />
                </div>
                <div class="gl-field"><label style="font-size:12px;color:var(--text-soft);">位置微调 X / Y</label>
                  <div style="display:flex;gap:8px;">
                    <el-input-number v-model="gl.offX" :min="-16" :max="16" size="small" controls-position="right" style="width:50%;" />
                    <el-input-number v-model="gl.offY" :min="-16" :max="16" size="small" controls-position="right" style="width:50%;" />
                  </div>
                </div>
              </div>
            </div>

            <div class="gl-card" style="border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04);">
              <div class="gl-card-head" style="display:flex;align-items:center;gap:7px;padding:9px 13px;font-size:13px;font-weight:600;color:var(--text);border-bottom:1px solid var(--border);background:var(--panel-2);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                取模选项
              </div>
              <div class="gl-card-body" style="padding:12px 13px;display:flex;flex-direction:column;gap:12px;">
                <div class="gl-field"><label style="font-size:12px;color:var(--text-soft);">点阵格式</label>
                  <el-radio-group v-model="gl.negative" size="small">
                    <el-radio-button :value="true">阴码</el-radio-button>
                    <el-radio-button :value="false">阳码</el-radio-button>
                  </el-radio-group>
                </div>
                <div class="gl-field"><label style="font-size:12px;color:var(--text-soft);">取模方式</label>
                  <el-radio-group v-model="gl.scan" size="small" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
                    <el-radio-button value="col" style="width:auto;">逐列式</el-radio-button>
                    <el-radio-button value="row" style="width:auto;">逐行式</el-radio-button>
                    <el-radio-button value="colrow" style="width:auto;">列行式</el-radio-button>
                    <el-radio-button value="rowcol" style="width:auto;">行列式</el-radio-button>
                  </el-radio-group>
                </div>
                <div class="gl-field"><label style="font-size:12px;color:var(--text-soft);">取模走向</label>
                  <el-radio-group v-model="gl.msb" size="small" style="display:flex;flex-direction:column;gap:4px;">
                    <el-radio-button :value="true">顺向（高位在前）</el-radio-button>
                    <el-radio-button :value="false">逆向（低位在前）</el-radio-button>
                  </el-radio-group>
                </div>
                <div class="gl-field"><label style="font-size:12px;color:var(--text-soft);">输出数制</label>
                  <el-radio-group v-model="gl.radix" size="small">
                    <el-radio-button value="hex">十六进制</el-radio-button>
                    <el-radio-button value="dec">十进制</el-radio-button>
                  </el-radio-group>
                </div>
                <div class="gl-field"><label style="font-size:12px;color:var(--text-soft);">每行数据个数</label>
                  <el-input-number v-model.number="gl.perLine" :min="1" :max="64" size="small" controls-position="right" style="width:100%;" />
                </div>
                <div class="gl-field"><el-checkbox v-model="gl.comment" size="small">输出索引注释 /*"字",序号*/</el-checkbox></div>
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
