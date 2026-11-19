// 把翻译脚本和词典内联注入 resources/app.asar 的 dist/preload.js。
// 用法：node patch.mjs [--plugin-dir <目录>] [--dry-run] [--wait-exit] [--relaunch] [--dict <词典路径>]
//   --dry-run   只在 <临时目录>/agy-zh/dry 里完成解包、注入、重新打包、再解包校验，不碰安装目录
//   --wait-exit 先轮询等待 Antigravity.exe 退出（最长 10 分钟）
//   --relaunch  完成后以 detached 方式重新启动 Antigravity.exe
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ASAR, EXE, appInfo } from './lib/app.mjs';
import { loadDep } from './lib/deps.mjs';
import {
  BACKUP_DIR, WORK_ROOT, MARK_BEGIN, MARK_END, PRELOAD,
  defaultDictPath, defaultTranslatorPath,
  log, rmWork, isPatched, hasAnyPatch, headerFiles, unpackedDirs, runningCount, waitExit, relaunch, backupList,
  replaceFile, sha256File, isEntry, parseArgs,
} from './lib/common.mjs';

const asar = loadDep('@electron/asar');

const args = parseArgs();
const DRY = args.has('--dry-run');
const DICT_FILE = path.resolve(args.opt('--dict', defaultDictPath()));
const TRANSLATOR = defaultTranslatorPath();
const PLACEHOLDER = '/*__AGY_ZH_DICT__*/{}';

// 去掉已有注入块（可能有多个，全部剥掉），保证重复执行结果一致
export const stripBlock = (code) => {
  const re = new RegExp(`\\r?\\n?${MARK_BEGIN.replace(/[/*]/g, '\\$&')}[\\s\\S]*?${MARK_END.replace(/[/*]/g, '\\$&')}\\r?\\n?`, 'g');
  return code.replace(re, '');
};

export function loadDict(dictFile = DICT_FILE) {
  if (!fs.existsSync(dictFile)) {
    if (!DRY) throw new Error(`找不到词典：${dictFile}`);
    log(`警告：找不到词典 ${dictFile}，dry-run 使用空词典`);
    return { meta: {}, exact: {}, patterns: {} };
  }
  const d = JSON.parse(fs.readFileSync(dictFile, 'utf8'));
  const keep = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => typeof v === 'string' && v !== ''));
  return { meta: d.meta ?? {}, exact: keep(d.exact), patterns: keep(d.patterns) };
}

export function buildBlock(dict, translatorFile = TRANSLATOR) {
  const tpl = fs.readFileSync(translatorFile, 'utf8');
  if (!tpl.includes(PLACEHOLDER)) throw new Error('translator.js 中没有词典占位符');
  // 转义 "/"，词典内容就不可能拼出注释结束符或注入标记；同时转义行分隔符
  const json = JSON.stringify(dict).replace(/\//g, '\\/').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const body = tpl.replace(PLACEHOLDER, () => json);
  return `\n${MARK_BEGIN}\ntry {\n${body}\n} catch (e) { try { console.error('[agy-zh]', e); } catch (_) {} }\n${MARK_END}\n`;
}

const nodeCheck = (file) => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
const countMarks = (s) => s.split(MARK_BEGIN).length - 1;

// 由原包头信息推导 unpack 规则：整棵子树都 unpacked 的目录用 <dir>/**，其余逐个列出
export function unpackGlob(srcDir, files) {
  const dirAll = new Map(); // 目录 -> 子树是否全部 unpacked
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
    // minimatch 的 ** 不匹配以 . 开头的路径段，这类文件单独列出
    if (!top || p.slice(top.length + 1).split('/').some((s) => s.startsWith('.'))) pats.push(`${base}/${p}`);
  }
  if (!pats.length) return undefined;
  return pats.length === 1 ? pats[0] : `{${pats.join(',')}}`;
}

// Windows 上文件没有可执行位，createPackage 会丢掉 executable 标记。
// asar 里文件偏移是相对数据区的，改写头部 JSON 不影响数据，所以直接按原包补回标记。
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

// 对比新旧包头：文件集合、unpacked 标记、executable 标记，以及除 preload 外的内容哈希
export function compareHeaders(origAsar, newAsar) {
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
    if (p !== PRELOAD && x.integrity && y.integrity && x.integrity.hash !== y.integrity.hash) errs.push(`内容哈希不一致：${p}`);
    if (p !== PRELOAD && x.size !== y.size) errs.push(`大小不一致：${p}`);
  }
  const da = unpackedDirs(origAsar).join('|'), db = unpackedDirs(newAsar).join('|');
  if (da !== db) errs.push('目录 unpacked 标记不一致');
  return { errs, files: a.size, unpacked };
}

// 递归比较两个目录（跳过 preload）
export function compareDirs(a, b) {
  const errs = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(a, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) { walk(r); continue; }
      if (r.split(path.sep).join('/') === PRELOAD) continue;
      const fb = path.join(b, r);
      if (!fs.existsSync(fb)) errs.push(`再解包缺少 ${r}`);
      else if (sha256File(path.join(a, r)) !== sha256File(fb)) errs.push(`再解包内容不同 ${r}`);
    }
  };
  walk('');
  return errs;
}

