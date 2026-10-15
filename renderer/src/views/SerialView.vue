<template>
      <div class="tool-pane">
        <div class="pane-top">
          <div><div class="pt-title">串口调试</div><div class="pt-sub">serialport · 收发 / HEX / 快捷指令</div></div>
          <div class="spacer"></div>
          <div class="status-pill" :class="{ ok: serial.connected, busy: serial.reconnecting }"><span class="dot"></span>{{ serial.connected ? ('已连接 ' + (serial.portLabel || '')) : (serial.reconnecting ? ('自动重连 · 第 ' + serial.reconnectAttempt + ' 次') : '未连接') }}</div>
          <el-tooltip :content="quickPanelCollapsed ? '展开快捷指令面板' : '收起快捷指令面板'" placement="bottom-end">
            <el-button class="quick-panel-toggle" size="small" text @click="toggleQuickPanel">
              快捷指令<el-icon class="qpt-caret"><component :is="quickPanelCollapsed ? CaretLeft : CaretRight" /></el-icon>
            </el-button>
          </el-tooltip>
        </div>

        <div class="serial-body">
          <!-- 中：终端。原「串口设置」左栏已整体搬进终端工具栏（见 .term-bar），
               248px 全数让给日志区 -->

          <div class="serial-col serial-center">
            <div class="term-card">
              <div class="term-bar">
                <!-- 连接组：原左栏「串口设置」整体搬入，把 248px 让给终端。
                     参数在连接中禁用；term-bar 自带 flex-wrap，窄窗口会自动换成两行 -->
                <el-tooltip :content="portTooltip" placement="bottom-start">
                  <span class="tb-port" :class="{ on: serial.connected, idle: !serial.portLabel }" @click="onPortPick">
                    <span class="tb-port-dot"></span>
                    <span class="tb-port-name">{{ serial.portLabel || '选择串口' }}</span>
                    <el-icon class="tb-port-caret"><CaretRight /></el-icon>
                  </span>
                </el-tooltip>
                <span class="tb-param">
                  <span class="tb-lbl">波特率</span>
                  <el-select v-model="serial.baudRate" size="small" class="tb-sel tb-sel-baud" :disabled="serialParamLocked" filterable allow-create default-first-option>
                    <el-option v-for="b in baudRates" :key="b" :label="b" :value="b" />
                  </el-select>
                </span>
                <span class="tb-param">
                  <span class="tb-lbl">数据位</span>
                  <el-select v-model="serial.dataBits" size="small" class="tb-sel" :disabled="serialParamLocked">
                    <el-option :value="8" label="8" /><el-option :value="7" label="7" />
                  </el-select>
                </span>
                <span class="tb-param">
                  <span class="tb-lbl">校验位</span>
                  <el-select v-model="serial.parity" size="small" class="tb-sel" :disabled="serialParamLocked">
                    <el-option value="none" label="None" /><el-option value="even" label="Even" /><el-option value="odd" label="Odd" />
                  </el-select>
                </span>
                <span class="tb-param">
                  <span class="tb-lbl">停止位</span>
                  <el-select v-model="serial.stopBits" size="small" class="tb-sel tb-sel-stop" :disabled="serialParamLocked">
                    <el-option :value="1" label="1" /><el-option :value="2" label="2" />
                  </el-select>
                </span>
                <el-tooltip :content="'掉线自动重连：' + serialReconnectStatus" placement="bottom">
                  <span class="tb-toggle tb-icon-toggle" :class="{ on: serial.autoReconnect, busy: serial.reconnecting }"
                        @click="setAutoReconnect(!serial.autoReconnect)" aria-label="掉线自动重连">
                    <el-icon><RefreshRight /></el-icon>
                  </span>
                </el-tooltip>
                <el-button v-if="!serial.connected" class="tb-connect" size="small" type="primary"
                           :loading="serial.connecting" :icon="Connection" @click="serialConnect">{{ serial.reconnecting ? '重连' : '连接' }}</el-button>
                <el-button v-else class="tb-connect" size="small" type="danger" plain
                           :icon="SwitchButton" @click="serialDisconnect">断开</el-button>
                <el-tooltip v-if="!serialSupported" :content="(serialErrMsg || 'serialport 未安装') + ' —— 请在工程目录执行 npm install serialport 并 npx @electron/rebuild'" placement="bottom">
                  <span class="tb-warn">串口后端不可用</span>
                </el-tooltip>

                <span class="tb-sep"></span>

                <span class="tb-toggle" :class="{ on: serial.rxHex }" @click="serial.rxHex = !serial.rxHex">接收 HEX</span>
                <span class="tb-toggle" :class="{ on: serial.txHex }" @click="serial.txHex = !serial.txHex">发送 HEX</span>
                <span class="tb-toggle" :class="{ on: serial.appendNewline && !serial.txHex, disabled: serial.txHex }"
                      :title="serial.txHex ? 'HEX 模式按原始字节发送，不追加换行' : '发送时自动追加换行符'"
                      @click="toggleAppendNewline">追加换行</span>
                <span class="tb-toggle" :class="{ on: serial.autoScroll, suspended: serial.autoScroll && !termFollowing }"
                      @click="setAutoScroll(!serial.autoScroll)" :title="autoScrollHint">自动滚动</span>
                <span class="tb-toggle" :class="{ on: serial.timestamp }" @click="serial.timestamp = !serial.timestamp">时间戳</span>
                <span class="spacer"></span>
                <span class="tb-toggle" @click="clearTerm"><el-icon><Delete /></el-icon>清空</span>
                <span class="tb-toggle" @click="copyTerm"><el-icon><CopyDocument /></el-icon>复制</span>
              </div>
              <SerialTerminal />
            </div>

            <div class="send-bar serial-compose">
              <div class="send-input-stack">
                <el-input class="serial-send-input" v-model="serial.sendText" type="textarea" :rows="2" resize="none"
                          :placeholder="serial.txHex ? '输入 HEX，如 01 02 0A 0D' : '输入要发送的内容…'"
                          @keydown.enter="onSendKey"></el-input>
                <!-- 键盘提示与收发统计合并为一行：原先「Enter 发送…」与
                     「Tx/Rx 字节 + 串口格式」各占一行，白吃垂直空间 -->
                <div class="send-meta">
                  <span class="send-key-hint">Enter 发送 · Shift+Enter 换行</span>
                  <span class="send-meta-stats">
                    <SerialByteStats />
                    <span class="send-meta-sep">·</span>
                    <span>{{ serial.connected ? (serial.baudRate + ' ' + serial.dataBits + (serial.parity==='none'?'N':serial.parity==='even'?'E':'O') + serial.stopBits) : '未连接' }}</span>
                  </span>
                </div>
              </div>
              <div class="send-actions">
                <div class="send-action-buttons">
                  <el-popover v-model:visible="sendHistoryVisible" placement="top-end" :width="320" trigger="click"
                              popper-class="serial-history-popper">
                    <template #reference>
                      <el-button class="send-history-trigger" aria-label="发送历史" title="发送历史">
                        <el-icon><Clock /></el-icon><span>历史</span>
                      </el-button>
                    </template>
                    <div class="send-history-head">
                      <strong>发送历史</strong>
                      <span>{{ sendHistory.length }} / 30</span>
                      <el-button v-if="sendHistory.length" size="small" text @click="clearSendHistory">清空</el-button>
                    </div>
                    <div v-if="sendHistory.length" class="send-history-list">
                      <button v-for="(h, i) in sendHistory" :key="h.time + '-' + i" class="send-history-item" type="button"
                              @click="serial.sendText = h.text; serial.txHex = h.hex; sendHistoryVisible = false">
                        <span class="send-history-mode">{{ h.hex ? 'HEX' : 'TXT' }}</span>
                        <span class="send-history-text">{{ h.text }}</span>
                      </button>
                    </div>
                    <div v-else class="send-history-empty">暂无发送记录</div>
                  </el-popover>
                  <el-button class="serial-send-button" type="primary" :icon="Promotion"
                             :disabled="!serial.connected || !serial.sendText" @click="serialSend">发送</el-button>
                </div>
              </div>
            </div>
          </div>

          <!-- 右：快捷指令。收折只由页头按钮显式控制，不做悬停展开/延迟自动收起 -->
          <div class="serial-col serial-right quick-panel" :class="{ 'is-collapsed': quickPanelCollapsed }">
            <div v-show="!quickPanelCollapsed" class="quick-panel-content">
              <div class="quick-head">
                <div class="panel-title">快捷指令 <span class="qh-count">{{ quickCmds.length }}</span></div>
                <div class="quick-head-actions">
                  <el-tooltip :content="looping ? '停止循环发送' : '按勾选与间隔循环发送'" placement="top">
                    <el-button class="quick-loop-button" :class="{ on: looping }" size="small" text
                               :icon="looping ? VideoPause : RefreshRight" :disabled="!serial.connected"
                               @click="toggleLoop">{{ looping ? '停止' : '循环' }}</el-button>
                  </el-tooltip>
                </div>
              </div>
              <div class="quick-groups" :class="{ collapsed: quickGroupsCollapsed }">
                <button class="qgroup-toggle" type="button" :aria-expanded="!quickGroupsCollapsed"
                        @click="quickGroupsCollapsed = !quickGroupsCollapsed">
                  <span class="qgroup-label">分组</span>
                  <span class="qgroup-current">{{ cmdGroups.find(g => g.id === activeGid)?.name || '未选择' }}</span>
                  <span class="qgroup-total">{{ cmdGroups.length }} 组</span>
                  <el-icon class="qgroup-chevron"><CaretRight /></el-icon>
                </button>
                <div v-show="!quickGroupsCollapsed" class="qgroup-chips">
                  <button v-for="g in cmdGroups" :key="g.id" class="qgchip" :class="{ active: g.id === activeGid }"
                          type="button" @click="switchGroup(g.id)" @dblclick="startRename(g)"
                          :title="'单击切换 · 双击重命名 · ' + g.name">
                    <input v-if="editingGid === g.id" :id="'qgedit-' + g.id" class="qgt-edit" v-model="editName"
                           @click.stop @keyup.enter="commitRename(g)" @keyup.esc="cancelRename" @blur="commitRename(g)" />
                    <template v-else>
                      <span class="qgt-name">{{ g.name }}</span>
                      <span class="qgt-n">{{ g.cmds.length }}</span>
                      <el-icon v-if="g.id === activeGid" class="qgt-edit-ic" @click.stop="startRename(g)" title="重命名分组"><EditPen /></el-icon>
                    </template>
                  </button>
                  <button class="qgchip add" type="button" @click="addGroup" title="新建分组" aria-label="新建分组">
                    <el-icon><Plus /></el-icon>
                  </button>
                </div>
              </div>
              <div class="quick-toolbar">
                <el-button class="qtool-add" size="small" :icon="Plus" @click="addQuickCmd">添加指令</el-button>
                <span class="qtool-spacer"></span>
                <el-tooltip content="删除当前分组" placement="top">
                  <el-button class="qtool-icon" size="small" text :icon="Delete" aria-label="删除当前分组" @click="delGroup(cmdGroups.find(g => g.id === activeGid))" />
                </el-tooltip>
                <el-tooltip content="JSON 格式说明" placement="top">
                  <el-button class="qtool-icon" size="small" text :icon="Document" aria-label="JSON 格式说明" @click="openQuickFormat" />
                </el-tooltip>
                <el-tooltip content="导出全部分组" placement="top">
                  <el-button class="qtool-icon" size="small" text :icon="Download" aria-label="导出全部分组" @click="exportQuickCmds" />
                </el-tooltip>
                <el-tooltip content="导入 JSON" placement="top">
                  <el-button class="qtool-icon" size="small" text :icon="Upload" aria-label="导入 JSON" @click="importQuickCmds" />
                </el-tooltip>
              </div>
              <!-- 快捷指令可能上百条（每张卡 8 个 Element Plus 控件 ≈ 40 节点），
                   全量渲染会让本页 DOM 冲到 4000+，切页时样式重算/重排明显卡顿。
                   改用可变高度虚拟列表：只渲染视口内的卡片。 -->
              <VirtualList
                v-if="quickCmds.length"
                ref="quickList"
                class="quick-list"
                :items="quickCmds"
                item-key="id"
                :estimate="104"
                :gap="6"
              >
                <template #default="{ item: q, index: i }">
                <div class="qcard" :class="{ on: q.enabled }">
                  <div class="qc-top">
                    <el-checkbox v-model="q.enabled" size="small" title="勾选后纳入循环发送" />
                    <el-input class="qc-name" v-model="q.name" size="small" placeholder="名称 / 备注" />
                    <el-button class="qc-send" size="small" :disabled="!serial.connected" @click="sendQuickCmd(q)">发送</el-button>
                    <el-tooltip content="删除该指令" placement="top">
                      <el-button class="qc-del" size="small" text :icon="Close" aria-label="删除该指令" @click="delQuickCmd(i)" />
                    </el-tooltip>
                  </div>
                  <el-input class="qc-content" v-model="q.content" size="small" type="textarea" :rows="quickContentRows(q)"
                            :placeholder="q.hex ? 'HEX 如 01 03 00 0A' : '指令内容（发送自动追加 \\r\\n）'"
                            @focus="onQuickContentFocus(q)" @blur="onQuickContentBlur" />
                  <div class="qc-bot">
                    <el-checkbox v-model="q.hex" size="small" title="按 HEX 解析发送">HEX</el-checkbox>
                    <span class="lbl">间隔</span>
                    <el-input class="qc-int" v-model.number="q.interval" size="small" type="number" :min="0" />
                    <el-select class="qc-unit" v-model="q.unit" size="small">
                      <el-option label="毫秒" value="ms" />
                      <el-option label="秒" value="s" />
                      <el-option label="分" value="min" />
                    </el-select>
                  </div>
                </div>
                </template>
              </VirtualList>
              <div v-else class="quick-empty">暂无快捷指令<br>点「添加」新建</div>
            </div>
          </div>
        </div>

        <el-dialog v-model="quickFormatVisible" class="quick-format-dialog" title="快捷指令 JSON 格式"
                   width="760px" append-to-body destroy-on-close>
          <el-tabs v-model="quickFormatTab" class="qf-tabs">
            <el-tab-pane label="参数说明" name="fields">
              <div class="qf-structure">版本化追加格式：顶层包含 <code>schema</code>、<code>version</code>、<code>mode</code> 和 <code>groups</code>，导入不会覆盖已有指令。</div>
              <div class="qf-field-grid qf-field-head" aria-hidden="true">
                <span>层级</span><span>参数</span><span>类型</span><span>必填</span><span>备注</span>
              </div>
              <div v-for="field in quickCommandFormatFields" :key="field.scope + '-' + field.name" class="qf-field-grid">
                <span class="qf-scope">{{ field.scope }}</span>
                <code>{{ field.name }}</code>
                <span class="qf-type">{{ field.type }}</span>
                <span>{{ field.required }}</span>
                <span class="qf-note">{{ field.note }}</span>
              </div>
            </el-tab-pane>
            <el-tab-pane label="JSON 示例" name="example">
              <pre class="qf-code"><code>{{ quickCommandJsonExample }}</code></pre>
            </el-tab-pane>
            <el-tab-pane label="AI 提示词" name="prompt">
              <pre class="qf-code qf-prompt"><code>{{ quickCommandAiPrompt }}</code></pre>
            </el-tab-pane>
          </el-tabs>
          <template #footer>
            <el-button @click="quickFormatVisible = false">关闭</el-button>
            <el-button :icon="CopyDocument" @click="copyQuickCommandExample">复制 JSON 示例</el-button>
            <el-button type="primary" :icon="CopyDocument" @click="copyQuickCommandAiPrompt">复制 AI 提示词</el-button>
          </template>
        </el-dialog>
      </div>
