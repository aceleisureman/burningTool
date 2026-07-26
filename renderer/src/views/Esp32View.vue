<template>
      <div class="tool-pane">
        <div class="pane-top">
          <div><div class="pt-title">ESP32 烧录</div><div class="pt-sub">ESP32 / S2 / S3 / C3 / C6 / H2 / ESP8266 · UART · esptool wrapper</div></div>
          <div class="spacer"></div>
          <div class="status-pill" :class="espStatusKind"><span class="dot"></span>{{ espStatusText }}</div>
        </div>

        <div class="stc-body">
          <div class="stc-main">
            <div class="card ops-panel stc-panel">
              <div class="ops-section stc-hero">
                <div>
                  <span class="eyebrow">esptool</span>
                  <div class="title">ESP 系列 UART 下载器</div>
                  <div class="hint">通过 esptool 经串口烧录 .bin 固件，支持单合并镜像或多 offset 分区（bootloader / partitions / app）、全片擦除与读取 MAC。</div>
                </div>
                <div class="stc-tool-state" :class="{ ok: esp32.toolOk, installing: esp32.installing }">
                  <div class="sts-head">
                    <span class="sts-title">
                      <el-icon :class="{ 'is-spin': esp32.installing }"><component :is="esp32.toolOk ? 'CircleCheck' : (esp32.installing ? 'Download' : 'InfoFilled')" /></el-icon>
                      {{ esp32.toolOk ? 'esptool 已就绪' : (esp32.installing ? '正在安装 esptool…' : '需要安装 esptool') }}
                    </span>
                    <el-tag v-if="esp32.toolOk" size="small" :type="esp32.toolLocal ? 'success' : 'info'" effect="dark" round>
                      {{ esp32.toolLocal ? '项目环境' : '系统环境' }}
                    </el-tag>
                  </div>
                  <code>{{ esp32.toolOk ? (esp32.toolCommand || esp32.toolVersion || 'esptool') : '将安装到项目目录 toolchain/esptool（独立 venv，与 pyOCD/stcgal 一致）' }}</code>
                  <div v-if="esp32.toolOk && esp32.toolVersion" class="sts-ver">{{ esp32.toolVersion }}</div>
                  <div v-if="!esp32.toolOk" class="sts-actions">
                    <el-button type="primary" size="small" :icon="Download" :loading="esp32.installing" @click="installEspTool">
                      {{ esp32.installing ? '安装中…' : '安装到项目环境' }}
                    </el-button>
                    <el-button text size="small" :icon="RefreshRight" :disabled="esp32.installing" @click="() => checkEspTool()">重新检测</el-button>
                  </div>
                </div>
              </div>

              <div class="ops-section stc-grid stc-grid-esp">
                <div class="stc-card">
                  <div class="stc-card-h"><el-icon><Cpu /></el-icon><span>芯片与串口</span></div>
                  <div class="field"><label>芯片型号</label>
                    <el-select v-model="esp32.chip" style="width:100%;" @change="persistEsp32Config">
                      <el-option v-for="c in ESP_CHIPS" :key="c.value" :label="c.label" :value="c.value" />
                    </el-select>
                  </div>
                  <div class="field"><label>串口</label>
                    <div class="stc-inline">
                      <el-select v-model="esp32.portPath" placeholder="选择 USB 转串口" filterable @change="(v) => { pickEspPort(v); persistEsp32Config(); }" style="flex:1;">
                        <el-option v-for="p in esp32.ports" :key="p.path" :label="espPortLabel(p)" :value="p.path" />
                      </el-select>
                      <el-button :icon="RefreshRight" :loading="esp32.portsLoading" @click="refreshEspPorts">刷新</el-button>
                    </div>
                    <div class="set-hint">{{ esp32.portSub || '请使用 CH340 / CP210x / 内置 USB-JTAG 等连接 ESP 模组。' }}</div>
                  </div>
                </div>

                <div class="stc-card">
                  <div class="stc-card-h"><el-icon><DataLine /></el-icon><span>通信与复位</span></div>
                  <div class="field"><label>波特率</label>
                    <el-select v-model.number="esp32.baudRate" style="width:100%;" @change="persistEsp32Config">
                      <el-option v-for="b in ESP_BAUDS" :key="b" :label="String(b)" :value="b" />
                    </el-select>
                  </div>
                  <div class="field"><label>复位时序（before / after）</label>
                    <div class="stc-inline">
                      <el-select v-model="esp32.beforeReset" style="flex:1;" @change="persistEsp32Config">
                        <el-option v-for="r in ESP_BEFORE" :key="r.value" :label="r.label" :value="r.value" />
                      </el-select>
                      <el-select v-model="esp32.afterReset" style="flex:1;" @change="persistEsp32Config">
                        <el-option v-for="r in ESP_AFTER" :key="r.value" :label="r.label" :value="r.value" />
                      </el-select>
                    </div>
                    <div class="set-hint">自动下载电路（DTR/RTS）通常用默认复位；无自动电路时选「不复位」并手动进入下载模式（按住 BOOT 再复位）。</div>
                  </div>
                </div>

                <div class="stc-card">
                  <div class="stc-card-h"><el-icon><MagicStick /></el-icon><span>Flash 参数</span></div>
                  <div class="field"><label>模式 / 频率 / 大小</label>
                    <div class="stc-inline">
                      <el-select v-model="esp32.flashMode" style="flex:1;min-width:0;" @change="persistEsp32Config">
                        <el-option v-for="m in ESP_FLASH_MODES" :key="m" :label="m" :value="m" />
                      </el-select>
                      <el-select v-model="esp32.flashFreq" style="flex:1;min-width:0;" @change="persistEsp32Config">
                        <el-option v-for="f in ESP_FLASH_FREQS" :key="f" :label="f" :value="f" />
                      </el-select>
                      <el-select v-model="esp32.flashSize" style="flex:1;min-width:0;" @change="persistEsp32Config">
                        <el-option v-for="s in ESP_FLASH_SIZES" :key="s" :label="s" :value="s" />
                      </el-select>
                    </div>
                  </div>
                  <div class="field"><label>选项</label>
                    <el-checkbox v-model="esp32.eraseBeforeWrite" size="small" @change="persistEsp32Config">烧录前先擦除整片（--erase-all）</el-checkbox>
                  </div>
                </div>
              </div>

              <div class="ops-section esp-fw-row">
                <div class="stc-card stc-file-card">
                  <div class="stc-card-h">
                    <el-icon><Document /></el-icon><span>固件镜像</span>
                    <div class="spacer"></div>
                    <el-checkbox v-model="esp32.partMode" size="small" @change="persistEsp32Config">多 bin 分区</el-checkbox>
                  </div>
                  <template v-if="!esp32.partMode">
                    <div class="esp-single-pick">
                      <div class="stc-file-pick">
                        <el-button type="primary" :icon="FolderOpened" @click="selectEspFirmware">选择 .bin</el-button>
                        <div class="stc-file-meta">
                          <b>{{ espFirmwareLabel }}</b>
                          <span>{{ esp32.firmwarePath || '单合并镜像：merged bin（含 bootloader/分区表/app）' }}</span>
                        </div>
                        <el-tag effect="plain" round>{{ espFirmwareSizeLabel }}</el-tag>
                      </div>
                      <div class="field esp-offset"><label>烧录地址 offset</label>
                        <el-input v-model="esp32.flashOffset" placeholder="如 0x0 / 0x10000" @change="persistEsp32Config" />
                      </div>
                    </div>
                    <div class="set-hint">ESP8266 单文件通常 offset=0x0；多 bin 请开启「多 bin 分区」。</div>
                  </template>
                  <template v-else>
                    <div class="esp-preset-bar">
                      <el-select
                        v-model="esp32.activePresetId"
                        clearable
                        filterable
                        placeholder="选择已保存方案"
                        style="flex:1;"
                        @change="(id) => id && applyEspPreset(id)"
                      >
                        <el-option
                          v-for="item in esp32.presets"
                          :key="item.id"
                          :label="item.name + (item.chip ? ` · ${item.chip}` : '')"
                          :value="item.id"
                        />
                      </el-select>
                      <el-input v-model="esp32.presetName" placeholder="方案名称，如 8266-OTA" style="width:160px;" @keyup.enter="saveEspPreset()" />
                      <el-button type="primary" size="small" @click="saveEspPreset()">保存方案</el-button>
                      <el-button size="small" :disabled="!esp32.activePresetId" @click="deleteEspPreset()">删除</el-button>
                    </div>

                    <div class="esp-template-bar">
                      <span class="set-hint" style="margin:0;">模板：</span>
                      <el-button size="small" plain @click="applyEspPartTemplate('esp8266_single')">ESP8266 单 app</el-button>
                      <el-button size="small" plain @click="applyEspPartTemplate('esp8266_classic')">ESP8266 多 bin</el-button>
                      <el-button size="small" plain @click="applyEspPartTemplate('esp32')">ESP32 标准</el-button>
                      <div class="spacer"></div>
                      <el-button size="small" text @click="setAllEspPartsEnabled(true)">全选</el-button>
                      <el-button size="small" text @click="setAllEspPartsEnabled(false)">全不选</el-button>
                      <el-tag size="small" effect="plain" round>已选 {{ espSelectedPartCount }}/{{ esp32.parts.length }}</el-tag>
                    </div>

                    <div v-if="!esp32.parts.length" class="set-hint">还没有分区，先添加或套用模板。</div>
                    <div v-else class="esp-parts-grid">
                      <div v-for="(p, i) in esp32.parts" :key="i" class="esp-part-row" :class="{ off: p.enabled === false }">
                        <el-checkbox
                          :model-value="p.enabled !== false"
                          @change="(v) => toggleEspPart(i, v)"
                        />
                        <el-input v-model="p.offset" placeholder="offset 如 0x0" style="width:118px;" @change="persistEsp32Config" />
                        <el-button class="esp-part-file" :icon="FolderOpened" @click="selectEspPartFile(i)">
                          {{ p.name || '选择 .bin' }}
                        </el-button>
                        <el-button text :icon="Delete" @click="removeEspPart(i)" />
                      </div>
                    </div>
                    <el-button :icon="Plus" size="small" @click="addEspPart()">添加分区</el-button>
                    <div class="set-hint">
                      勾选的分区才会参与烧录。ESP8266 常见：0x0 boot/app · 0x1000 user1；ESP32 常见：0x1000 bootloader · 0x8000 partition · 0x10000 app。
                    </div>
                  </template>
                </div>
              </div>

              <div class="ops-section stc-actions">
                <div class="stc-steps">
                  <div><b>1</b><span>选择芯片、串口与 .bin</span></div>
                  <div><b>2</b><span>必要时手动进入下载模式</span></div>
                  <div><b>3</b><span>点击烧录</span></div>
                </div>
                <div class="action-bar">
                  <el-button :icon="Connection" plain :loading="esp32.busy" @click="doEspReadMac">读取 MAC</el-button>
                  <el-button :icon="Delete" plain :disabled="!esp32.portPath || esp32.busy" @click="doEspErase">擦除整片</el-button>
                  <el-button class="one-shot" type="primary" :icon="Upload" :loading="esp32.busy" :disabled="!espCanFlash" @click="doEspFlash">烧录固件</el-button>
                </div>
              </div>
            </div>

            <div class="progress-wrap" v-if="esp32.busy">
              <el-progress :percentage="100" :indeterminate="true" :duration="2" :stroke-width="6" :show-text="false" status="success" />
            </div>

            <div class="log-panel">
              <div class="log-toolbar">
                <span class="left"><span class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>ESP32 输出 <span style="color:var(--text-dim);font-weight:400;"><LogLineCount /></span></span>
                <span class="right">
                  <span @click="reverse = !reverse"><el-icon><Sort /></el-icon>{{ reverse ? '倒序' : '正序' }}</span>
                  <span @click="showTs = !showTs"><el-icon><Clock /></el-icon>{{ showTs ? '隐藏时间' : '显示时间' }}</span>
                  <span @click="copyLog"><el-icon><CopyDocument /></el-icon>复制</span>
                  <span @click="autoScroll = !autoScroll"><el-icon><component :is="autoScroll ? 'Bottom' : 'Minus'" /></el-icon>{{ autoScroll ? '自动滚动' : '已暂停' }}</span>
                </span>
              </div>
              <LogPanel v-if="tool === 'esp32'" pane="esp32" empty="等待 ESP32 操作…" />
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
