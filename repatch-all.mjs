// Antigravity 六补丁联合编排器（汉化 agy-zh-cn + 周额度 agy-weekly-quota + 右键菜单 agy-file-menu + 实时 Tokens agy-token-meter + 周期表 agy-periodic-model + 中文对话标题 agy-zh-title）
// 用法：
//   node repatch-all.mjs [patch] [--dry-only] [--no-relaunch] [--no-lint]
//   node repatch-all.mjs check [--json]
//   node repatch-all.mjs restore [--no-relaunch]
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
  PRELOAD_SCRIPT as PERIODIC_MODEL_PRELOAD_SCRIPT,
} from './agy-periodic-model/patcher/lib/common.mjs';
import {
  stripPeriodicModelBlock, buildPeriodicModelBlock,
} from './agy-periodic-model/patcher/patch.mjs';
import { validatePrompts } from './agy-zh-title/patcher/lib/prompt.mjs';
import { runningLsCount, waitLsExit } from './agy-zh-title/patcher/lib/common.mjs';
import {
  inspectLsTitleState, applyLsTitlePatch, restoreLsTitlePatch,
} from './agy-zh-title/patcher/patch.mjs';

const asar = loadDep('@electron/asar');
const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ZH_DIR = path.join(ROOT_DIR, 'agy-zh-cn');
const BACKUP_DIR = process.env.AGY_BACKUP_DIR || path.join(ROOT_DIR, '.backup');
const LS_TITLE_META_FILE = path.join(BACKUP_DIR, 'language_server.title-meta.json');
const WORK_ROOT = process.env.AGY_REPATCH_TEMP || path.join(TEMP_ROOT, 'agy-repatch');
const LOG_FILE = path.join(WORK_ROOT, 'repatch.log');

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

function inspectState() {
  const buf = fs.readFileSync(ASAR);
  const raw = buf.toString('latin1');
  const m = raw.match(/"productName":\s*"Antigravity",\s*"version":\s*"([^"]+)"/);
  const version = m ? m[1] : 'unknown';
  const zhPatched = raw.includes(ZH_BEGIN);
  const quotaPatched = raw.includes(QUOTA_BEGIN) && raw.includes(QUOTA_MAIN_BEGIN);
  const fileMenuPatched = raw.includes(FILE_MENU_BEGIN) && raw.includes(FILE_MENU_MAIN_BEGIN);
  const tokenMeterPatched = raw.includes(TOKEN_METER_BEGIN) && raw.includes(TOKEN_METER_MAIN_BEGIN);
  const periodicModelPatched = raw.includes(PERIODIC_MODEL_BEGIN);
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
  if (fs.existsSync(LS_EXE)) {
    try {
      const lsSt = inspectLsTitleState(LS_EXE, LS_TITLE_META_FILE);
      zhTitleStatus = lsSt.status;
      zhTitleOffset = lsSt.offset;
    } catch {
      zhTitleStatus = 'error';
    }
  }

  return {
    asar: ASAR,
    lsExe: LS_EXE,
    version,
    zhPatched,
    quotaPatched,
    fileMenuPatched,
    tokenMeterPatched,
    periodicModelPatched,
    zhTitleStatus,
    zhTitlePatched: zhTitleStatus === 'patched',
    zhTitleOffset,
    anyPatched,
    dictVersion: dict?.meta?.appVersion ?? null,
    backupDir: BACKUP_DIR,
    backups,
  };
}

