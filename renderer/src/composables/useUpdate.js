// 应用内自动更新（对接主进程 updater.js / GitHub Releases）
import { ref, reactive, onUnmounted } from 'vue';

export function useUpdate() {
  const updateState = reactive({
    status: 'idle',      // idle|checking|latest|downloading|downloaded|installing|error
    currentVersion: '',  // 当前运行版本
    version: null,       // 可更新到的版本
    percent: 0,
    error: null,
    platform: ''
  });
  const updateChecking = ref(false);
  const updateInstalling = ref(false);
  let pollTimer = null;
  let offStatus = null;

  function applyState(s) {
    if (!s) return;
    Object.assign(updateState, s);
    if (s.status === 'installing') updateInstalling.value = true;
  }

  // 兜底轮询：主进程推送失败时仍能看到进度（例如旧版本 preload）
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(async () => {
      try {
        const s = await window.api.updateStatus();
        applyState(s);
        if (['latest', 'downloaded', 'error', 'idle', 'installing'].includes(s.status)) stopPoll();
      } catch (e) { stopPoll(); }
    }, 1000);
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // 手动"检查更新"
  async function checkUpdate() {
    if (updateChecking.value || updateInstalling.value) return;
    if (updateState.status === 'downloaded') return installUpdate();
    updateChecking.value = true;
    updateState.status = 'checking';
    updateState.error = null;
    try {
      const r = await window.api.updateCheck();
      if (r && r.ok === false) {
        updateState.status = 'error';
        updateState.error = r.error || '检查失败';
      } else {
        if (r && r.state) applyState(r.state);
        // 推送通道已接好时轮询仅作短时兜底
        startPoll();
      }
    } catch (e) {
      updateState.status = 'error';
      updateState.error = String(e && e.message || e);
    } finally {
      updateChecking.value = false;
    }
  }

  // 重启并安装已下载的更新
  async function installUpdate() {
    if (updateInstalling.value) return;
    updateInstalling.value = true;
    updateState.status = 'installing';
    updateState.error = null;
    try {
      const r = await window.api.updateInstall();
      if (r && r.state) applyState(r.state);
      if (r && r.ok === false) {
        updateInstalling.value = false;
        updateState.status = 'downloaded';
        updateState.error = r.error || '安装失败';
      }
      // ok=true 时进程应很快退出；保留 installing 状态避免重复点击
    } catch (e) {
      updateInstalling.value = false;
      updateState.status = 'error';
      updateState.error = String(e && e.message || e);
    }
  }

  // 初始化时拉一次当前版本/状态，并订阅主进程推送
  async function initUpdate() {
    try {
      if (typeof window.api.onUpdateStatus === 'function') {
        offStatus = window.api.onUpdateStatus((s) => applyState(s));
      }
    } catch (e) {}
    try { applyState(await window.api.updateStatus()); } catch (e) {}
  }

  function disposeUpdate() {
    stopPoll();
    if (typeof offStatus === 'function') {
      try { offStatus(); } catch (e) {}
      offStatus = null;
    }
  }

  // 组件卸载时清理（App.vue 根组件一般不卸载，但保留安全路径）
  try { onUnmounted(disposeUpdate); } catch (e) {}

  return {
    updateState,
    updateChecking,
    updateInstalling,
    checkUpdate,
    installUpdate,
    initUpdate,
    disposeUpdate
  };
}
