// 把文件右键菜单脚本内联注入 resources/app.asar 的 dist/preload.js 与 dist/main.js，保留其他补丁块（如 AGY-ZH、AGY-QUOTA）。
// 用法：node patch.mjs [--dry-run] [--wait-exit] [--relaunch]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ASAR, EXE, appInfo } from './lib/app.mjs';
import { loadDep } from './lib/deps.mjs';
import {
  BACKUP_DIR, WORK_ROOT, MARK_BEGIN, MARK_END, MAIN_MARK_BEGIN, MAIN_MARK_END,
  PRELOAD, MAIN_JS, PRELOAD_SCRIPT, MAIN_IPC_SCRIPT,
  log, rmWork, isPatched, hasAnyPatch, headerFiles, unpackedDirs, runningCount, waitExit, relaunch, backupList,
  replaceFile, sha256File, isEntry, parseArgs,
} from './lib/common.mjs';

const asar = loadDep('@electron/asar');
const args = parseArgs();
const DRY = args.has('--dry-run');

export const stripFileMenuBlock = (code) => {
  const re = new RegExp(`\\r?\\n?${MARK_BEGIN.replace(/[/*]/g, '\\$&')}[\\s\\S]*?${MARK_END.replace(/[/*]/g, '\\$&')}\\r?\\n?`, 'g');
  return code.replace(re, '');
};

export const stripMainFileMenuBlock = (code) => {
  const re = new RegExp(`\\r?\\n?${MAIN_MARK_BEGIN.replace(/[/*]/g, '\\$&')}[\\s\\S]*?${MAIN_MARK_END.replace(/[/*]/g, '\\$&')}\\r?\\n?`, 'g');
  return code.replace(re, '');
};

export function buildFileMenuBlock(preloadScriptFile = PRELOAD_SCRIPT) {
  if (!fs.existsSync(preloadScriptFile)) throw new Error(`找不到文件菜单 preload 脚本：${preloadScriptFile}`);
  const body = fs.readFileSync(preloadScriptFile, 'utf8')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  if (body.includes(MARK_BEGIN) || body.includes(MARK_END)) {
    throw new Error('file-menu-preload.js 内不应包含注入起止标记');
  }
  return `\n${MARK_BEGIN}\ntry {\n${body}\n} catch (e) { try { console.error('[agy-file-menu]', e); } catch (_) {} }\n${MARK_END}\n`;
}

export function buildMainFileMenuBlock(mainIpcFile = MAIN_IPC_SCRIPT) {
  if (!fs.existsSync(mainIpcFile)) throw new Error(`找不到文件菜单主进程 IPC 脚本：${mainIpcFile}`);
  const body = fs.readFileSync(mainIpcFile, 'utf8')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  if (body.includes(MAIN_MARK_BEGIN) || body.includes(MAIN_MARK_END)) {
    throw new Error('file-menu-main-ipc.js 内不应包含注入起止标记');
  }
  return `\n${MAIN_MARK_BEGIN}\ntry {\n${body}\n} catch (e) { try { console.error('[agy-file-menu-main]', e); } catch (_) {} }\n${MAIN_MARK_END}\n`;
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

export function compareHeaders(origAsar, newAsar, modified = new Set([PRELOAD, MAIN_JS])) {
  const a = headerFiles(origAsar), b = headerFiles(newAsar);
  const errs = [];
  for (const p of a.keys()) if (!b.has(p)) errs.push(`新包缺少 ${p}`);
  for (const p of b.keys()) if (!a.has(p)) errs.push(`新包多出 ${p}`);
  let unpacked = 0;
  for (const [p, x] of a) {
    const y = b.get(p);
    if (!y) continue;
    if (!!x.unpacked !== !!y.unpacked) errs.push(`unpacked 标记不一致：${p}`);
    if (!!x.executable !== !!y.executable) errs.push(`executable 标记不一致：${p}`);
    if (!!x.link !== !!y.link) errs.push(`link 标记不一致：${p}`);
    if (x.unpacked) unpacked++;
    if (!modified.has(p) && x.integrity && y.integrity && x.integrity.hash !== y.integrity.hash) errs.push(`内容哈希不一致：${p}`);
    if (!modified.has(p) && x.size !== y.size) errs.push(`大小不一致：${p}`);
  }
  const da = unpackedDirs(origAsar).join('|'), db = unpackedDirs(newAsar).join('|');
  if (da !== db) errs.push('目录 unpacked 标记不一致');
  return { errs, files: a.size, unpacked };
}

export function compareDirs(a, b, modified = new Set([PRELOAD, MAIN_JS])) {
  const errs = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(a, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) { walk(r); continue; }
      if (modified.has(r.split(path.sep).join('/'))) continue;
      const fb = path.join(b, r);
      if (!fs.existsSync(fb)) errs.push(`再解包缺少 ${r}`);
      else if (sha256File(path.join(a, r)) !== sha256File(fb)) errs.push(`再解包内容不同 ${r}`);
    }
  };
  walk('');
  return errs;
}

