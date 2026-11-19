// 卸载文件右键菜单补丁：若包内仍含其他补丁（如 AGY-ZH、AGY-QUOTA）则仅剥离文件菜单块重打包；否则直接用原版备份还原 resources/app.asar。
// 用法：node restore.mjs [--wait-exit] [--relaunch]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ASAR, EXE, appInfo } from './lib/app.mjs';
import { loadDep } from './lib/deps.mjs';
import {
  WORK_ROOT, PRELOAD, MAIN_JS, MARK_BEGIN, MARK_END, MAIN_MARK_BEGIN, MAIN_MARK_END, ANY_PATCH_RE,
  log, rmWork, isPatched, hasAnyPatch, headerFiles, runningCount, waitExit, relaunch, backupList, replaceFile, isEntry, parseArgs,
} from './lib/common.mjs';
import { stripFileMenuBlock, stripMainFileMenuBlock, unpackGlob, syncExecutable, compareHeaders } from './patch.mjs';

const asar = loadDep('@electron/asar');
const args = parseArgs();

async function stripOnlyFileMenu() {
  const work = path.join(WORK_ROOT, `restore-${process.pid}`);
  rmWork(work);
  const extractDir = path.join(work, 'src');
  const outAsar = path.join(work, 'out', 'app.asar');
  try {
    asar.uncacheAll?.();
    asar.extractAll(ASAR, extractDir);
    const preloadFile = path.join(extractDir, ...PRELOAD.split('/'));
    const mainFile = path.join(extractDir, ...MAIN_JS.split('/'));

    const cleanPreload = stripFileMenuBlock(fs.readFileSync(preloadFile, 'utf8'));
    if (cleanPreload.includes(MARK_BEGIN) || cleanPreload.includes(MARK_END)) {
      throw new Error('preload.js 中的文件菜单注入块不完整，无法安全剥离');
    }
    fs.writeFileSync(preloadFile, cleanPreload.replace(/\s*$/, '\n'));
    execFileSync(process.execPath, ['--check', preloadFile], { stdio: 'pipe' });

    if (fs.existsSync(mainFile)) {
      const cleanMain = stripMainFileMenuBlock(fs.readFileSync(mainFile, 'utf8'));
      if (cleanMain.includes(MAIN_MARK_BEGIN) || cleanMain.includes(MAIN_MARK_END)) {
        throw new Error('main.js 中的文件菜单注入块不完整，无法安全剥离');
      }
      fs.writeFileSync(mainFile, cleanMain.replace(/\s*$/, '\n'));
      execFileSync(process.execPath, ['--check', mainFile], { stdio: 'pipe' });
    }

    const origFiles = headerFiles(ASAR);
    const unpack = unpackGlob(extractDir, origFiles);
    await asar.createPackageWithOptions(extractDir, outAsar, unpack ? { unpack } : {});
    syncExecutable(ASAR, outAsar);

    const cmp = compareHeaders(ASAR, outAsar);
    if (cmp.errs.length) throw new Error('剥离后包头校验失败：\n  ' + cmp.errs.slice(0, 20).join('\n  '));
    replaceFile(outAsar, ASAR);
    const rawAfter = fs.readFileSync(ASAR).toString('latin1');
    if (isPatched(ASAR) || rawAfter.includes(MAIN_MARK_BEGIN)) throw new Error('剥离后仍检测到文件菜单注入块');
    log('已剥离文件右键菜单注入块（保留汉化、周额度等其他补丁模块）');
  } finally {
    rmWork(work);
  }
}

async function main() {
  log(`===== agy-file-menu restore 开始 目标 ${ASAR}`);
  if (args.has('--wait-exit')) await waitExit(EXE);
  const { version } = appInfo();
  const rawAsar = fs.readFileSync(ASAR).toString('latin1');
  const patched = isPatched(ASAR) || rawAsar.includes(MAIN_MARK_BEGIN);
  const backups = backupList();
  const mine = backups.find((b) => b.version === version);
  log(`当前版本 ${version}，${patched ? '已' : '未'}打文件菜单补丁；备份：${backups.map((b) => b.version).join(', ') || '无'}`);

  if (!patched) {
    if (backups.length && !mine) log('当前版本与备份版本不一致：已被自动更新覆盖，无需还原');
    else log('当前未注入文件右键菜单补丁，无需还原');
  } else {
    asar.uncacheAll?.();
    const preload = asar.extractFile(ASAR, PRELOAD).toString('utf8');
    const mainCode = asar.extractFile(ASAR, MAIN_JS).toString('utf8');
    const strippedPreload = stripFileMenuBlock(preload);
    const strippedMain = stripMainFileMenuBlock(mainCode);
    const otherPatchesRemain = ANY_PATCH_RE.test(strippedPreload) || ANY_PATCH_RE.test(strippedMain);

    if (otherPatchesRemain) {
      if (runningCount(EXE)) throw new Error('Antigravity 正在运行，请先退出，或加 --wait-exit');
      await stripOnlyFileMenu();
    } else if (backups.length && !mine) {
      log('当前版本与备份版本不一致：已被自动更新覆盖，无需还原');
    } else if (!mine) {
      log('失败：没有可用的纯净备份，无法还原');
      process.exitCode = 1;
    } else {
      if (runningCount(EXE)) throw new Error('Antigravity 正在运行，请先退出，或加 --wait-exit');
      if (hasAnyPatch(mine.file)) throw new Error('备份文件本身含注入块，拒绝还原');
      replaceFile(mine.file, ASAR);
      const afterRaw = fs.readFileSync(ASAR).toString('latin1');
      if (isPatched(ASAR) || afterRaw.includes(MAIN_MARK_BEGIN)) throw new Error('还原后仍检测到文件菜单注入块');
      log(`已用 ${mine.file} 还原`);
    }
  }

  if (args.has('--relaunch')) relaunch(EXE);
  log('===== agy-file-menu restore 结束');
}

if (isEntry(import.meta.url)) {
  main().catch((e) => { log(`失败：${e.stack || e.message}`); process.exit(1); });
}
