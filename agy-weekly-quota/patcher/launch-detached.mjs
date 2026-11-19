// 预检 + 以 WMI 脱离进程树启动周额度 patch.mjs / restore.mjs（等待 Antigravity 退出并自动重启）。
// 用法：node launch-detached.mjs <patch|restore> [--no-relaunch] [--dry-only]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { EXE } from './lib/app.mjs';
import { SCRIPT_DIR, LOG_FILE, SLOT_SCRIPT, isEntry, runningCount, parseArgs } from './lib/common.mjs';

export function buildWorkerArgs(action, { scriptDir = SCRIPT_DIR, relaunch = true } = {}) {
  const script = path.join(scriptDir, `${action}.mjs`);
  const argv = [script, '--wait-exit'];
  if (relaunch) argv.push('--relaunch');
  return argv;
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const winArgQuote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

export function formatWmiCommandLine(nodeExe, workerArgs) {
  return [nodeExe, ...workerArgs].map(winArgQuote).join(' ');
}

function killStaleWatchers() {
  if (process.platform !== 'win32') return 0;
  const cmd = [
    "$list = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'agy-weekly-quota.*(patch|restore)\\.mjs.*--wait-exit' -and $_.ProcessId -ne $PID };",
    "$cnt = 0; foreach ($p in $list) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $cnt++ }; Write-Output $cnt",
  ].join(' ');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', windowsHide: true });
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}

function launchViaWmi(commandLine) {
  const ps = [
    '$si = New-CimInstance -ClassName Win32_ProcessStartup -Property @{ ShowWindow = [uint16]0 } -ClientOnly;',
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(commandLine)}; ProcessStartupInformation = $si };`,
    'if ($r.ReturnValue -ne 0) { throw "Win32_Process.Create failed with code $($r.ReturnValue)" };',
    'Write-Output $r.ProcessId',
  ].join(' ');
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  return Number(out.trim());
}

function runPreflight(action) {
  if (action !== 'patch') return;
  if (!fs.existsSync(SLOT_SCRIPT)) throw new Error(`找不到插槽脚本：${SLOT_SCRIPT}`);
  execFileSync(process.execPath, ['--check', SLOT_SCRIPT], { stdio: 'pipe' });
  console.log('预检 1/2（quota-slot.js 语法校验）：通过');

  const dry = spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'patch.mjs'), '--dry-run'], { encoding: 'utf8' });
  if (dry.status !== 0) {
    throw new Error(`patch --dry-run 预检失败：\n${dry.stdout}\n${dry.stderr}`);
  }
  console.log('预检 2/2（patch --dry-run）：通过');
}

function readLogTail(lines = 6) {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, 'utf8').trim().split(/\r?\n/).slice(-lines);
}

async function main() {
  const args = parseArgs();
  const pos = args.positional([]);
  const action = pos[0] || 'patch';
  if (action !== 'patch' && action !== 'restore') {
    throw new Error(`未知动作 "${action}"，仅支持 patch 或 restore`);
  }

  runPreflight(action);
  if (args.has('--dry-only')) {
    console.log(`launch-detached：${action} 预检通过（--dry-only，未启动后台进程）`);
    return;
  }

  const killed = killStaleWatchers();
  if (killed) console.log(`已清理 ${killed} 个旧的后台等待进程`);

  const workerArgs = buildWorkerArgs(action, {
    scriptDir: SCRIPT_DIR,
    relaunch: !args.has('--no-relaunch'),
  });

  let pid;
  if (process.platform === 'win32') {
    pid = launchViaWmi(formatWmiCommandLine(process.execPath, workerArgs));
  } else {
    const child = spawn(process.execPath, workerArgs, { detached: true, stdio: 'ignore' });
    child.unref();
    pid = child.pid;
  }

  await new Promise((r) => setTimeout(r, 1200));
  const procs = runningCount(EXE);
  console.log(`已在后台脱离启动 ${action}.mjs（PID=${pid}），当前检测到 ${procs} 个 Antigravity 主进程`);
  console.log(`日志文件：${LOG_FILE}`);
  for (const line of readLogTail(6)) console.log(`  ${line}`);
}

if (isEntry(import.meta.url)) {
  main().catch((e) => { console.error(`失败：${e.message}`); process.exit(1); });
}
