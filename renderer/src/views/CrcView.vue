<template>
  <div class="tool-pane">
    <div class="pane-top">
      <div>
        <div class="pt-title">CRC 校验</div>
        <div class="pt-sub">Checksum / CRC8 / CRC16 / CRC32 · 串口协议常用</div>
      </div>
      <div class="spacer"></div>
      <div class="status-pill" :class="crc.result ? 'ok' : crc.error ? 'err' : ''">
        <span class="dot"></span>
        {{ crc.result ? (crc.result.label + ' · ' + crc.result.hexPrefixed) : (crc.error || '等待输入') }}
      </div>
    </div>

    <div class="crc-body">
      <div class="crc-main">
        <section class="crc-card">
          <div class="crc-card-h">
            <div>
              <div class="crc-kicker">Input</div>
              <strong>数据输入</strong>
              <small>支持 HEX / ASCII / 十进制字节</small>
            </div>
            <div class="crc-actions">
              <el-button size="small" @click="useSampleCrc">示例</el-button>
              <el-button size="small" @click="clearCrcInput">清空</el-button>
              <el-button size="small" type="primary" @click="pushCrcHistory">记录结果</el-button>
            </div>
          </div>

          <div class="crc-grid">
            <div class="field">
              <label>算法</label>
              <el-select v-model="crc.algo" filterable>
                <el-option
                  v-for="item in crcAlgorithms"
                  :key="item.id"
                  :label="item.label"
                  :value="item.id"
                />
              </el-select>
            </div>
            <div class="field">
              <label>输入格式</label>
              <el-segmented v-model="crc.inputMode" :options="[
                { label: 'HEX', value: 'hex' },
                { label: 'ASCII', value: 'ascii' },
                { label: 'DEC', value: 'dec' },
              ]" />
            </div>
            <div class="field crc-check-row">
              <el-checkbox v-model="crc.invert">结果取反</el-checkbox>
              <el-checkbox v-model="crc.appendResult">附加到帧尾</el-checkbox>
            </div>
          </div>

          <div class="field">
            <label>原始数据</label>
            <el-input
              v-model="crc.input"
              type="textarea"
              :rows="8"
              resize="none"
              :placeholder="crc.inputMode === 'hex'
                ? '例如：01 03 00 00 00 0A'
                : (crc.inputMode === 'ascii' ? '例如：Hello' : '例如：1 3 0 0 0 10')"
            />
          </div>

          <div class="crc-meta">
            <span class="crc-chip">长度 {{ crcPreviewBytes.length }} B</span>
            <span class="crc-chip mono" :title="crcPreviewBytes.hex || ''">
              {{ crcPreviewBytes.ok ? (crcPreviewBytes.hex || '空数据') : crcPreviewBytes.error }}
            </span>
          </div>
        </section>

        <section class="crc-card">
          <div class="crc-card-h">
            <div>
              <div class="crc-kicker">Result</div>
              <strong>校验结果</strong>
              <small>自动计算，可直接复制</small>
            </div>
            <div class="crc-actions">
              <el-button size="small" :disabled="!crc.result" @click="copyCrcResult('hex')">复制 0x</el-button>
              <el-button size="small" :disabled="!crc.result" @click="copyCrcResult('bytes')">复制字节</el-button>
              <el-button size="small" type="primary" :disabled="!crc.result" @click="copyCrcResult('frame')">复制完整帧</el-button>
            </div>
          </div>

          <div v-if="crc.error" class="crc-error">{{ crc.error }}</div>
          <div v-else-if="crc.result" class="crc-result-grid">
            <div class="crc-result-main">
              <div class="crc-result-label">{{ crc.result.label }}</div>
              <div class="crc-result-value">{{ crc.result.hexPrefixed }}</div>
              <div class="crc-result-sub">十进制 {{ crc.result.value }} · {{ crc.result.width }} bit</div>
            </div>
            <div class="crc-kv">
              <div><span>HEX</span><b>{{ crc.result.hex }}</b></div>
              <div><span>字节序</span><b class="mono">{{ crc.result.bytesHex || '-' }}</b></div>
              <div><span>完整帧</span><b class="mono">{{ crcFrameHex || '-' }}</b></div>
              <div><span>数据长度</span><b>{{ crc.result.length }} 字节</b></div>
            </div>
          </div>
          <div v-else class="crc-empty">输入数据后自动计算校验值</div>
        </section>
      </div>

      <aside class="crc-side">
        <section class="crc-card crc-side-card">
          <div class="crc-card-h compact">
            <div>
              <div class="crc-kicker">History</div>
              <strong>最近结果</strong>
            </div>
          </div>
          <div v-if="!crc.history.length" class="crc-empty">暂无记录</div>
          <div v-else class="crc-history">
            <button
              v-for="item in crc.history"
              :key="item.id"
              class="crc-history-item"
              type="button"
              @click="copyTextSafe(item.hex)"
              :title="item.input"
            >
              <div class="row">
                <span class="name">{{ item.algo }}</span>
                <span class="time">{{ item.time }}</span>
              </div>
              <div class="hex mono">{{ item.hex }}</div>
              <div class="input mono">{{ item.input || '(空)' }}</div>
            </button>
          </div>
        </section>

        <section class="crc-card crc-side-card">
          <div class="crc-card-h compact">
            <div>
              <div class="crc-kicker">Tips</div>
              <strong>使用说明</strong>
            </div>
          </div>
          <ul class="crc-tips">
            <li>串口 Modbus 常用 <b>CRC-16/MODBUS</b></li>
            <li>XMODEM / 部分嵌入式协议常用 <b>CRC-16/XMODEM</b></li>
            <li>文件与固件校验常用 <b>CRC-32</b></li>
            <li>开启“附加到帧尾”后，可直接复制完整发送帧</li>
          </ul>
        </section>
      </aside>
    </div>
  </div>
</template>

<script>
import { inject } from 'vue';
import { copyText } from '../util.js';

export default {
  setup() {
    const app = inject('appContext');
    if (!app) throw new Error('appContext is not available');
    async function copyTextSafe(text) {
      try {
        await copyText(text);
        ElMessage.success('已复制');
      } catch {
        ElMessage.error('复制失败');
      }
    }
    return { ...app, copyTextSafe };
  },
};
</script>
