// 把 Gemini 4 元素周期表模型选择器脚本内联注入 resources/app.asar 的 dist/preload.js，保留其他补丁块。
// 用法：node patch.mjs [--dry-run] [--wait-exit] [--relaunch]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ASAR, EXE, appInfo } from './lib/app.mjs';
import { loadDep } from './lib/deps.mjs';
import {
  BACKUP_DIR, WORK_ROOT, MARK_BEGIN, MARK_END, PRELOAD, PRELOAD_SCRIPT,
  log, rmWork, isPatched, hasAnyPatch, headerFiles, runningCount, waitExit, relaunch, backupList,
  replaceFile, sha256File, isEntry, parseArgs,
} from './lib/common.mjs';

const asar = loadDep('@electron/asar');
const args = parseArgs();
const DRY = args.has('--dry-run');

export const stripPeriodicModelBlock = (code) => {
  const re = new RegExp(`\\r?\\n?${MARK_BEGIN.replace(/[/*]/g, '\\$&')}[\\s\\S]*?${MARK_END.replace(/[/*]/g, '\\$&')}\\r?\\n?`, 'g');
  return code.replace(re, '');
};

export function buildPeriodicModelBlock(preloadScriptFile = PRELOAD_SCRIPT) {
  if (!fs.existsSync(preloadScriptFile)) throw new Error(`找不到周期表模型选择器 preload 脚本：${preloadScriptFile}`);
  const body = fs.readFileSync(preloadScriptFile, 'utf8')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  if (body.includes(MARK_BEGIN) || body.includes(MARK_END)) {
    throw new Error('periodic-model-preload.js 内不应包含注入起止标记');
  }
  return `\n${MARK_BEGIN}\ntry {\n${body}\n} catch (e) { try { console.error('[agy-periodic-model]', e); } catch (_) {} }\n${MARK_END}\n`;
}

const nodeCheck = (file) => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
const countMarks = (s) => s.split(MARK_BEGIN).length - 1;

export function unpackGlob(srcDir, files) {
  const dirAll = new Map();
  for (const [p, n] of files) {
    const segs = p.split('/');
    for (let i = 1; i < segs.length; i++) {
      const d = segs.slice(0, i).join('/');
      dirAll.set(d, (dirAll.get(d) ?? true) && !!n.unpacked);
    }
  }
  const tops = [...dirAll].filter(([d, all]) => all && !d.split('/').slice(0, -1).some((_, i, a) => dirAll.get(a.slice(0, i + 1).join('/'))))
    .map(([d]) => d);
  const base = srcDir.split(path.sep).join('/');
  const pats = [];
  for (const d of tops) pats.push(`${base}/${d}/**`);
  for (const [p, n] of files) {
    if (!n.unpacked) continue;
    const top = tops.find((d) => p.startsWith(d + '/'));
    if (!top || p.slice(top.length + 1).split('/').some((s) => s.startsWith('.'))) pats.push(`${base}/${p}`);
  }
  if (!pats.length) return undefined;
  return pats.length === 1 ? pats[0] : `{${pats.join(',')}}`;
}

function readRaw(file) {
  const buf = fs.readFileSync(file);
  const headerSize = buf.readUInt32LE(4);
  const len = buf.readUInt32LE(12);
  return { header: JSON.parse(buf.subarray(16, 16 + len).toString('utf8')), data: buf.subarray(8 + headerSize) };
}

