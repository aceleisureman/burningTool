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
      <button class="nav-item" :class="{ active: tool === 'flash' }" @click="tool = 'flash'" title="STM32 固件烧录">
        <el-icon><Cpu /></el-icon><span class="label">固件烧录</span>
        <span v-if="busy" class="dot-state on"></span>
      </button>
      <button class="nav-item" :class="{ active: tool === 'stc51' }" @click="tool = 'stc51'" title="STC 宏晶单片机烧录">
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
      <button class="nav-item" :class="{ active: tool === 'mqtt' }" @click="tool = 'mqtt'" title="MQTT 消息调试">
        <el-icon><Connection /></el-icon><span class="label">消息调试</span>
        <span class="dot-state" :class="{ on: activeConn && activeConn.connected }"></span>
      </button>
      <button class="nav-item" :class="{ active: tool === 'glyph' }" @click="tool = 'glyph'" title="字模生成">
        <el-icon><Grid /></el-icon><span class="label">字模生成</span>
      </button>
      <button class="nav-item" :class="{ active: tool === 'crc' }" @click="tool = 'crc'" title="CRC 校验工具">
        <el-icon><DataLine /></el-icon><span class="label">CRC校验</span>
      </button>

      <div class="nav-spacer"></div>
      <div class="nav-foot">
        <button class="nf-btn" @click="toggleNav" :title="navCollapsed ? '展开菜单' : '收起菜单'"><el-icon><component :is="navCollapsed ? 'Expand' : 'Fold'" /></el-icon></button>
        <button class="nf-btn" @click="openThemePicker" :title="'主题：' + (currentPreset && currentPreset.name ? currentPreset.name : '')">
          <el-icon><component :is="isDark ? 'Moon' : 'Sunny'" /></el-icon>
        </button>
        <button class="nf-btn" @click="aboutVisible = true" title="关于"><el-icon><info-filled /></el-icon></button>
        <button class="nf-btn" :class="{ active: tool === 'settings' }" @click="openSettings" title="设置"><el-icon><Setting /></el-icon></button>
      </div>
    </nav>

    <!-- 主题配色选择 -->
    <el-dialog v-model="themePickerVisible" title="选择配色风格" width="560px" align-center class="theme-picker-dialog">
      <div class="theme-picker">
        <div class="theme-picker-group">
          <div class="theme-picker-label">浅色</div>
          <div class="theme-grid">
            <button
              v-for="p in themePresets.filter(t => t.mode === 'light')"
              :key="p.id"
              class="theme-card"
              :class="{ active: theme === p.id }"
              @click="selectTheme(p.id)"
            >
              <div class="theme-swatches">
                <span v-for="(c, i) in p.swatches" :key="i" class="theme-swatch" :style="{ background: c }"></span>
              </div>
              <div class="theme-card-meta">
                <div class="theme-card-name">{{ p.name }}</div>
                <div class="theme-card-desc">{{ p.desc }}</div>
              </div>
              <span v-if="theme === p.id" class="theme-card-check">✓</span>
            </button>
          </div>
        </div>
        <div class="theme-picker-group">
          <div class="theme-picker-label">深色</div>
          <div class="theme-grid">
            <button
              v-for="p in themePresets.filter(t => t.mode === 'dark')"
              :key="p.id"
              class="theme-card"
              :class="{ active: theme === p.id }"
              @click="selectTheme(p.id)"
            >
              <div class="theme-swatches">
                <span v-for="(c, i) in p.swatches" :key="i" class="theme-swatch" :style="{ background: c }"></span>
              </div>
              <div class="theme-card-meta">
                <div class="theme-card-name">{{ p.name }}</div>
                <div class="theme-card-desc">{{ p.desc }}</div>
              </div>
              <span v-if="theme === p.id" class="theme-card-check">✓</span>
            </button>
          </div>
        </div>
        <div class="theme-picker-actions">
          <el-button size="small" @click="toggleTheme">{{ isDark ? '切到浅色默认（清爽薄荷）' : '切到深色默认（深空青）' }}</el-button>
          <el-button size="small" text @click="cycleTheme">下一套配色</el-button>
        </div>
        <div class="theme-picker-tip">点击卡片立即切换并保存；下次启动自动恢复。旧版 light/dark 设置会自动迁移到对应默认方案。</div>
      </div>
    </el-dialog>

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
            v-if="updateState.status !== 'downloaded' && updateState.status !== 'installing'"
            size="small" type="primary" plain
            :loading="updateState.status === 'checking' || updateChecking"
            :disabled="updateInstalling"
            @click="checkUpdate">
            {{ updateState.status === 'downloading' ? `下载中 ${updateState.percent}%` : '检查更新' }}
          </el-button>
          <el-button
            v-else
            size="small" type="success"
            :loading="updateState.status === 'installing' || updateInstalling"
            @click="installUpdate">
            {{ (updateState.status === 'installing' || updateInstalling) ? '正在退出并安装…' : ('重启安装 v' + updateState.version) }}
          </el-button>
          <div class="about-update-tip">
            <span v-if="updateState.status === 'latest'">已是最新版本</span>
            <span v-else-if="updateState.status === 'downloading'">正在下载新版本 v{{ updateState.version }}… {{ updateState.percent }}%</span>
            <span v-else-if="updateState.status === 'downloaded'">新版本已就绪，点击重启完成更新</span>
            <span v-else-if="updateState.status === 'installing'">正在关闭占用资源并安装更新…</span>
            <span v-else-if="updateState.status === 'error'" class="about-update-err">{{ updateState.error }}</span>
            <span v-else-if="updateState.status === 'checking'">正在检查更新…</span>
          </div>
        </div>
        <div class="about-desc">可视化编译烧录 · StcGal · 串口调试 · MQTT 调试 · 字模生成 · CRC 校验</div>
        <div class="about-divider"></div>
        <div class="about-org">锐新网络科技有限公司</div>
        <div class="about-sub">© 2026 RuiXin Network Technology · 版权所有</div>
      </div>
    </el-dialog>

    <!-- ════ 主内容区 ════ -->
    <div class="app-main">

      <!-- ───── 工具①：烧录 ───── -->
      <!-- flash -->
      <FlashView v-show="tool === 'flash'" />

      <!-- ───── 工具②：StcGal ───── -->
      <!-- stc51 -->
      <Stc51View v-show="tool === 'stc51'" />

      <!-- ───── 工具③：ESP32 烧录 ───── -->
      <!-- esp32 -->
      <Esp32View v-show="tool === 'esp32'" />

      <!-- ───── 工具④：硬件调试 ───── -->
      <!-- hardware -->
      <HardwareView v-show="tool === 'hardware'" />

      <!-- ───── 工具③：内存日志 ───── -->
      <!-- ramlog -->
      <RamLogView v-show="tool === 'ramlog'" />

      <!-- ───── 工具④：固件分析 ───── -->
      <!-- firmware -->
      <FirmwareView v-show="tool === 'firmware'" />

      <!-- ───── 工具⑤：串口调试 ───── -->
      <!-- serial -->
      <SerialView v-show="tool === 'serial'" />

      <!-- ───── 工具③：MQTT 调试（MQTTX 风格 · 多连接）───── -->
      <!-- mqtt -->
      <MqttView v-show="tool === 'mqtt'" />

      <!-- ───── 工具④：字模生成（PCtoLCD 风格 · 重编）───── -->
      <!-- glyph -->
      <GlyphView v-show="tool === 'glyph'" />
      <CrcView v-show="tool === 'crc'" />

      <!-- ───── 工具⑤：设置 ───── -->
      <!-- settings -->
      <SettingsView v-show="tool === 'settings'" />
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
import { ref, onMounted, provide } from 'vue';
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
import { useCrc } from './composables/useCrc.js';
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
// 工具页面按域拆分，App 仅负责应用外壳与状态装配。
import FlashView from './views/FlashView.vue';
import Stc51View from './views/Stc51View.vue';
import Esp32View from './views/Esp32View.vue';
import HardwareView from './views/HardwareView.vue';
import RamLogView from './views/RamLogView.vue';
import FirmwareView from './views/FirmwareView.vue';
import SerialView from './views/SerialView.vue';
import MqttView from './views/MqttView.vue';
import GlyphView from './views/GlyphView.vue';
import CrcView from './views/CrcView.vue';
import SettingsView from './views/SettingsView.vue';

