<template>
    <!-- ════ 左侧工具导航 ════ -->
    <nav class="app-nav" :class="{ collapsed: navCollapsed }">
      <div class="nav-brand">
        <div class="logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <rect x="4" y="4" width="16" height="16" rx="2.5"/>
            <line x1="9" y1="1.5" x2="9" y2="4"/><line x1="15" y1="1.5" x2="15" y2="4"/>
            <line x1="9" y1="20" x2="9" y2="22.5"/><line x1="15" y1="20" x2="15" y2="22.5"/>
            <line x1="1.5" y1="9" x2="4" y2="9"/><line x1="1.5" y1="15" x2="4" y2="15"/>
            <line x1="20" y1="9" x2="22.5" y2="9"/><line x1="20" y1="15" x2="22.5" y2="15"/>
          </svg>
        </div>
        <div class="bt"><span class="t1">STM32 工具箱</span><span class="t2">toolbox</span></div>
      </div>

      <div class="nav-section">工具</div>
      <button class="nav-item" :class="{ active: tool === 'flash' }" @click="tool = 'flash'" title="烧录工具">
        <el-icon><Cpu /></el-icon><span class="label">烧录工具</span>
        <span v-if="busy" class="dot-state on"></span>
      </button>
      <button class="nav-item" :class="{ active: tool === 'stc51' }" @click="tool = 'stc51'" title="StcGal">
        <el-icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/><line x1="9" y1="3.2" x2="9" y2="6"/><line x1="15" y1="3.2" x2="15" y2="6"/><line x1="9" y1="18" x2="9" y2="20.8"/><line x1="15" y1="18" x2="15" y2="20.8"/><line x1="3.2" y1="9" x2="6" y2="9"/><line x1="3.2" y1="15" x2="6" y2="15"/><line x1="18" y1="9" x2="20.8" y2="9"/><line x1="18" y1="15" x2="20.8" y2="15"/><line x1="12" y1="8.5" x2="12" y2="13.5"/><polyline points="9.8,11.6 12,13.8 14.2,11.6"/></svg></el-icon><span class="label">StcGal</span>
        <span v-if="stc51.busy" class="dot-state on"></span>
      </button>
      <button class="nav-item" :class="{ active: tool === 'esp32' }" @click="tool = 'esp32'" title="ESP32 烧录">
        <el-icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8 15.5a6 6 0 0 1 8 0"/><circle cx="12" cy="18.5" r="1.1" fill="currentColor" stroke="none"/><path d="M2 9a14 14 0 0 1 20 0"/></svg></el-icon><span class="label">ESP32</span>
        <span v-if="esp32.busy" class="dot-state on"></span>
      </button>
      <button class="nav-item" :class="{ active: tool === 'hardware' }" @click="tool = 'hardware'" title="硬件调试">
        <el-icon><Operation /></el-icon><span class="label">硬件调试</span>
      </button>
      <button class="nav-item" :class="{ active: tool === 'ramlog' }" @click="tool = 'ramlog'" title="内存日志">
        <el-icon><Document /></el-icon><span class="label">内存日志</span>
        <span class="dot-state" :class="{ on: ramLog.running }"></span>
      </button>
      <button class="nav-item" :class="{ active: tool === 'firmware' }" @click="tool = 'firmware'" title="固件分析">
        <el-icon><DataAnalysis /></el-icon><span class="label">固件分析</span>
      </button>
      <button class="nav-item" :class="{ active: tool === 'serial' }" @click="tool = 'serial'" title="串口调试">
        <el-icon><Monitor /></el-icon><span class="label">串口调试</span>
        <span class="dot-state" :class="{ on: serial.connected }"></span>
      </button>
      <button class="nav-item" :class="{ active: tool === 'mqtt' }" @click="tool = 'mqtt'" title="MQTT 调试">
        <el-icon><Connection /></el-icon><span class="label">MQTT 调试</span>
        <span class="dot-state" :class="{ on: activeConn && activeConn.connected }"></span>
      </button>
      <button class="nav-item" :class="{ active: tool === 'glyph' }" @click="tool = 'glyph'" title="字模生成">
        <el-icon><Grid /></el-icon><span class="label">字模生成</span>
      </button>

      <div class="nav-spacer"></div>
      <div class="nav-foot">
        <button class="nf-btn" @click="toggleNav" :title="navCollapsed ? '展开菜单' : '收起菜单'"><el-icon><component :is="navCollapsed ? 'Expand' : 'Fold'" /></el-icon></button>
        <button class="nf-btn" @click="toggleTheme" :title="theme === 'dark' ? '切换白天' : '切换黑夜'"><el-icon><component :is="theme === 'dark' ? 'Sunny' : 'Moon'" /></el-icon></button>
        <button class="nf-btn" @click="aboutVisible = true" title="关于"><el-icon><info-filled /></el-icon></button>
        <button class="nf-btn" :class="{ active: tool === 'settings' }" @click="openSettings" title="设置"><el-icon><Setting /></el-icon></button>
      </div>
    </nav>

    <el-dialog v-model="aboutVisible" width="400px" align-center :show-close="true" class="about-dialog">
      <div class="about-box">
        <div class="about-logo">
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">
            <rect x="4" y="4" width="16" height="16" rx="2.5"/>
            <circle cx="12" cy="12" r="2.6" fill="#fff" stroke="none"/>
            <line x1="9" y1="1.5" x2="9" y2="4"/><line x1="15" y1="1.5" x2="15" y2="4"/>
            <line x1="9" y1="20" x2="9" y2="22.5"/><line x1="15" y1="20" x2="15" y2="22.5"/>
            <line x1="1.5" y1="9" x2="4" y2="9"/><line x1="1.5" y1="15" x2="4" y2="15"/>
            <line x1="20" y1="9" x2="22.5" y2="9"/><line x1="20" y1="15" x2="22.5" y2="15"/>
          </svg>
        </div>
        <div class="about-name">STM32 工具箱</div>
        <div class="about-ver">版本 v{{ appVersion }}</div>
        <div class="about-update">
          <el-button
            v-if="updateState.status !== 'downloaded'"
            size="small" type="primary" plain
            :loading="updateState.status === 'checking' || updateChecking"
            @click="checkUpdate">
            {{ updateState.status === 'downloading' ? `下载中 ${updateState.percent}%` : '检查更新' }}
          </el-button>
          <el-button
            v-else
            size="small" type="success"
            @click="installUpdate">
            重启安装 v{{ updateState.version }}
          </el-button>
          <div class="about-update-tip">
            <span v-if="updateState.status === 'latest'">已是最新版本</span>
            <span v-else-if="updateState.status === 'downloading'">正在下载新版本 v{{ updateState.version }}…</span>
            <span v-else-if="updateState.status === 'downloaded'">新版本已就绪，点击重启完成更新</span>
            <span v-else-if="updateState.status === 'error'" class="about-update-err">{{ updateState.error }}</span>
          </div>
        </div>
        <div class="about-desc">可视化编译烧录 · StcGal · 串口调试 · MQTT 调试 · 字模生成</div>
        <div class="about-divider"></div>
        <div class="about-org">锐新网络科技有限公司</div>
        <div class="about-sub">© 2026 RuiXin Network Technology · 版权所有</div>
      </div>
    </el-dialog>

    <!-- ════ 主内容区 ════ -->
    <div class="app-main">

      <!-- ───── 工具①：烧录 ───── -->
      <div class="tool-pane" v-show="tool === 'flash'">
        <div class="pane-top">
          <div><div class="pt-title">STM32 烧录工具</div><div class="pt-sub">pyOCD + ARM GCC · 可视化编译烧录</div></div>
          <div class="spacer"></div>
          <div class="status-pill" :class="statusKind"><span class="dot"></span>{{ statusText }}</div>
          <button class="icon-btn" @click="toggleHistory" :title="historyOpen ? '收起历史' : '展开历史'"><el-icon :size="18"><Tickets /></el-icon></button>
        </div>

        <div class="flash-body">
          <div class="body">
            <!-- 项目选择 + 操作台（统一面板） -->
            <div class="card ops-panel">
              <!-- 项目选择 -->
              <div class="ops-section ops-project">
                <div class="project-row">
                  <el-button type="primary" @click="selectDir" :icon="FolderOpened" :disabled="busy">选择项目目录</el-button>
                  <div class="project-path" :class="pathClass">
                    <el-icon v-if="projectDir"><component :is="projectValid ? 'CircleCheck' : 'CircleClose'" /></el-icon>
                    {{ projectDir || '请选择 STM32 项目目录（含 Makefile / Keil .uvprojx / CubeMX .ioc）…' }}
                  </div>
                </div>
                <div class="meta-row">
                  <el-tag v-if="projectDir && hasMakefile" type="success" effect="light" size="small" round>Makefile</el-tag>
                  <el-tag v-if="projectDir && hasKeil" type="success" effect="light" size="small" round>Keil 工程：{{ keilProject }}</el-tag>
                  <el-tag v-if="projectDir && hasIoc && !hasMakefile && !hasKeil" type="warning" effect="light" size="small" round>CubeMX 工程：{{ iocFile }}（需生成 Makefile）</el-tag>
                  <el-tag v-if="projectDir && !hasMakefile && !hasKeil && !hasIoc" type="danger" effect="light" size="small" round>未检测到工程 (Makefile/Keil)</el-tag>
                  <el-tag v-if="projectDir && projectValid" type="info" effect="plain" size="small" round>编译：{{ buildSysLabel }}</el-tag>
                  <el-tag type="info" effect="plain" size="small" round>烧录：{{ flashLabel }}</el-tag>
                  <el-tag type="info" effect="plain" size="small" round>目标芯片：{{ config.targetChip }}</el-tag>
                  <el-tag :type="envReady ? 'success' : 'warning'" effect="plain" size="small" round>编译环境：{{ envReady ? '已就绪' : '未安装' }}</el-tag>
                </div>
              </div>

              <!-- 操作区 -->
              <div class="ops-section ops-actions">
                <div class="action-head">
                  <span class="eyebrow">Control Deck</span>
                  <span class="title">编译与烧录操作台</span>
                  <span class="hint">先选工程，再执行编译、烧录或一键流程</span>
                </div>
                <div class="action-bar">
                  <div class="build-group">
                    <el-button type="success" :icon="VideoPlay" :loading="building" :disabled="!canOperate" @click="doBuild">编译</el-button>
                    <el-button type="warning" :icon="Upload" :loading="flashing && !building" :disabled="!canOperate" @click="doFlash">烧录</el-button>
                  </div>
                  <el-button class="one-shot" type="primary" :icon="CaretRight" :loading="building && flashing" :disabled="!canOperate" @click="doBuildAndFlash">一键编译烧录</el-button>
                </div>
              </div>

              <!-- 辅助工具 + 烧录方式 -->
              <div class="ops-section ops-utility">
                <div class="tool-cluster">
                  <el-button :icon="Connection" :disabled="busy" @click="doCheckProbe" plain>检测烧录器</el-button>
                  <el-button :icon="Cpu" :disabled="busy" @click="doReadChipInfo" plain>读取芯片</el-button>
                  <el-button v-if="projectDir && hasIoc && !hasMakefile" type="primary" :icon="MagicStick" :loading="generating" :disabled="busy" @click="doGenerateMakefile" plain>生成 Makefile</el-button>
                  <el-button :type="envReady ? 'success' : 'warning'" :icon="Download" :loading="installing" :disabled="busy" @click="installEnv" plain>{{ envReady ? envButtonReadyText : envButtonText }}</el-button>
                  <el-button class="danger-tool" :icon="Delete" :disabled="busy || logLines.length === 0" @click="clearLog" plain>清空日志</el-button>
                </div>
                <div class="flash-method">
                  <div class="fm-head">
                    <span class="fm-label">烧录方式</span>
                    <el-radio-group v-model="flashMethodModel" size="small">
                      <el-radio-button label="pyocd">pyOCD</el-radio-button>
                      <el-radio-button label="openocd">OpenOCD</el-radio-button>
                      <el-radio-button v-if="isWindows" label="keil">Keil</el-radio-button>
                    </el-radio-group>
                  </div>
                  <div class="flash-options">
                    <el-checkbox v-if="flashMethodModel === 'pyocd'" v-model="autoDetectModel" size="small" title="烧录前用 pyocd 探测芯片；关闭则直接用设置芯片，跳过识别">自动识别芯片</el-checkbox>
                    <el-checkbox v-if="flashMethodModel === 'pyocd'" v-model="underResetModel" size="small" title="复位状态下连接：固件占用 SWD/进低功耗后连不上时勾选（需探针 RST 接芯片复位脚）">复位下连接</el-checkbox>
                    <span v-if="flashMethodModel !== 'pyocd'" class="fm-label">{{ flashLabel }} 当前使用工程固件直接烧录</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="progress-wrap" v-if="busy">
              <el-progress :percentage="100" :indeterminate="true" :duration="2" :stroke-width="6" :show-text="false" status="success" />
            </div>

            <!-- 日志面板 -->
            <div class="log-panel">
              <div class="log-toolbar">
                <span class="left"><span class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>终端输出 <span style="color:var(--text-dim);font-weight:400;">({{ logLines.length }})</span></span>
                <span class="right">
                  <span @click="reverse = !reverse"><el-icon><Sort /></el-icon>{{ reverse ? '倒序' : '正序' }}</span>
                  <span @click="showTs = !showTs"><el-icon><Clock /></el-icon>{{ showTs ? '隐藏时间' : '显示时间' }}</span>
                  <span @click="copyLog"><el-icon><CopyDocument /></el-icon>复制</span>
                  <span @click="autoScroll = !autoScroll"><el-icon><component :is="autoScroll ? 'Bottom' : 'Minus'" /></el-icon>{{ autoScroll ? '自动滚动' : '已暂停' }}</span>
                </span>
              </div>
              <div class="log-content" ref="logBox">
                <div v-for="line in displayLines" :key="line.id" class="log-line" :class="line.type"><span class="ts" v-if="showTs">{{ line.ts }}</span><span class="msg">{{ line.text }}</span></div>
                <div v-if="logLines.length === 0" class="log-empty"><div class="big">⌁</div>等待操作…选择项目目录后即可编译 / 烧录</div>
              </div>
            </div>
          </div>

          <aside class="history" :class="{ collapsed: !historyOpen }">
            <div class="history-head"><span>历史项目 <span style="color:var(--text-dim);font-weight:400;">({{ recent.length }})</span></span><el-icon style="cursor:pointer;color:var(--text-dim);" @click="toggleHistory" title="收起"><Fold /></el-icon></div>
            <div class="history-list">
              <div v-for="d in recent" :key="d" class="history-item" :class="{ active: d === projectDir }" @click="openRecent(d)">
                <div class="row"><span class="name">{{ baseName(d) }}</span><el-icon class="history-del" @click.stop="delRecent(d)" title="移除"><Close /></el-icon></div>
                <span class="path">{{ d }}</span>
              </div>
              <div v-if="recent.length === 0" class="history-empty">暂无历史项目<br>选择目录后自动记录</div>
            </div>
          </aside>
        </div>
      </div>

      <!-- ───── 工具②：StcGal ───── -->
      <div class="tool-pane" v-show="tool === 'stc51'">
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
                <span class="left"><span class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>StcGal 输出 <span style="color:var(--text-dim);font-weight:400;">({{ logLines.length }})</span></span>
                <span class="right">
                  <span @click="reverse = !reverse"><el-icon><Sort /></el-icon>{{ reverse ? '倒序' : '正序' }}</span>
                  <span @click="showTs = !showTs"><el-icon><Clock /></el-icon>{{ showTs ? '隐藏时间' : '显示时间' }}</span>
                  <span @click="copyLog"><el-icon><CopyDocument /></el-icon>复制</span>
                  <span @click="autoScroll = !autoScroll"><el-icon><component :is="autoScroll ? 'Bottom' : 'Minus'" /></el-icon>{{ autoScroll ? '自动滚动' : '已暂停' }}</span>
                </span>
              </div>
              <div class="log-content" ref="logBox">
                <div v-for="line in displayLines" :key="line.id" class="log-line" :class="line.type"><span class="ts" v-if="showTs">{{ line.ts }}</span><span class="msg">{{ line.text }}</span></div>
                <div v-if="logLines.length === 0" class="log-empty"><div class="big">⌁</div>等待 StcGal 操作…</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ───── 工具③：ESP32 烧录 ───── -->
      <div class="tool-pane" v-show="tool === 'esp32'">
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

              <div class="ops-section stc-grid">
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

                <div class="stc-card stc-file-card">
                  <div class="stc-card-h">
                    <el-icon><Document /></el-icon><span>固件镜像</span>
                    <div class="spacer"></div>
                    <el-checkbox v-model="esp32.partMode" size="small" @change="persistEsp32Config">多 offset 分区</el-checkbox>
                  </div>
                  <template v-if="!esp32.partMode">
                    <div class="stc-file-pick">
                      <el-button type="primary" :icon="FolderOpened" @click="selectEspFirmware">选择 .bin</el-button>
                      <div class="stc-file-meta">
                        <b>{{ espFirmwareLabel }}</b>
                        <span>{{ esp32.firmwarePath || '单合并镜像：merged bin（含 bootloader/分区表/app）' }}</span>
                      </div>
                      <el-tag effect="plain" round>{{ espFirmwareSizeLabel }}</el-tag>
                    </div>
                    <div class="field"><label>烧录地址 offset</label>
                      <el-input v-model="esp32.flashOffset" placeholder="如 0x0（合并 bin）或 0x10000（仅 app）" @change="persistEsp32Config" />
                    </div>
                  </template>
                  <template v-else>
                    <div v-for="(p, i) in esp32.parts" :key="i" class="stc-inline" style="margin-bottom:8px;align-items:center;">
                      <el-input v-model="p.offset" placeholder="offset 如 0x1000" style="width:130px;" @change="persistEsp32Config" />
                      <el-button :icon="FolderOpened" @click="selectEspPartFile(i)">{{ p.name || '选择 .bin' }}</el-button>
                      <el-button text :icon="Delete" @click="removeEspPart(i)" />
                    </div>
                    <el-button :icon="Plus" size="small" @click="addEspPart">添加分区</el-button>
                    <div class="set-hint">常见布局：0x1000 bootloader · 0x8000 partition-table · 0x10000 app（ESP32-C3/S3 的 bootloader 多为 0x0，以你的工程为准）。</div>
                  </template>
                </div>
              </div>

              <div class="ops-section stc-advanced">
                <div class="stc-card compact">
                  <div class="stc-card-h"><el-icon><MagicStick /></el-icon><span>Flash 参数</span></div>
                  <div class="stc-inline">
                    <el-select v-model="esp32.flashMode" style="flex:1;" @change="persistEsp32Config">
                      <el-option v-for="m in ESP_FLASH_MODES" :key="m" :label="`mode ${m}`" :value="m" />
                    </el-select>
                    <el-select v-model="esp32.flashFreq" style="flex:1;" @change="persistEsp32Config">
                      <el-option v-for="f in ESP_FLASH_FREQS" :key="f" :label="`freq ${f}`" :value="f" />
                    </el-select>
                    <el-select v-model="esp32.flashSize" style="flex:1;" @change="persistEsp32Config">
                      <el-option v-for="s in ESP_FLASH_SIZES" :key="s" :label="`size ${s}`" :value="s" />
                    </el-select>
                  </div>
                </div>
                <div class="stc-card compact">
                  <div class="stc-card-h"><el-icon><DataAnalysis /></el-icon><span>选项</span></div>
                  <el-checkbox v-model="esp32.eraseBeforeWrite" size="small" @change="persistEsp32Config">烧录前先擦除整片（--erase-all）</el-checkbox>
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
                <span class="left"><span class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>ESP32 输出 <span style="color:var(--text-dim);font-weight:400;">({{ logLines.length }})</span></span>
                <span class="right">
                  <span @click="reverse = !reverse"><el-icon><Sort /></el-icon>{{ reverse ? '倒序' : '正序' }}</span>
                  <span @click="showTs = !showTs"><el-icon><Clock /></el-icon>{{ showTs ? '隐藏时间' : '显示时间' }}</span>
                  <span @click="copyLog"><el-icon><CopyDocument /></el-icon>复制</span>
                  <span @click="autoScroll = !autoScroll"><el-icon><component :is="autoScroll ? 'Bottom' : 'Minus'" /></el-icon>{{ autoScroll ? '自动滚动' : '已暂停' }}</span>
                </span>
              </div>
              <div class="log-content" ref="logBox">
                <div v-for="line in displayLines" :key="line.id" class="log-line" :class="line.type"><span class="ts" v-if="showTs">{{ line.ts }}</span><span class="msg">{{ line.text }}</span></div>
                <div v-if="logLines.length === 0" class="log-empty"><div class="big">⌁</div>等待 ESP32 操作…</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ───── 工具④：硬件调试 ───── -->
      <div class="tool-pane" v-show="tool === 'hardware'">
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

      <!-- ───── 工具③：内存日志 ───── -->
      <div class="tool-pane" v-show="tool === 'ramlog'">
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
              <pre ref="ramLogBox" class="ram-log">{{ ramLog.text || '等待读取 RAM 日志。请确认固件已在同一基地址放置 RLOG 结构。' }}</pre>
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

      <!-- ───── 工具④：固件分析 ───── -->
      <div class="tool-pane" v-show="tool === 'firmware'">
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

      <!-- ───── 工具⑤：串口调试 ───── -->
      <div class="tool-pane" v-show="tool === 'serial'">
        <div class="pane-top">
          <div><div class="pt-title">串口调试</div><div class="pt-sub">serialport · 收发 / HEX / 快捷指令</div></div>
          <div class="spacer"></div>
          <div class="status-pill" :class="serial.connected ? 'ok' : ''"><span class="dot"></span>{{ serial.connected ? ('已连接 ' + (serial.portLabel || '')) : '未连接' }}</div>
        </div>

        <div class="serial-body">
          <!-- 左：串口参数 -->
          <div class="serial-col serial-left">
            <div>
              <div class="panel-title">串口设置</div>
              <div class="panel-sub">先「选择串口」识别设备，设置好参数再点「连接串口」</div>
            </div>
            <div class="field"><label>串口</label>
              <el-button style="width:100%" :disabled="serial.connected" :icon="RefreshRight" @click="selectPort">{{ serial.portLabel ? '重新选择串口' : '选择串口' }}</el-button>
            </div>
            <div v-if="serial.portLabel" class="port-info" :class="{ live: serial.connected }">
              <div class="pi-name"><span class="pi-dot"></span><el-icon><Cpu /></el-icon><span>{{ serial.portLabel }}</span></div>
              <div class="pi-sub" v-if="serial.portSub">{{ serial.portSub }}</div>
              <div class="pi-state">{{ serial.connected ? '已连接' : '已选择，待连接' }}</div>
            </div>
            <div class="field"><label>波特率</label>
              <el-select v-model="serial.baudRate" :disabled="serial.connected" style="width:100%" filterable allow-create default-first-option>
                <el-option v-for="b in baudRates" :key="b" :label="b" :value="b" />
              </el-select>
            </div>
            <div class="field"><label>数据位</label>
              <el-select v-model="serial.dataBits" :disabled="serial.connected" style="width:100%">
                <el-option :value="8" label="8" /><el-option :value="7" label="7" />
              </el-select>
            </div>
            <div class="field"><label>校验位</label>
              <el-select v-model="serial.parity" :disabled="serial.connected" style="width:100%">
                <el-option value="none" label="None" /><el-option value="even" label="Even" /><el-option value="odd" label="Odd" />
              </el-select>
            </div>
            <div class="field"><label>停止位</label>
              <el-select v-model="serial.stopBits" :disabled="serial.connected" style="width:100%">
                <el-option :value="1" label="1" /><el-option :value="2" label="2" />
              </el-select>
            </div>
            <el-button v-if="!serial.connected" type="primary" style="width:100%" :loading="serial.connecting" :icon="Connection" @click="serialConnect">连接串口</el-button>
            <el-button v-else type="danger" style="width:100%" :icon="SwitchButton" @click="serialDisconnect" plain>断开连接</el-button>
            <div v-if="!serialSupported" style="color:var(--danger);font-size:12px;line-height:1.6;">串口后端不可用：{{ serialErrMsg || 'serialport 未安装' }}<br/>请在工程目录执行 npm install serialport 并 npx @electron/rebuild。</div>
          </div>

          <!-- （左面板串口选择在下方插入） 中：终端 -->
          <div class="serial-col serial-center">
            <div class="term-card">
              <div class="term-bar">
                <span class="tb-toggle" :class="{ on: serial.rxHex }" @click="serial.rxHex = !serial.rxHex">接收 HEX</span>
                <span class="tb-toggle" :class="{ on: serial.txHex }" @click="serial.txHex = !serial.txHex">发送 HEX</span>
                <span class="tb-toggle" :class="{ on: serial.autoScroll }" @click="serial.autoScroll = !serial.autoScroll">自动滚动</span>
                <span class="tb-toggle" :class="{ on: serial.timestamp }" @click="serial.timestamp = !serial.timestamp">时间戳</span>
                <span class="spacer"></span>
                <span class="tb-toggle" @click="clearTerm"><el-icon><Delete /></el-icon>清空</span>
                <span class="tb-toggle" @click="copyTerm"><el-icon><CopyDocument /></el-icon>复制</span>
              </div>
              <div class="term-content" ref="termBox">
                <div v-for="ln in serialLines" :key="ln.id" class="s-line" :class="[ln.dir, ln.level, { continuation: ln.continuation }]">
                  <span class="s-meta">
                    <span class="ts" v-if="serial.timestamp">[{{ ln.ts }}]</span>
                    <span class="s-badge">{{ ln.badge }}</span>
                  </span>
                  <span class="msg">{{ ln.text }}</span>
                </div>
                <div v-if="serialLines.length === 0" class="term-empty"><div class="big">⇄</div>暂无收发记录<br>连接串口后开始通信</div>
              </div>
            </div>

            <div class="send-bar">
              <el-input v-model="serial.sendText" type="textarea" :rows="2" resize="none"
                        :placeholder="serial.txHex ? '输入 HEX，如 01 02 0A 0D' : '输入要发送的内容…（回车发送 · Shift+Enter 换行）'"
                        @keydown.enter="onSendKey"></el-input>
              <div style="display:flex;flex-direction:column;gap:6px;width:128px;">
                <el-button type="primary" :icon="Promotion" :disabled="!serial.connected" @click="serialSend" style="flex:1;">发送</el-button>
                <el-checkbox v-model="serial.appendNewline" :disabled="serial.txHex" size="small">追加换行</el-checkbox>
              </div>
            </div>
            <div class="stat-row">
              <span>Tx {{ serial.tx }} 字节</span><span>Rx {{ serial.rx }} 字节</span>
              <span class="sep"></span>
              <span>{{ serial.connected ? (serial.baudRate + ' / ' + serial.dataBits + (serial.parity==='none'?'N':serial.parity==='even'?'E':'O') + serial.stopBits) : '—' }}</span>
            </div>
          </div>

          <!-- 右：快捷指令 -->
          <div class="serial-col serial-right">
            <div class="quick-head">
              <div class="panel-title">快捷指令 <span class="qh-count">{{ quickCmds.length }}</span></div>
              <el-button size="small" :type="looping ? 'danger' : 'success'" :icon="looping ? VideoPause : RefreshRight" :disabled="!serial.connected" @click="toggleLoop" round>{{ looping ? '停止循环' : '循环发送' }}</el-button>
            </div>
            <div class="qgroup-tabs">
              <div v-for="g in cmdGroups" :key="g.id" class="qgtab" :class="{ active: g.id === activeGid }"
                   @click="switchGroup(g.id)" @dblclick="startRename(g)" :title="'单击切换 · 双击重命名 · ' + g.name">
                <input v-if="editingGid === g.id" :id="'qgedit-' + g.id" class="qgt-edit" v-model="editName"
                       @click.stop @keyup.enter="commitRename(g)" @keyup.esc="cancelRename" @blur="commitRename(g)" />
                <template v-else>
                  <span class="qgt-name">{{ g.name }}</span>
                  <span class="qgt-n">{{ g.cmds.length }}</span>
                  <el-icon v-if="g.id === activeGid" class="qgt-edit-ic" @click.stop="startRename(g)" title="重命名分组"><EditPen /></el-icon>
                </template>
              </div>
              <button class="qgtab add" @click="addGroup" title="新建分组">＋</button>
            </div>
            <div class="quick-toolbar">
              <el-button size="small" :icon="Plus" @click="addQuickCmd">添加指令</el-button>
              <span style="flex:1;"></span>
              <el-button size="small" text :icon="Delete" @click="delGroup(cmdGroups.find(g => g.id === activeGid))" title="删除当前分组">删组</el-button>
              <el-button size="small" text :icon="Download" @click="exportQuickCmds" title="导出全部分组到 .json">导出</el-button>
              <el-button size="small" text :icon="Upload" @click="importQuickCmds" title="从 .json 导入">导入</el-button>
            </div>
            <div class="quick-list">
              <div v-for="(q, i) in quickCmds" :key="q.id" class="qcard" :class="{ on: q.enabled }">
                <div class="qc-top">
                  <el-checkbox v-model="q.enabled" size="small" title="勾选后纳入循环发送" />
                  <el-input class="qc-name" v-model="q.name" size="small" placeholder="名称 / 备注" />
                  <el-button class="qc-send" size="small" type="primary" :disabled="!serial.connected" @click="sendQuickCmd(q)">发送</el-button>
                  <el-button class="qc-del" size="small" :icon="Close" @click="delQuickCmd(i)" circle plain title="删除" />
                </div>
                <el-input class="qc-content" v-model="q.content" size="small" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" :placeholder="q.hex ? 'HEX 如 01 03 00 0A' : '指令内容（发送自动追加 \\r\\n）'" />
                <div class="qc-bot">
                  <el-checkbox v-model="q.hex" size="small" title="按 HEX 解析发送">HEX</el-checkbox>
                  <span class="lbl">循环间隔</span>
                  <el-input class="qc-int" v-model.number="q.interval" size="small" type="number" :min="0" />
                  <el-select class="qc-unit" v-model="q.unit" size="small">
                    <el-option label="毫秒" value="ms" />
                    <el-option label="秒" value="s" />
                    <el-option label="分" value="min" />
                  </el-select>
                </div>
              </div>
              <div v-if="quickCmds.length === 0" class="quick-empty">暂无快捷指令<br>点「添加」新建</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ───── 工具③：MQTT 调试（MQTTX 风格 · 多连接）───── -->
      <div class="tool-pane" v-show="tool === 'mqtt'">
        <div class="pane-top">
          <div><div class="pt-title">MQTT 调试</div><div class="pt-sub">mqtt.js · 多连接 · 订阅 / 发布</div></div>
          <div class="spacer"></div>
          <div class="status-pill" :class="activeConn && activeConn.connected ? 'ok' : ''"><span class="dot"></span>{{ activeConn ? (activeConn.connecting ? '连接中…' : (activeConn.connected ? '已连接' : '未连接')) : '无连接' }}</div>
        </div>

        <div class="mx-layout">
          <!-- 一列：连接列表 -->
          <div class="mx-conns">
            <div class="mx-conns-head">
              <span>连接 <span class="qh-count">{{ mqttConns.length }}</span></span>
              <el-button size="small" :icon="Plus" circle @click="openConnDlg(null)" title="新建连接" />
            </div>
            <div class="mx-conn-list">
              <div v-for="c in mqttConns" :key="c.id" class="mx-conn" :class="{ active: c.id === activeConnId }" @click="selectConn(c)">
                <span class="mx-conn-dot" :class="{ on: c.connected, ing: c.connecting }"></span>
                <div class="mx-conn-meta">
                  <div class="mx-conn-name">{{ c.name }}</div>
                  <div class="mx-conn-url">{{ c.url }}</div>
                </div>
              </div>
              <div v-if="mqttConns.length === 0" class="mx-conns-empty">暂无连接<br>点 ＋ 新建</div>
            </div>
          </div>

          <!-- 选中连接：订阅 + 消息 + 发布 -->
          <div class="mx-main" v-if="activeConn">
            <div class="mx-main-head">
              <span class="mx-conn-dot" :class="{ on: activeConn.connected, ing: activeConn.connecting }"></span>
              <span class="mx-main-name">{{ activeConn.name }}</span>
              <span class="mx-main-url">{{ activeConn.url }}</span>
              <div class="spacer"></div>
              <el-button size="small" @click="openConnDlg(activeConn)"><el-icon><EditPen /></el-icon>编辑</el-button>
              <el-button v-if="!activeConn.connected" size="small" type="primary" :loading="activeConn.connecting" :icon="Connection" @click="connConnect(activeConn)">连接</el-button>
              <el-button v-else size="small" type="danger" plain :icon="SwitchButton" @click="connDisconnect(activeConn)">断开</el-button>
              <el-button size="small" plain :icon="Delete" @click="delConn(activeConn)" title="删除连接" />
            </div>

            <div class="mx-main-body">
              <!-- 订阅侧栏 -->
              <div class="mx-subs">
                <div class="mx-subs-head">订阅主题 <span class="qh-count">{{ activeConn.subs.length }}</span></div>
                <div class="mx-sub-add">
                  <el-input v-model="subDraft.topic" size="small" placeholder="主题 test/#" @keyup.enter="addSub" />
                  <el-select v-model.number="subDraft.qos" size="small" style="width:64px;flex-shrink:0;">
                    <el-option label="Q0" :value="0" /><el-option label="Q1" :value="1" /><el-option label="Q2" :value="2" />
                  </el-select>
                  <el-button size="small" type="primary" :icon="Plus" @click="addSub">订阅</el-button>
                </div>
                <div class="mx-sub-list">
                  <div v-for="(s, i) in activeConn.subs" :key="s.topic" class="mx-sub" :class="{ paused: s.active === false }" :style="{ borderLeftColor: s.color }">
                    <span class="mx-sub-color" :style="{ background: s.active === false ? '#94a3b8' : s.color }" @click="toggleSub(i)" :title="s.active === false ? '点击恢复订阅' : '点击暂停订阅'"></span>
                    <span class="mx-sub-topic">{{ s.topic }}</span>
                    <span class="mx-sub-qos">Q{{ s.qos }}</span>
                    <el-icon class="mx-sub-del" @click="removeSub(i)" title="退订并删除"><Close /></el-icon>
                  </div>
                  <div v-if="activeConn.subs.length === 0" class="mx-subs-empty">暂无订阅<br>输入主题点「订阅」</div>
                </div>
              </div>

              <!-- 消息流 + 发布 -->
              <div class="mx-chat">
                <div class="mx-chat-bar">
                  <span class="tb-toggle" :class="{ on: activeConn.rxHex }" @click="activeConn.rxHex = !activeConn.rxHex">接收 HEX</span>
                  <span class="tb-toggle" :class="{ on: activeConn.autoScroll }" @click="activeConn.autoScroll = !activeConn.autoScroll">自动滚动</span>
                  <span class="tb-toggle" :class="{ on: activeConn.timestamp }" @click="activeConn.timestamp = !activeConn.timestamp">时间戳</span>
                  <span class="spacer"></span>
                  <span class="tb-toggle" @click="clearMqtt"><el-icon><Delete /></el-icon>清空</span>
                </div>
                <div class="mx-msgs" ref="mqttBox">
                  <template v-for="m in activeConn.messages" :key="m.id">
                    <div v-if="m.dir === 'sys'" class="mx-sys">{{ m.ts }} · {{ m.text }}</div>
                    <div v-else class="mx-row" :class="m.dir">
                      <div class="mx-bubble" :class="m.dir" :style="{ '--mxc': m.color || '#94a3b8' }">
                        <div class="mx-bubble-head">
                          <span class="mx-b-dir">{{ m.dir === 'rx' ? '收' : '发' }}</span>
                          <span class="mx-b-topic">{{ m.topic }}</span>
                          <span v-if="m.json" class="mx-b-json">JSON</span>
                          <span class="mx-b-meta">{{ m.meta }}</span>
                        </div>
                        <div v-if="m.json" class="mx-b-payload json" v-html="m.html"></div>
                        <div v-else class="mx-b-payload">{{ m.text }}</div>
                        <div class="mx-b-time" v-if="activeConn.timestamp">{{ m.ts }}</div>
                      </div>
                    </div>
                  </template>
                  <div v-if="activeConn.messages.length === 0" class="term-empty"><div class="big">⇄</div>暂无消息<br>连接并订阅后显示</div>
                </div>
                <div class="mx-pub">
                  <div class="mx-pub-row">
                    <el-input v-model="activeConn.pubTopic" size="small" placeholder="发布主题，如 test/topic">
                      <template #prepend>主题</template>
                    </el-input>
                    <el-select v-model.number="activeConn.pubQos" size="small" style="width:90px;flex-shrink:0;">
                      <el-option label="QoS 0" :value="0" /><el-option label="QoS 1" :value="1" /><el-option label="QoS 2" :value="2" />
                    </el-select>
                    <el-checkbox v-model="activeConn.pubRetain" size="small">Retain</el-checkbox>
                    <el-checkbox v-model="activeConn.pubHex" size="small">HEX</el-checkbox>
                    <el-checkbox v-model="activeConn.pubSub" size="small" @change="onPubSubToggle" title="勾选后自动订阅当前发布主题">订阅消息</el-checkbox>
                  </div>
                  <div class="send-bar">
                    <el-input v-model="activeConn.pubText" type="textarea" :rows="5" resize="none"
                              :placeholder="activeConn.pubHex ? '输入 HEX，如 01 02 0A · 回车发送' : '发布内容…（回车发送 · Shift+Enter 换行）'"
                              @keydown.enter="mqttSendKey"></el-input>
                    <el-button class="mx-send-btn" type="primary" :icon="Promotion" :disabled="!activeConn.connected" @click="mqttPublish">发送</el-button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 无连接占位 -->
          <div class="mx-empty" v-else>
            <div class="big">⇆</div>
            还没有连接，点左侧 ＋ 新建一个 MQTT 连接
            <div v-if="!mqttSupported" style="color:var(--danger);margin-top:12px;font-size:12px;line-height:1.6;">MQTT 后端不可用：{{ mqttErrMsg || 'mqtt 未安装' }}<br/>请在工程目录执行 npm install mqtt 并重启。</div>
          </div>
        </div>

        <!-- 连接编辑弹窗 -->
        <el-dialog v-model="connDlg.visible" :title="connDlg.editing ? '编辑连接' : '新建连接'" width="440px" append-to-body>
          <div class="field"><label>名称</label><el-input v-model="connDlg.name" placeholder="连接名称" /></div>
          <div class="field"><label>Broker 地址</label><el-input v-model="connDlg.url" placeholder="mqtt://broker.emqx.io:1883" /></div>
          <div class="field"><label>Client ID</label><el-input v-model="connDlg.clientId" placeholder="留空自动生成" /></div>
          <div class="field"><label>用户名</label><el-input v-model="connDlg.username" placeholder="可选" /></div>
          <div class="field"><label>密码</label><el-input v-model="connDlg.password" type="password" show-password placeholder="可选" /></div>
          <div class="field"><label>Keepalive（秒）</label><el-input v-model.number="connDlg.keepalive" type="number" :min="0" /></div>
          <div class="field"><el-checkbox v-model="connDlg.clean">Clean Session</el-checkbox></div>
          <template #footer>
            <el-button @click="connDlg.visible = false">取消</el-button>
            <el-button type="primary" @click="saveConnDlg">保存</el-button>
          </template>
        </el-dialog>
      </div>

      <!-- ───── 工具④：字模生成（PCtoLCD 风格 · 重编）───── -->
      <div class="tool-pane" v-show="tool === 'glyph'">
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

      <!-- ───── 工具⑤：设置 ───── -->
      <div class="tool-pane" v-show="tool === 'settings'">
        <div class="pane-top">
          <div><div class="pt-title">工具链设置</div><div class="pt-sub">编译 / 烧录 / 工具链路径</div></div>
          <div class="spacer"></div>
          <div class="set-actions">
            <el-button @click="resetSettings">恢复默认</el-button>
            <el-button @click="closeSettings">取消</el-button>
            <el-button type="primary" @click="saveSettings">保存</el-button>
          </div>
        </div>
        <div class="settings-body">
          <el-form :model="draft" label-width="120px" label-position="right" class="set-form">
            <div class="set-card">
              <div class="set-card-h"><el-icon><VideoPlay /></el-icon><span>编译</span></div>
              <el-form-item label="当前系统">
                <div style="display:flex;flex-direction:column;gap:7px;width:100%;">
                  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    <el-tag type="success" size="small" round>{{ systemDisplayName }}</el-tag>
                    <el-tag type="info" size="small" round>{{ systemRuntimeLabel }}</el-tag>
                    <el-tag :type="toolchainProfile.supportsKeil ? 'success' : 'warning'" size="small" round>{{ toolchainProfile.supportsKeil ? '支持 Keil' : '不支持 Keil' }}</el-tag>
                    <el-tag type="info" size="small" round>{{ systemDownloadLabel }}</el-tag>
                  </div>
                  <span class="set-hint">会按当前系统分别读取/保存路径配置，并匹配对应工具链下载包。</span>
                </div>
              </el-form-item>
              <el-form-item label="编译方式">
                <el-radio-group v-model="draft.buildSystem">
                  <el-radio-button label="auto">自动判断</el-radio-button>
                  <el-radio-button label="make">Makefile (GCC)</el-radio-button>
                  <el-radio-button v-if="isWindows" label="keil">Keil uVision5</el-radio-button>
                </el-radio-group>
                <span class="set-hint">自动：有 Makefile 用 GCC，Windows 下有 .uvprojx 才会走 Keil</span>
              </el-form-item>
              <el-form-item label="Keil UV4.exe" v-if="isWindows && (draft.buildSystem !== 'make' || draft.flashMethod === 'keil')">
                <el-input v-model="draft.keilUV4Path" placeholder="如 C:\Keil_v5\UV4\UV4.exe" />
              </el-form-item>
              <el-form-item label="Keil 重新编译" v-if="isWindows && draft.buildSystem !== 'make'">
                <el-switch v-model="draft.keilRebuild" />
                <span class="set-hint inline">开 = 重新编译全部(-z)，关 = 增量编译(-b)</span>
              </el-form-item>
              <el-form-item label="工具链模式" v-if="draft.buildSystem !== 'keil'">
                <el-radio-group v-model="draft.toolchainMode">
                  <el-radio-button label="custom">自定义路径</el-radio-button>
                  <el-radio-button label="default">使用默认(自动下载)</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="ARM GCC bin" v-if="draft.buildSystem !== 'keil' && draft.toolchainMode === 'custom'">
                <el-input v-model="draft.armGccPath" :placeholder="toolchainProfile.placeholders.armGccPath || 'arm-none-eabi-gcc 所在 bin 目录'" />
              </el-form-item>
              <el-form-item label="make bin" v-if="draft.buildSystem !== 'keil' && draft.toolchainMode === 'custom'">
                <el-input v-model="draft.makePath" :placeholder="toolchainProfile.placeholders.makePath || 'make 所在 bin 目录'" />
              </el-form-item>
              <el-form-item label="默认工具链" v-if="draft.buildSystem !== 'keil' && draft.toolchainMode === 'default'">
                <div style="display:flex;flex-direction:column;gap:7px;width:100%;">
                  <div class="set-hint">{{ defaultToolchainHint }}</div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <el-tag class="clickable-tag" :type="defaultTc.gccBin ? 'success' : 'info'" size="small" round @click="openToolDetail('gcc')">ARM GCC {{ defaultTc.gccBin ? '已就绪' : '未安装' }} {{ toolVersionText('gcc') }}</el-tag>
                    <el-tag class="clickable-tag" :type="defaultTc.makeBin ? 'success' : 'info'" size="small" round @click="openToolDetail('make')">make {{ defaultTc.makeBin === 'system' ? '系统提供' : (defaultTc.makeBin ? '已就绪' : '未安装') }} {{ toolVersionText('make') }}</el-tag>
                    <el-tag class="clickable-tag" :type="defaultTc.pyocdBin ? 'success' : 'info'" size="small" round @click="openToolDetail('pyocd')">pyOCD {{ defaultTc.pyocdBin ? '本地已就绪' : '未安装' }} {{ toolVersionText('pyocd') }}</el-tag>
                    <el-tag class="clickable-tag" :type="defaultTc.openocdBin ? 'success' : 'info'" size="small" round @click="openToolDetail('openocd')">OpenOCD {{ defaultTc.openocdBin ? '本地已就绪' : '未安装' }} {{ toolVersionText('openocd') }}</el-tag>
                    <el-tag class="clickable-tag" :type="defaultTc.busybox || (toolchainProfile.commandTools && toolchainProfile.commandTools.mode === 'system') ? 'success' : 'info'" size="small" round @click="openToolDetail('commandTools')">{{ toolchainProfile.commandTools && toolchainProfile.commandTools.mode === 'busybox' ? '编译命令' : '系统命令' }} {{ toolchainProfile.commandTools && toolchainProfile.commandTools.mode === 'busybox' ? (defaultTc.busybox ? '已就绪' : '未安装') : '系统提供' }} {{ toolVersionText('commandTools') }}</el-tag>
                  </div>
                  <div v-if="dlProgress.active" style="display:flex;align-items:center;gap:8px;">
                    <el-progress :percentage="dlProgress.percent" :stroke-width="10" style="flex:1;" />
                    <span class="set-hint" style="white-space:nowrap;">{{ dlProgress.label ? ('下载 ' + dlProgress.label) : '准备中' }}</span>
                  </div>
                  <div style="display:flex;gap:8px;align-items:center;">
                    <el-button type="primary" size="small" :icon="Download" :loading="installingDefault" @click="installDefaultTc(false)">{{ installingDefault ? '安装中…' : defaultInstallButtonText }}</el-button>
                    <el-button size="small" text :disabled="installingDefault" @click="installDefaultTc(true)">强制重新下载</el-button>
                  </div>
                </div>
              </el-form-item>
              <el-form-item label="STM32CubeMX">
                <el-input v-model="draft.cubeMxPath" :placeholder="toolchainProfile.placeholders.cubeMxPath || ''" />
                <span class="set-hint">用于「一键生成 Makefile」：把 CubeMX 工程(.ioc)重生成为 Makefile 工程（含启动文件/链接脚本）</span>
                <span v-if="!isWindows" class="set-hint">当前是 {{ systemDisplayName }}，Keil/UV4 仅 Windows 可用，建议统一使用 Makefile + pyOCD。</span>
              </el-form-item>
            </div>

            <div class="set-card">
              <div class="set-card-h"><el-icon><Download /></el-icon><span>下载</span></div>
              <el-form-item label="下载加速镜像">
                <el-input v-model="draft.ghProxy" placeholder="可选，如 https://gh-proxy.com ；留空直连 GitHub" />
                <span class="set-hint">默认 8 线程分段下载；国内慢可填 GitHub 代理前缀提速</span>
              </el-form-item>
            </div>

            <div class="set-card">
              <div class="set-card-h"><el-icon><MagicStick /></el-icon><span>烧录</span></div>
              <el-form-item label="烧录方式">
                <el-radio-group v-model="draft.flashMethod">
                  <el-radio-button label="pyocd">pyOCD</el-radio-button>
                  <el-radio-button label="openocd">OpenOCD</el-radio-button>
                  <el-radio-button v-if="isWindows" label="keil">Keil UV4 下载</el-radio-button>
                </el-radio-group>
                <span class="set-hint">PWLink/CMSIS-DAP 推荐 pyOCD 或 OpenOCD；Keil 方式仅 Windows 可用。</span>
              </el-form-item>
              <el-form-item label="pyOCD 路径" v-if="draft.flashMethod === 'pyocd'">
                <el-input v-model="draft.pyocdPath" :placeholder="toolchainProfile.placeholders.pyocdPath || 'pyocd 完整路径'" />
              </el-form-item>
              <el-form-item label="OpenOCD 路径" v-if="draft.flashMethod === 'openocd'">
                <el-input v-model="draft.openocdPath" :placeholder="toolchainProfile.placeholders.openocdPath || 'openocd 完整路径'" />
                <span class="set-hint">默认使用 interface/cmsis-dap.cfg，适配 PWLink/CMSIS-DAP。</span>
              </el-form-item>
              <el-form-item label="自动识别芯片" v-if="draft.flashMethod === 'pyocd'">
                <el-switch v-model="draft.autoDetectChip" />
                <span class="set-hint inline">烧录前用 pyOCD 探测；缺少型号支持时会自动安装对应 Pack</span>
              </el-form-item>
              <el-form-item label="复位下连接" v-if="draft.flashMethod === 'pyocd'">
                <el-switch v-model="draft.connectUnderReset" />
                <span class="set-hint inline">固件占用 SWD/进低功耗后连不上时开（需探针 RST 接芯片复位脚）</span>
              </el-form-item>
              <el-form-item label="ELF 文件名" v-if="draft.flashMethod === 'pyocd' || draft.flashMethod === 'openocd'">
                <el-input v-model="draft.elfName" placeholder="留空 = 自动在工程内检测 .elf/.axf/.hex" />
              </el-form-item>
            </div>
          </el-form>
        </div>
      </div>
    </div>

    <!-- 串口选择对话框 -->
    <el-dialog v-model="portChooser.visible" title="选择串口设备" width="480px" align-center @close="cancelPortChoose">
      <div v-if="portChooser.list.length === 0" style="color:var(--text-dim);text-align:center;padding:16px;line-height:1.7;">
        未检测到任何 COM 串口。<br/>请插好 USB 转串口设备（CH340 / CP210x / FTDI 等）并装好驱动后点「刷新」重试。<br/>
        （PWLink2 / ST-Link 调试探针不是串口，不会出现在此列表）
      </div>
      <div v-else style="display:flex;flex-direction:column;gap:8px;">
        <div v-for="p in portChooser.list" :key="p.path"
             @click="pickPort(p)"
             style="cursor:pointer;border:1px solid var(--border);border-radius:9px;padding:11px 13px;display:flex;align-items:center;gap:10px;"
             onmouseover="this.style.borderColor='var(--accent-line)'" onmouseout="this.style.borderColor='var(--border)'">
          <el-icon :size="18" style="color:var(--accent);"><Cpu /></el-icon>
          <div style="min-width:0;flex:1;">
            <div style="font-weight:600;">{{ portMainLabel(p) }}</div>
            <div style="font-size:11px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;">{{ portSubLabel(p) || '未知设备' }}</div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button :loading="portChooser.loading" :icon="RefreshRight" @click="refreshPorts">刷新</el-button>
        <el-button @click="cancelPortChoose">取消</el-button>
      </template>
	    </el-dialog>

    <el-dialog v-model="toolDetail.visible" :title="toolDetail.title + ' 详情'" width="560px" align-center class="tool-detail-dialog">
      <div class="tool-detail">
        <div class="tool-detail-row" v-for="row in toolDetail.rows" :key="row[0]">
          <span>{{ row[0] }}</span>
          <code>{{ row[1] }}</code>
        </div>
        <div v-if="toolDetail.commands.length" class="cmd-tools-panel">
          <div class="cmd-tools-title">当前系统支持的命令（{{ toolDetail.commands.length }} 个）</div>
          <div class="cmd-tools-list">
            <code v-for="cmd in toolDetail.commands" :key="cmd">{{ cmd }}</code>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button type="primary" @click="toolDetail.visible = false">知道了</el-button>
      </template>
    </el-dialog>