export async function applyCombinedPatch({ dryRun = false } = {}) {
  const { version } = appInfo();
  const dictFile = defaultDictPath(ZH_DIR);
  const translatorFile = defaultTranslatorPath(ZH_DIR);
  const dict = loadDict(dictFile);

  const backupFile = path.join(BACKUP_DIR, `app.asar.${version}`);
  if (!dryRun && !fs.existsSync(backupFile)) {
    const raw = fs.readFileSync(ASAR).toString('latin1');
    if (ANY_PATCH_RE.test(raw)) {
      log('警告：当前 app.asar 已含补丁标记但缺少对应版本的备份，跳过备份（防止污染纯净备份）');
    } else {
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
  }

  const work = dryRun ? path.join(WORK_ROOT, `dry-${process.pid}`) : path.join(WORK_ROOT, `work-${process.pid}`);
  rmWork(work);
  const extractDir = path.join(work, 'src');
  const outAsar = path.join(work, 'out', 'app.asar');
  const verifyDir = path.join(work, 'verify');

  try {
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

    const merged = clean.replace(/\s*$/, '\n')
      + buildZhBlock(dict, translatorFile)
      + buildQuotaBlock(SLOT_SCRIPT)
      + buildFileMenuBlock(FILE_MENU_PRELOAD_SCRIPT)
      + buildTokenMeterBlock(TOKEN_METER_PRELOAD_SCRIPT)
      + buildPeriodicModelBlock(PERIODIC_MODEL_PRELOAD_SCRIPT);
    fs.writeFileSync(preloadFile, merged);
    execFileSync(process.execPath, ['--check', preloadFile], { stdio: 'pipe' });

    const cleanMain = stripMainTokenMeterBlock(stripMainFileMenuBlock(stripMainQuotaBlock(fs.readFileSync(mainFile, 'utf8'))));
    if (
      cleanMain.includes(QUOTA_MAIN_BEGIN) || cleanMain.includes(QUOTA_MAIN_END)
      || cleanMain.includes(FILE_MENU_MAIN_BEGIN) || cleanMain.includes(FILE_MENU_MAIN_END)
      || cleanMain.includes(TOKEN_METER_MAIN_BEGIN) || cleanMain.includes(TOKEN_METER_MAIN_END)
      || ANY_PATCH_RE.test(cleanMain)
    ) {
      throw new Error('main.js 中的旧补丁块不完整或存在残留标记，无法安全剥离');
    }
    const mergedMain = cleanMain.replace(/\s*$/, '\n')
      + buildMainQuotaBlock(QUOTA_MAIN_IPC_SCRIPT, ACCOUNTS_CONFIG_FILE)
      + buildMainFileMenuBlock(FILE_MENU_MAIN_IPC_SCRIPT)
      + buildMainTokenMeterBlock(TOKEN_METER_MAIN_IPC_SCRIPT);
    fs.writeFileSync(mainFile, mergedMain);
    execFileSync(process.execPath, ['--check', mainFile], { stdio: 'pipe' });

    const origFiles = headerFiles(ASAR);
    const unpack = unpackGlob(extractDir, origFiles);
    await asar.createPackageWithOptions(extractDir, outAsar, unpack ? { unpack } : {});
    syncExecutable(ASAR, outAsar);

    const cmp = compareHeaders(ASAR, outAsar);
    if (cmp.errs.length) throw new Error('合并打包后包头校验失败：\n  ' + cmp.errs.slice(0, 20).join('\n  '));

    asar.uncacheAll?.();
    const newPreload = asar.extractFile(outAsar, PRELOAD).toString('utf8');
    const newMain = asar.extractFile(outAsar, MAIN_JS).toString('utf8');
    if (newPreload.split(ZH_BEGIN).length - 1 !== 1) throw new Error('汉化注入块数量异常');
    if (newPreload.split(QUOTA_BEGIN).length - 1 !== 1) throw new Error('周额度 preload 注入块数量异常');
    if (newPreload.split(FILE_MENU_BEGIN).length - 1 !== 1) throw new Error('文件右键菜单 preload 注入块数量异常');
    if (newPreload.split(TOKEN_METER_BEGIN).length - 1 !== 1) throw new Error('实时 Tokens preload 注入块数量异常');
    if (newPreload.split(PERIODIC_MODEL_BEGIN).length - 1 !== 1) throw new Error('周期表模型选择器 preload 注入块数量异常');
    if (newMain.split(QUOTA_MAIN_BEGIN).length - 1 !== 1) throw new Error('周额度 main 注入块数量异常');
    if (newMain.split(FILE_MENU_MAIN_BEGIN).length - 1 !== 1) throw new Error('文件右键菜单 main 注入块数量异常');
    if (newMain.split(TOKEN_METER_MAIN_BEGIN).length - 1 !== 1) throw new Error('实时 Tokens main 注入块数量异常');

    asar.extractAll(outAsar, verifyDir);
    execFileSync(process.execPath, ['--check', path.join(verifyDir, ...PRELOAD.split('/'))], { stdio: 'pipe' });
    execFileSync(process.execPath, ['--check', path.join(verifyDir, ...MAIN_JS.split('/'))], { stdio: 'pipe' });
    const dirErrs = compareDirs(extractDir, verifyDir);
    if (dirErrs.length) throw new Error('再解包校验失败：\n  ' + dirErrs.slice(0, 20).join('\n  '));

    if (!dryRun) {
      replaceFile(outAsar, ASAR);
      const lsRes = applyLsTitlePatch({
        lsPath: LS_EXE,
        metaFile: LS_TITLE_META_FILE,
        version,
        dryRun: false,
      });
      const after = inspectState();
      if (
        !after.zhPatched
        || !after.quotaPatched
        || !after.fileMenuPatched
        || !after.tokenMeterPatched
        || !after.periodicModelPatched
        || !after.zhTitlePatched
      ) {
        throw new Error('替换后未同时检测到六补丁标记');
      }
      log(`六补丁合并注入完成（Antigravity ${version}，共校验 ${cmp.files} 个 asar 文件，标题偏移 0x${lsRes.offset.toString(16)}）`);
    } else {
      applyLsTitlePatch({
        lsPath: LS_EXE,
        metaFile: LS_TITLE_META_FILE,
        version,
        dryRun: true,
      });
      log(`合并 dry-run 预检通过（Antigravity ${version}，共校验 ${cmp.files} 个 asar 文件）`);
    }
  } finally {
    rmWork(work);
  }
}

async function restoreCleanOriginal() {
  const st = inspectState();
  const needAsarRestore = st.anyPatched;
  const needLsRestore = st.zhTitleStatus === 'patched' || st.zhTitleStatus === 'outdated_patch';
  if (!needAsarRestore && !needLsRestore) {
    log('当前未注入任何补丁，无需还原');
    return;
  }
  if (needAsarRestore) {
    const mine = st.backups.find((b) => b.matches);
    if (!mine) {
      throw new Error(`找不到当前版本 (${st.version}) 的纯净备份（备份目录：${BACKUP_DIR}）`);
    }
    if (ANY_PATCH_RE.test(fs.readFileSync(mine.file).toString('latin1'))) {
      throw new Error('备份文件自身含补丁块，拒绝还原');
    }
    replaceFile(mine.file, ASAR);
    if (inspectState().anyPatched) throw new Error('还原后仍检测到补丁标记');
    log(`已从 ${mine.file} 完整还原官方原版 app.asar`);
  }
  if (needLsRestore) {
    restoreLsTitlePatch({
      lsPath: LS_EXE,
      metaFile: LS_TITLE_META_FILE,
      version: st.version,
      dryRun: false,
    });
  }
}

function runPreflight({ skipLint = false } = {}) {
  const dictPath = defaultDictPath(ZH_DIR);
  const glossaryPath = defaultGlossaryPath(ZH_DIR);
  if (!fs.existsSync(dictPath)) throw new Error(`找不到汉化词典：${dictPath}`);
  if (!fs.existsSync(SLOT_SCRIPT)) throw new Error(`找不到周额度脚本：${SLOT_SCRIPT}`);
  if (!fs.existsSync(QUOTA_MAIN_IPC_SCRIPT)) throw new Error(`找不到周额度主进程脚本：${QUOTA_MAIN_IPC_SCRIPT}`);
  if (!fs.existsSync(FILE_MENU_PRELOAD_SCRIPT)) throw new Error(`找不到文件菜单 preload 脚本：${FILE_MENU_PRELOAD_SCRIPT}`);
  if (!fs.existsSync(FILE_MENU_MAIN_IPC_SCRIPT)) throw new Error(`找不到文件菜单主进程脚本：${FILE_MENU_MAIN_IPC_SCRIPT}`);
  if (!fs.existsSync(TOKEN_METER_PRELOAD_SCRIPT)) throw new Error(`找不到实时 Tokens preload 脚本：${TOKEN_METER_PRELOAD_SCRIPT}`);
  if (!fs.existsSync(TOKEN_METER_MAIN_IPC_SCRIPT)) throw new Error(`找不到实时 Tokens 主进程脚本：${TOKEN_METER_MAIN_IPC_SCRIPT}`);
  if (!fs.existsSync(PERIODIC_MODEL_PRELOAD_SCRIPT)) throw new Error(`找不到周期表模型选择器 preload 脚本：${PERIODIC_MODEL_PRELOAD_SCRIPT}`);

  if (!skipLint) {
    const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
    const gloss = fs.existsSync(glossaryPath) ? fs.readFileSync(glossaryPath, 'utf8') : null;
    const lr = lintDict(dict, gloss);
    if (lr.errors > 0) throw new Error(`词典校验发现 ${lr.errors} 个错误，已中止`);
    console.log(`预检 1/7（汉化词典 Lint）：通过（${lr.entries} 条，错误 0）`);
  }
  execFileSync(process.execPath, ['--check', SLOT_SCRIPT], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', QUOTA_MAIN_IPC_SCRIPT], { stdio: 'pipe' });
  console.log('预检 2/7（周额度插槽与主进程配置桥语法）：通过');

  execFileSync(process.execPath, ['--check', FILE_MENU_PRELOAD_SCRIPT], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', FILE_MENU_MAIN_IPC_SCRIPT], { stdio: 'pipe' });
  console.log('预检 3/7（文件右键菜单 preload 与主进程 IPC 语法）：通过');

  execFileSync(process.execPath, ['--check', TOKEN_METER_PRELOAD_SCRIPT], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', TOKEN_METER_MAIN_IPC_SCRIPT], { stdio: 'pipe' });
  console.log('预检 4/7（实时 Tokens 统计 preload 与主进程 IPC 语法）：通过');

  execFileSync(process.execPath, ['--check', PERIODIC_MODEL_PRELOAD_SCRIPT], { stdio: 'pipe' });
  console.log('预检 5/7（周期表模型选择器 preload 语法）：通过');

  const promptSizes = validatePrompts();
  const lsDry = applyLsTitlePatch({
    lsPath: LS_EXE,
    metaFile: LS_TITLE_META_FILE,
    version: appInfo().version,
    dryRun: true,
  });
  console.log(`预检 6/7（中文对话标题提示词校验）：通过（${promptSizes.patchedBytes} 字节，状态 ${lsDry.status}，偏移 0x${lsDry.offset.toString(16)}）`);
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

async function main() {
  const args = parseArgs();
  const pos = args.positional([]);
  const action = pos[0] || 'patch';

  if (action === 'check') {
    const st = inspectState();
    if (args.has('--json')) {
      console.log(JSON.stringify(st, null, 2));
    } else {
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
      console.log(`客户端版本：${st.version}（词典基准版本：${st.dictVersion || '未知'}）`);
      console.log(`汉化补丁（agy-zh-cn）        ：${st.zhPatched ? '已注入' : '未注入'}`);
      console.log(`周额度补丁（agy-weekly-quota）：${st.quotaPatched ? '已注入' : '未注入'}`);
      console.log(`文件菜单补丁（agy-file-menu） ：${st.fileMenuPatched ? '已注入' : '未注入'}`);
      console.log(`Tokens 补丁（agy-token-meter）：${st.tokenMeterPatched ? '已注入' : '未注入'}`);
      console.log(`周期表补丁（agy-periodic-model）：${st.periodicModelPatched ? '已注入' : '未注入'}`);
      console.log(`中文标题补丁（agy-zh-title）  ：${zhTitleText}`);
      console.log(`共享纯净备份（${st.backupDir}）：${st.backups.length ? st.backups.map((b) => `${b.version}${b.matches ? '（匹配）' : '（旧版）'}`).join('，') : '无'}`);
      if (st.dictVersion && st.dictVersion !== st.version) {
        console.log(`提示：客户端已升级至 ${st.version}（词典为 ${st.dictVersion}），重打补丁可立即恢复现有六项补丁；若发现新增英文可后续增量补译。`);
      }
    }
    return;
  }

  if (action !== 'patch' && action !== 'restore') {
    throw new Error(`未知命令 "${action}"，仅支持 patch / check / restore`);
  }

  const doRelaunch = !args.has('--no-relaunch');

  // 后台脱离 Worker 执行分支
  if (args.has('--worker')) {
    log(`===== repatch-all worker (${action}) 启动 =====`);
    await waitExit(EXE, 24 * 60 * 60 * 1000);
    await waitLsExit(LS_EXE, 24 * 60 * 60 * 1000);
    if (action === 'patch') await applyCombinedPatch({ dryRun: false });
    else await restoreCleanOriginal();
    if (doRelaunch) relaunch(EXE);
    log(`===== repatch-all worker (${action}) 完成 =====`);
    return;
  }

  if (action === 'patch') {
    runPreflight({ skipLint: args.has('--no-lint') });
    await applyCombinedPatch({ dryRun: true });
    console.log('预检 7/7（六补丁合并重打包与标题提示词 dry-run）：通过');
    const st = inspectState();
    if (st.dictVersion && st.dictVersion !== st.version) {
      console.log(`提示：检测到客户端新版本 ${st.version}（词典版本 ${st.dictVersion}），本次将直接恢复六补丁并建立 ${st.version} 纯净备份。`);
    }
  }

  if (args.has('--dry-only')) {
    console.log('repatch-all：预检全部通过（--dry-only，未修改安装目录）');
    return;
  }

  const killed = killStaleWatchers();
  if (killed) console.log(`已清理 ${killed} 个旧的后台等待进程`);

  const activeAppProcs = runningCount(EXE);
  const activeLsProcs = runningLsCount(LS_EXE);
  const activeProcs = activeAppProcs + activeLsProcs;
  if (activeProcs === 0) {
    // 客户端当前未运行：直接同步完成替换并按需拉起
    log(`检测到 Antigravity 未运行，立即执行 ${action}…`);
    if (action === 'patch') await applyCombinedPatch({ dryRun: false });
    else await restoreCleanOriginal();
    if (doRelaunch && fs.existsSync(EXE)) relaunch(EXE);
    return;
  }

  // 客户端正在运行：通过 WMI 脱离进程树等待用户关闭窗口后自动替换并重启
  const selfScript = fileURLToPath(import.meta.url);
  const workerArgs = [selfScript, action, '--worker'];
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
  console.log(`请关闭所有 Antigravity 窗口，后台会在约 3～5 秒内自动完成${action === 'patch' ? '六补丁注入' : '原版还原'}并重新打开应用。`);
  console.log(`日志文件：${LOG_FILE}`);
}

if (isEntry(import.meta.url)) {
  main().catch((e) => {
    log(`失败：${e.stack || e.message}`);
    process.exit(1);
  });
}
