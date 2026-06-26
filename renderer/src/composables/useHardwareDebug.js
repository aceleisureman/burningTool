import { reactive } from 'vue';

export function useHardwareDebug(deps) {
  const { appendLog } = deps;
  const hw = reactive({
    busy: false, action: '', lastOk: null,
    pyocd: '', probe: '', target: '', devid: '', output: '',
    address: '0x20000000', count: 4, value: '0x00000000'
  });

  function applyHwProbe(r) {
    if (!r) return;
    hw.pyocd = r.pyocd || hw.pyocd;
    const p = r.chosen || r.probe || (Array.isArray(r.probes) ? r.probes[0] : null);
    if (p) hw.probe = `${p.name || 'Probe'}${p.uid ? ' UID=' + p.uid : ''}`;
    if (r.target) hw.target = r.target;
    if (r.devid) hw.devid = r.devid;
  }

  async function hwCheckProbe() {
    hw.busy = true; hw.action = 'probe'; hw.lastOk = null;
    appendLog({ text: '═════════ 硬件调试：检测探针 ═════════', type: 'step' });
    try {
      const r = await window.api.checkProbe();
      applyHwProbe(r);
      hw.lastOk = !!(r && r.ok);
      hw.output = r && r.probes ? r.probes.map((p, i) => `${i}: ${p.name} UID=${p.uid}`).join('\n') : (r.error || '');
      if (!r.ok) ElMessage.error(r.error || '未检测到探针');
    } catch (e) {
      hw.lastOk = false; hw.output = e.message; appendLog({ text: `[异常] ${e.message}`, type: 'error' });
    }
    hw.busy = false; hw.action = '';
  }

  async function hwReadChip() {
    hw.busy = true; hw.action = 'chip'; hw.lastOk = null;
    appendLog({ text: '═════════ 硬件调试：读取芯片 ═════════', type: 'step' });
    try {
      const r = await window.api.readChipInfo();
      applyHwProbe(r);
      hw.lastOk = !!(r && r.ok);
      hw.output = r && r.ok ? [`Probe: ${hw.probe || '未知'}`, `Target: ${r.target}`, `DEV_ID: ${r.devid || '未读取'}`, r.name ? `Name: ${r.name}` : '', r.diagnostic ? `Diagnostic: ${r.diagnostic}` : ''].filter(Boolean).join('\n') : (r.error || '');
      if (!r.ok) ElMessage.error(r.error || '读取失败');
    } catch (e) {
      hw.lastOk = false; hw.output = e.message; appendLog({ text: `[异常] ${e.message}`, type: 'error' });
    }
    hw.busy = false; hw.action = '';
  }

  async function runHwCommand(action) {
    const addr = parseInt(String(hw.address || '').replace(/^0x/i, ''), 16);
    if (action === 'write32' && Number.isFinite(addr) && addr >= 0x08000000 && addr < 0x10000000) {
      hw.lastOk = false;
      hw.output = '当前地址属于 Flash 区，write32 不能单字写入 Flash。\n请使用“烧录工具”烧录固件，或使用“整片擦除”清空 Flash。';
      ElMessage.warning('Flash 区不能用 write32 写入');
      return;
    }
    hw.busy = true; hw.action = action; hw.lastOk = null;
    try {
      const r = await window.api.hardwareDebugCommand(action, { address: hw.address, count: hw.count, value: hw.value });
      applyHwProbe(r);
      hw.lastOk = !!(r && r.ok);
      hw.output = (r && r.out ? r.out.trim() : '') || (r && r.error) || (r && r.ok ? '执行完成' : '执行失败');
      if (r && r.ok) ElMessage.success('执行完成');
      else ElMessage.error((r && r.error) || '执行失败');
    } catch (e) {
      hw.lastOk = false; hw.output = e.message; appendLog({ text: `[异常] ${e.message}`, type: 'error' });
    }
    hw.busy = false; hw.action = '';
  }

  async function confirmHwErase() {
    try { await ElMessageBox.confirm('确定整片擦除 Flash？该操作会清空当前固件。', '确认擦除', { type: 'warning' }); } catch { return; }
    runHwCommand('erase');
  }

  return { hw, hwCheckProbe, hwReadChip, runHwCommand, confirmHwErase };
}