async function main() {
  log(`===== agy-file-menu patch 开始 ${DRY ? '(dry-run)' : ''} 目标 ${ASAR}`);
  if (args.has('--wait-exit')) {
    if (DRY) log('dry-run：跳过等待进程退出');
    else await waitExit(EXE);
  }
  if (!DRY && runningCount(EXE)) throw new Error('Antigravity 正在运行，请先退出，或加 --wait-exit');

  const { version } = appInfo();
  log(`Antigravity 版本 ${version}，当前${isPatched(ASAR) ? '已' : '未'}注入文件右键菜单补丁`);

  const backupFile = path.join(BACKUP_DIR, `app.asar.${version}`);
  if (DRY) {
    log(`dry-run：${fs.existsSync(backupFile) ? '备份已存在' : `将备份到 ${backupFile}`}`);
  } else if (!fs.existsSync(backupFile)) {
    if (hasAnyPatch(ASAR)) {
      log('警告：当前 app.asar 已含补丁块但无对应版本纯净备份，跳过备份（防止污染原版备份）');
    } else {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const tmp = `${backupFile}.tmp`;
      fs.copyFileSync(ASAR, tmp);
      if (sha256File(tmp) !== sha256File(ASAR)) { fs.rmSync(tmp, { force: true }); throw new Error('备份校验失败'); }
      fs.renameSync(tmp, backupFile);
      for (const b of backupList()) if (b.file !== backupFile) fs.rmSync(b.file, { force: true });
      log(`已保存原版备份到 ${backupFile}`);
    }
  }

  const work = DRY ? path.join(WORK_ROOT, `dry-${process.pid}`) : path.join(WORK_ROOT, `work-${process.pid}`);
  rmWork(work);
  const extractDir = path.join(work, 'src');
  const outAsar = path.join(work, 'out', 'app.asar');
  const verifyDir = path.join(work, 'verify');
  try {
    asar.uncacheAll?.();
    asar.extractAll(ASAR, extractDir);
    const preloadFile = path.join(extractDir, ...PRELOAD.split('/'));
    const mainFile = path.join(extractDir, ...MAIN_JS.split('/'));
    if (!fs.existsSync(preloadFile)) throw new Error(`包内没有 ${PRELOAD}`);
    if (!fs.existsSync(mainFile)) throw new Error(`包内没有 ${MAIN_JS}`);

    const cleanPreload = stripFileMenuBlock(fs.readFileSync(preloadFile, 'utf8'));
    if (cleanPreload.includes(MARK_BEGIN) || cleanPreload.includes(MARK_END)) {
      throw new Error('preload.js 中的旧文件菜单注入块不完整，无法安全剥离');
    }
    fs.writeFileSync(preloadFile, cleanPreload.replace(/\s*$/, '\n') + buildFileMenuBlock());
    nodeCheck(preloadFile);

    const cleanMain = stripMainFileMenuBlock(fs.readFileSync(mainFile, 'utf8'));
    if (cleanMain.includes(MAIN_MARK_BEGIN) || cleanMain.includes(MAIN_MARK_END)) {
      throw new Error('main.js 中的旧文件菜单注入块不完整，无法安全剥离');
    }
    fs.writeFileSync(mainFile, cleanMain.replace(/\s*$/, '\n') + buildMainFileMenuBlock());
    nodeCheck(mainFile);

    log(`注入完成：preload ${fs.statSync(preloadFile).size} 字节，main ${fs.statSync(mainFile).size} 字节`);

    const origFiles = headerFiles(ASAR);
    const unpack = unpackGlob(extractDir, origFiles);
    await asar.createPackageWithOptions(extractDir, outAsar, unpack ? { unpack } : {});
    const fixed = syncExecutable(ASAR, outAsar);
    if (fixed) log(`已按原包补回 ${fixed} 个文件的 executable 标记`);

    const cmp = compareHeaders(ASAR, outAsar);
    if (cmp.errs.length) throw new Error('包头校验失败：\n  ' + cmp.errs.slice(0, 20).join('\n  '));
    asar.uncacheAll?.();
    const newPreload = asar.extractFile(outAsar, PRELOAD).toString('utf8');
    const newMain = asar.extractFile(outAsar, MAIN_JS).toString('utf8');
    if (countMarks(newPreload) !== 1) throw new Error(`preload 文件菜单注入块出现 ${countMarks(newPreload)} 次`);
    if (newMain.split(MAIN_MARK_BEGIN).length - 1 !== 1) throw new Error('main 文件菜单注入块数量异常');
    asar.extractAll(outAsar, verifyDir);
    nodeCheck(path.join(verifyDir, ...PRELOAD.split('/')));
    nodeCheck(path.join(verifyDir, ...MAIN_JS.split('/')));
    const dirErrs = compareDirs(extractDir, verifyDir);
    if (dirErrs.length) throw new Error('再解包校验失败：\n  ' + dirErrs.slice(0, 20).join('\n  '));
    log(`校验通过：${cmp.files} 个文件，其中 unpacked ${cmp.unpacked} 个，新包 ${fs.statSync(outAsar).size} 字节`);

    if (DRY) {
      log(`dry-run 完成，包头与再解包校验全部通过`);
    } else {
      replaceFile(outAsar, ASAR);
      const rawAfter = fs.readFileSync(ASAR).toString('latin1');
      if (!isPatched(ASAR) || !rawAfter.includes(MAIN_MARK_BEGIN)) throw new Error('替换后未检测到文件菜单注入块');
      log(`已替换 ${ASAR}`);
    }
  } finally {
    rmWork(work);
  }

  if (args.has('--relaunch')) {
    if (DRY) log('dry-run：跳过重新启动');
    else relaunch(EXE);
  }
  log('===== agy-file-menu patch 结束');
}

if (isEntry(import.meta.url)) {
  main().catch((e) => { log(`失败：${e.stack || e.message}`); process.exit(1); });
}
