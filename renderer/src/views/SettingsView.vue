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
              <el-form-item label="下载加速镜像">
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
    </div>
  </div>
</template>

<script>
import { computed, inject } from 'vue';

export default {
  setup() {
    const app = inject('appContext');
    if (!app) throw new Error('appContext is not available');
    const readyToolchainCount = computed(() => (
      (app.defaultToolchainItems.value || []).filter((item) => item.ready).length
    ));
    return { ...app, readyToolchainCount };
  },
};
</script>
