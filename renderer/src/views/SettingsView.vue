<template>
  <div class="tool-pane settings-pane">
    <div class="pane-top settings-topbar">
      <div>
        <div class="pt-title">工具链设置</div>
        <div class="pt-sub">环境 / 编译烧录 / 工具链 / 路径</div>
      </div>
      <div class="spacer"></div>
      <div class="set-actions">
        <el-button @click="resetSettings">恢复默认</el-button>
        <el-button @click="closeSettings">取消</el-button>
        <el-button type="primary" @click="saveSettings">保存</el-button>
      </div>
    </div>

    <div class="settings-body">
      <el-form :model="draft" label-width="112px" label-position="right" class="set-form">
        <section class="set-overview">
          <div class="set-overview-copy">
            <div class="set-eyebrow">环境概览</div>
            <div class="set-overview-title">{{ systemDisplayName }}</div>
            <div class="set-overview-tags">
              <el-tag type="success" size="small" round>{{ systemRuntimeLabel }}</el-tag>
              <el-tag :type="toolchainProfile.supportsKeil ? 'success' : 'warning'" size="small" round>
                {{ toolchainProfile.supportsKeil ? '支持 Keil' : '不支持 Keil' }}
              </el-tag>
              <el-tag type="info" size="small" round>{{ systemDownloadLabel }}</el-tag>
            </div>
            <div class="set-overview-note">设置按当前系统独立保存，并自动匹配对应的工具链下载包。</div>
          </div>
          <div
            v-if="draft.buildSystem !== 'keil' && draft.toolchainMode === 'default'"
            class="set-health"
            :class="{ ready: readyToolchainCount === defaultToolchainItems.length }"
          >
            <span class="set-health-dot"></span>
            <div>
              <strong>{{ readyToolchainCount }}/{{ defaultToolchainItems.length }} 已就绪</strong>
              <span>默认工具链状态</span>
            </div>
          </div>
        </section>

        <section class="set-card">
          <div class="set-card-h">
            <el-icon><VideoPlay /></el-icon>
            <div>
              <span>编译与烧录</span>
              <small>选择工程构建方式和下载探针</small>
            </div>
          </div>

          <div class="set-config-grid set-balanced-grid">
            <div class="set-subsection set-balanced-panel">
              <div class="set-subsection-title">编译配置</div>
              <el-form-item label="编译方式">
                <el-radio-group v-model="draft.buildSystem">
                  <el-radio-button value="auto">自动判断</el-radio-button>
                  <el-radio-button value="make">Makefile (GCC)</el-radio-button>
                  <el-radio-button v-if="isWindows" value="keil">Keil uVision5</el-radio-button>
                </el-radio-group>
                <span class="set-hint">自动模式优先识别 Makefile；Windows 工程存在 .uvprojx 时可使用 Keil。</span>
              </el-form-item>

              <el-form-item label="工具链模式" v-if="draft.buildSystem !== 'keil'">
                <el-radio-group v-model="draft.toolchainMode">
                  <el-radio-button value="default">默认工具链</el-radio-button>
                  <el-radio-button value="custom">自定义路径</el-radio-button>
                </el-radio-group>
              </el-form-item>

              <el-form-item label="ELF 文件名" v-if="draft.flashMethod === 'pyocd' || draft.flashMethod === 'openocd'">
                <el-input v-model="draft.elfName" placeholder="留空 = 自动检测 .elf/.axf/.hex" />
              </el-form-item>

              <el-form-item label="Keil UV4.exe" v-if="isWindows && (draft.buildSystem !== 'make' || draft.flashMethod === 'keil')">
                <el-input v-model="draft.keilUV4Path" placeholder="如 C:\Keil_v5\UV4\UV4.exe" />
              </el-form-item>

              <el-form-item label="Keil 重新编译" v-if="isWindows && draft.buildSystem !== 'make'">
                <el-switch v-model="draft.keilRebuild" />
                <span class="set-hint inline">开：重新编译全部；关：增量编译</span>
              </el-form-item>
            </div>

            <div class="set-subsection set-balanced-panel">
              <div class="set-subsection-title">烧录配置</div>
              <el-form-item label="烧录方式">
                <el-radio-group v-model="draft.flashMethod">
                  <el-radio-button value="pyocd">pyOCD</el-radio-button>
                  <el-radio-button value="openocd">OpenOCD</el-radio-button>
                  <el-radio-button v-if="isWindows" value="keil">Keil UV4</el-radio-button>
                </el-radio-group>
                <span class="set-hint">PWLink/CMSIS-DAP 推荐使用 pyOCD 或 OpenOCD。</span>
              </el-form-item>

              <el-form-item label="pyOCD 路径" v-if="draft.flashMethod === 'pyocd'">
                <el-input v-model="draft.pyocdPath" :placeholder="toolchainProfile.placeholders.pyocdPath || 'pyocd 完整路径'" />
              </el-form-item>

              <el-form-item label="OpenOCD 路径" v-if="draft.flashMethod === 'openocd'">
                <el-input v-model="draft.openocdPath" :placeholder="toolchainProfile.placeholders.openocdPath || 'openocd 完整路径'" />
                <span class="set-hint">默认使用 interface/cmsis-dap.cfg。</span>
              </el-form-item>

              <el-form-item label="自动识别芯片" v-if="draft.flashMethod === 'pyocd'">
                <el-switch v-model="draft.autoDetectChip" />
                <span class="set-hint inline">缺少型号支持时自动安装对应 Pack</span>
              </el-form-item>

              <el-form-item label="复位下连接" v-if="draft.flashMethod === 'pyocd'">
                <el-switch v-model="draft.connectUnderReset" />
                <span class="set-hint inline">固件占用 SWD 或进入低功耗时使用</span>
              </el-form-item>

            </div>
          </div>
        </section>

        <section class="set-card" v-if="draft.buildSystem !== 'keil' && draft.toolchainMode === 'default'">
          <div class="set-card-h">
            <el-icon><Download /></el-icon>
            <div>
              <span>默认工具链</span>
              <small>{{ defaultToolchainHint }}</small>
            </div>
            <el-tag class="set-card-status" :type="readyToolchainCount === defaultToolchainItems.length ? 'success' : 'warning'" size="small" round>
              {{ readyToolchainCount }}/{{ defaultToolchainItems.length }} 就绪
            </el-tag>
          </div>

          <div class="tc-tool-list set-tool-grid">
            <div
              v-for="item in defaultToolchainItems"
              :key="item.key"
              class="tc-tool-item"
              :class="{ ready: item.ready && !item.showProgress, busy: item.showProgress, error: item.tagType === 'danger', 'set-tool-item-wide': item.key === 'commandTools' }"
              @click="openToolDetail(item.key)"
            >
              <div class="tc-tool-main">
                <span class="tc-tool-dot"></span>
                <span class="tc-tool-name">{{ item.name }}</span>
                <el-tag class="clickable-tag" :type="item.tagType" size="small" round effect="light">{{ item.stateText }}</el-tag>
                <span v-if="item.versionText" class="tc-tool-ver">{{ item.versionText }}</span>
                <span class="tc-tool-more">详情</span>
              </div>
              <el-progress
                v-if="item.showProgress"
                class="tc-tool-progress"
                :percentage="item.percent"
                :stroke-width="8"
                :status="item.progressStatus"
              />
            </div>
          </div>

          <div v-if="dlProgress.active" class="set-download-progress">
            <el-progress :percentage="dlProgress.percent" :stroke-width="10" />
            <span>{{ dlProgress.label ? ('当前 ' + dlProgress.label) : '准备中' }}</span>
          </div>

          <div class="set-card-actions">
            <el-button type="primary" :icon="Download" :loading="installingDefault" @click="installDefaultTc(false)">
              {{ installingDefault ? '安装中…' : defaultInstallButtonText }}
            </el-button>
            <el-button text :disabled="installingDefault" @click="installDefaultTc(true)">强制重新下载</el-button>
            <span class="set-action-note">缺失组件会自动补齐，已就绪组件默认跳过。</span>
          </div>
        </section>

        <section class="set-card">
          <div class="set-card-h">
            <el-icon><MagicStick /></el-icon>
            <div>
              <span>路径与系统集成</span>
              <small>管理工具位置、下载来源和命令行环境</small>
            </div>
          </div>

          <div class="set-path-panel" v-if="draft.buildSystem !== 'keil' && draft.toolchainMode === 'default'">
            <el-form-item label="保存目录">
              <div class="set-path-row">
                <el-input v-model="draft.toolchainRootPath" placeholder="留空 = 默认应用数据目录（升级后保留）" />
                <el-button @click="chooseToolchainRoot">浏览</el-button>
                <el-button text :disabled="!draft.toolchainRootPath" @click="clearToolchainRoot">恢复默认</el-button>
              </div>
              <span class="set-hint">当前生效：{{ defaultToolchainRootDisplay }}。修改后请先保存，再下载工具链。</span>
            </el-form-item>
          </div>

          <div class="set-config-grid set-path-grid">
            <div class="set-subsection">
              <div class="set-subsection-title">工具路径</div>
              <template v-if="draft.buildSystem !== 'keil' && draft.toolchainMode === 'custom'">
                <el-form-item label="ARM GCC bin">
                  <el-input v-model="draft.armGccPath" :placeholder="toolchainProfile.placeholders.armGccPath || 'arm-none-eabi-gcc 所在 bin 目录'" />
                </el-form-item>
                <el-form-item label="make bin">
                  <el-input v-model="draft.makePath" :placeholder="toolchainProfile.placeholders.makePath || 'make 所在 bin 目录'" />
                </el-form-item>
              </template>

              <el-form-item label="STM32CubeMX">
                <el-input v-model="draft.cubeMxPath" :placeholder="toolchainProfile.placeholders.cubeMxPath || ''" />
                <span class="set-hint">用于将 CubeMX .ioc 工程重新生成 Makefile 工程。</span>
              </el-form-item>
            </div>

            <div class="set-subsection">
              <div class="set-subsection-title">下载与系统</div>
              <el-form-item label="应用更新镜像">
                <el-input v-model="draft.updateFeedUrl" clearable placeholder="可选，如 https://download.example.com/burningTool/" />
                <span class="set-hint">完整更新源需提供 latest.yml / latest-linux.yml / latest-mac.yml 与安装包，建议同步 blockmap 以保留差分更新；仅支持 HTTPS，镜像失败自动回退官方源。</span>
              </el-form-item>

              <el-form-item label="工具链下载代理">
                <el-input v-model="draft.ghProxy" placeholder="可选，如 https://gh-proxy.com；留空直连 GitHub" />
                <span class="set-hint">工具链默认使用 8 线程分段下载。</span>
              </el-form-item>

              <el-form-item :label="pathEnv.label || '系统 PATH'" v-if="draft.buildSystem !== 'keil' && draft.toolchainMode === 'default'">
                <div class="set-env-row">
                  <el-tag :type="pathEnv.present ? 'success' : (pathEnv.partial ? 'warning' : 'info')" size="small" round>
                    {{ pathEnv.present ? '已配置' : (pathEnv.partial ? '部分配置' : '未配置') }}
                  </el-tag>
                  <el-button v-if="!pathEnv.present" type="warning" plain size="small" :loading="pathEnvBusy" :disabled="installingDefault || pathEnv.supported === false" @click="addSystemPathEnv">写入 PATH</el-button>
                  <el-button v-else type="danger" plain size="small" :loading="pathEnvBusy" :disabled="installingDefault || pathEnv.supported === false" @click="removeSystemPathEnv">从 PATH 删除</el-button>
                </div>
                <span class="set-hint">
                  {{ pathEnv.message || (pathEnv.supported === false ? '当前系统不支持自动写入 PATH' : '默认不修改 PATH，按需启用') }}
                </span>
              </el-form-item>
            </div>
          </div>
        </section>
      </el-form>

      <!-- ════ 内存监控（采样日志，用于排查内存增长 / 验证优化效果）════ -->
      <section class="set-card mem-card">
        <div class="set-card-h">
          <el-icon><DataLine /></el-icon>
          <div>
            <span>内存监控</span>
            <small>实时采样主进程 / 渲染进程 / GPU 的内存占用，记录成日志便于对比优化前后</small>
          </div>
          <el-tag
            v-if="memLatest"
            class="set-card-status"
            :type="memGrowthMb > 20 ? 'danger' : (memGrowthMb > 5 ? 'warning' : 'success')"
            size="small"
            round
          >
            合计 {{ memLatest.total }} MB
          </el-tag>
        </div>

        <div v-if="!memSupported" class="set-hint">当前环境不支持内存采集（需在 Electron 中运行）。</div>

        <template v-else>
          <!-- 概览卡片 -->
          <div class="mem-stats">
            <div class="mem-stat mem-stat-total">
              <span class="mem-stat-label">合计工作集</span>
              <span class="mem-stat-value">{{ memLatest ? memLatest.total : '—' }}<i>MB</i></span>
              <span class="mem-stat-sub">峰值 {{ memPeakTotalMb }} MB</span>
            </div>
            <div class="mem-stat">
              <span class="mem-stat-label">主进程</span>
              <span class="mem-stat-value">{{ memLatest ? memLatest.main : '—' }}<i>MB</i></span>
              <span class="mem-stat-sub">JS 堆 {{ memLatest ? memLatest.mainHeapUsed : '—' }} MB</span>
            </div>
            <div class="mem-stat">
              <span class="mem-stat-label">渲染进程</span>
              <span class="mem-stat-value">{{ memLatest ? memLatest.renderer : '—' }}<i>MB</i></span>
              <span class="mem-stat-sub">
                JS 堆 {{ memLatest && memLatest.heapUsed != null ? memLatest.heapUsed : '—' }} MB
              </span>
            </div>
            <div class="mem-stat">
              <span class="mem-stat-label">GPU 进程</span>
              <span class="mem-stat-value">{{ memLatest ? memLatest.gpu : '—' }}<i>MB</i></span>
              <span class="mem-stat-sub">进程数 {{ memLatest ? memLatest.processCount : '—' }}</span>
            </div>
          </div>

          <!-- 渲染进程 JS 堆占用条（相对 V8 上限） -->
          <div class="mem-heap" v-if="memLatest && memLatest.heapLimit">
            <div class="mem-heap-head">
              <span>渲染进程 JS 堆</span>
              <span>{{ memLatest.heapUsed }} / {{ memLatest.heapLimit }} MB（上限）</span>
            </div>
            <el-progress
              :percentage="Math.min(100, Math.round((memLatest.heapUsed / memLatest.heapLimit) * 1000) / 10)"
              :stroke-width="8"
              :show-text="false"
            />
          </div>

          <!-- 控制区 -->
          <div class="mem-controls">
            <el-form-item label="采样间隔" class="mem-interval">
              <el-radio-group :model-value="memIntervalMs" @update:model-value="memSetInterval">
                <el-radio-button v-for="opt in memIntervalOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </el-radio-button>
              </el-radio-group>
            </el-form-item>
            <div class="mem-actions">
              <el-button type="primary" :icon="memSampling ? VideoPause : VideoPlay" @click="memToggle">
                {{ memSampling ? '停止采样' : '开始采样' }}
              </el-button>
              <el-button :icon="RefreshRight" @click="memSampleNow">立即采样</el-button>
              <el-button :icon="Delete" :disabled="!memSamples.length" @click="memClear">清空</el-button>
              <el-button :icon="CopyDocument" :disabled="!memSamples.length" @click="memCopyLog">复制日志</el-button>
              <el-button :disabled="!memSamples.length" @click="memExportCsv">导出 CSV</el-button>
              <el-button :loading="memGcBusy" @click="memGc">触发 GC</el-button>
            </div>
          </div>

          <div class="set-hint mem-note" v-if="memGcNote">{{ memGcNote }}</div>
          <div class="set-hint mem-note mem-err" v-if="memError">采集失败：{{ memError }}</div>

          <!-- 采样日志 -->
          <div class="mem-log" v-if="memLogRows.length">
            <div class="mem-log-head">
              <span>时间</span><span>运行</span><span>合计</span><span>主进程</span>
              <span>渲染</span><span>GPU</span><span>渲染JS堆</span>
            </div>
            <div class="mem-log-body">
              <div class="mem-log-row" v-for="row in memLogRows" :key="row.t">
                <span>{{ row.time }}</span>
                <span class="mem-dim">{{ row.elapsed }}</span>
                <span class="mem-strong">{{ row.total }}</span>
                <span>{{ row.main }}</span>
                <span>{{ row.renderer }}</span>
                <span>{{ row.gpu }}</span>
                <span>{{ row.heapUsed }}</span>
              </div>
            </div>
            <div class="mem-log-foot">
              共 {{ memLogRows.length }} 条（最多保留 300 条）· 首末对比 {{ memGrowthMb >= 0 ? '+' : '' }}{{ memGrowthMb }} MB
            </div>
          </div>
          <div class="set-hint mem-note" v-else>
            尚未采样。点「开始采样」后每 {{ memIntervalMs / 1000 }} 秒记录一次；持续观察可发现内存是否稳定或缓慢增长。
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<script>
import { computed, inject, onMounted } from 'vue';

export default {
  setup() {
    const app = inject('appContext');
    if (!app) throw new Error('appContext is not available');
    const readyToolchainCount = computed(() => (
      (app.defaultToolchainItems.value || []).filter((item) => item.ready).length
    ));
    // 首次进入设置页先采一次，让内存卡片立刻有数据（不自动开始持续采样，避免无谓开销）
    onMounted(() => {
      if (app.memSupported && app.memSupported.value && !app.memLatest.value) app.memSampleNow();
    });
    return { ...app, readyToolchainCount };
  },
};
</script>
