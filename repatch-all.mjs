// Antigravity 九补丁联合编排器（汉化/周额度/文件菜单/实时 Tokens/周期表/通知跳转/中文标题/中文步骤/压缩自动重命名）
// 用法：
//   node repatch-all.mjs [patch] [--only <id1,id2> | --exclude <id1,id2>] [--dry-only] [--no-relaunch] [--no-lint]
//   node repatch-all.mjs check [--json]
//   node repatch-all.mjs restore [--only <id1,id2> | --exclude <id1,id2>] [--dry-only] [--no-relaunch]
//   node repatch-all.mjs update [--check] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ASAR, EXE, LS_EXE, TEMP_ROOT, appInfo } from './agy-zh-cn/patcher/lib/app.mjs';
import { loadDep } from './agy-zh-cn/patcher/lib/deps.mjs';
import { lintDict } from './agy-zh-cn/patcher/lib/lint.mjs';
import {
  PRELOAD, ANY_PATCH_RE, MARK_BEGIN as ZH_BEGIN, MARK_END as ZH_END,
  defaultDictPath, defaultGlossaryPath, defaultTranslatorPath,
  headerFiles, runningCount, waitExit, relaunch, replaceFile, sha256File, isEntry, parseArgs,
} from './agy-zh-cn/patcher/lib/common.mjs';
import {
  stripBlock as stripZhBlock, loadDict, buildBlock as buildZhBlock,
  unpackGlob, syncExecutable,
} from './agy-zh-cn/patcher/patch.mjs';
import {
  MARK_BEGIN as QUOTA_BEGIN, MARK_END as QUOTA_END,
  MAIN_MARK_BEGIN as QUOTA_MAIN_BEGIN, MAIN_MARK_END as QUOTA_MAIN_END,
  MAIN_JS, SLOT_SCRIPT, MAIN_IPC_SCRIPT as QUOTA_MAIN_IPC_SCRIPT, ACCOUNTS_CONFIG_FILE,
} from './agy-weekly-quota/patcher/lib/common.mjs';
import {
  stripQuotaBlock, stripMainQuotaBlock, buildQuotaBlock, buildMainQuotaBlock,
  compareHeaders, compareDirs,
} from './agy-weekly-quota/patcher/patch.mjs';
import {
  MARK_BEGIN as FILE_MENU_BEGIN, MARK_END as FILE_MENU_END,
  MAIN_MARK_BEGIN as FILE_MENU_MAIN_BEGIN, MAIN_MARK_END as FILE_MENU_MAIN_END,
  PRELOAD_SCRIPT as FILE_MENU_PRELOAD_SCRIPT,
  MAIN_IPC_SCRIPT as FILE_MENU_MAIN_IPC_SCRIPT,
} from './agy-file-menu/patcher/lib/common.mjs';
import {
  stripFileMenuBlock, stripMainFileMenuBlock, buildFileMenuBlock, buildMainFileMenuBlock,
} from './agy-file-menu/patcher/patch.mjs';
import {
  MARK_BEGIN as TOKEN_METER_BEGIN, MARK_END as TOKEN_METER_END,
  MAIN_MARK_BEGIN as TOKEN_METER_MAIN_BEGIN, MAIN_MARK_END as TOKEN_METER_MAIN_END,
  PRELOAD_SCRIPT as TOKEN_METER_PRELOAD_SCRIPT,
  MAIN_IPC_SCRIPT as TOKEN_METER_MAIN_IPC_SCRIPT,
} from './agy-token-meter/patcher/lib/common.mjs';
import {
  stripTokenMeterBlock, stripMainTokenMeterBlock, buildTokenMeterBlock, buildMainTokenMeterBlock,
} from './agy-token-meter/patcher/patch.mjs';
import {
  MARK_BEGIN as PERIODIC_MODEL_BEGIN, MARK_END as PERIODIC_MODEL_END,
  MAIN_MARK_BEGIN as PERIODIC_MODEL_MAIN_BEGIN, MAIN_MARK_END as PERIODIC_MODEL_MAIN_END,
  PRELOAD_SCRIPT as PERIODIC_MODEL_PRELOAD_SCRIPT,
  MAIN_IPC_SCRIPT as PERIODIC_MODEL_MAIN_IPC_SCRIPT,
  EQUIV_COST_FILE as PERIODIC_MODEL_EQUIV_COST_FILE,
} from './agy-periodic-model/patcher/lib/common.mjs';
import {
  stripPeriodicModelBlock, stripMainPeriodicModelBlock, buildPeriodicModelBlock, buildMainPeriodicModelBlock,
} from './agy-periodic-model/patcher/patch.mjs';
import { validatePrompts } from './agy-zh-title/patcher/lib/prompt.mjs';
import { runningLsCount, waitLsExit } from './agy-zh-title/patcher/lib/common.mjs';
import {
  inspectLsTitleState, applyLsTitlePatch, restoreLsTitlePatch,
} from './agy-zh-title/patcher/patch.mjs';
import { validateTargets } from './agy-zh-steps/patcher/lib/targets.mjs';
import {
  inspectLsStepsState, applyLsStepsPatch, restoreLsStepsPatch,
} from './agy-zh-steps/patcher/patch.mjs';
import {
  MAIN_MARK_BEGIN as WIN_NOTIFY_MAIN_BEGIN, MAIN_MARK_END as WIN_NOTIFY_MAIN_END,
  MAIN_SCRIPT as WIN_NOTIFY_MAIN_SCRIPT,
} from './agy-win-notify/patcher/lib/common.mjs';
import {
  stripMainWinNotifyBlock, buildMainWinNotifyBlock,
} from './agy-win-notify/patcher/patch.mjs';
import {
  DEFAULT_DEST as DEFAULT_COMPACT_RETITLE_DEST,
  RUNTIME_FILES as COMPACT_RETITLE_FILES,
  inspectPlugin as inspectCompactRetitlePlugin,
  installPlugin as installCompactRetitlePlugin,
  uninstallPlugin as uninstallCompactRetitlePlugin,
} from './agy-compact-retitle/scripts/install-plugin.mjs';

const asar = loadDep('@electron/asar');
const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ZH_DIR = path.join(ROOT_DIR, 'agy-zh-cn');
const COMPACT_RETITLE_DIR = path.join(ROOT_DIR, 'agy-compact-retitle');
const COMPACT_RETITLE_DEST = process.env.AGY_COMPACT_RETITLE_DEST || DEFAULT_COMPACT_RETITLE_DEST;
const BACKUP_DIR = process.env.AGY_BACKUP_DIR || path.join(ROOT_DIR, '.backup');
const LS_TITLE_META_FILE = path.join(BACKUP_DIR, 'language_server.title-meta.json');
const LS_STEPS_META_FILE = path.join(BACKUP_DIR, 'language_server.steps-meta.json');
const WORK_ROOT = process.env.AGY_REPATCH_TEMP || path.join(TEMP_ROOT, 'agy-repatch');
const LOG_FILE = path.join(WORK_ROOT, 'repatch.log');

