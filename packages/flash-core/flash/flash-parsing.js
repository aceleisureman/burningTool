const path = require('path');

/* ── STM32 DBGMCU IDCODE 的 DEV_ID → pyocd 目标 / 家族 ──── */
const DEVID_MAP = {
  0x410: { family: 'stm32f1', target: 'stm32f103rc', name: 'STM32F101/102/103 (中密度)' },
  0x412: { family: 'stm32f1', target: 'stm32f103rc', name: 'STM32F1 (低密度)' },
  0x414: { family: 'stm32f1', target: 'stm32f103rc', name: 'STM32F1 (高密度)' },
  0x418: { family: 'stm32f1', target: 'stm32f107rc', name: 'STM32F105/107 (互联型)' },
  0x420: { family: 'stm32f1', target: 'stm32f100rc', name: 'STM32F100 (值线)' },
  0x413: { family: 'stm32f4', target: 'stm32f407vg', name: 'STM32F405/407/415/417' },
  0x419: { family: 'stm32f4', target: 'stm32f429xx', name: 'STM32F42x/43x' },
  0x431: { family: 'stm32f4', target: 'stm32f411re', name: 'STM32F411' },
  0x441: { family: 'stm32f4', target: 'stm32f412ce', name: 'STM32F412' },
  0x449: { family: 'stm32f7', target: 'stm32f746ng', name: 'STM32F74x/75x' },
  0x450: { family: 'stm32h7', target: 'stm32h743xx', name: 'STM32H742/743/753' },
  0x415: { family: 'stm32l4', target: 'stm32l475xg', name: 'STM32L4x5/4x6' },
  0x435: { family: 'stm32l4', target: 'stm32l433xx', name: 'STM32L43x/44x' },
  0x468: { family: 'stm32g4', target: 'stm32g431xx', name: 'STM32G431/441' },
  0x469: { family: 'stm32g4', target: 'stm32g474xx', name: 'STM32G47x/48x' },
  0x440: { family: 'stm32f0', target: 'stm32f051x8', name: 'STM32F05x' },
  0x444: { family: 'stm32f0', target: 'stm32f031x6', name: 'STM32F03x' },
  0x445: { family: 'stm32f0', target: 'stm32f042x6', name: 'STM32F04x' },
  0x448: { family: 'stm32f0', target: 'stm32f072xb', name: 'STM32F07x' },
  0x460: { family: 'stm32g0', target: 'stm32g071xx', name: 'STM32G07x/08x' },
  0x466: { family: 'stm32g0', target: 'stm32g031xx', name: 'STM32G03x/04x' }
};

function parseHex32(text) {
  // read32 输出形如 "0xe0042000:  0x10036410"，取冒号后的值，否则取最后一个 0x token
  const colon = String(text).match(/:\s*(0x[0-9a-fA-F]+)/);
  if (colon) return parseInt(colon[1], 16);
  const all = String(text).match(/0x[0-9a-fA-F]+/g);
  return all ? parseInt(all[all.length - 1], 16) : null;
}

function parseStm32DevidFromValues(out) {
  const vals = [];
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = line.match(/\b(?:0x)?(?:e0042000|40015800)\b\s*:\s*(?:0x)?([0-9a-fA-F]{1,8})\b/i);
    if (m) vals.push(parseInt(m[1], 16));
  }
  for (const v of vals) {
    if (!v) continue;
    const devid = v & 0xFFF;
    if (DEVID_MAP[devid]) return { detected: true, devid, entry: DEVID_MAP[devid] };
  }
  const lastVal = vals.find((v) => v);
  return { detected: false, devid: lastVal == null ? null : (lastVal & 0xFFF) };
}

// 多探针时选一个：优先有效 UID(非全 0) 且 CMSIS-DAP/DAPLink(如 PWLink2)
function chooseProbe(probes) {
  if (!probes || !probes.length) return null;
  const valid = probes.filter((p) => p.uid && !/^0+$/.test(p.uid));
  const pool = valid.length ? valid : probes;
  const dap = pool.find((p) => /cmsis-?dap|daplink/i.test(p.name));
  return dap || pool[0];
}

