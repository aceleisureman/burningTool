const { execFileSync } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function quotePowerShell(value) {
  return String(value).replace(/'/g, "''");
}

function stopWindows() {
  const root = quotePowerShell(projectRoot);
  const script = `
    Get-CimInstance Win32_Process |
      Where-Object { $_.CommandLine -like '*${root}*' -and $_.ProcessId -ne $PID } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  `;
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { stdio: 'ignore' });
}

function stopPosix() {
  const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  for (const line of out.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const cmd = match[2];
    if (pid === process.pid) continue;
    if (!cmd.includes(projectRoot)) continue;
    if (!/electron/i.test(cmd)) continue;
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
}

try {
  if (process.platform === 'win32') stopWindows();
  else stopPosix();
} catch {
  process.exitCode = 0;
}
