<template>
      <div class="tool-pane">
        <div class="pane-top">
          <div><div class="pt-title">内存日志</div><div class="pt-sub">SRAM ring buffer · SWD polling · no serial required</div></div>
          <div class="spacer"></div>
          <div class="status-pill" :class="ramLogStatusKind"><span class="dot"></span>{{ ramLogStatusText }}</div>
        </div>
        <div class="ram-body">
          <div class="ram-hero">
            <div>
              <div class="hw-kicker">RAM Log Console</div>
              <div class="ram-title">从 MCU SRAM 读取日志</div>
              <div class="ram-sub">固件按约定结构写入环形缓冲区，工具通过 pyOCD/SWD 周期读取；地址、偏移、大小都可以动态配置。</div>
            </div>
            <div class="ram-meta">
              <div><span>系统</span><code>{{ systemRuntimeLabel }}</code></div>
              <div><span>目标</span><code>{{ ramLog.target || config.targetChip || '未配置' }}</code></div>
              <div><span>Magic</span><code :class="{ ok: ramLog.meta.magicOk }">{{ ramLog.meta.magicHex || '未读取' }}</code></div>
              <div><span>SEQ</span><code>{{ ramLog.meta.seq ?? '-' }}</code></div>
            </div>
          </div>
          <div class="ram-grid">
            <div class="ram-card ram-config">
              <div class="hw-card-h"><el-icon><Setting /></el-icon><span>协议配置</span></div>
              <div class="ram-form">
                <label>基地址</label><el-input v-model="ramLog.base" placeholder="0x20004800" />
                <label>缓冲区大小</label><el-input-number v-model="ramLog.size" :min="16" :max="16384" controls-position="right" />
                <label>轮询间隔(ms)</label><el-input-number v-model="ramLog.interval" :min="200" :max="10000" controls-position="right" />
                <label>Magic</label><el-input v-model="ramLog.magic" placeholder="0x524C4F47" />
                <div class="ram-switches">
                  <el-checkbox v-model="ramLog.ring">环形缓冲区</el-checkbox>
                  <el-checkbox v-model="ramLog.autoScroll">自动滚动</el-checkbox>
                </div>
                <label>编码</label>
                <el-select v-model="ramLog.encoding">
                  <el-option label="UTF-8" value="utf-8" />
                  <el-option label="GBK/GB18030" value="gb18030" />
                </el-select>
                <button class="ram-link" @click="ramLog.advanced = !ramLog.advanced">{{ ramLog.advanced ? '收起高级偏移' : '展开高级偏移' }}</button>
                <div v-if="ramLog.advanced" class="ram-offsets">
                  <label>magic</label><el-input-number v-model="ramLog.offsets.magic" :min="0" controls-position="right" />
                  <label>version</label><el-input-number v-model="ramLog.offsets.version" :min="0" controls-position="right" />
                  <label>size</label><el-input-number v-model="ramLog.offsets.size" :min="0" controls-position="right" />
                  <label>write_pos</label><el-input-number v-model="ramLog.offsets.writePos" :min="0" controls-position="right" />
                  <label>seq</label><el-input-number v-model="ramLog.offsets.seq" :min="0" controls-position="right" />
                  <label>data</label><el-input-number v-model="ramLog.offsets.data" :min="4" controls-position="right" />
                </div>
                <div class="ram-actions">
                  <el-button type="primary" :loading="ramLog.busy" @click="readRamLogOnce">读取一次</el-button>
                  <el-button :type="ramLog.running ? 'danger' : 'success'" :loading="ramLog.busy && ramLog.running" @click="toggleRamLog">{{ ramLog.running ? '停止轮询' : '开始轮询' }}</el-button>
                  <el-button plain @click="saveRamLogConfig">保存配置</el-button>
                </div>
              </div>
            </div>
            <div class="ram-card ram-console">
              <div class="ram-console-head">
                <div>
                  <div class="ram-console-title">实时日志</div>
                  <div class="ram-console-sub">write_pos={{ ramLog.meta.writePos ?? '-' }} · size={{ ramLog.meta.size || ramLog.size }} · version={{ ramLog.meta.version ?? '-' }}</div>
                </div>
                <div class="ram-tools">
                  <el-button size="small" :icon="CopyDocument" @click="copyRamLog">复制</el-button>
                  <el-button size="small" :icon="Delete" @click="clearRamLog">清空</el-button>
                </div>
              </div>
              <div v-if="ramLog.notice" class="ram-notice">{{ ramLog.notice }}</div>
              <div v-if="ramLog.error" class="ram-error">{{ ramLog.error }}</div>
              <RamLogText />
            </div>
            <div class="ram-card ram-contract">
              <div class="hw-card-h"><el-icon><Document /></el-icon><span>固件端结构约定</span></div>
              <pre>typedef struct {
  uint32_t magic;      // 0x524C4F47 "RLOG"
  uint32_t version;
  uint32_t size;
  uint32_t write_pos;
  uint32_t seq;
  uint8_t  buf[1024];
} RamLog;</pre>
              <div class="hw-tip">当前测试工程已固定到 <code>0x20004800</code>。</div>
            </div>
          </div>
        </div>
      </div>
</template>

<script>
import { inject } from 'vue';
import RamLogText from '../components/RamLogText.vue';

export default {
  components: { RamLogText },
  setup() {
    const app = inject('appContext');
    if (!app) throw new Error('appContext is not available');
    return app;
  },
};
</script>