export const PATCH_REGISTRY = [
  { id: 'zh-cn', name: '汉化补丁', moduleDir: 'agy-zh-cn', target: 'asar', needsRestart: true },
  { id: 'weekly-quota', name: '周额度补丁', moduleDir: 'agy-weekly-quota', target: 'asar', needsRestart: true },
  { id: 'file-menu', name: '文件菜单补丁', moduleDir: 'agy-file-menu', target: 'asar', needsRestart: true },
  { id: 'token-meter', name: 'Tokens 补丁', moduleDir: 'agy-token-meter', target: 'asar', needsRestart: true },
  { id: 'periodic-model', name: '周期表补丁', moduleDir: 'agy-periodic-model', target: 'asar', needsRestart: true },
  { id: 'win-notify', name: '通知跳转补丁', moduleDir: 'agy-win-notify', target: 'asar', needsRestart: true },
  { id: 'zh-title', name: '中文标题补丁', moduleDir: 'agy-zh-title', target: 'ls', needsRestart: true },
  { id: 'zh-steps', name: '中文步骤补丁', moduleDir: 'agy-zh-steps', target: 'ls', needsRestart: true },
  { id: 'compact-retitle', name: '压缩自动重命名', moduleDir: 'agy-compact-retitle', target: 'plugin', needsRestart: false },
];

export const ALL_PATCH_IDS = PATCH_REGISTRY.map((p) => p.id);
const PATCH_BY_ID = new Map(PATCH_REGISTRY.map((p) => [p.id, p]));
const ASAR_PATCH_IDS = PATCH_REGISTRY.filter((p) => p.target === 'asar').map((p) => p.id);

export function normalizePatchId(raw) {
  const trimmed = String(raw ?? '').trim().toLowerCase();
  if (!trimmed) {
    throw new Error(`补丁 ID 不能为空；合法 ID：${ALL_PATCH_IDS.join(', ')}`);
  }
  const id = trimmed.startsWith('agy-') ? trimmed.slice(4) : trimmed;
  if (!PATCH_BY_ID.has(id)) {
    throw new Error(`未知补丁 ID "${raw}"；合法 ID：${ALL_PATCH_IDS.join(', ')}`);
  }
  return id;
}

function parseIdList(input) {
  const rawTokens = Array.isArray(input) ? input : [input];
  const out = [];
  const seen = new Set();
  for (const chunk of rawTokens) {
    if (chunk === undefined || chunk === null) continue;
    for (const part of String(chunk).split(/[\s,]+/)) {
      const s = part.trim();
      if (!s) continue;
      const id = normalizePatchId(s);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

export function resolveSelectedPatches({ only, exclude } = {}) {
  const hasOnly = only !== undefined && only !== null;
  const hasExclude = exclude !== undefined && exclude !== null;
  if (hasOnly && hasExclude) {
    throw new Error('--only 与 --exclude 不能同时使用');
  }
  if (hasOnly) {
    const onlySet = new Set(parseIdList(only));
    const selected = ALL_PATCH_IDS.filter((id) => onlySet.has(id));
    if (selected.length === 0) {
      throw new Error(`--only 未选中任何有效补丁；合法 ID：${ALL_PATCH_IDS.join(', ')}`);
    }
    return selected;
  }
  if (hasExclude) {
    const excludeSet = new Set(parseIdList(exclude));
    const selected = ALL_PATCH_IDS.filter((id) => !excludeSet.has(id));
    if (selected.length === 0) {
      throw new Error('通过 --exclude 排除后剩余补丁集合为空');
    }
    return selected;
  }
  return [...ALL_PATCH_IDS];
}

export function extractListArg(argv, flagName) {
  let found = false;
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === flagName) {
      found = true;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        values.push(next);
        i++;
      } else {
        throw new Error(`参数 ${flagName} 缺少补丁 ID 列表`);
      }
    } else if (a.startsWith(`${flagName}=`)) {
      found = true;
      values.push(a.slice(flagName.length + 1));
    }
  }
  return found ? values : undefined;
}

function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(a.join(' '));
  try {
    fs.mkdirSync(WORK_ROOT, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* 忽略日志异常 */ }
}

