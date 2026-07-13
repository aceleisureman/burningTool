// 应用内自动更新（对接主进程 updater.js / GitHub Releases）
import { ref, reactive } from 'vue';

export function useUpdate() {
  const updateState = reactive({
    status: 'idle',      // idle|checking|latest|downloading|downloaded|error
    currentVersion: '',  // 当前运行版本
    version: null,       // 可更新到的版本
    percent: 0,
    error: null
  });
  const updateChecking = ref(false);
  let pollTimer = null;

  function applyState(s) {
    if (!s) return;
    Object.assign(updateState, s);
  }

  // 轮询主进程状态，直到下载完成/最新/出错
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(async () => {
      try {
        const s = await window.api.updateStatus();
        applyState(s);
        if (['latest', 'downloaded', 'error', 'idle'].includes(s.status)) stopPoll();
      } catch (e) { stopPoll(); }
    }, 1000);
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // 手动"检查更新"
  async function checkUpdate() {
    if (updateChecking.value) return;
    updateChecking.value = true;
    updateState.status = 'checking';
    updateState.error = null;
    try {
      const r = await window.api.updateCheck();
      if (r && r.ok === false) {
        updateState.status = 'error';
        updateState.error = r.error || '检查失败';
      } else {
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
    try { await window.api.updateInstall(); } catch (e) {}
  }

  // 初始化时拉一次当前版本/状态
  async function initUpdate() {
    try { applyState(await window.api.updateStatus()); } catch (e) {}
  }

  return { updateState, updateChecking, checkUpdate, installUpdate, initUpdate };
}
