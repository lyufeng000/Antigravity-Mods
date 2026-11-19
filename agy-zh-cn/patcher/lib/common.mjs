// patch / restore / check / 配套脚本共用的工具：路径、日志、进程检测、asar 头比较。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ASAR, EXE, TEMP_ROOT } from './app.mjs';
import { loadDep } from './deps.mjs';

const asar = loadDep('@electron/asar');

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPT_DIR = path.resolve(here, '..');

function resolvePluginDir() {
  const realOr = (d) => { try { return fs.realpathSync(d); } catch { return d; } };
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--plugin-dir');
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return realOr(path.resolve(argv[idx + 1]));
  if (process.env.AGY_I18N_PLUGIN_DIR) return realOr(path.resolve(process.env.AGY_I18N_PLUGIN_DIR));
  const parent = path.resolve(SCRIPT_DIR, '..');
  if (fs.existsSync(path.join(parent, 'plugin.json')) || fs.existsSync(path.join(parent, 'i18n'))) return realOr(parent);
  return realOr(path.join(os.homedir(), '.gemini', 'config', 'plugins', 'agy-zh-cn'));
}

export const PLUGIN_DIR = resolvePluginDir();
export const PATCHER_DIR = fs.existsSync(path.join(PLUGIN_DIR, 'patcher')) ? path.join(PLUGIN_DIR, 'patcher') : SCRIPT_DIR;
// 默认优先使用同级共享纯净备份池（F:\Code\Antigravity\.backup），允许环境变量覆盖供单测使用
const sharedBackupDir = path.resolve(PLUGIN_DIR, '..', '.backup');
export const BACKUP_DIR = process.env.AGY_ZH_BACKUP_DIR ||
  (fs.existsSync(sharedBackupDir) || path.basename(path.resolve(PLUGIN_DIR, '..')).toLowerCase() === 'antigravity'
    ? sharedBackupDir
    : path.join(PLUGIN_DIR, 'backup'));
export const WORK_ROOT = process.env.AGY_ZH_TEMP || path.join(TEMP_ROOT, 'agy-zh');
export const LOG_FILE = path.join(WORK_ROOT, 'patch.log');
export const MARK_BEGIN = '/*AGY-ZH-BEGIN*/';
export const MARK_END = '/*AGY-ZH-END*/';
export const ANY_PATCH_RE = /\/\*AGY-[A-Z0-9_-]+-BEGIN\*\//;
export const PRELOAD = 'dist/preload.js';

export function defaultDictPath(pluginDir = PLUGIN_DIR) {
  const zh = path.join(pluginDir, 'i18n', 'zh-CN.json');
  if (fs.existsSync(zh)) return zh;
  const i18nDir = path.join(pluginDir, 'i18n');
  if (fs.existsSync(i18nDir)) {
    const jsons = fs.readdirSync(i18nDir).filter((f) => f.endsWith('.json'));
    if (jsons.length === 1) return path.join(i18nDir, jsons[0]);
  }
  return zh;
}

export function defaultGlossaryPath(pluginDir = PLUGIN_DIR) {
  const g = path.join(pluginDir, 'i18n', 'glossary.md');
  if (fs.existsSync(g)) return g;
  const ref = path.resolve(SCRIPT_DIR, '..', 'references', 'glossary.md');
  return fs.existsSync(ref) ? ref : g;
}

export function defaultTranslatorPath(pluginDir = PLUGIN_DIR) {
  const candidates = [
    path.join(pluginDir, 'patcher', 'translator.js'),
    path.join(SCRIPT_DIR, 'translator.js'),
    path.resolve(SCRIPT_DIR, '..', 'resources', 'translator.js'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

export function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(a.join(' '));
  try { fs.mkdirSync(WORK_ROOT, { recursive: true }); fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* 日志失败不影响主流程 */ }
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const sha256File = (f) => sha256(fs.readFileSync(f));

// 只允许删除 WORK_ROOT 内部的目录，防止误删
export function rmWork(dir) {
  const rel = path.relative(WORK_ROOT, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`拒绝删除工作目录以外的路径：${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// asar 原样存储文件内容，直接搜索标记即可判断是否已打补丁
export function isPatched(asarPath = ASAR) {
  return fs.readFileSync(asarPath).includes(Buffer.from(MARK_BEGIN, 'latin1'));
}

// 检测 app.asar 是否已包含任一模块（如 AGY-ZH / AGY-QUOTA）的注入块，防止把已注入包误存为原版纯净备份
export function hasAnyPatch(asarPath = ASAR) {
  return ANY_PATCH_RE.test(fs.readFileSync(asarPath).toString('latin1'));
}

// 头信息里所有文件：路径 -> 节点
export function headerFiles(asarPath) {
  const out = new Map();
  const walk = (node, p) => {
    if (node.files) for (const k of Object.keys(node.files)) walk(node.files[k], p ? `${p}/${k}` : k);
    else out.set(p, node);
  };
  walk(asar.getRawHeader(asarPath).header, '');
  return out;
}
export function unpackedDirs(asarPath) {
  const out = [];
  const walk = (node, p) => {
    if (!node.files) return;
    if (node.unpacked) out.push(p);
    for (const k of Object.keys(node.files)) walk(node.files[k], p ? `${p}/${k}` : k);
  };
  walk(asar.getRawHeader(asarPath).header, '');
  return out;
}

// 正在运行、且可执行文件就是目标安装目录下 Antigravity.exe 的应用进程数
// 注意：agy-node.cmd 会设 ELECTRON_RUN_AS_NODE=1 复用 Antigravity.exe 跑 sidecar 脚本，这类进程不加载 app.asar，应排除
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
    // 排除提权终端启动、路径与命令行不可读的孤立单进程（如管理员 cmd 下的 agy-node.cmd，无任何 Electron 子进程家族）
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
  // 进程刚退出时文件句柄可能尚未释放，稍等片刻
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

// 先复制到同目录临时文件并校验哈希，再原子替换目标
// Windows 上杀毒软件可能短暂占用刚写入的文件，rename 遇到 EPERM/EBUSY/EACCES 时重试
export function replaceFile(srcFile, dest) {
  const tmp = `${dest}.agy-zh-tmp`;
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
  const optAll = (k) => {
    const out = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === k && argv[i + 1] && !argv[i + 1].startsWith('--')) { out.push(argv[i + 1]); i++; }
    }
    return out;
  };
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
  return { has: (k) => flags.has(k), opt, optAll, positional };
}