function rmWork(dir) {
  const rel = path.relative(WORK_ROOT, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`拒绝删除工作目录以外的路径：${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

function backupList() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((f) => /^app\.asar\..+/.test(f))
    .map((f) => ({ file: path.join(BACKUP_DIR, f), version: f.slice('app.asar.'.length) }));
}

export function inspectState() {
  if (!fs.existsSync(ASAR)) {
    throw new Error(`未找到 Antigravity 客户端文件：${ASAR}`);
  }
  const buf = fs.readFileSync(ASAR);
  const raw = buf.toString('latin1');
  const m = raw.match(/"productName":\s*"Antigravity",\s*"version":\s*"([^"]+)"/);
  const version = m ? m[1] : 'unknown';
  const zhPatched = raw.includes(ZH_BEGIN);
  const quotaPatched = raw.includes(QUOTA_BEGIN) && raw.includes(QUOTA_MAIN_BEGIN);
  const fileMenuPatched = raw.includes(FILE_MENU_BEGIN) && raw.includes(FILE_MENU_MAIN_BEGIN);
  const tokenMeterPatched = raw.includes(TOKEN_METER_BEGIN) && raw.includes(TOKEN_METER_MAIN_BEGIN);
  const periodicModelPatched = raw.includes(PERIODIC_MODEL_BEGIN) && raw.includes(PERIODIC_MODEL_MAIN_BEGIN);
  const winNotifyPatched = raw.includes(WIN_NOTIFY_MAIN_BEGIN);
  const anyPatched = ANY_PATCH_RE.test(raw);
  const dictPath = defaultDictPath(ZH_DIR);
  const dict = fs.existsSync(dictPath) ? JSON.parse(fs.readFileSync(dictPath, 'utf8')) : null;
  const backups = backupList().map((b) => ({
    version: b.version,
    file: b.file,
    matches: b.version === version,
  }));

  let zhTitleStatus = 'missing';
  let zhTitleOffset = -1;
  let zhStepsStatus = 'missing';
  let zhStepsPatchedCount = 0;
  let zhStepsTotalCount = 0;
  if (fs.existsSync(LS_EXE)) {
    try {
      const lsSt = inspectLsTitleState(LS_EXE, LS_TITLE_META_FILE);
      zhTitleStatus = lsSt.status;
      zhTitleOffset = lsSt.offset;
    } catch {
      zhTitleStatus = 'error';
    }
    try {
      const stepsSt = inspectLsStepsState(LS_EXE, LS_STEPS_META_FILE);
      zhStepsStatus = stepsSt.status;
      zhStepsPatchedCount = stepsSt.patchedCount;
      zhStepsTotalCount = stepsSt.totalCount;
    } catch {
      zhStepsStatus = 'error';
    }
  }

  let compactInfo;
  try {
    compactInfo = inspectCompactRetitlePlugin(COMPACT_RETITLE_DEST);
  } catch {
    compactInfo = {
      status: 'error',
      installed: false,
      dest: COMPACT_RETITLE_DEST,
      missingFiles: [],
      outdatedFiles: [],
    };
  }

  const runningAppProcs = runningCount(EXE);
  const runningLsProcs = runningLsCount(LS_EXE);

  const patches = {
    'zh-cn': {
      id: 'zh-cn',
      name: '汉化补丁',
      target: 'asar',
      installed: zhPatched,
      status: zhPatched ? 'patched' : 'unpatched',
    },
    'weekly-quota': {
      id: 'weekly-quota',
      name: '周额度补丁',
      target: 'asar',
      installed: quotaPatched,
      status: quotaPatched ? 'patched' : 'unpatched',
    },
    'file-menu': {
      id: 'file-menu',
      name: '文件菜单补丁',
      target: 'asar',
      installed: fileMenuPatched,
      status: fileMenuPatched ? 'patched' : 'unpatched',
    },
    'token-meter': {
      id: 'token-meter',
      name: 'Tokens 补丁',
      target: 'asar',
      installed: tokenMeterPatched,
      status: tokenMeterPatched ? 'patched' : 'unpatched',
    },
    'periodic-model': {
      id: 'periodic-model',
      name: '周期表补丁',
      target: 'asar',
      installed: periodicModelPatched,
      status: periodicModelPatched ? 'patched' : 'unpatched',
    },
    'win-notify': {
      id: 'win-notify',
      name: '通知跳转补丁',
      target: 'asar',
      installed: winNotifyPatched,
      status: winNotifyPatched ? 'patched' : 'unpatched',
    },
    'zh-title': {
      id: 'zh-title',
      name: '中文标题补丁',
      target: 'ls',
      installed: zhTitleStatus === 'patched',
      status: zhTitleStatus,
      offset: zhTitleOffset,
    },
    'zh-steps': {
      id: 'zh-steps',
      name: '中文步骤补丁',
      target: 'ls',
      installed: zhStepsStatus === 'patched',
      status: zhStepsStatus,
      patchedCount: zhStepsPatchedCount,
      totalCount: zhStepsTotalCount,
    },
    'compact-retitle': {
      id: 'compact-retitle',
      name: '压缩自动重命名',
      target: 'plugin',
      installed: compactInfo.installed,
      status: compactInfo.status,
      dest: compactInfo.dest,
    },
  };

  return {
    asar: ASAR,
    lsExe: LS_EXE,
    version,
    zhPatched,
    quotaPatched,
    fileMenuPatched,
    tokenMeterPatched,
    periodicModelPatched,
    winNotifyPatched,
    zhTitleStatus,
    zhTitlePatched: zhTitleStatus === 'patched',
    zhTitleOffset,
    zhStepsStatus,
    zhStepsPatched: zhStepsStatus === 'patched',
    zhStepsPatchedCount,
    zhStepsTotalCount,
    compactRetitleStatus: compactInfo.status,
    compactRetitleInstalled: compactInfo.installed,
    compactRetitleDest: compactInfo.dest,
    compactRetitleMissingFiles: compactInfo.missingFiles,
    compactRetitleOutdatedFiles: compactInfo.outdatedFiles,
    anyPatched,
    runningAppProcs,
    runningLsProcs,
    dictVersion: dict?.meta?.appVersion ?? null,
    backupDir: BACKUP_DIR,
    backups,
    patches,
  };
}

function isPatchPresent(id, st) {
  const entry = st.patches[id];
  if (!entry) return false;
  if (entry.installed) return true;
  if (id === 'zh-title') return st.zhTitleStatus === 'outdated_patch';
  if (id === 'zh-steps') return ['partial', 'outdated_patch'].includes(st.zhStepsStatus);
  if (id === 'compact-retitle') return st.compactRetitleStatus !== 'not_installed';
  return false;
}

function ensureCleanBackupForVersion(version) {
  const backups = backupList();
  const mine = backups.find((b) => b.version === version);
  if (!mine) {
    throw new Error(`找不到当前版本 (${version}) 的纯净备份（备份目录：${BACKUP_DIR}）`);
  }
  if (ANY_PATCH_RE.test(fs.readFileSync(mine.file).toString('latin1'))) {
    throw new Error('备份文件自身含补丁块，拒绝还原');
  }
  return mine.file;
}

function ensureCleanBackupIfUnpatched(version) {
  const backupFile = path.join(BACKUP_DIR, `app.asar.${version}`);
  if (fs.existsSync(backupFile)) return;
  const raw = fs.readFileSync(ASAR).toString('latin1');
  if (ANY_PATCH_RE.test(raw)) {
    log('警告：当前 app.asar 已含补丁标记但缺少对应版本的备份，跳过备份（防止污染纯净备份）');
    return;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const tmp = `${backupFile}.tmp`;
  fs.copyFileSync(ASAR, tmp);
  if (sha256File(tmp) !== sha256File(ASAR)) {
    fs.rmSync(tmp, { force: true });
    throw new Error('原版备份 SHA-256 校验失败');
  }
  fs.renameSync(tmp, backupFile);
  for (const b of backupList()) if (b.file !== backupFile) fs.rmSync(b.file, { force: true });
  log(`已备份纯净原包到 ${backupFile}`);
}

export async function applyCombinedPatch({ selected = ALL_PATCH_IDS, dryRun = false } = {}) {
  const sel = new Set(selected.map(normalizePatchId));
  if (sel.size === 0) throw new Error('补丁集合为空，无法执行合并注入');

  const { version } = appInfo();
  const selectedAsar = ASAR_PATCH_IDS.filter((id) => sel.has(id));
  const work = dryRun ? path.join(WORK_ROOT, `dry-${process.pid}`) : path.join(WORK_ROOT, `work-${process.pid}`);
  let cmpFiles = 0;

  try {
    if (selectedAsar.length > 0) {
      let dict = null;
      let translatorFile = null;
      if (sel.has('zh-cn')) {
        const dictFile = defaultDictPath(ZH_DIR);
        translatorFile = defaultTranslatorPath(ZH_DIR);
        dict = loadDict(dictFile);
      }

      if (!dryRun) ensureCleanBackupIfUnpatched(version);

      rmWork(work);
      const extractDir = path.join(work, 'src');
      const outAsar = path.join(work, 'out', 'app.asar');
      const verifyDir = path.join(work, 'verify');

      asar.uncacheAll?.();
      asar.extractAll(ASAR, extractDir);
      const preloadFile = path.join(extractDir, ...PRELOAD.split('/'));
      const mainFile = path.join(extractDir, ...MAIN_JS.split('/'));
      if (!fs.existsSync(preloadFile)) throw new Error(`包内未找到 ${PRELOAD}`);
      if (!fs.existsSync(mainFile)) throw new Error(`包内未找到 ${MAIN_JS}`);

      const clean = stripPeriodicModelBlock(stripTokenMeterBlock(stripFileMenuBlock(stripQuotaBlock(stripZhBlock(fs.readFileSync(preloadFile, 'utf8'))))));
      if (
        clean.includes(ZH_BEGIN) || clean.includes(ZH_END)
        || clean.includes(QUOTA_BEGIN) || clean.includes(QUOTA_END)
        || clean.includes(FILE_MENU_BEGIN) || clean.includes(FILE_MENU_END)
        || clean.includes(TOKEN_METER_BEGIN) || clean.includes(TOKEN_METER_END)
        || clean.includes(PERIODIC_MODEL_BEGIN) || clean.includes(PERIODIC_MODEL_END)
        || ANY_PATCH_RE.test(clean)
      ) {
        throw new Error('preload.js 中的旧补丁块不完整或存在残留标记，无法安全剥离');
      }

      let merged = clean.replace(/\s*$/, '\n');
      if (sel.has('zh-cn')) merged += buildZhBlock(dict, translatorFile);
      if (sel.has('weekly-quota')) merged += buildQuotaBlock(SLOT_SCRIPT);
      if (sel.has('file-menu')) merged += buildFileMenuBlock(FILE_MENU_PRELOAD_SCRIPT);
      if (sel.has('token-meter')) merged += buildTokenMeterBlock(TOKEN_METER_PRELOAD_SCRIPT);
      if (sel.has('periodic-model')) merged += buildPeriodicModelBlock(PERIODIC_MODEL_PRELOAD_SCRIPT);
      fs.writeFileSync(preloadFile, merged);
      execFileSync(process.execPath, ['--check', preloadFile], { stdio: 'pipe' });

      const cleanMain = stripMainWinNotifyBlock(stripMainPeriodicModelBlock(stripMainTokenMeterBlock(stripMainFileMenuBlock(stripMainQuotaBlock(fs.readFileSync(mainFile, 'utf8'))))));
      if (
        cleanMain.includes(QUOTA_MAIN_BEGIN) || cleanMain.includes(QUOTA_MAIN_END)
        || cleanMain.includes(FILE_MENU_MAIN_BEGIN) || cleanMain.includes(FILE_MENU_MAIN_END)
        || cleanMain.includes(TOKEN_METER_MAIN_BEGIN) || cleanMain.includes(TOKEN_METER_MAIN_END)
        || cleanMain.includes(PERIODIC_MODEL_MAIN_BEGIN) || cleanMain.includes(PERIODIC_MODEL_MAIN_END)
        || cleanMain.includes(WIN_NOTIFY_MAIN_BEGIN) || cleanMain.includes(WIN_NOTIFY_MAIN_END)
        || ANY_PATCH_RE.test(cleanMain)
      ) {
        throw new Error('main.js 中的旧补丁块不完整或存在残留标记，无法安全剥离');
      }

      let mergedMain = cleanMain.replace(/\s*$/, '\n');
      if (sel.has('weekly-quota')) mergedMain += buildMainQuotaBlock(QUOTA_MAIN_IPC_SCRIPT, ACCOUNTS_CONFIG_FILE);
      if (sel.has('file-menu')) mergedMain += buildMainFileMenuBlock(FILE_MENU_MAIN_IPC_SCRIPT);
      if (sel.has('token-meter')) mergedMain += buildMainTokenMeterBlock(TOKEN_METER_MAIN_IPC_SCRIPT);
      if (sel.has('periodic-model')) mergedMain += buildMainPeriodicModelBlock(PERIODIC_MODEL_MAIN_IPC_SCRIPT, PERIODIC_MODEL_EQUIV_COST_FILE);
      if (sel.has('win-notify')) mergedMain += buildMainWinNotifyBlock(WIN_NOTIFY_MAIN_SCRIPT);
      fs.writeFileSync(mainFile, mergedMain);
      execFileSync(process.execPath, ['--check', mainFile], { stdio: 'pipe' });

      const origFiles = headerFiles(ASAR);
      const unpack = unpackGlob(extractDir, origFiles);
      await asar.createPackageWithOptions(extractDir, outAsar, unpack ? { unpack } : {});
      syncExecutable(ASAR, outAsar);

      const cmp = compareHeaders(ASAR, outAsar);
      if (cmp.errs.length) throw new Error('合并打包后包头校验失败：\n  ' + cmp.errs.slice(0, 20).join('\n  '));
      cmpFiles = cmp.files;

      asar.uncacheAll?.();
      const newPreload = asar.extractFile(outAsar, PRELOAD).toString('utf8');
      const newMain = asar.extractFile(outAsar, MAIN_JS).toString('utf8');
      const preloadChecks = [
        { id: 'zh-cn', marker: ZH_BEGIN, label: '汉化' },
        { id: 'weekly-quota', marker: QUOTA_BEGIN, label: '周额度 preload' },
        { id: 'file-menu', marker: FILE_MENU_BEGIN, label: '文件右键菜单 preload' },
        { id: 'token-meter', marker: TOKEN_METER_BEGIN, label: '实时 Tokens preload' },
        { id: 'periodic-model', marker: PERIODIC_MODEL_BEGIN, label: '周期表模型选择器 preload' },
      ];
      const mainChecks = [
        { id: 'weekly-quota', marker: QUOTA_MAIN_BEGIN, label: '周额度 main' },
        { id: 'file-menu', marker: FILE_MENU_MAIN_BEGIN, label: '文件右键菜单 main' },
        { id: 'token-meter', marker: TOKEN_METER_MAIN_BEGIN, label: '实时 Tokens main' },
        { id: 'periodic-model', marker: PERIODIC_MODEL_MAIN_BEGIN, label: '周期表模型选择器 main' },
        { id: 'win-notify', marker: WIN_NOTIFY_MAIN_BEGIN, label: '通知跳转 main' },
      ];
      for (const c of preloadChecks) {
        const want = sel.has(c.id) ? 1 : 0;
        const got = newPreload.split(c.marker).length - 1;
        if (got !== want) throw new Error(`${c.label}注入块数量异常（期望 ${want}，实际 ${got}）`);
      }
      for (const c of mainChecks) {
        const want = sel.has(c.id) ? 1 : 0;
        const got = newMain.split(c.marker).length - 1;
        if (got !== want) throw new Error(`${c.label}注入块数量异常（期望 ${want}，实际 ${got}）`);
      }

      asar.extractAll(outAsar, verifyDir);
      execFileSync(process.execPath, ['--check', path.join(verifyDir, ...PRELOAD.split('/'))], { stdio: 'pipe' });
      execFileSync(process.execPath, ['--check', path.join(verifyDir, ...MAIN_JS.split('/'))], { stdio: 'pipe' });
      const dirErrs = compareDirs(extractDir, verifyDir);
      if (dirErrs.length) throw new Error('再解包校验失败：\n  ' + dirErrs.slice(0, 20).join('\n  '));

      if (!dryRun) {
        replaceFile(outAsar, ASAR);
      }
    } else if (ANY_PATCH_RE.test(fs.readFileSync(ASAR).toString('latin1'))) {
      const cleanBackup = ensureCleanBackupForVersion(version);
      if (!dryRun) {
        replaceFile(cleanBackup, ASAR);
        log(`已按选定集合还原官方原版 app.asar（本次未选中任何 asar 补丁）`);
      }
    }

    let lsOffsetText = '';
    if (sel.has('zh-title')) {
      const lsRes = applyLsTitlePatch({
        lsPath: LS_EXE,
        metaFile: LS_TITLE_META_FILE,
        version,
        dryRun,
      });
      lsOffsetText = `，标题偏移 0x${lsRes.offset.toString(16)}`;
    } else if (fs.existsSync(LS_EXE)) {
      const titleSt = inspectLsTitleState(LS_EXE, LS_TITLE_META_FILE);
      if (titleSt.status === 'patched' || titleSt.status === 'outdated_patch') {
        restoreLsTitlePatch({
          lsPath: LS_EXE,
          metaFile: LS_TITLE_META_FILE,
          version,
          dryRun,
        });
      }
    }

    let stepsText = '';
    if (sel.has('zh-steps')) {
      const stepsRes = applyLsStepsPatch({
        lsPath: LS_EXE,
        metaFile: LS_STEPS_META_FILE,
        version,
        dryRun,
      });
      stepsText = `，步骤 ${stepsRes.patchedCount}/${stepsRes.totalCount}`;
    } else if (fs.existsSync(LS_EXE)) {
      const stepsSt = inspectLsStepsState(LS_EXE, LS_STEPS_META_FILE);
      if (['patched', 'partial', 'outdated_patch'].includes(stepsSt.status)) {
        restoreLsStepsPatch({
          lsPath: LS_EXE,
          metaFile: LS_STEPS_META_FILE,
          version,
          dryRun,
        });
      }
    }

    if (!dryRun) {
      if (sel.has('compact-retitle')) {
        const res = installCompactRetitlePlugin(COMPACT_RETITLE_DEST);
        log(`原生插件 agy-compact-retitle 已同步（${res.files.length} 个文件 -> ${res.dest}）`);
      } else {
        const res = uninstallCompactRetitlePlugin(COMPACT_RETITLE_DEST);
        if (res.removed) log(`已卸载未选中的原生插件目录：${res.dest}`);
      }

      const after = inspectState();
      for (const id of ALL_PATCH_IDS) {
        const want = sel.has(id);
        const got = Boolean(after.patches[id]?.installed);
        if (got !== want) {
          throw new Error(`替换后状态核验失败：${id} 期望 installed=${want}，实际=${got}`);
        }
      }
      const asarText = selectedAsar.length > 0 ? `，共校验 ${cmpFiles} 个 asar 文件` : '';
      log(`补丁同步完成（Antigravity ${version}，已启用 ${sel.size}/${ALL_PATCH_IDS.length} 项${asarText}${lsOffsetText}${stepsText}）`);
    } else {
      const asarText = selectedAsar.length > 0 ? `，共校验 ${cmpFiles} 个 asar 文件` : '，跳过 asar 重打包';
      log(`合并 dry-run 预检通过（Antigravity ${version}，计划启用 ${sel.size}/${ALL_PATCH_IDS.length} 项${asarText}）`);
    }
  } finally {
    if (fs.existsSync(work)) rmWork(work);
  }
}

export async function restoreCleanOriginal({ dryRun = false } = {}) {
  const st = inspectState();
  const needAsarRestore = st.anyPatched;
  const needLsTitleRestore = st.zhTitleStatus === 'patched' || st.zhTitleStatus === 'outdated_patch';
  const needLsStepsRestore = ['patched', 'partial', 'outdated_patch'].includes(st.zhStepsStatus);
  const needCompactRestore = st.compactRetitleStatus !== 'not_installed';
  if (!needAsarRestore && !needLsTitleRestore && !needLsStepsRestore && !needCompactRestore) {
    log('当前未注入或安装任何补丁，无需还原');
    return;
  }
  if (needAsarRestore) {
    const cleanFile = ensureCleanBackupForVersion(st.version);
    if (!dryRun) {
      replaceFile(cleanFile, ASAR);
      if (inspectState().anyPatched) throw new Error('还原后仍检测到补丁标记');
      log(`已从 ${cleanFile} 完整还原官方原版 app.asar`);
    } else {
      log(`还原 dry-run：将从 ${cleanFile} 还原官方原版 app.asar`);
    }
  }
  if (needLsStepsRestore) {
    restoreLsStepsPatch({
      lsPath: LS_EXE,
      metaFile: LS_STEPS_META_FILE,
      version: st.version,
      dryRun,
    });
  }
  if (needLsTitleRestore) {
    restoreLsTitlePatch({
      lsPath: LS_EXE,
      metaFile: LS_TITLE_META_FILE,
      version: st.version,
      dryRun,
    });
  }
  if (needCompactRestore) {
    if (!dryRun) {
      uninstallCompactRetitlePlugin(COMPACT_RETITLE_DEST);
      log(`已移除原生插件目录：${COMPACT_RETITLE_DEST}`);
    } else {
      log(`还原 dry-run：将移除原生插件目录 ${COMPACT_RETITLE_DEST}`);
    }
  }
}

export function runPreflight({ selected = ALL_PATCH_IDS, skipLint = false } = {}) {
  const sel = new Set(selected.map(normalizePatchId));
  const checks = [];

  if (sel.has('zh-cn')) {
    checks.push(() => {
      const dictPath = defaultDictPath(ZH_DIR);
      const glossaryPath = defaultGlossaryPath(ZH_DIR);
      if (!fs.existsSync(dictPath)) throw new Error(`找不到汉化词典：${dictPath}`);
      if (!skipLint) {
        const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
        const gloss = fs.existsSync(glossaryPath) ? fs.readFileSync(glossaryPath, 'utf8') : null;
        const lr = lintDict(dict, gloss);
        if (lr.errors > 0) throw new Error(`词典校验发现 ${lr.errors} 个错误，已中止`);
        return `汉化词典 Lint：通过（${lr.entries} 条，错误 0）`;
      }
      return '汉化词典文件校验：通过（已跳过 Lint）';
    });
  }

  if (sel.has('weekly-quota')) {
    checks.push(() => {
      if (!fs.existsSync(SLOT_SCRIPT)) throw new Error(`找不到周额度脚本：${SLOT_SCRIPT}`);
      if (!fs.existsSync(QUOTA_MAIN_IPC_SCRIPT)) throw new Error(`找不到周额度主进程脚本：${QUOTA_MAIN_IPC_SCRIPT}`);
      execFileSync(process.execPath, ['--check', SLOT_SCRIPT], { stdio: 'pipe' });
      execFileSync(process.execPath, ['--check', QUOTA_MAIN_IPC_SCRIPT], { stdio: 'pipe' });
      return '周额度插槽与主进程配置桥语法：通过';
    });
  }

  if (sel.has('file-menu')) {
    checks.push(() => {
      if (!fs.existsSync(FILE_MENU_PRELOAD_SCRIPT)) throw new Error(`找不到文件菜单 preload 脚本：${FILE_MENU_PRELOAD_SCRIPT}`);
      if (!fs.existsSync(FILE_MENU_MAIN_IPC_SCRIPT)) throw new Error(`找不到文件菜单主进程脚本：${FILE_MENU_MAIN_IPC_SCRIPT}`);
      execFileSync(process.execPath, ['--check', FILE_MENU_PRELOAD_SCRIPT], { stdio: 'pipe' });
      execFileSync(process.execPath, ['--check', FILE_MENU_MAIN_IPC_SCRIPT], { stdio: 'pipe' });
      return '文件右键菜单 preload 与主进程 IPC 语法：通过';
    });
  }

  if (sel.has('token-meter')) {
    checks.push(() => {
      if (!fs.existsSync(TOKEN_METER_PRELOAD_SCRIPT)) throw new Error(`找不到实时 Tokens preload 脚本：${TOKEN_METER_PRELOAD_SCRIPT}`);
      if (!fs.existsSync(TOKEN_METER_MAIN_IPC_SCRIPT)) throw new Error(`找不到实时 Tokens 主进程脚本：${TOKEN_METER_MAIN_IPC_SCRIPT}`);
      execFileSync(process.execPath, ['--check', TOKEN_METER_PRELOAD_SCRIPT], { stdio: 'pipe' });
      execFileSync(process.execPath, ['--check', TOKEN_METER_MAIN_IPC_SCRIPT], { stdio: 'pipe' });
      return '实时 Tokens 统计 preload 与主进程 IPC 语法：通过';
    });
  }

  if (sel.has('periodic-model')) {
    checks.push(() => {
      if (!fs.existsSync(PERIODIC_MODEL_PRELOAD_SCRIPT)) throw new Error(`找不到周期表模型选择器 preload 脚本：${PERIODIC_MODEL_PRELOAD_SCRIPT}`);
      if (!fs.existsSync(PERIODIC_MODEL_MAIN_IPC_SCRIPT)) throw new Error(`找不到周期表模型选择器主进程脚本：${PERIODIC_MODEL_MAIN_IPC_SCRIPT}`);
      execFileSync(process.execPath, ['--check', PERIODIC_MODEL_PRELOAD_SCRIPT], { stdio: 'pipe' });
      execFileSync(process.execPath, ['--check', PERIODIC_MODEL_MAIN_IPC_SCRIPT], { stdio: 'pipe' });
      return '周期表模型选择器 preload 与主进程 IPC 语法：通过';
    });
  }

  if (sel.has('zh-title')) {
    checks.push(() => {
      const promptSizes = validatePrompts();
      const lsDry = applyLsTitlePatch({
        lsPath: LS_EXE,
        metaFile: LS_TITLE_META_FILE,
        version: appInfo().version,
        dryRun: true,
      });
      return `中文对话标题提示词校验：通过（${promptSizes.patchedBytes} 字节，状态 ${lsDry.status}，偏移 0x${lsDry.offset.toString(16)}）`;
    });
  }

  if (sel.has('zh-steps')) {
    checks.push(() => {
      const stepsMetaInfo = validateTargets();
      const stepsDry = applyLsStepsPatch({
        lsPath: LS_EXE,
        metaFile: LS_STEPS_META_FILE,
        version: appInfo().version,
        dryRun: true,
      });
      return `中文步骤与状态提示词校验：通过（${stepsMetaInfo.count} 处共 ${stepsMetaInfo.totalBytes} 字节，状态 ${stepsDry.status}，${stepsDry.patchedCount}/${stepsDry.totalCount}）`;
    });
  }

  if (sel.has('win-notify')) {
    checks.push(() => {
      if (!fs.existsSync(WIN_NOTIFY_MAIN_SCRIPT)) throw new Error(`找不到通知跳转主进程脚本：${WIN_NOTIFY_MAIN_SCRIPT}`);
      execFileSync(process.execPath, ['--check', WIN_NOTIFY_MAIN_SCRIPT], { stdio: 'pipe' });
      return 'Windows 通知跳转修复主进程脚本语法：通过';
    });
  }

  if (sel.has('compact-retitle')) {
    checks.push(() => {
      for (const rel of COMPACT_RETITLE_FILES) {
        const full = path.join(COMPACT_RETITLE_DIR, rel);
        if (!fs.existsSync(full)) throw new Error(`找不到压缩自动重命名文件：${full}`);
        if (rel.endsWith('.mjs')) {
          execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
        }
      }
      const st = inspectCompactRetitlePlugin(COMPACT_RETITLE_DEST);
      return `压缩自动重命名原生插件校验：通过（${COMPACT_RETITLE_FILES.length} 个运行时文件，当前状态 ${st.status}）`;
    });
  }

  const total = checks.length;
  checks.forEach((fn, idx) => {
    const msg = fn();
    console.log(`预检 ${idx + 1}/${total}（${msg.split('：')[0]}）：${msg.split('：').slice(1).join('：')}`);
  });
}

function killStaleWatchers() {
  if (process.platform !== 'win32') return 0;
  const cmd = [
    "$list = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { ($_.CommandLine -match '(patch|restore)\\.mjs.*--wait-exit' -or $_.CommandLine -match 'repatch-all\\.mjs.*--worker') -and $_.ProcessId -ne $PID };",
    "$cnt = 0; foreach ($p in $list) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $cnt++ }; Write-Output $cnt",
  ].join(' ');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', windowsHide: true });
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}

function launchWorkerViaWmi(workerArgs) {
  const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const winArgQuote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
  const cmdLine = [process.execPath, ...workerArgs].map(winArgQuote).join(' ');
  const ps = [
    '$si = New-CimInstance -ClassName Win32_ProcessStartup -Property @{ ShowWindow = [uint16]0 } -ClientOnly;',
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(cmdLine)}; ProcessStartupInformation = $si };`,
    'if ($r.ReturnValue -ne 0) { throw "Win32_Process.Create failed with code $($r.ReturnValue)" };',
    'Write-Output $r.ProcessId',
  ].join(' ');
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  return Number(out.trim());
}

