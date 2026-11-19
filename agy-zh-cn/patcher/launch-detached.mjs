// 预检 + 以 WMI 脱离进程树/Job Object 的方式启动 patch.mjs / restore.mjs（等待 Antigravity 退出并自动重启）。
// 用法：node launch-detached.mjs <patch|restore> [--plugin-dir <目录>] [--dict <词典>] [--glossary <术语表>] [--no-relaunch] [--dry-only] [--no-lint]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { EXE } from './lib/app.mjs';
import {
  SCRIPT_DIR, LOG_FILE,
  defaultDictPath, defaultGlossaryPath, isEntry, runningCount, parseArgs,
} from './lib/common.mjs';
import { lintDict } from './lib/lint.mjs';

export function buildWorkerArgs(action, { scriptDir = SCRIPT_DIR, pluginDir = null, dictPath = null, relaunch = true } = {}) {
  const script = path.join(scriptDir, `${action}.mjs`);
  const argv = [script, '--wait-exit'];
  if (relaunch) argv.push('--relaunch');
  if (pluginDir) argv.push('--plugin-dir', path.resolve(pluginDir));
  if (action === 'patch' && dictPath) argv.push('--dict', path.resolve(dictPath));
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
    "$list = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match '(patch|restore)\\.mjs.*--wait-exit' -and $_.ProcessId -ne $PID };",
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

function runPreflight(action, { dictPath, glossaryPath, pluginDir, skipLint }) {
  if (action !== 'patch') return;
  if (!fs.existsSync(dictPath)) throw new Error(`找不到词典：${dictPath}`);
  if (!skipLint) {
    const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
    const gloss = fs.existsSync(glossaryPath) ? fs.readFileSync(glossaryPath, 'utf8') : null;
    const lr = lintDict(dict, gloss);
    if (lr.errors > 0) {
      for (const i of lr.issues.filter((x) => x.level === 'error').slice(0, 20)) {
        console.error(`ERROR [${i.kind}] ${JSON.stringify(i.en)} → ${JSON.stringify(i.zh)}：${i.msg}`);
      }
      throw new Error(`词典校验有 ${lr.errors} 个错误，已中止启动后台补丁`);
    }
    console.log(`预检 1/2（lint-dict）：通过（${lr.entries} 条，错误 0，警告 ${lr.warnings}）`);
  }
  const dryArgs = [path.join(SCRIPT_DIR, 'patch.mjs'), '--dry-run', '--dict', dictPath];
  if (pluginDir) dryArgs.push('--plugin-dir', path.resolve(pluginDir));
  const dry = spawnSync(process.execPath, dryArgs, { encoding: 'utf8' });
  if (dry.status !== 0) {
    throw new Error(`patch --dry-run 预检失败：\n${dry.stdout}\n${dry.stderr}`);
  }
  console.log('预检 2/2（patch --dry-run）：通过');
}

function readLogTail(lines = 8) {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, 'utf8').trim().split(/\r?\n/).slice(-lines);
}

async function main() {
  const args = parseArgs();
  const pos = args.positional(['--plugin-dir', '--dict', '--glossary']);
  const action = pos[0] || 'patch';
  if (action !== 'patch' && action !== 'restore') {
    throw new Error(`未知动作 "${action}"，仅支持 patch 或 restore`);
  }

  const pluginDir = args.opt('--plugin-dir', null);
  const dictPath = path.resolve(args.opt('--dict', defaultDictPath()));
  const glossaryPath = path.resolve(args.opt('--glossary', defaultGlossaryPath()));

  runPreflight(action, { dictPath, glossaryPath, pluginDir, skipLint: args.has('--no-lint') });

  if (args.has('--dry-only')) {
    console.log(`launch-detached：${action} 预检通过（--dry-only，未启动后台进程）`);
    return;
  }

  const killed = killStaleWatchers();
  if (killed) console.log(`已清理 ${killed} 个旧的后台等待进程`);

  const workerArgs = buildWorkerArgs(action, {
    scriptDir: SCRIPT_DIR,
    pluginDir,
    dictPath,
    relaunch: !args.has('--no-relaunch'),
  });

  let pid;
  if (process.platform === 'win32') {
    const cmdLine = formatWmiCommandLine(process.execPath, workerArgs);
    pid = launchViaWmi(cmdLine);
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