export default {
  components: { FlashView, Stc51View, Esp32View, HardwareView, RamLogView, FirmwareView, SerialView, MqttView, GlyphView, CrcView, SettingsView },
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
    const crcTool = useCrc();
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

    // 叶子组件 inject：把高频状态树提供出去，子组件订阅自身依赖即可，App 主模板不再为每批数据 diff
    provide('log', log);
    provide('serial', serial);
    provide('mqtt', mqtt);
    provide('ramlog', ramlog);

    onMounted(() => {
      try { navCollapsed.value = localStorage.getItem('nav-collapsed') === '1'; } catch (e) {}
      // loadConfig 读取配置后再分发给串口/ MQTT 域（见 useSettings.loadConfig）
      settings.loadConfig().then(() => ramlog.applyRamLogConfig(settings.config.ramLogConfig));
      settings.checkEnv(); flash.loadRecent(); settings.refreshDefaultTc();
      // 读取真实版本号并同步一次更新状态
      update.initUpdate().then(() => { if (update.updateState.currentVersion) appVersion.value = update.updateState.currentVersion; });
    });

    const appContext = {
      tool, navCollapsed, toggleNav, aboutVisible, appVersion,
      ...theme, ...log, ...glyph, ...crcTool, ...settings, ...flash, ...stc51Tool, ...esp32Tool, ...hardware, ...ramlog, ...firmware, ...serial, ...mqtt, ...update,
      FolderOpened, VideoPlay, Upload, CaretRight, Delete, Download, MagicStick, CopyDocument,
      Connection, SwitchButton, Promotion, Plus, Close, RefreshRight, VideoPause, Cpu,
      Operation, Document, DataAnalysis, DataLine
    };
    provide('appContext', appContext);
    return appContext;
  }
};
</script>