function formatCheckOutput(st) {
  const zhTitleText = st.zhTitlePatched
    ? `已注入（偏移 0x${st.zhTitleOffset.toString(16)}）`
    : ({
      unpatched: '未注入',
      outdated_patch: '旧版补丁待升级',
      prompt_changed: '上游提示词已变更',
      not_found: '未找到目标提示词',
      ambiguous: '匹配位置不唯一',
      missing: '未找到 language_server.exe',
      error: '检查失败',
    }[st.zhTitleStatus] || st.zhTitleStatus);
  const zhStepsText = st.zhStepsPatched
    ? `已注入（${st.zhStepsPatchedCount}/${st.zhStepsTotalCount}）`
    : ({
      unpatched: `未注入（0/${st.zhStepsTotalCount}）`,
      partial: `部分注入（${st.zhStepsPatchedCount}/${st.zhStepsTotalCount}）`,
      outdated_patch: '旧版补丁待升级',
      prompt_changed: '上游提示词已变更',
      not_found: '未找到目标描述',
      ambiguous: '匹配位置不唯一',
      overlap: '命中区间存在重叠',
      missing: '未找到 language_server.exe',
      error: '检查失败',
    }[st.zhStepsStatus] || st.zhStepsStatus);
  const compactText = ({
    installed: '已安装（真实目录）',
    junction: '目录联接（需转为真实目录）',
    outdated: '文件已过期待同步',
    not_installed: '未安装',
    error: '检查失败',
  }[st.compactRetitleStatus] || st.compactRetitleStatus);

  console.log(`客户端版本：${st.version}（词典基准版本：${st.dictVersion || '未知'}）`);
  console.log(`汉化补丁（zh-cn）          ：${st.zhPatched ? '已注入' : '未注入'}`);
  console.log(`周额度补丁（weekly-quota）  ：${st.quotaPatched ? '已注入' : '未注入'}`);
  console.log(`文件菜单补丁（file-menu）   ：${st.fileMenuPatched ? '已注入' : '未注入'}`);
  console.log(`Tokens 补丁（token-meter）  ：${st.tokenMeterPatched ? '已注入' : '未注入'}`);
  console.log(`周期表补丁（periodic-model）：${st.periodicModelPatched ? '已注入' : '未注入'}`);
  console.log(`通知跳转补丁（win-notify）  ：${st.winNotifyPatched ? '已注入' : '未注入'}`);
  console.log(`中文标题补丁（zh-title）    ：${zhTitleText}`);
  console.log(`中文步骤补丁（zh-steps）    ：${zhStepsText}`);
  console.log(`压缩重命名（compact-retitle）：${compactText}`);
  console.log(`共享纯净备份（${st.backupDir}）：${st.backups.length ? st.backups.map((b) => `${b.version}${b.matches ? '（匹配）' : '（旧版）'}`).join('，') : '无'}`);
  if (st.dictVersion && st.dictVersion !== st.version) {
    console.log(`提示：客户端已升级至 ${st.version}（词典基准为 ${st.dictVersion}），重打补丁可立即恢复既有功能；若发现新英文可再执行增量补译。`);
  }
}