/* ── pyOCD 输出清洗：去进度条/克隆探针噪声，阶段中文化 ──── */
function cleanPyocd(raw) {
  const s = String(raw).replace(/[\b]/g, '').trim();
  if (!s) return null;
  if (/^[\s=\->|<[\]#.*]+$/.test(s)) return null;        // 纯符号的进度条/标尺行
  let msg = s.replace(/^\d+\s+[IWE]\s+/, '')              // 去掉 "0001583 I " 前缀
             .replace(/\s*\[[a-z0-9_]+\]\s*$/i, '')        // 去掉 "[loader]" 后缀
             .trim();
  if (!msg) return null;
  if (/Board ID .* is not recognized/i.test(msg)) return null;   // 克隆探针噪声
  if (/Not a genuine ST Device/i.test(msg)) return null;
  if (/memory transfer failed/i.test(msg)) return null;
  let m;
  if (/^Erasing\b/i.test(msg)) return { text: '  擦除中 …', type: 'info' };
  if (/^Programming\b/i.test(msg)) return { text: '  编程中 …', type: 'info' };
  if ((m = msg.match(/^Loading\s+(.+)$/i))) return { text: `  写入 ${path.basename(m[1].trim())}`, type: 'info' };
  if ((m = msg.match(/programmed\s+(\d+)\s+bytes.*?at\s+([\d.]+\s*\S+)/i)))
    return { text: `  完成：写入 ${m[1]} 字节 @ ${m[2]}`, type: 'success' };
  return { text: `  ${msg}`, type: 'info' };
}

/* ── make/GCC 输出清洗：长命令回显压缩为简短中文，警告/错误原样保留 ── */
function cleanMake(raw) {
  const t = String(raw).trimEnd();
  const s = t.trim();
  if (!s) return null;
  if (/^(rm|mkdir)\b/.test(s)) return null;                       // 抑制 rm/mkdir 回显
  let m;
  if ((m = s.match(/arm-none-eabi-(?:gcc|g\+\+)\s+-c\b.*?\s(\S+\.(?:c|cpp|cc|cxx|s|S))\s+-o\b/)))
    return { text: `  编译 ${path.basename(m[1])}`, type: 'info' };
  if ((m = s.match(/arm-none-eabi-(?:gcc|g\+\+)\b.*\s-o\s+(\S+\.(?:elf|axf))\b/)))
    return { text: `  链接 ${path.basename(m[1])}`, type: 'info' };
  if ((m = s.match(/arm-none-eabi-objcopy\b.*\s(\S+\.(?:hex|bin))\s*$/)))
    return { text: `  生成 ${path.basename(m[1])}`, type: 'info' };
  if (/^\S*arm-none-eabi-size\b/.test(s)) return null;            // 抑制 size 命令回显（保留其表格输出）
  return t;                                                       // 其余（警告/错误/size 表格）原样
}

/* ── STM32CubeMX 输出清洗：压掉空行/纯符号噪声，其余加缩进 ── */
function cleanCubeMx(raw) {
  const s = String(raw).replace(/[\b]/g, '').trim();
  if (!s) return null;
  if (/^[=\-_.*\s]+$/.test(s)) return null;
  return { text: `  ${s}`, type: 'info' };
}

// 把含中文/非 ASCII 的工程名转成安全的 ASCII 目标名（用于 Makefile 的 TARGET）
function asciiTargetName(orig) {
  const cleaned = String(orig || '')
    .replace(/[^\x20-\x7E]/g, '')   // 去掉非 ASCII（中文等）
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_.-]/g, '')
    .replace(/^[_.-]+|[_.-]+$/g, '');
  // 清洗后若没有字母（如只剩 "2"），用通用名，避免奇怪的目标名
  return /[A-Za-z]/.test(cleaned) ? cleaned : 'firmware';
}

module.exports = {
  DEVID_MAP,
  parseHex32,
  parseStm32DevidFromValues,
  chooseProbe,
  cleanPyocd,
  cleanMake,
  cleanCubeMx,
  asciiTargetName
};
