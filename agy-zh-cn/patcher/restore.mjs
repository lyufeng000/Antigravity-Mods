// 卸载汉化补丁：若包内含其他补丁块（如周额度 AGY-QUOTA）则仅剥离汉化块重打包；否则直接用原版备份还原 resources/app.asar。
// 用法：node restore.mjs [--plugin-dir <目录>] [--wait-exit] [--relaunch]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ASAR, EXE, appInfo } from './lib/app.mjs';
import { loadDep } from './lib/deps.mjs';
import {
  WORK_ROOT, PRELOAD, ANY_PATCH_RE,
  log, rmWork, isPatched, hasAnyPatch, headerFiles, runningCount, waitExit, relaunch, backupList, replaceFile, isEntry, parseArgs,
} from './lib/common.mjs';
import { stripBlock, unpackGlob, syncExecutable, compareHeaders } from './patch.mjs';

const asar = loadDep('@electron/asar');
const args = parseArgs();

async function stripOnlyZhBlock() {
  const work = path.join(WORK_ROOT, `restore-${process.pid}`);
  rmWork(work);
  const extractDir = path.join(work, 'src');
  const outAsar = path.join(work, 'out', 'app.asar');
  try {
    asar.uncacheAll?.();
    asar.extractAll(ASAR, extractDir);
    const preloadFile = path.join(extractDir, ...PRELOAD.split('/'));
    const clean = stripBlock(fs.readFileSync(preloadFile, 'utf8'));
    fs.writeFileSync(preloadFile, clean.replace(/\s*$/, '\n'));
    execFileSync(process.execPath, ['--check', preloadFile], { stdio: 'pipe' });

    const origFiles = headerFiles(ASAR);
    const unpack = unpackGlob(extractDir, origFiles);
    await asar.createPackageWithOptions(extractDir, outAsar, unpack ? { unpack } : {});
    syncExecutable(ASAR, outAsar);

    const cmp = compareHeaders(ASAR, outAsar);
    if (cmp.errs.length) throw new Error('剥离后包头校验失败：\n  ' + cmp.errs.slice(0, 20).join('\n  '));
    replaceFile(outAsar, ASAR);
    if (isPatched(ASAR)) throw new Error('剥离后仍检测到汉化注入块');
    log('已剥离汉化注入块（保留其他补丁模块）');
  } finally {
    rmWork(work);
  }
}

async function main() {
  log(`===== restore 开始 目标 ${ASAR}`);
  if (args.has('--wait-exit')) await waitExit(EXE);
  const { version } = appInfo();
  const patched = isPatched(ASAR);
  const backups = backupList();
  const mine = backups.find((b) => b.version === version);
  log(`当前版本 ${version}，${patched ? '已' : '未'}打汉化补丁；备份：${backups.map((b) => b.version).join(', ') || '无'}`);

  if (backups.length && !mine && !patched) {
    log('当前版本与备份版本不一致：已被自动更新覆盖，无需还原');
  } else if (!patched) {
    if (backups.length && !mine) log('当前版本与备份版本不一致：已被自动更新覆盖，无需还原');
    else log('当前未打补丁，无需还原');
  } else {
    asar.uncacheAll?.();
    const preload = asar.extractFile(ASAR, PRELOAD).toString('utf8');
    const stripped = stripBlock(preload);
    const otherPatchesRemain = ANY_PATCH_RE.test(stripped);

    if (otherPatchesRemain) {
      if (runningCount(EXE)) throw new Error('Antigravity 正在运行，请先退出，或加 --wait-exit');
      await stripOnlyZhBlock();
    } else if (backups.length && !mine) {
      log('当前版本与备份版本不一致：已被自动更新覆盖，无需还原');
    } else if (!mine) {
      log('失败：没有可用的备份，无法还原');
      process.exitCode = 1;
    } else {
      if (runningCount(EXE)) throw new Error('Antigravity 正在运行，请先退出，或加 --wait-exit');
      if (hasAnyPatch(mine.file)) throw new Error('备份文件本身含注入块，拒绝还原');
      replaceFile(mine.file, ASAR);
      if (isPatched(ASAR)) throw new Error('还原后仍检测到注入块');
      log(`已用 ${mine.file} 还原`);
    }
  }

  if (args.has('--relaunch')) relaunch(EXE);
  log('===== restore 结束');
}

if (isEntry(import.meta.url)) {
  main().catch((e) => { log(`失败：${e.stack || e.message}`); process.exit(1); });
}
