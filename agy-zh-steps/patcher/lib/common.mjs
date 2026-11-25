// agy-zh-steps 公共工具：元信息管理、多区间分段哈希、进程检测与大文件多点位原子写入。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXE, LS_EXE, TEMP_ROOT } from './app.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPT_DIR = path.resolve(here, '..');
export const PROJECT_DIR = path.resolve(SCRIPT_DIR, '..');

const sharedBackupDir = path.resolve(PROJECT_DIR, '..', '.backup');
export const BACKUP_DIR = process.env.AGY_ZH_STEPS_BACKUP_DIR
  || process.env.AGY_BACKUP_DIR
  || process.env.AGY_ZH_BACKUP_DIR
  || sharedBackupDir;
export const META_FILE = path.join(BACKUP_DIR, 'language_server.steps-meta.json');
export const WORK_ROOT = process.env.AGY_ZH_STEPS_TEMP || path.join(TEMP_ROOT, 'agy-zh-steps');
export const LOG_FILE = path.join(WORK_ROOT, 'patch.log');

export function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(a.join(' '));
  try {
    fs.mkdirSync(WORK_ROOT, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* 日志写入失败不影响主流程 */ }
}

export const sha256Buffer = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// 分块读取计算大文件 SHA-256，避免多份 200 MB 级缓冲区常驻内存
export function sha256File(filePath, chunkSize = 4 * 1024 * 1024) {
  const hash = crypto.createHash('sha256');
  const buf = Buffer.allocUnsafe(chunkSize);
  const fd = fs.openSync(filePath, 'r');
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, chunkSize, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function sortAndValidateRanges(ranges, totalSize) {
  if (!Array.isArray(ranges)) throw new Error('ranges 必须是数组');
  const sorted = ranges
    .map((r) => ({ offset: r.offset, replacementBuf: r.replacementBuf }))
    .sort((a, b) => a.offset - b.offset);
  let prevEnd = 0;
  for (const r of sorted) {
    if (!Number.isInteger(r.offset) || !Buffer.isBuffer(r.replacementBuf) || r.replacementBuf.length === 0) {
      throw new Error(`无效替换区间：offset=${r.offset}`);
    }
    const end = r.offset + r.replacementBuf.length;
    if (r.offset < 0 || end > totalSize) {
      throw new Error(`替换区间越界：offset=${r.offset}, len=${r.replacementBuf.length}, total=${totalSize}`);
    }
    if (r.offset < prevEnd) {
      throw new Error(`替换区间重叠：offset=${r.offset} < prevEnd=${prevEnd}`);
    }
    prevEnd = end;
  }
  return sorted;
}

// 直接基于原缓冲按升序分段计算多处替换后的目标 SHA-256，不分配整份副本
export function sha256WithReplacements(buf, ranges) {
  const sorted = sortAndValidateRanges(ranges, buf.length);
  const hash = crypto.createHash('sha256');
  let cursor = 0;
  for (const r of sorted) {
    if (r.offset > cursor) hash.update(buf.subarray(cursor, r.offset));
    hash.update(r.replacementBuf);
    cursor = r.offset + r.replacementBuf.length;
  }
  if (cursor < buf.length) hash.update(buf.subarray(cursor));
  return hash.digest('hex');
}

export function readMeta(metaFile = META_FILE) {
  try {
    if (!fs.existsSync(metaFile)) return null;
    const raw = fs.readFileSync(metaFile, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeMeta(meta, metaFile = META_FILE) {
  fs.mkdirSync(path.dirname(metaFile), { recursive: true });
  const tmp = `${metaFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, metaFile);
}

export function removeMeta(metaFile = META_FILE) {
  if (fs.existsSync(metaFile)) fs.rmSync(metaFile, { force: true });
}

export function runningAppCount(exe = EXE) {
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

export function runningLsCount(lsExe = LS_EXE) {
  if (process.platform !== 'win32' || !fs.existsSync(lsExe)) return 0;
  const procName = path.basename(lsExe);
  let outp = '';
  try {
    outp = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='${procName.replace(/'/g, "''")}'" | ForEach-Object { "$($_.ProcessId)\`t$($_.ExecutablePath -replace '^$','?')" }`],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  } catch { return 0; }
  const target = path.resolve(lsExe).toLowerCase();
  const rows = outp.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((line) => {
    const [pid = '', p = '?'] = line.split('\t');
    return { pid, p };
  });
  return rows.filter(({ p }) => p === '?' || path.resolve(p).toLowerCase() === target).length;
}

export async function waitExit(exe = EXE, timeoutMs = 30 * 60 * 1000) {
  const t0 = Date.now();
  let n = runningAppCount(exe);
  if (n) log(`等待 Antigravity 退出（${n} 个进程），最长 ${Math.round(timeoutMs / 60000)} 分钟…`);
  while (n) {
    if (Date.now() - t0 > timeoutMs) throw new Error('等待 Antigravity 退出超时');
    await new Promise((r) => setTimeout(r, 2000));
    n = runningAppCount(exe);
  }
  if (Date.now() - t0 > 100) await new Promise((r) => setTimeout(r, 1500));
}

export async function waitLsExit(lsExe = LS_EXE, timeoutMs = 30 * 60 * 1000) {
  const t0 = Date.now();
  let n = runningLsCount(lsExe);
  if (n) log(`等待 language_server.exe 退出（${n} 个进程），最长 ${Math.round(timeoutMs / 60000)} 分钟…`);
  while (n) {
    if (Date.now() - t0 > timeoutMs) throw new Error('等待 language_server.exe 退出超时');
    await new Promise((r) => setTimeout(r, 2000));
    n = runningLsCount(lsExe);
  }
  if (Date.now() - t0 > 100) await new Promise((r) => setTimeout(r, 1500));
}

export async function waitAllExit({ exe = EXE, lsExe = LS_EXE, timeoutMs = 30 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  let appN = runningAppCount(exe);
  let lsN = runningLsCount(lsExe);
  if (appN || lsN) {
    log(`等待 Antigravity（${appN}）与 language_server.exe（${lsN}）退出，最长 ${Math.round(timeoutMs / 60000)} 分钟…`);
  }
  while (appN || lsN) {
    if (Date.now() - t0 > timeoutMs) throw new Error('等待 Antigravity 相关进程退出超时');
    await new Promise((r) => setTimeout(r, 2000));
    appN = runningAppCount(exe);
    lsN = runningLsCount(lsExe);
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
    } catch { /* 回退 detached spawn */ }
  }
  const child = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
  child.unref();
  log(`已重新启动 ${exe}`);
}

export function atomicWritePatchedRanges(destPath, ranges, expectedSha256 = null) {
  const origSize = fs.statSync(destPath).size;
  const sorted = sortAndValidateRanges(ranges, origSize);
  if (sorted.length === 0) return;

  const tmp = `${destPath}.agy-zh-steps-tmp`;
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const verifyRanges = (filePath, stageLabel) => {
    const rfd = fs.openSync(filePath, 'r');
    try {
      for (const r of sorted) {
        const out = Buffer.allocUnsafe(r.replacementBuf.length);
        const n = fs.readSync(rfd, out, 0, r.replacementBuf.length, r.offset);
        if (n !== r.replacementBuf.length) {
          throw new Error(`${stageLabel}读取校验长度不足（offset=${r.offset}）：${n} != ${r.replacementBuf.length}`);
        }
        if (!out.equals(r.replacementBuf)) {
          throw new Error(`${stageLabel}字节校验失败（offset=${r.offset}）`);
        }
      }
    } finally {
      fs.closeSync(rfd);
    }
  };

  try {
    fs.copyFileSync(destPath, tmp);
    const fd = fs.openSync(tmp, 'r+');
    try {
      for (const r of sorted) {
        let written = 0;
        while (written < r.replacementBuf.length) {
          written += fs.writeSync(
            fd,
            r.replacementBuf,
            written,
            r.replacementBuf.length - written,
            r.offset + written,
          );
        }
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    const tmpSize = fs.statSync(tmp).size;
    if (tmpSize !== origSize) throw new Error(`临时文件大小发生变化：${tmpSize} != ${origSize}`);
    verifyRanges(tmp, '临时文件');
    if (expectedSha256 && sha256File(tmp) !== expectedSha256) {
      throw new Error('临时文件整体 SHA-256 校验失败');
    }

    for (let i = 0; ; i++) {
      try {
        fs.renameSync(tmp, destPath);
        break;
      } catch (e) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || i >= 29) throw e;
        sleep(250 + i * 150);
      }
    }

    const afterSize = fs.statSync(destPath).size;
    if (afterSize !== origSize) throw new Error(`替换后文件大小异常：${afterSize} != ${origSize}`);
    verifyRanges(destPath, '替换后');
    if (expectedSha256 && sha256File(destPath) !== expectedSha256) {
      throw new Error(`替换后 SHA-256 校验失败：${destPath}`);
    }
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  }
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
