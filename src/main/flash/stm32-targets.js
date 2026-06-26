function normalizePyocdTarget(target) {
  const t = String(target || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!t) return t;
  // STM32 order codes include a 2-char package/temp suffix, e.g. STM32F103C8T6.
  // pyOCD/CMSIS-Pack target names use the device name only: stm32f103c8.
  if (/^stm32[a-z]\d{3}/i.test(t) && t.length > 11) return t.slice(0, 11);
  return t;
}

function isStm32Target(target) {
  return /^stm32[a-z]\d/i.test(String(target || ''));
}

function openocdTargetConfig(target) {
  const t = normalizePyocdTarget(target);
  const m = t.match(/^stm32([a-z]\d)/i);
  if (!m) return 'target/stm32f1x.cfg';
  const family = m[1].toLowerCase();
  const map = {
    f0: 'target/stm32f0x.cfg',
    f1: 'target/stm32f1x.cfg',
    f2: 'target/stm32f2x.cfg',
    f3: 'target/stm32f3x.cfg',
    f4: 'target/stm32f4x.cfg',
    f7: 'target/stm32f7x.cfg',
    g0: 'target/stm32g0x.cfg',
    g4: 'target/stm32g4x.cfg',
    h7: 'target/stm32h7x.cfg',
    l0: 'target/stm32l0.cfg',
    l1: 'target/stm32l1.cfg',
    l4: 'target/stm32l4x.cfg',
    u5: 'target/stm32u5x.cfg',
    wb: 'target/stm32wbx.cfg',
    wl: 'target/stm32wlx.cfg'
  };
  return map[family] || 'target/stm32f1x.cfg';
}

module.exports = {
  normalizePyocdTarget,
  isStm32Target,
  openocdTargetConfig
};
