// agy-file-menu 公共工具：标记位、共享纯净备份池、asar 包头比较与进程管理。
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
export const PRELOAD_SCRIPT = process.env.AGY_FILE_MENU_PRELOAD_SCRIPT || path.join(PROJECT_DIR, 'src', 'file-menu-preload.js');
export const MAIN_IPC_SCRIPT = process.env.AGY_FILE_MENU_MAIN_SCRIPT || path.join(PROJECT_DIR, 'src', 'file-menu-main-ipc.js');

const sharedBackupDir = path.resolve(PROJECT_DIR, '..', '.backup');
export const BACKUP_DIR = process.env.AGY_FILE_MENU_BACKUP_DIR || process.env.AGY_BACKUP_DIR || process.env.AGY_ZH_BACKUP_DIR || sharedBackupDir;
export const WORK_ROOT = process.env.AGY_FILE_MENU_TEMP || path.join(TEMP_ROOT, 'agy-file-menu');
export const LOG_FILE = path.join(WORK_ROOT, 'patch.log');

export const MARK_BEGIN = '/*AGY-FILE-MENU-BEGIN*/';
export const MARK_END = '/*AGY-FILE-MENU-END*/';
export const MAIN_MARK_BEGIN = '/*AGY-FILE-MENU-MAIN-BEGIN*/';
export const MAIN_MARK_END = '/*AGY-FILE-MENU-MAIN-END*/';
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
        `Start-Process -FilePath ${q(exe)} -WorkingDirectory ${q(path.dirname(exe))} -WindowStyle Normal`,
      ], { windowsHide: true, timeout: 15000 });
      log(`已重新启动 ${exe}`);
      return;
    } catch { /* 回退到 spawn */ }
  }
  const child = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
  child.unref();
  log(`已重新启动 ${exe}`);
}

export function backupList() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((f) => /^app\.asar\..+/.test(f))
    .map((f) => ({ file: path.join(BACKUP_DIR, f), version: f.slice('app.asar.'.length) }));
}

export function replaceFile(srcFile, dest) {
  const tmp = `${dest}.agy-file-menu-tmp`;
  const want = sha256File(srcFile);
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  try {
    fs.copyFileSync(srcFile, tmp);
    if (sha256File(tmp) !== want) throw new Error('复制后的临时文件校验失败');
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, dest); break; } catch (e) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || i >= 20) throw e;
        sleep(250 + i * 100);
      }
    }
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  }
  if (sha256File(dest) !== want) throw new Error(`替换后校验失败：${dest}`);
}

export const isEntry = (metaUrl) => {
  if (!process.argv[1]) return false;
  try {
    const a = fs.realpathSync(process.argv[1]);
    const b = fs.realpathSync(fileURLToPath(metaUrl));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
};

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const positional = (valueKeys = []) => {
    const vk = new Set(valueKeys);
    const out = [];
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a.startsWith('--')) { if (vk.has(a) && argv[i + 1] && !argv[i + 1].startsWith('--')) i++; continue; }
      out.push(a);
    }
    return out;
  };
  return { has: (k) => flags.has(k), opt, positional };
}
