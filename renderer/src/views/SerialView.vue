<template>
      <div class="tool-pane">
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
              <SerialTerminal />
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
</template>

<script>
import { inject } from 'vue';
import SerialTerminal from '../components/SerialTerminal.vue';
import SerialByteStats from '../components/SerialByteStats.vue';

export default {
  components: { SerialTerminal, SerialByteStats },
  setup() {
    const app = inject('appContext');
    if (!app) throw new Error('appContext is not available');
    return app;
  },
};
</script>