</template>

<script>
import { ref, onMounted } from 'vue';
// ElMessage / ElMessageBox 由 unplugin-auto-import + ElementPlusResolver 自动注入（含样式）
// 图标按需引入：仅 import 模板返回用到的图标（其余 PascalCase/动态 :is 图标由 main.js 全局注册）
import {
  FolderOpened, VideoPlay, Upload, CaretRight, Delete, Download, MagicStick, CopyDocument,
  Connection, SwitchButton, Promotion, Plus, Close, RefreshRight, VideoPause, Cpu,
  Operation, Document, DataAnalysis, DataLine,
} from '@element-plus/icons-vue';

// 按域拆分的组合式（各自管理状态/方法/IPC，见 ./composables/*）
import { useTheme } from './composables/useTheme.js';
import { useLog } from './composables/useLog.js';
import { useGlyph } from './composables/useGlyph.js';
import { useSerial } from './composables/useSerial.js';
import { useMqtt } from './composables/useMqtt.js';
import { useSettings } from './composables/useSettings.js';
import { useFlash } from './composables/useFlash.js';
import { useStc51 } from './composables/useStc51.js';
import { useEsp32 } from './composables/useEsp32.js';
import { useHardwareDebug } from './composables/useHardwareDebug.js';
import { useRamLog } from './composables/useRamLog.js';
import { useFirmwareAnalysis } from './composables/useFirmwareAnalysis.js';
import { useUpdate } from './composables/useUpdate.js';

