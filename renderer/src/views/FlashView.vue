<template>
  <div class="tool-pane">
    <div class="pane-top">
      <div><div class="pt-title">STM32 烧录工具</div><div class="pt-sub">pyOCD + ARM GCC · 可视化编译烧录</div></div>
      <div class="spacer"></div>
      <div class="status-pill" :class="statusKind"><span class="dot"></span>{{ statusText }}</div>
      <button class="icon-btn" :class="{ active: historyOpen }" @click="toggleHistory" :title="historyOpen ? '收起历史项目' : '展开历史项目'">
        <el-icon :size="18"><Tickets /></el-icon>
      </button>
    </div>

    <div class="flash-body">
      <div class="body">
        <div class="card ops-panel">
          <!-- 1. 顶部烧录操作（纯图标操作栏：主操作 + 快捷工具 + 烧录方式） -->
          <div class="ops-section ops-actions">
            <div class="action-head">
              <span class="section-step">01</span>
              <div>
                <span class="title">快捷操作</span>
                <span class="hint">{{ projectDir ? '悬停图标查看功能说明' : '请选择项目后启用' }}</span>
              </div>
            </div>
            <div class="action-bar">
              <!-- 快捷工具 -->
              <div class="action-group">
                <el-tooltip content="检测烧录器连接状态" placement="bottom" :show-after="150">
                  <el-button class="tool-icon-button" :disabled="busy" @click="doCheckProbe" plain>
                    <el-icon><Aim /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="读取芯片信息" placement="bottom" :show-after="150">
                  <el-button class="tool-icon-button" :disabled="busy" @click="doReadChipInfo" plain>
                    <el-icon><Cpu /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip v-if="projectDir && hasIoc && !hasMakefile" content="由 CubeMX 工程生成 Makefile" placement="bottom" :show-after="150">
                  <el-button class="tool-icon-button tool-accent" :loading="generating" :disabled="busy" @click="doGenerateMakefile" plain>
                    <el-icon><MagicStick /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip :content="envReady ? envButtonReadyText : envButtonText" placement="bottom" :show-after="150">
                  <el-button class="tool-icon-button" :class="envReady ? 'tool-ok' : 'tool-warn'" :loading="installing" :disabled="busy" @click="installEnv" plain>
                    <el-icon><Download /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>

              <span class="action-divider"></span>

              <!-- 烧录方式 -->
              <el-radio-group v-model="flashMethodModel" class="method-icon-group" size="small">
                <el-tooltip content="pyOCD 烧录" placement="bottom" :show-after="150">
                  <el-radio-button class="method-icon-choice" value="pyocd"><el-icon><Connection /></el-icon></el-radio-button>
                </el-tooltip>
                <el-tooltip content="OpenOCD 烧录" placement="bottom" :show-after="150">
                  <el-radio-button class="method-icon-choice" value="openocd"><el-icon><Monitor /></el-icon></el-radio-button>
                </el-tooltip>
                <el-tooltip v-if="isWindows" content="Keil 烧录" placement="bottom" :show-after="150">
                  <el-radio-button class="method-icon-choice" value="keil"><el-icon><Setting /></el-icon></el-radio-button>
                </el-tooltip>
              </el-radio-group>

              <!-- pyOCD 选项（内联 chip） -->
              <div v-if="flashMethodModel === 'pyocd'" class="action-options">
                <el-checkbox v-model="autoDetectModel" size="small" class="option-chip" title="烧录前用 pyocd 探测芯片；关闭则直接用设置芯片，跳过识别">自动识别芯片</el-checkbox>
                <el-checkbox v-model="underResetModel" size="small" class="option-chip" title="复位状态下连接：固件占用 SWD/进低功耗后连不上时勾选（需探针 RST 接芯片复位脚）">复位下连接</el-checkbox>
              </div>

              <span class="action-divider"></span>

              <!-- 环境状态 -->
              <span class="utility-status" :class="{ ready: envReady }">{{ envReady ? '环境可用' : '环境待安装' }}</span>

              <!-- 主操作（最右侧） -->
              <div class="action-group action-group-main">
                <el-tooltip content="编译工程 · 生成最新固件" placement="bottom" :show-after="150">
                  <el-button class="command-button command-build" :loading="building" :disabled="!canOperate" @click="doBuild">
                    <el-icon class="command-glyph command-glyph-build"><VideoPlay /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="烧录固件 · 写入已有固件" placement="bottom" :show-after="150">
                  <el-button class="command-button command-flash" :loading="flashing && !building" :disabled="!canOperate" @click="doFlash">
                    <el-icon class="command-glyph command-glyph-flash"><Upload /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="一键执行 · 编译完成后自动烧录" placement="bottom" :show-after="150">
                  <el-button class="command-button command-primary" :loading="building && flashing" :disabled="!canOperate" @click="doBuildAndFlash">
                    <el-icon class="command-glyph command-glyph-primary"><CaretRight /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>
            </div>
          </div>

          <!-- 2. 选择项目 -->
          <div class="ops-section ops-project">
            <div class="section-heading">
              <span class="section-step">02</span>
              <div><strong>选择烧录项目</strong><small>支持 Makefile、Keil 与 CubeMX 工程</small></div>
            </div>
            <div class="project-row">
              <el-button type="primary" @click="selectDir" :icon="FolderOpened" :disabled="busy">选择项目目录</el-button>
              <div class="project-path" :class="pathClass" :title="projectDir || ''">
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

        </div>

        <div class="progress-wrap" v-if="busy">
          <el-progress :percentage="100" :indeterminate="true" :duration="2" :stroke-width="6" :show-text="false" status="success" />
        </div>

        <div class="log-panel">
          <div class="log-toolbar">
            <span class="left"><span class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>终端输出 <span class="log-count"><LogLineCount /></span></span>
            <span class="right">
              <span @click="reverse = !reverse"><el-icon><Sort /></el-icon>{{ reverse ? '倒序' : '正序' }}</span>
              <span @click="showTs = !showTs"><el-icon><Clock /></el-icon>{{ showTs ? '隐藏时间' : '显示时间' }}</span>
              <span @click="copyLog"><el-icon><CopyDocument /></el-icon>复制</span>
              <span @click="autoScroll = !autoScroll"><el-icon><component :is="autoScroll ? 'Bottom' : 'Minus'" /></el-icon>{{ autoScroll ? '自动滚动' : '已暂停' }}</span>
              <LogClearBtn :busy="busy" :icon="Delete" @clear="clearLog" />
            </span>
          </div>
          <LogPanel v-if="tool === 'flash'" pane="flash" empty="请先选择项目，然后检测环境并执行编译或烧录" />
        </div>
      </div>

      <aside class="history" :class="{ collapsed: !historyOpen }">
        <div class="history-head">
          <span>历史项目 <span class="history-count">({{ recent.length }})</span></span>
          <span class="history-head-actions">
            <span class="history-auto" :class="{ on: historyAutoHide }" @click="toggleHistoryAutoHide" :title="historyAutoHide ? '已开启：选项目/编译烧录后自动收起' : '已关闭：保持当前展开状态'">
              <el-icon><component :is="historyAutoHide ? 'Hide' : 'View'" /></el-icon>自动隐藏
            </span>
            <el-icon class="history-fold" @click="toggleHistory" title="收起"><Fold /></el-icon>
          </span>
        </div>
        <div class="history-list">
          <div v-for="d in recent" :key="d" class="history-item" :class="{ active: d === projectDir }" @click="openRecent(d)" :title="d">
            <div class="row"><span class="name">{{ baseName(d) }}</span><el-icon class="history-del" @click.stop="delRecent(d)" title="移除"><Close /></el-icon></div>
            <span class="path">{{ d }}</span>
          </div>
          <div v-if="recent.length === 0" class="history-empty">暂无历史项目<br>选择目录后自动记录</div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script>
import { inject } from 'vue';
import LogPanel from '../components/LogPanel.vue';
import LogLineCount from '../components/LogLineCount.vue';
import LogClearBtn from '../components/LogClearBtn.vue';

export default {
  components: { LogPanel, LogLineCount, LogClearBtn },
  setup() {
    const app = inject('appContext');
    if (!app) throw new Error('appContext is not available');
    return app;
  },
};
</script>
