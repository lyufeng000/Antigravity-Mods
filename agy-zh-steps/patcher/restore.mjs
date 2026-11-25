// 卸载 language_server.exe 中文步骤与状态补丁，并保留其他共存补丁（如 agy-zh-title）。
// 用法：node restore.mjs [--wait-exit] [--relaunch]
import { ASAR, EXE, LS_EXE, appInfo } from './lib/app.mjs';
import {
  META_FILE, log, runningAppCount, runningLsCount,
  waitAllExit, relaunch, isEntry, parseArgs,
} from './lib/common.mjs';
import { restoreLsStepsPatch } from './patch.mjs';

async function main() {
  const args = parseArgs();
  log(`===== agy-zh-steps restore 开始 目标 ${LS_EXE}`);
  const { version } = appInfo(ASAR);
  log(`Antigravity 版本: ${version}`);

  if (args.has('--wait-exit')) await waitAllExit({ exe: EXE, lsExe: LS_EXE });
  if (runningAppCount(EXE) > 0 || runningLsCount(LS_EXE) > 0) {
    throw new Error('Antigravity 或 language_server.exe 正在运行，请先退出，或加 --wait-exit');
  }

  restoreLsStepsPatch({ lsPath: LS_EXE, metaFile: META_FILE, version });
  if (args.has('--relaunch')) relaunch(EXE);
  log('===== agy-zh-steps restore 结束');
}

if (isEntry(import.meta.url)) {
  main().catch((e) => {
    log(`失败：${e.stack || e.message}`);
    process.exit(1);
  });
}
