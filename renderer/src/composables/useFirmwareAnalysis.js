import { reactive } from 'vue';

export function useFirmwareAnalysis(deps) {
  const { appendLog, flash } = deps;
  const fw = reactive({
    busy: false, ok: false, error: '',
    firmware: '', firmwareName: '', firmwareSize: 0, mapFile: '',
    flash: { used: 0, total: 0, percent: 0, label: '' },
    ram: { used: 0, total: 0, percent: 0, label: '' },
    sections: [], symbols: [], regions: []
  });

  function fmtFwBytes(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }

  async function doAnalyzeFirmware() {
    if (!flash.projectDir.value) { ElMessage.warning('请先选择工程目录'); return; }
    fw.busy = true; fw.ok = false; fw.error = '';
    appendLog({ text: '═════════ 固件分析 ═════════', type: 'step' });
    try {
      const r = await window.api.analyzeFirmware(flash.projectDir.value);
      if (!r || !r.ok) {
        fw.error = (r && r.error) || '分析失败';
        appendLog({ text: `[分析] ✗ ${fw.error}`, type: 'error' });
        ElMessage.error(fw.error);
      } else {
        Object.assign(fw, {
          ok: true, error: '',
          firmware: r.firmware || '', firmwareName: r.firmwareName || '', firmwareSize: r.firmwareSize || 0, mapFile: r.mapFile || '',
          flash: r.flash || { used: 0, total: 0, percent: 0, label: '' },
          ram: r.ram || { used: 0, total: 0, percent: 0, label: '' },
          sections: r.sections || [], symbols: r.symbols || [], regions: r.regions || []
        });
        appendLog({ text: `[分析] 固件: ${fw.firmwareName} (${fmtFwBytes(fw.firmwareSize)})`, type: 'info' });
        appendLog({ text: `[分析] Flash ${fw.flash.label || '0 B'}${fw.flash.total ? ' / ' + fmtFwBytes(fw.flash.total) + ' (' + fw.flash.percent + '%)' : ''}`, type: 'success' });
        appendLog({ text: `[分析] RAM ${fw.ram.label || '0 B'}${fw.ram.total ? ' / ' + fmtFwBytes(fw.ram.total) + ' (' + fw.ram.percent + '%)' : ''}`, type: 'success' });
        ElMessage.success('固件分析完成');
      }
    } catch (e) {
      fw.error = e.message || String(e);
      appendLog({ text: `[异常] ${fw.error}`, type: 'error' });
    }
    fw.busy = false;
  }

  return { fw, doAnalyzeFirmware, fmtFwBytes };
}
