// agy-token-meter 公共工具：标记位、共享纯净备份池、asar 包头比较与进程管理。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ASAR, EXE, TEMP_ROOT } from './app.mjs';
import { loadDep } from './deps.mjs';

const asar = loadDep('@electron/asar');

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPT_DIR = path.resolve(here, '..');
export const PROJECT_DIR = path.resolve(SCRIPT_DIR, '..');
export const PRELOAD_SCRIPT = process.env.AGY_TOKEN_METER_PRELOAD_SCRIPT || path.join(PROJECT_DIR, 'src', 'token-meter-preload.js');
export const MAIN_IPC_SCRIPT = process.env.AGY_TOKEN_METER_MAIN_SCRIPT || path.join(PROJECT_DIR, 'src', 'token-meter-main-ipc.js');

const sharedBackupDir = path.resolve(PROJECT_DIR, '..', '.backup');
export const BACKUP_DIR = process.env.AGY_TOKEN_METER_BACKUP_DIR || process.env.AGY_BACKUP_DIR || process.env.AGY_ZH_BACKUP_DIR || sharedBackupDir;
export const WORK_ROOT = process.env.AGY_TOKEN_METER_TEMP || path.join(TEMP_ROOT, 'agy-token-meter');
export const LOG_FILE = path.join(WORK_ROOT, 'patch.log');

export const MARK_BEGIN = '/*AGY-TOKEN-METER-BEGIN*/';
export const MARK_END = '/*AGY-TOKEN-METER-END*/';
export const MAIN_MARK_BEGIN = '/*AGY-TOKEN-METER-MAIN-BEGIN*/';
export const MAIN_MARK_END = '/*AGY-TOKEN-METER-MAIN-END*/';
export const ANY_PATCH_RE = /\/\*AGY-[A-Z0-9_-]+-BEGIN\*\//;
export const PRELOAD = 'dist/preload.js';
export const MAIN_JS = 'dist/main.js';

export function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(a.join(' '));
  try {
    fs.mkdirSync(WORK_ROOT, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* 日志写入失败不影响主流程 */ }
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const sha256File = (f) => sha256(fs.readFileSync(f));

export function rmWork(dir) {
  const rel = path.relative(WORK_ROOT, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`拒绝删除工作目录以外的路径：${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function isPatched(asarPath = ASAR) {
  return fs.readFileSync(asarPath).includes(Buffer.from(MARK_BEGIN, 'latin1'));
}

export function hasAnyPatch(asarPath = ASAR) {
  return ANY_PATCH_RE.test(fs.readFileSync(asarPath).toString('latin1'));
}

export function headerFiles(asarPath) {
  asar.uncacheAll?.();
  const out = new Map();
  const walk = (node, p) => {
    if (node.files) for (const k of Object.keys(node.files)) walk(node.files[k], p ? `${p}/${k}` : k);
    else out.set(p, node);
  };
  walk(asar.getRawHeader(asarPath).header, '');
  return out;
}

export function unpackedDirs(asarPath) {
  asar.uncacheAll?.();
  const out = [];
  const walk = (node, p) => {
    if (!node.files) return;
    if (node.unpacked) out.push(p);
    for (const k of Object.keys(node.files)) walk(node.files[k], p ? `${p}/${k}` : k);
  };
  walk(asar.getRawHeader(asarPath).header, '');
  return out;
}

export function runningCount(exe = EXE) {
  if (process.platform !== 'win32' || !fs.existsSync(exe)) return 0;
  let outp = '';
  try {
    outp = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.ExecutablePath -replace '^$','?')`t$($_.CommandLine -replace '[\\r\\n]+',' ')\" }"],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  } catch { return 0; }
  const target = path.resolve(exe).toLowerCase();
  const rows = outp.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((line) => {
    const [pid = '', ppid = '', p = '?', cmd = ''] = line.split('\t');
    return { pid, ppid, p, cmd };
  });
  const allPids = new Set(rows.map((r) => r.pid));
  const parentPids = new Set(rows.map((r) => r.ppid));
  return rows.filter(({ pid, ppid, p, cmd }) => {
    if (p !== '?' && path.resolve(p).toLowerCase() !== target) return false;
    if (/sidecar_sdk[\\/]register_loader\.js/i.test(cmd) && !/--type=|app\.asar/i.test(cmd)) return false;
    if (p === '?' && !cmd && !parentPids.has(pid) && !allPids.has(ppid)) return false;
    return true;
  }).length;
}

export async function waitExit(exe = EXE, timeoutMs = 30 * 60 * 1000) {
  const t0 = Date.now();
  let n = runningCount(exe);
  if (n) log(`等待 Antigravity 退出（${n} 个进程），最长 ${Math.round(timeoutMs / 60000)} 分钟…`);
  while (n) {
    if (Date.now() - t0 > timeoutMs) throw new Error('等待 Antigravity 退出超时');
    await new Promise((r) => setTimeout(r, 2000));
    n = runningCount(exe);
  }
  if (Date.now() - t0 > 100) await new Promise((r) => setTimeout(r, 1500));
}

export function relaunch(exe = EXE) {
  if (process.platform === 'win32') {
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    try {
      execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${q(`"${exe}"`)} }; if ($r.ReturnValue -ne 0) { throw "Win32_Process.Create failed: $($r.ReturnValue)" }`,
      ], { windowsHide: true });
      log(`已通过 WMI 启动 ${exe}`);
      return;
    } catch (e) {
      log(`WMI 启动失败，回退 detached spawn：${e.message}`);
    }
  }
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  log(`已启动 ${exe}`);
}

export function backupList() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((f) => /^app\.asar\..+/.test(f))
    .map((f) => ({ file: path.join(BACKUP_DIR, f), version: f.slice('app.asar.'.length) }));
}

export function replaceFile(src, dst) {
  const tmp = `${dst}.tmp-${process.pid}`;
  fs.copyFileSync(src, tmp);
  if (sha256File(tmp) !== sha256File(src)) { fs.rmSync(tmp, { force: true }); throw new Error('复制校验失败'); }
  for (let i = 0; i < 15; i++) {
    try { fs.renameSync(tmp, dst); return; } catch (e) {
      if (i === 14) { fs.rmSync(tmp, { force: true }); throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
}

export const isEntry = (url) => !!process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(url));

export function parseArgs(argv = process.argv.slice(2)) {
  const set = new Set();
  const vals = new Map();
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        const k = a.slice(0, eq);
        set.add(k);
        vals.set(k, a.slice(eq + 1));
      } else {
        set.add(a);
        if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) vals.set(a, argv[i + 1]);
      }
    } else positional.push(a);
  }
  return {
    has: (k) => set.has(k),
    opt: (k, d) => vals.get(k) ?? d,
    positional: (d) => (positional.length ? positional : d),
  };
}
