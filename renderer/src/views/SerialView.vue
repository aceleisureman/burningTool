<template>
      <div class="tool-pane">
        <div class="pane-top">
          <div><div class="pt-title">串口调试</div><div class="pt-sub">serialport · 收发 / HEX / 快捷指令</div></div>
          <div class="spacer"></div>
          <div class="status-pill" :class="{ ok: serial.connected, busy: serial.reconnecting }"><span class="dot"></span>{{ serial.connected ? ('已连接 ' + (serial.portLabel || '')) : (serial.reconnecting ? ('自动重连 · 第 ' + serial.reconnectAttempt + ' 次') : '未连接') }}</div>
        </div>

        <div class="serial-body">
          <!-- 左：串口参数 -->
          <div class="serial-col serial-left">
            <div>
              <div class="panel-title">串口设置</div>
              <div class="panel-sub">先「选择串口」识别设备，设置好参数再点「连接串口」</div>
            </div>
            <div class="field"><label>串口</label>
              <el-button style="width:100%" :disabled="serial.connected || serial.connecting" :icon="RefreshRight" @click="selectPort">{{ serial.portLabel ? '重新选择串口' : '选择串口' }}</el-button>
            </div>
            <div v-if="serial.portLabel" class="port-info" :class="{ live: serial.connected }">
              <div class="pi-name"><span class="pi-dot"></span><el-icon><Cpu /></el-icon><span>{{ serial.portLabel }}</span></div>
              <div class="pi-sub" v-if="serial.portSub">{{ serial.portSub }}</div>
              <div class="pi-state">{{ serial.connected ? '已连接' : (serial.reconnecting ? (serial.reconnectWait ? serial.reconnectWait + ' 秒后重连' : '正在重连') : '已选择，待连接') }}</div>
            </div>
            <div class="field"><label>波特率</label>
              <el-select v-model="serial.baudRate" :disabled="serial.connected || serial.connecting" style="width:100%" filterable allow-create default-first-option>
                <el-option v-for="b in baudRates" :key="b" :label="b" :value="b" />
              </el-select>
            </div>
            <div class="field"><label>数据位</label>
              <el-select v-model="serial.dataBits" :disabled="serial.connected || serial.connecting" style="width:100%">
                <el-option :value="8" label="8" /><el-option :value="7" label="7" />
              </el-select>
            </div>
            <div class="field"><label>校验位</label>
              <el-select v-model="serial.parity" :disabled="serial.connected || serial.connecting" style="width:100%">
                <el-option value="none" label="None" /><el-option value="even" label="Even" /><el-option value="odd" label="Odd" />
              </el-select>
            </div>
            <div class="field"><label>停止位</label>
              <el-select v-model="serial.stopBits" :disabled="serial.connected || serial.connecting" style="width:100%">
                <el-option :value="1" label="1" /><el-option :value="2" label="2" />
              </el-select>
            </div>
            <div class="serial-reconnect-control" :class="{ on: serial.autoReconnect, busy: serial.reconnecting }"
                 @click="setAutoReconnect(!serial.autoReconnect)">
              <span class="src-icon" aria-hidden="true"><el-icon><RefreshRight /></el-icon></span>
              <span class="src-copy">
                <span class="src-title">掉线重连</span>
                <span class="src-status">{{ serialReconnectStatus }}</span>
              </span>
              <el-checkbox class="src-check" :model-value="serial.autoReconnect" aria-label="掉线重连"
                           @click.stop @change="setAutoReconnect" />
            </div>
            <el-button v-if="!serial.connected" type="primary" style="width:100%" :loading="serial.connecting" :icon="Connection" @click="serialConnect">{{ serial.reconnecting ? '立即重连' : '连接串口' }}</el-button>
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
              <SerialTerminal />
            </div>

            <div class="send-bar serial-compose">
              <div class="send-input-stack">
                <el-input class="serial-send-input" v-model="serial.sendText" type="textarea" :rows="2" resize="none"
                          :placeholder="serial.txHex ? '输入 HEX，如 01 02 0A 0D' : '输入要发送的内容…'"
                          @keydown.enter="onSendKey"></el-input>
                <span class="send-key-hint">Enter 发送 · Shift+Enter 换行</span>
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
                <el-checkbox v-model="serial.appendNewline" :disabled="serial.txHex" size="small">追加换行</el-checkbox>
              </div>
            </div>
            <div class="stat-row">
              <SerialByteStats />
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
            <div class="quick-groups" :class="{ collapsed: quickGroupsCollapsed }">
              <button class="qgroup-toggle" type="button" :aria-expanded="!quickGroupsCollapsed"
                      @click="quickGroupsCollapsed = !quickGroupsCollapsed">
                <span class="qgroup-label">指令分组</span>
                <span class="qgroup-current">{{ cmdGroups.find(g => g.id === activeGid)?.name || '未选择' }}</span>
                <span class="qgroup-total">{{ cmdGroups.length }}</span>
                <el-icon class="qgroup-chevron"><CaretRight /></el-icon>
              </button>
              <div v-show="!quickGroupsCollapsed" class="qgroup-tabs">
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
            </div>
            <div class="quick-toolbar">
              <el-button size="small" :icon="Plus" @click="addQuickCmd">添加指令</el-button>
              <span style="flex:1;"></span>
              <el-tooltip content="删除当前分组" placement="top">
                <el-button class="qtool-icon" size="small" text :icon="Delete" aria-label="删除当前分组" @click="delGroup(cmdGroups.find(g => g.id === activeGid))" />
              </el-tooltip>
              <el-button class="qfmt-button" size="small" text :icon="Document" @click="openQuickFormat">JSON 格式</el-button>
              <el-tooltip content="导出全部分组" placement="top">
                <el-button class="qtool-icon" size="small" text :icon="Download" aria-label="导出全部分组" @click="exportQuickCmds" />
              </el-tooltip>
              <el-tooltip content="导入 JSON" placement="top">
                <el-button class="qtool-icon" size="small" text :icon="Upload" aria-label="导入 JSON" @click="importQuickCmds" />
              </el-tooltip>
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
  CaretRight, Clock, Close, Connection, CopyDocument, Cpu, Delete, Document,
  Download, EditPen, Plus, Promotion, RefreshRight, SwitchButton, Upload, VideoPause
} from '@element-plus/icons-vue';
import SerialTerminal from '../components/SerialTerminal.vue';
import SerialByteStats from '../components/SerialByteStats.vue';

export default {
  components: { SerialTerminal, SerialByteStats },
  data() {
    return { quickGroupsCollapsed: false, sendHistoryVisible: false };
  },
  setup() {
    const serialDomain = inject('serial');
    if (!serialDomain) throw new Error('serial context is not available');
    return {
      ...serialDomain,
      CaretRight, Clock, Close, Connection, CopyDocument, Cpu, Delete, Document,
      Download, EditPen, Plus, Promotion, RefreshRight, SwitchButton, Upload, VideoPause
    };
  },
};
</script>