</template>

<script>
import { inject } from 'vue';
import {
  CaretLeft, CaretRight, Clock, Close, Connection, CopyDocument, Delete, Document,
  Download, EditPen, Plus, Promotion, RefreshRight, SwitchButton, Upload, VideoPause
} from '@element-plus/icons-vue';
import SerialTerminal from '../components/SerialTerminal.vue';
import SerialByteStats from '../components/SerialByteStats.vue';
import VirtualList from '../components/VirtualList.vue';

export default {
  components: { SerialTerminal, SerialByteStats, VirtualList },
  data() {
    return {
      quickGroupsCollapsed: false,
      sendHistoryVisible: false,
      quickPanelCollapsed: true,
      focusedQuickId: null
    };
  },
  computed: {
    // 「自动滚动」有两种真实状态（开启并跟随 / 开启但被上滑暂停），必须分别说清，
    // 否则开关亮着却停在历史位置会让人以为功能失效
    autoScrollHint() {
      if (!this.serial.autoScroll) return '已关闭，点击开启并跳到最新';
      return this.termFollowing ? '正在跟随最新，点击暂停' : '已暂停（你上滑查看了历史），点击恢复跟随';
    },
    // 连接中/已连接时串口参数不可改（与原左栏的禁用条件一致）
    serialParamLocked() {
      return this.serial.connected || this.serial.connecting;
    },
    // 设备卡搬进工具栏后，VID/PID 这类设备详情改由口选择器的 tooltip 承担
    portTooltip() {
      if (this.serialParamLocked) return '已连接，需先「断开」才能切换串口';
      return this.serial.portSub ? ('点击切换串口 · ' + this.serial.portSub) : '点击选择串口设备';
    }
  },
  methods: {
    // 内容框高度必须是确定值：虚拟列表里用 autosize 会按当前宽度测算行数，
    // 而右栏收折时宽度在 0.2s 内从 36px 过渡到 312px，过渡期间测量会把
    // 单行指令算成 maxRows 行（实测卡片被撑到 168px，其中内容框占 78px）。
    // 改为按行数显式指定：未聚焦 1 行，聚焦时展开到 4 行方便编辑长指令。
    quickContentRows(q) {
      return this.focusedQuickId === q.id ? 4 : 1;
    },
    onQuickContentFocus(q) {
      this.focusedQuickId = q.id;
      this.refreshQuickListLayout();
    },
    onQuickContentBlur() {
      this.focusedQuickId = null;
      this.refreshQuickListLayout();
    },
    // 卡片自身高度变化不会改变列表容器尺寸，容器上的 ResizeObserver 不会触发，
    // 必须主动让虚拟列表重新实测，否则展开的卡片会压住下一条。
    refreshQuickListLayout() {
      this.$nextTick(() => {
        const list = this.$refs.quickList;
        if (list && typeof list.measure === 'function') list.measure();
      });
    },
    // 页面顶部「快捷指令」开关：只做显式切换，不做悬停展开、不做延迟自动收起
    toggleQuickPanel() {
      this.quickPanelCollapsed = !this.quickPanelCollapsed;
    },
    // 工具栏上的口选择器：连接中/已连接时不可切换
    onPortPick() {
      if (this.serialParamLocked) return;
      this.selectPort();
    },
    // 追加换行只在文本模式有意义（HEX 模式按原始字节发送）
    toggleAppendNewline() {
      if (this.serial.txHex) return;
      this.serial.appendNewline = !this.serial.appendNewline;
    }
  },
  setup() {
    const serialDomain = inject('serial');
    if (!serialDomain) throw new Error('serial context is not available');
    return {
      ...serialDomain,
      CaretLeft, CaretRight, Clock, Close, Connection, CopyDocument, Delete, Document,
      Download, EditPen, Plus, Promotion, RefreshRight, SwitchButton, Upload, VideoPause
    };
  },
};
</script>