async function main() {
  log(`===== patch 开始 ${DRY ? '(dry-run)' : ''} 目标 ${ASAR}`);
  if (args.has('--wait-exit')) {
    if (DRY) log('dry-run：跳过等待进程退出');
    else await waitExit(EXE);
  }
  if (!DRY && runningCount(EXE)) throw new Error('Antigravity 正在运行，请先退出，或加 --wait-exit');

  const { version } = appInfo();
  log(`Antigravity 版本 ${version}，当前${isPatched(ASAR) ? '已' : '未'}打补丁`);

  // 备份原件：仅当包内不含任何 AGY-* 补丁块时保存，每个版本只保留一份纯净备份
  const backupFile = path.join(BACKUP_DIR, `app.asar.${version}`);
  if (DRY) {
    log(`dry-run：${fs.existsSync(backupFile) ? '备份已存在' : `将备份到 ${backupFile}`}`);
  } else if (!fs.existsSync(backupFile)) {
    if (hasAnyPatch(ASAR)) {
      log('警告：当前 app.asar 已含注入块但没有对应版本的备份，跳过备份（防止污染原版备份）');
    } else {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const tmp = `${backupFile}.tmp`;
      fs.copyFileSync(ASAR, tmp);
      if (sha256File(tmp) !== sha256File(ASAR)) { fs.rmSync(tmp, { force: true }); throw new Error('备份校验失败'); }
      fs.renameSync(tmp, backupFile);
      for (const b of backupList()) if (b.file !== backupFile) fs.rmSync(b.file, { force: true });
      log(`已备份原件到 ${backupFile}`);
    }
  }

  const work = DRY ? path.join(WORK_ROOT, 'dry') : path.join(WORK_ROOT, `work-${process.pid}`);
  rmWork(work);
  const extractDir = path.join(work, 'src');
  const outAsar = path.join(work, 'out', 'app.asar');
  const verifyDir = path.join(work, 'verify');
  try {
    // 1. 解包（extractAll 会从 app.asar.unpacked 读取 unpacked 文件）
    asar.extractAll(ASAR, extractDir);
    const preloadFile = path.join(extractDir, ...PRELOAD.split('/'));
    if (!fs.existsSync(preloadFile)) throw new Error(`包内没有 ${PRELOAD}`);

    // 2. 注入
    const dict = loadDict();
    const clean = stripBlock(fs.readFileSync(preloadFile, 'utf8'));
    if (clean.includes(MARK_BEGIN) || clean.includes(MARK_END)) throw new Error('preload.js 中的旧注入块不完整，无法安全剥离');
    fs.writeFileSync(preloadFile, clean.replace(/\s*$/, '\n') + buildBlock(dict));
    nodeCheck(preloadFile);
    log(`注入完成：exact ${Object.keys(dict.exact).length} 条，patterns ${Object.keys(dict.patterns).length} 条，preload ${fs.statSync(preloadFile).size} 字节`);

    // 3. 按原 unpack 规则重新打包
    const origFiles = headerFiles(ASAR);
    const unpack = unpackGlob(extractDir, origFiles);
    await asar.createPackageWithOptions(extractDir, outAsar, unpack ? { unpack } : {});
    const fixed = syncExecutable(ASAR, outAsar);
    if (fixed) log(`已按原包补回 ${fixed} 个文件的 executable 标记`);

    // 4. 校验：包头一致、注入块唯一、语法正确、再解包内容一致
    const cmp = compareHeaders(ASAR, outAsar);
    if (cmp.errs.length) throw new Error('包头校验失败：\n  ' + cmp.errs.slice(0, 20).join('\n  '));
    const newPreload = asar.extractFile(outAsar, PRELOAD).toString('utf8');
    if (countMarks(newPreload) !== 1) throw new Error(`注入块出现 ${countMarks(newPreload)} 次`);
    asar.extractAll(outAsar, verifyDir);
    nodeCheck(path.join(verifyDir, ...PRELOAD.split('/')));
    const dirErrs = compareDirs(extractDir, verifyDir);
    if (dirErrs.length) throw new Error('再解包校验失败：\n  ' + dirErrs.slice(0, 20).join('\n  '));
    log(`校验通过：${cmp.files} 个文件，其中 unpacked ${cmp.unpacked} 个，新包 ${fs.statSync(outAsar).size} 字节`);

    // 5. 替换（unpacked 文件内容没变，安装目录里的 app.asar.unpacked 保持原样）
    if (DRY) {
      log(`dry-run 完成，产物在 ${outAsar}`);
    } else {
      replaceFile(outAsar, ASAR);
      if (!isPatched(ASAR)) throw new Error('替换后未检测到注入块');
      log(`已替换 ${ASAR}`);
    }
  } finally {
    if (!DRY) rmWork(work);
  }

  if (args.has('--relaunch')) {
    if (DRY) log('dry-run：跳过重新启动');
    else relaunch(EXE);
  }
  log('===== patch 结束');
}

if (isEntry(import.meta.url)) {
  main().catch((e) => { log(`失败：${e.stack || e.message}`); process.exit(1); });
}