function writeRaw(file, header, data) {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const aligned = (json.length + 3) & ~3;
  const pickle = Buffer.alloc(8 + aligned);
  pickle.writeUInt32LE(4 + aligned, 0);
  pickle.writeUInt32LE(json.length, 4);
  json.copy(pickle, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(pickle.length, 4);
  fs.writeFileSync(file, Buffer.concat([size, pickle, data]));
}

export function syncExecutable(origAsar, newAsar) {
  const a = readRaw(origAsar).header, nb = readRaw(newAsar);
  let changed = 0;
  const walk = (x, y) => {
    if (!x || !y) return;
    if (x.files && y.files) { for (const k of Object.keys(x.files)) walk(x.files[k], y.files[k]); return; }
    if (!!x.executable !== !!y.executable) {
      if (x.executable) y.executable = true; else delete y.executable;
      changed++;
    }
  };
  walk(a, nb.header);
  if (changed) writeRaw(newAsar, nb.header, nb.data);
  return changed;
}

export function compareHeaders(origAsar, newAsar, modified = new Set([PRELOAD])) {
  const a = headerFiles(origAsar), b = headerFiles(newAsar);
  const errs = [];
  for (const p of a.keys()) if (!b.has(p)) errs.push(`新包缺少 ${p}`);
  for (const p of b.keys()) if (!a.has(p)) errs.push(`新包多出 ${p}`);
  let unpacked = 0;
  for (const [p, x] of a) {
    const y = b.get(p);
    if (!y) continue;
    if (!!x.unpacked !== !!y.unpacked) errs.push(`unpacked 位不一致: ${p}`);
    if (!!x.executable !== !!y.executable) errs.push(`executable 位不一致: ${p}`);
    if (x.unpacked) unpacked++;
    if (!modified.has(p) && !x.unpacked && x.size !== y.size) errs.push(`未修改文件大小变化: ${p}`);
  }
  return { errs, files: a.size, unpacked };
}

export function compareDirs(dirA, dirB) {
  const errs = [];
  const walk = (a, b, rel = '') => {
    const ea = new Map(fs.readdirSync(a, { withFileTypes: true }).map((e) => [e.name, e]));
    const eb = new Map(fs.readdirSync(b, { withFileTypes: true }).map((e) => [e.name, e]));
    for (const n of ea.keys()) if (!eb.has(n)) errs.push(`缺少 ${rel}${n}`);
    for (const n of eb.keys()) if (!ea.has(n)) errs.push(`多出 ${rel}${n}`);
    for (const [n, e] of ea) {
      const f = eb.get(n);
      if (!f) continue;
      const pa = path.join(a, n), pb = path.join(b, n);
      if (e.isDirectory() !== f.isDirectory()) errs.push(`类型变化 ${rel}${n}`);
      else if (e.isDirectory()) walk(pa, pb, `${rel}${n}/`);
      else if (sha256File(pa) !== sha256File(pb)) errs.push(`内容不一致 ${rel}${n}`);
    }
  };
  walk(dirA, dirB);
  return errs;
}

async function main() {
  log(`===== agy-periodic-model patch 开始${DRY ? ' (DRY-RUN)' : ''} 目标 ${ASAR}`);
  if (!fs.existsSync(ASAR)) throw new Error(`找不到 ${ASAR}`);
  nodeCheck(PRELOAD_SCRIPT);

  const { version } = appInfo();
  log(`Antigravity 版本: ${version}`);

  if (!DRY && args.has('--wait-exit')) await waitExit(EXE);
  if (!DRY && runningCount(EXE)) throw new Error('Antigravity 正在运行，请先退出，或加 --wait-exit');

  const backupFile = path.join(BACKUP_DIR, `app.asar.${version}`);
  if (!DRY && !fs.existsSync(backupFile)) {
    if (hasAnyPatch(ASAR)) {
      log('警告：当前 app.asar 已含补丁标记但缺少对应版本的纯净备份，跳过备份');
    } else {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const tmp = `${backupFile}.tmp`;
      fs.copyFileSync(ASAR, tmp);
      if (sha256File(tmp) !== sha256File(ASAR)) { fs.rmSync(tmp, { force: true }); throw new Error('原版备份 SHA-256 校验失败'); }
      fs.renameSync(tmp, backupFile);
      for (const b of backupList()) if (b.file !== backupFile) fs.rmSync(b.file, { force: true });
      log(`已备份纯净原包到 ${backupFile}`);
    }
  }

  const work = path.join(WORK_ROOT, `${DRY ? 'dry' : 'work'}-${process.pid}`);
  rmWork(work);
  const extractDir = path.join(work, 'src');
  const outAsar = path.join(work, 'out', 'app.asar');
  const verifyDir = path.join(work, 'verify');

  try {
    asar.uncacheAll?.();
    asar.extractAll(ASAR, extractDir);
    const preloadFile = path.join(extractDir, ...PRELOAD.split('/'));
    if (!fs.existsSync(preloadFile)) throw new Error(`包内未找到 ${PRELOAD}`);

    const clean = stripPeriodicModelBlock(fs.readFileSync(preloadFile, 'utf8'));
    if (clean.includes(MARK_BEGIN) || clean.includes(MARK_END)) {
      throw new Error('preload.js 中的旧周期表注入块不完整，无法安全剥离');
    }
    fs.writeFileSync(preloadFile, clean.replace(/\s*$/, '\n') + buildPeriodicModelBlock(PRELOAD_SCRIPT));
    nodeCheck(preloadFile);

    const origFiles = headerFiles(ASAR);
    const unpack = unpackGlob(extractDir, origFiles);
    await asar.createPackageWithOptions(extractDir, outAsar, unpack ? { unpack } : {});
    syncExecutable(ASAR, outAsar);

    const cmp = compareHeaders(ASAR, outAsar);
    if (cmp.errs.length) throw new Error('包头校验失败：\n  ' + cmp.errs.slice(0, 20).join('\n  '));

    asar.uncacheAll?.();
    const newPreload = asar.extractFile(outAsar, PRELOAD).toString('utf8');
    if (countMarks(newPreload) !== 1) throw new Error(`周期表注入块数量异常: ${countMarks(newPreload)}`);

    asar.extractAll(outAsar, verifyDir);
    nodeCheck(path.join(verifyDir, ...PRELOAD.split('/')));
    const dirErrs = compareDirs(extractDir, verifyDir);
    if (dirErrs.length) throw new Error('再解包校验失败：\n  ' + dirErrs.slice(0, 20).join('\n  '));

    if (!DRY) {
      replaceFile(outAsar, ASAR);
      if (!isPatched(ASAR)) throw new Error('替换后未检测到周期表补丁标记');
      log(`注入完成（共校验 ${cmp.files} 个文件）`);
      if (args.has('--relaunch')) relaunch(EXE);
    } else {
      log(`DRY-RUN 预检通过（共校验 ${cmp.files} 个文件）`);
    }
  } finally {
    rmWork(work);
  }
  log('===== agy-periodic-model patch 结束');
}

if (isEntry(import.meta.url)) {
  main().catch((e) => { log(`失败：${e.stack || e.message}`); process.exit(1); });
}