function runGit(args, { cwd = ROOT_DIR, timeoutMs = 10000 } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function checkRemoteUpdate({ cwd = ROOT_DIR, remote = 'origin', fetchTimeoutMs = 10000 } = {}) {
  let inside = false;
  try {
    inside = runGit(['rev-parse', '--is-inside-work-tree'], { cwd, timeoutMs: 5000 }) === 'true';
  } catch {
    inside = false;
  }
  if (!inside) {
    return { status: 'not_git', cwd };
  }

  let branch = 'HEAD';
  let head = '';
  try {
    branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 5000 }) || 'HEAD';
  } catch { /* 忽略空仓异常 */ }
  try {
    head = runGit(['rev-parse', '--short', 'HEAD'], { cwd, timeoutMs: 5000 }) || '';
  } catch { /* 忽略空仓异常 */ }

  let dirty = false;
  try {
    dirty = runGit(['status', '--porcelain'], { cwd, timeoutMs: 5000 }).length > 0;
  } catch {
    dirty = false;
  }

  try {
    runGit(['fetch', '--quiet', remote], { cwd, timeoutMs: fetchTimeoutMs });
  } catch (err) {
    return {
      status: 'offline',
      branch,
      head,
      dirty,
      error: err?.stderr?.toString?.().trim() || err?.message || String(err),
    };
  }

  let upstream = null;
  try {
    upstream = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd, timeoutMs: 5000 });
  } catch {
    if (branch && branch !== 'HEAD') {
      try {
        runGit(['show-ref', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`], { cwd, timeoutMs: 5000 });
        upstream = `${remote}/${branch}`;
      } catch {
        upstream = null;
      }
    }
  }
  if (!upstream) {
    return { status: 'no_upstream', branch, head, dirty };
  }

  const counts = runGit(['rev-list', '--left-right', '--count', `HEAD...${upstream}`], { cwd, timeoutMs: 5000 });
  const [aheadStr = '0', behindStr = '0'] = counts.split(/\s+/);
  const ahead = Number(aheadStr) || 0;
  const behind = Number(behindStr) || 0;

  let commits = [];
  if (behind > 0) {
    const rawLog = runGit(['log', '-n', '10', '--format=%h%x09%cs%x09%s', `HEAD..${upstream}`], { cwd, timeoutMs: 5000 });
    commits = rawLog
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [hash = '', date = '', ...rest] = line.split('\t');
        return { hash, date, subject: rest.join('\t') };
      });
  }

  let status = 'up_to_date';
  if (behind === 0 && ahead > 0) status = 'ahead';
  else if (behind > 0 && ahead > 0) status = 'diverged';
  else if (behind > 0 && dirty) status = 'dirty_behind';
  else if (behind > 0 && !dirty) status = 'behind';

  return {
    status,
    branch,
    upstream,
    head,
    ahead,
    behind,
    dirty,
    commits,
  };
}

export function performRemoteUpdate({
  cwd = ROOT_DIR,
  remote = 'origin',
  fetchTimeoutMs = 10000,
  pullTimeoutMs = 20000,
  autoInstallDeps = true,
} = {}) {
  const st = checkRemoteUpdate({ cwd, remote, fetchTimeoutMs });
  if (st.status !== 'behind') return st;

  const pkgFile = path.join(cwd, 'package.json');
  const pkgShaBefore = fs.existsSync(pkgFile) ? sha256File(pkgFile) : null;

  const pullArgs = st.upstream.startsWith(`${remote}/`)
    ? ['pull', '--ff-only', remote, st.upstream.slice(remote.length + 1)]
    : ['pull', '--ff-only'];
  runGit(pullArgs, { cwd, timeoutMs: pullTimeoutMs });

  const newHead = runGit(['rev-parse', '--short', 'HEAD'], { cwd, timeoutMs: 5000 });
  const pkgShaAfter = fs.existsSync(pkgFile) ? sha256File(pkgFile) : null;
  const nodeModulesMissing = !fs.existsSync(path.join(cwd, 'node_modules'));

  let depsReinstalled = false;
  if (autoInstallDeps && pkgShaAfter && (pkgShaAfter !== pkgShaBefore || nodeModulesMissing)) {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFileSync(npmCmd, ['install', '--no-package-lock'], {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
    });
    depsReinstalled = true;
  }

  return {
    status: 'updated',
    branch: st.branch,
    upstream: st.upstream,
    oldHead: st.head,
    newHead,
    pulledCount: st.behind,
    commits: st.commits,
    depsReinstalled,
  };
}

function formatUpdateOutput(res) {
  switch (res.status) {
    case 'not_git':
      console.log(`当前目录不是 Git 工作树（${res.cwd}），跳过远端更新检查。`);
      return;
    case 'offline':
      console.log(`远端更新检测跳过（离线或超时）：${res.error}`);
      return;
    case 'no_upstream':
      console.log(`当前分支 ${res.branch}（${res.head}）未绑定上游跟踪分支，无法检查远端更新。`);
      return;
    case 'up_to_date':
      console.log(`本地仓库已是最新（${res.branch} @ ${res.head}，已对齐 ${res.upstream}）。`);
      return;
    case 'ahead':
      console.log(`本地仓库领先远端 ${res.ahead} 个提交（${res.branch} @ ${res.head} -> ${res.upstream}），无需拉取。`);
      return;
    case 'diverged':
      console.log(`本地分支与远端 ${res.upstream} 已分叉（本地领先 ${res.ahead}，落后 ${res.behind}），已拒绝自动覆盖，请手动处理。`);
      return;
    case 'dirty_behind':
      console.log(`远端 ${res.upstream} 有 ${res.behind} 个新提交，但本地存在未提交修改，已保护工作区未强行拉取。`);
      for (const c of res.commits || []) console.log(`  - ${c.hash} (${c.date}) ${c.subject}`);
      return;
    case 'behind':
      console.log(`发现远端 ${res.upstream} 有 ${res.behind} 个新提交（本地 ${res.head}）：`);
      for (const c of res.commits || []) console.log(`  - ${c.hash} (${c.date}) ${c.subject}`);
      return;
    case 'updated':
      console.log(`已快进更新 ${res.branch}：${res.oldHead} -> ${res.newHead}（拉取 ${res.pulledCount} 个提交${res.depsReinstalled ? '，已自动同步依赖' : ''}）：`);
      for (const c of res.commits || []) console.log(`  - ${c.hash} (${c.date}) ${c.subject}`);
      return;
    default:
      console.log(JSON.stringify(res, null, 2));
  }
}

function computePatchNeedsBinaryWrite(selected, st) {
  const sel = new Set(selected);
  const touchesAsar = ASAR_PATCH_IDS.some((id) => sel.has(id)) || st.anyPatched;
  const touchesTitle = sel.has('zh-title') || st.zhTitleStatus === 'patched' || st.zhTitleStatus === 'outdated_patch';
  const touchesSteps = sel.has('zh-steps') || ['patched', 'partial', 'outdated_patch'].includes(st.zhStepsStatus);
  return touchesAsar || touchesTitle || touchesSteps;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const pos = args.positional(['--only', '--exclude']);
  const action = pos[0] || 'patch';

  const onlyRaw = extractListArg(argv, '--only');
  const excludeRaw = extractListArg(argv, '--exclude');

  if (action === 'check') {
    const st = inspectState();
    if (args.has('--json')) {
      console.log(JSON.stringify(st, null, 2));
    } else {
      formatCheckOutput(st);
    }
    return;
  }

  if (action === 'update') {
    const checkOnly = args.has('--check');
    const res = checkOnly ? checkRemoteUpdate() : performRemoteUpdate();
    if (args.has('--json')) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      formatUpdateOutput(res);
    }
    return;
  }

  if (action !== 'patch' && action !== 'restore') {
    throw new Error(`未知命令 "${action}"，仅支持 patch / check / restore / update`);
  }

  const doRelaunch = !args.has('--no-relaunch');
  const skipLint = args.has('--no-lint');
  const dryOnly = args.has('--dry-only');
  const hasFilter = onlyRaw !== undefined || excludeRaw !== undefined;
  const parsedSelection = hasFilter
    ? resolveSelectedPatches({ only: onlyRaw, exclude: excludeRaw })
    : [...ALL_PATCH_IDS];

  // 后台脱离 Worker 执行分支
  if (args.has('--worker')) {
    log(`===== repatch-all worker (${action}) 启动 =====`);
    await waitExit(EXE, 24 * 60 * 60 * 1000);
    await waitLsExit(LS_EXE, 24 * 60 * 60 * 1000);
    if (action === 'patch') {
      await applyCombinedPatch({ selected: parsedSelection, dryRun: false });
    } else if (!hasFilter) {
      await restoreCleanOriginal({ dryRun: false });
    } else {
      const st = inspectState();
      const removeSet = new Set(parsedSelection);
      const currentlyPresent = ALL_PATCH_IDS.filter((id) => isPatchPresent(id, st));
      const remaining = currentlyPresent.filter((id) => !removeSet.has(id));
      if (remaining.length === 0) {
        await restoreCleanOriginal({ dryRun: false });
      } else {
        await applyCombinedPatch({ selected: remaining, dryRun: false });
      }
    }
    if (doRelaunch) relaunch(EXE);
    log(`===== repatch-all worker (${action}) 完成 =====`);
    return;
  }

  const st = inspectState();
  let needsBinaryWrite = false;
  let restorePlan = null;

  if (action === 'patch') {
    runPreflight({ selected: parsedSelection, skipLint });
    await applyCombinedPatch({ selected: parsedSelection, dryRun: true });
    console.log(`合并与同步预检通过（计划启用 ${parsedSelection.length}/${ALL_PATCH_IDS.length} 项：${parsedSelection.join(', ')}）`);
    if (st.dictVersion && st.dictVersion !== st.version && parsedSelection.includes('zh-cn')) {
      console.log(`提示：检测到客户端新版本 ${st.version}（词典基准 ${st.dictVersion}），本次将直接恢复已选补丁并按需建立 ${st.version} 纯净备份。`);
    }
    needsBinaryWrite = computePatchNeedsBinaryWrite(parsedSelection, st);
  } else {
    if (!hasFilter) {
      await restoreCleanOriginal({ dryRun: true });
      needsBinaryWrite = st.anyPatched
        || st.zhTitleStatus === 'patched' || st.zhTitleStatus === 'outdated_patch'
        || ['patched', 'partial', 'outdated_patch'].includes(st.zhStepsStatus);
      restorePlan = { mode: 'full' };
    } else {
      const removeSet = new Set(parsedSelection);
      const currentlyPresent = ALL_PATCH_IDS.filter((id) => isPatchPresent(id, st));
      const matchedToRemove = currentlyPresent.filter((id) => removeSet.has(id));
      if (matchedToRemove.length === 0) {
        console.log('指定的补丁当前均未生效，无需卸载');
        return;
      }
      const remaining = currentlyPresent.filter((id) => !removeSet.has(id));
      const removesBinary = matchedToRemove.some((id) => PATCH_BY_ID.get(id)?.target !== 'plugin');
      if (remaining.length === 0) {
        await restoreCleanOriginal({ dryRun: true });
        needsBinaryWrite = removesBinary;
        restorePlan = { mode: 'full' };
      } else if (!removesBinary) {
        needsBinaryWrite = false;
        restorePlan = { mode: 'plugin_only' };
        console.log('卸载预检通过（仅移除原生插件 agy-compact-retitle，不改动安装目录二进制）');
      } else {
        runPreflight({ selected: remaining, skipLint });
        await applyCombinedPatch({ selected: remaining, dryRun: true });
        needsBinaryWrite = true;
        restorePlan = { mode: 'partial_sync', remaining };
        console.log(`部分卸载预检通过（将卸载：${matchedToRemove.join(', ')}；保留：${remaining.join(', ')}）`);
      }
    }
  }

  if (dryOnly) {
    console.log('repatch-all：预检全部通过（--dry-only，未修改安装目录）');
    return;
  }

  if (!needsBinaryWrite) {
    if (action === 'patch') {
      await applyCombinedPatch({ selected: parsedSelection, dryRun: false });
    } else if (restorePlan?.mode === 'plugin_only') {
      uninstallCompactRetitlePlugin(COMPACT_RETITLE_DEST);
      console.log(`已直接卸载原生插件（${COMPACT_RETITLE_DEST}），无需重启 Antigravity。`);
    } else {
      await restoreCleanOriginal({ dryRun: false });
    }
    console.log('本次仅操作原生插件目录，已即时生效，无需关闭或重启 Antigravity。');
    return;
  }

  const killed = killStaleWatchers();
  if (killed) console.log(`已清理 ${killed} 个旧的后台等待进程`);

  const activeAppProcs = runningCount(EXE);
  const activeLsProcs = runningLsCount(LS_EXE);
  const activeProcs = activeAppProcs + activeLsProcs;
  if (activeProcs === 0) {
    log(`检测到 Antigravity 未运行，立即执行 ${action}…`);
    if (action === 'patch') {
      await applyCombinedPatch({ selected: parsedSelection, dryRun: false });
    } else if (restorePlan?.mode === 'partial_sync') {
      await applyCombinedPatch({ selected: restorePlan.remaining, dryRun: false });
    } else {
      await restoreCleanOriginal({ dryRun: false });
    }
    if (doRelaunch && fs.existsSync(EXE)) relaunch(EXE);
    return;
  }

  // 客户端正在运行：通过 WMI 脱离进程树等待用户关闭窗口后自动替换并重启
  const selfScript = fileURLToPath(import.meta.url);
  const workerArgs = [selfScript, action, '--worker'];
  if (onlyRaw !== undefined) workerArgs.push('--only', parsedSelection.join(','));
  if (excludeRaw !== undefined) workerArgs.push('--exclude', excludeRaw.map((x) => String(x)).join(','));
  if (!doRelaunch) workerArgs.push('--no-relaunch');

  let pid;
  if (process.platform === 'win32') {
    pid = launchWorkerViaWmi(workerArgs);
  } else {
    const child = spawn(process.execPath, workerArgs, { detached: true, stdio: 'ignore' });
    child.unref();
    pid = child.pid;
  }

  console.log(`\n已在后台准备就绪（PID=${pid}），当前检测到 ${activeAppProcs} 个 Antigravity 进程、${activeLsProcs} 个 language_server 进程。`);
  console.log(`请关闭所有 Antigravity 窗口，后台会在约 3～5 秒内自动完成${action === 'patch' ? '补丁同步' : '还原'}并重新打开应用。`);
  console.log(`日志文件：${LOG_FILE}`);
}

if (isEntry(import.meta.url)) {
  main().catch((e) => {
    log(`失败：${e.stack || e.message}`);
    process.exit(1);
  });
}
