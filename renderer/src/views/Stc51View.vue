<template>
      <div class="tool-pane">
        <div class="pane-top">
          <div><div class="pt-title">StcGal</div><div class="pt-sub">STC 89/90/12/15/8/32 · UART / USB BSL · stcgal wrapper</div></div>
          <div class="spacer"></div>
          <div class="status-pill" :class="stcStatusKind"><span class="dot"></span>{{ stcStatusText }}</div>
        </div>

        <div class="stc-body">
          <div class="stc-main">
            <div class="card ops-panel stc-panel">
              <div class="ops-section stc-hero">
                <div>
                  <span class="eyebrow">StcGal</span>
                  <div class="title">STC 单片机 ISP 下载器</div>
                  <div class="hint">支持自动协议检测、代码区 / EEPROM 镜像、仅擦除、DTR/RTS 自动复位、RC Trim 与 Option 写入。</div>
                </div>
                <div class="stc-tool-state" :class="{ ok: stc51.toolOk, installing: stc51.installing }">
                  <div class="sts-head">
                    <span class="sts-title">
                      <el-icon :class="{ 'is-spin': stc51.installing }"><component :is="stc51.toolOk ? 'CircleCheck' : (stc51.installing ? 'Download' : 'InfoFilled')" /></el-icon>
                      {{ stc51.toolOk ? 'stcgal 已就绪' : (stc51.installing ? '正在安装 stcgal…' : '需要安装 stcgal') }}
                    </span>
                    <el-tag v-if="stc51.toolOk" size="small" :type="stc51.toolLocal ? 'success' : 'info'" effect="dark" round>
                      {{ stc51.toolLocal ? '项目环境' : '系统环境' }}
                    </el-tag>
                  </div>
                  <code>{{ stc51.toolOk ? (stc51.toolCommand || stc51.toolVersion || 'stcgal') : '将安装到项目目录 toolchain/stcgal（独立 venv，与 pyOCD/OpenOCD 一致）' }}</code>
                  <div v-if="stc51.toolOk && stc51.toolVersion" class="sts-ver">{{ stc51.toolVersion }}</div>
                  <div v-if="!stc51.toolOk" class="sts-actions">
                    <el-button type="primary" size="small" :icon="Download" :loading="stc51.installing" @click="installStcTool">
                      {{ stc51.installing ? '安装中…' : '安装到项目环境' }}
                    </el-button>
                    <el-button text size="small" :icon="RefreshRight" :disabled="stc51.installing" @click="() => checkStcTool()">重新检测</el-button>
                  </div>
                </div>
              </div>

              <div class="ops-section stc-grid">
                <div class="stc-card">
                  <div class="stc-card-h"><el-icon><Connection /></el-icon><span>连接与协议</span></div>
                  <div class="field"><label>协议</label>
                    <el-select v-model="stc51.protocol" placeholder="自动识别" style="width:100%;" @change="persistStc51Config">
                      <el-option v-for="p in STC_PROTOCOLS" :key="p.value" :label="p.label" :value="p.value" />
                    </el-select>
                  </div>
                  <div class="field"><label>串口</label>
                    <div class="stc-inline">
                      <el-select v-model="stc51.portPath" :disabled="stc51.protocol === 'usb15'" placeholder="选择 USB 转串口" filterable @change="(v) => { pickStcPort(v); persistStc51Config(); }" style="flex:1;">
                        <el-option v-for="p in stc51.ports" :key="p.path" :label="stcPortLabel(p)" :value="p.path" />
                      </el-select>
                      <el-button :icon="RefreshRight" :loading="stc51.portsLoading" @click="refreshStcPorts">刷新</el-button>
                    </div>
                    <div class="set-hint">{{ stc51.protocol === 'usb15' ? 'USB15 模式会忽略串口和波特率参数。' : (stc51.portSub || '请使用 CH340 / CP210x / FTDI 等 USB 转串口连接 STC 单片机 UART。') }}</div>
                  </div>
                </div>

                <div class="stc-card">
                  <div class="stc-card-h"><el-icon><DataLine /></el-icon><span>通信与复位</span></div>
                  <div class="field"><label>下载 / 握手波特率</label>
                    <div class="stc-inline">
                      <el-select v-model.number="stc51.baudRate" :disabled="stc51.protocol === 'usb15'" style="flex:1;" @change="persistStc51Config">
                        <el-option v-for="b in stcBaudRates" :key="b" :label="String(b)" :value="b" />
                      </el-select>
                      <el-select v-model.number="stc51.handshakeBaud" :disabled="stc51.protocol === 'usb15'" style="width:112px;" @change="persistStc51Config">
                        <el-option v-for="b in stcHandshakeRates" :key="b" :label="String(b)" :value="b" />
                      </el-select>
                    </div>
                  </div>
                  <div class="field"><el-checkbox v-model="stc51.autoReset" size="small" @change="persistStc51Config">自动复位 / 上电（-a）</el-checkbox></div>
                  <div class="stc-inline">
                    <el-select v-model="stc51.resetPin" :disabled="!stc51.autoReset && !stc51.resetCmd" style="width:128px;" @change="persistStc51Config">
                      <el-option v-for="p in STC_RESET_PINS" :key="p.value" :label="p.label" :value="p.value" />
                    </el-select>
                    <el-input v-model="stc51.resetCmd" placeholder="可选 resetcmd，如 ./powercycle.sh" @change="persistStc51Config" />
                  </div>
                  <div class="set-hint">不启用自动复位时，按 STC-ISP 流程：点击下载后手动上电或复位。</div>
                </div>

                <div class="stc-card stc-file-card">
                  <div class="stc-card-h"><el-icon><Document /></el-icon><span>镜像文件</span></div>
                  <div class="stc-file-pick">
                    <el-button type="primary" :icon="FolderOpened" @click="selectStcFirmware">代码镜像</el-button>
                    <div class="stc-file-meta">
                      <b>{{ stcFirmwareLabel }}</b>
                      <span>{{ stc51.firmwarePath || 'code_image：.hex / .ihx / .ihex / .bin' }}</span>
                    </div>
                    <el-tag effect="plain" round>{{ stcFirmwareSizeLabel }}</el-tag>
                  </div>
                  <div class="stc-file-pick secondary">
                    <el-button :icon="FolderOpened" @click="selectStcEeprom">EEPROM</el-button>
                    <div class="stc-file-meta">
                      <b>{{ stcEepromLabel }}</b>
                      <span>{{ stc51.eepromPath || '可选 eeprom_image：作为第二个镜像参数传给 stcgal' }}</span>
                    </div>
                    <el-button v-if="stc51.eepromPath" text :icon="Close" @click="clearStcEeprom">清除</el-button>
                    <el-tag effect="plain" round>{{ stcEepromSizeLabel }}</el-tag>
                  </div>
                </div>
              </div>

              <div class="ops-section stc-advanced">
                <div class="stc-card compact">
                  <div class="stc-card-h"><el-icon><MagicStick /></el-icon><span>操作选项</span></div>
                  <div class="stc-checks">
                    <el-checkbox v-model="stc51.eraseOnly" size="small" @change="persistStc51Config">仅擦除 Flash（-e）</el-checkbox>
                    <el-checkbox v-model="stc51.debug" size="small" @change="persistStc51Config">调试输出（-D）</el-checkbox>
                  </div>
                </div>
                <div class="stc-card compact">
                  <div class="stc-card-h"><el-icon><Cpu /></el-icon><span>RC Trim</span></div>
                  <el-input v-model="stc51.trimKHz" placeholder="可选，如 24000（kHz，STC15/8 且内部时钟）" @change="persistStc51Config" />
                </div>
                <div class="stc-card compact wide">
                  <div class="stc-card-h"><el-icon><DataAnalysis /></el-icon><span>Options（-o key=value）</span></div>
                  <el-input v-model="stc51.optionsText" type="textarea" :rows="2" resize="none" placeholder="每行或逗号分隔，如 clock_source=internal&#10;reset_pin_enabled=true" @change="persistStc51Config" />
                </div>
              </div>

              <div class="ops-section stc-actions">
                <div class="stc-steps">
                  <div><b>1</b><span>选择协议、端口和镜像</span></div>
                  <div><b>2</b><span>断电后点击下载</span></div>
                  <div><b>3</b><span>上电或自动复位握手</span></div>
                </div>
                <div class="action-bar">
                  <el-button :icon="Connection" plain @click="checkStcTool">检测 StcGal</el-button>
                  <el-button class="one-shot" type="primary" :icon="Upload" :loading="stc51.busy" :disabled="!stcCanFlash" @click="doStcFlash">执行 StcGal</el-button>
                </div>
              </div>
            </div>

            <div class="progress-wrap" v-if="stc51.busy">
              <el-progress :percentage="100" :indeterminate="true" :duration="2" :stroke-width="6" :show-text="false" status="success" />
            </div>

            <div class="log-panel">
              <div class="log-toolbar">
                <span class="left"><span class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>StcGal 输出 <span style="color:var(--text-dim);font-weight:400;"><LogLineCount /></span></span>
                <span class="right">
                  <span @click="reverse = !reverse"><el-icon><Sort /></el-icon>{{ reverse ? '倒序' : '正序' }}</span>
                  <span @click="showTs = !showTs"><el-icon><Clock /></el-icon>{{ showTs ? '隐藏时间' : '显示时间' }}</span>
                  <span @click="copyLog"><el-icon><CopyDocument /></el-icon>复制</span>
                  <span @click="autoScroll = !autoScroll"><el-icon><component :is="autoScroll ? 'Bottom' : 'Minus'" /></el-icon>{{ autoScroll ? '自动滚动' : '已暂停' }}</span>
                </span>
              </div>
              <LogPanel v-if="tool === 'stc51'" pane="stc51" empty="等待 StcGal 操作…" />
            </div>
          </div>
        </div>
      </div>
</template>

<script>
import { inject } from 'vue';
import LogPanel from '../components/LogPanel.vue';
import LogLineCount from '../components/LogLineCount.vue';

export default {
  components: { LogPanel, LogLineCount },
  setup() {
    const app = inject('appContext');
    if (!app) throw new Error('appContext is not available');
    return app;
  },
};
</script>
