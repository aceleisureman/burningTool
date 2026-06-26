function diagnosePyocdOutput(output, context = {}) {
  const text = String(output || '');
  const target = context.target || '当前目标';
  const items = [];

  if (/Target type .* not recognized/i.test(text)) {
    items.push({
      reason: 'pyOCD 不支持当前目标型号',
      suggestion: `安装对应 CMSIS-Pack，或确认目标型号名称是否正确：${target}`
    });
  }
  if (/flash program page failure|result code 0x1/i.test(text)) {
    items.push({
      reason: 'Flash 写入失败',
      suggestion: '优先确认目标型号是否匹配真实芯片；若型号正确，再尝试全片擦除/解除写保护/降低 SWD 频率。'
    });
  }
  if (/Unable to claim interface|probe.*busy|resource busy|device.*busy/i.test(text)) {
    items.push({
      reason: '烧录器被其它进程占用',
      suggestion: '停止 RAM Log 轮询、关闭其它 pyOCD/OpenOCD/调试窗口，或重新插拔 PWLink 后重试。'
    });
  }
  if (/No probe|No connected|probe.*not found|Unable to find/i.test(text)) {
    items.push({
      reason: '未检测到烧录器',
      suggestion: '检查 PWLink 是否接入、USB 权限、SWDIO/SWCLK/GND/3V3 接线。'
    });
  }
  if (/locked|read.?out protection|write protect|protected/i.test(text)) {
    items.push({
      reason: '芯片可能开启读保护或写保护',
      suggestion: '需要先执行全片擦除或解除保护，注意这会清空芯片。'
    });
  }
  if (/transfer fault|memory transfer failed|timeout|timed out/i.test(text)) {
    items.push({
      reason: 'SWD 通信不稳定',
      suggestion: '尝试勾选复位下连接、连接 NRST、降低 SWD 频率，确认目标板供电稳定。'
    });
  }

  return items;
}

function diagnoseOpenocdOutput(output, context = {}) {
  const text = String(output || '');
  const target = context.target || '当前目标';
  const items = [];

  if (/target voltage.*too low|target voltage.*0\.0|no target voltage/i.test(text)) {
    items.push({
      reason: 'OpenOCD 检测到目标板供电异常',
      suggestion: '确认目标板已供电，PWLink 的 GND/3V3/SWDIO/SWCLK 已正确连接。'
    });
  }
  if (/unable to open cmsis-dap|unable to find a matching cmsis-dap|no device found|unable to find/i.test(text)) {
    items.push({
      reason: 'OpenOCD 未检测到 PWLink/CMSIS-DAP',
      suggestion: '检查烧录器 USB 连接和权限；若被 pyOCD 占用，请关闭其它烧录进程后重试。'
    });
  }
  if (/timed out|ack fault|dap init failed|error connecting dp|can't attach/i.test(text)) {
    items.push({
      reason: 'OpenOCD 连接芯片失败',
      suggestion: '尝试降低 SWD 速度、按住复位再烧录，确认 SWDIO/SWCLK/NRST 接线和芯片型号。'
    });
  }
  if (/flash write failed|failed erasing sectors|program failed|verification failed/i.test(text)) {
    items.push({
      reason: 'OpenOCD 写入或校验失败',
      suggestion: `确认目标型号匹配 ${target}；必要时先全片擦除或解除写保护后再烧录。`
    });
  }
  if (/can't find target|invalid command name|couldn't open.*target\//i.test(text)) {
    items.push({
      reason: 'OpenOCD 目标配置不匹配',
      suggestion: '检查芯片系列是否正确，例如 STM32F103 使用 target/stm32f1x.cfg。'
    });
  }

  return items;
}

module.exports = { diagnoseOpenocdOutput, diagnosePyocdOutput };