export default {
  setup() {
    /* ════ 应用外壳：工具切换 / 侧边栏 / 关于 ════ */
    const tool = ref('flash');
    const prevTool = ref('flash');
    const navCollapsed = ref(false);
    const aboutVisible = ref(false);
    const appVersion = ref('1.0.0');
    function toggleNav() { navCollapsed.value = !navCollapsed.value; try { localStorage.setItem('nav-collapsed', navCollapsed.value ? '1' : '0'); } catch (e) {} }
    const appShell = { tool, prevTool };

    /* ════ 各域组合式（依赖显式注入：日志/配置/工具切换为跨域共享） ════ */
    const theme = useTheme();
    const log = useLog();
    const glyph = useGlyph();
    const serial = useSerial();
    const mqtt = useMqtt();
    const settings = useSettings({ appendLog: log.appendLog, appShell, serial, mqtt });
    const flash = useFlash({ log, settings, appShell });
    const stc51Tool = useStc51({ log, serial });
    const esp32Tool = useEsp32({ log, serial });
    const hardware = useHardwareDebug({ appendLog: log.appendLog });
    const ramlog = useRamLog({ settings });
    const firmware = useFirmwareAnalysis({ appendLog: log.appendLog, flash });
    const update = useUpdate();

    onMounted(() => {
      try { navCollapsed.value = localStorage.getItem('nav-collapsed') === '1'; } catch (e) {}
      // loadConfig 读取配置后再分发给串口/ MQTT 域（见 useSettings.loadConfig）
      settings.loadConfig().then(() => ramlog.applyRamLogConfig(settings.config.ramLogConfig));
      settings.checkEnv(); flash.loadRecent(); settings.refreshDefaultTc();
      // 读取真实版本号并同步一次更新状态
      update.initUpdate().then(() => { if (update.updateState.currentVersion) appVersion.value = update.updateState.currentVersion; });
    });

    return {
      tool, navCollapsed, toggleNav, aboutVisible, appVersion,
      ...theme, ...log, ...glyph, ...settings, ...flash, ...stc51Tool, ...esp32Tool, ...hardware, ...ramlog, ...firmware, ...serial, ...mqtt, ...update,
      FolderOpened, VideoPlay, Upload, CaretRight, Delete, Download, MagicStick, CopyDocument,
      Connection, SwitchButton, Promotion, Plus, Close, RefreshRight, VideoPause, Cpu,
      Operation, Document, DataAnalysis, DataLine
    };
  }
};
</script>
