// 应用内自动更新（对接主进程 updater.js / GitHub Releases）
import { ref, reactive } from 'vue';

export function useUpdate() {
  const updateState = reactive({
    status: 'idle',      // idle|checking|latest|downloading|downloaded|installing|error
    currentVersion: '',  // 当前运行版本
    version: null,       // 可更新到的版本
    percent: 0,
    error: null
  });
  const updateChecking = ref(false);
  const updateInstalling = ref(false);
  let pollTimer = null;

  function applyState(s) {
    if (!s) return;
    Object.assign(updateState, s);
    if (s.status === 'installing') updateInstalling.value = true;
  }

  // 轮询主进程状态，直到下载完成/最新/出错/安装中
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

  // 初始化时拉一次当前版本/状态
  async function initUpdate() {
    try { applyState(await window.api.updateStatus()); } catch (e) {}
  }

  return { updateState, updateChecking, updateInstalling, checkUpdate, installUpdate, initUpdate };
}
