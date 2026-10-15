import { createApp } from 'vue';
// 图标按需引入：仅注册模板用到的图标（含动态 :is 与 PascalCase 标签的并集），不再全量注册。
// ⚠️ 模板新增图标时必须同时加进下面的 import 与 usedIcons 两处，否则 Vue 只会打印
//    "Failed to resolve component: XXX"，图标位置留空而不中断，很容易漏掉。
import {
  Aim, Bottom, CaretLeft, CaretRight, CircleCheck, CircleClose, Clock, Close, Connection,
  CopyDocument, Cpu, Delete, Download, EditPen, Expand, Fold, FolderOpened, Grid,
  Hide, InfoFilled, MagicStick, Minus, Monitor, Moon, Plus, Promotion, RefreshRight,
  Setting, Sort, Sunny, SwitchButton, Tickets, Upload, VideoPause, VideoPlay, View,
  Operation, Document, DataAnalysis, DataLine,
} from '@element-plus/icons-vue';

// 组件与其样式经 unplugin 按需注入（见 vite.config.mjs）；此处仅引入暗色 css 变量与自定义样式
import 'element-plus/theme-chalk/dark/css-vars.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/tools/flash.css';
import './styles/tools/serial.css';
import './styles/tools/mqtt.css';
import './styles/tools/hardware.css';
import './styles/tools/ramlog.css';
import './styles/tools/firmware.css';
import './styles/tools/glyph.css';
import './styles/tools/crc.css';
import './styles/tools/stc51-esp32.css';
import './styles/tools/settings.css';

import App from './App.vue';

const usedIcons = {
  Aim, Bottom, CaretLeft, CaretRight, CircleCheck, CircleClose, Clock, Close, Connection,
  CopyDocument, Cpu, Delete, Download, EditPen, Expand, Fold, FolderOpened, Grid,
  Hide, InfoFilled, MagicStick, Minus, Monitor, Moon, Plus, Promotion, RefreshRight,
  Setting, Sort, Sunny, SwitchButton, Tickets, Upload, VideoPause, VideoPlay, View,
  Operation, Document, DataAnalysis, DataLine,
};

const app = createApp(App);
for (const [key, comp] of Object.entries(usedIcons)) app.component(key, comp);
app.mount('#app');
