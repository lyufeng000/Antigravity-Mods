// 原位等长替换 language_server.exe 内硬编码对话标题提示词，并支持无损还原。
// 用法：node patch.mjs [--dry-run] [--wait-exit] [--relaunch]
import fs from 'node:fs';
import { ASAR, EXE, LS_EXE, appInfo } from './lib/app.mjs';
import {
  META_FILE, log, sha256Buffer, sha256WithReplacement,
  readMeta, writeMeta, removeMeta,
  runningAppCount, runningLsCount, waitAllExit, relaunch,
  atomicWritePatchedRange, isEntry, parseArgs,
} from './lib/common.mjs';
import { ORIG_PROMPT, PATCHED_PROMPT, validatePrompts, inspectBuffer } from './lib/prompt.mjs';

export function inspectLsTitleState(
  lsPath = LS_EXE,
  metaFile = META_FILE,
  { origPrompt = ORIG_PROMPT, patchedPrompt = PATCHED_PROMPT } = {},
) {
  const meta = readMeta(metaFile);
  const buf = fs.readFileSync(lsPath);
  const res = inspectBuffer(buf, {
    origPrompt,
    patchedPrompt,
    previousPatchedPrompt: meta?.patchedPrompt ?? null,
  });
  return {
    lsPath,
    lsSize: buf.length,
    ...res,
    meta,
  };
}

export function applyLsTitlePatch({
  lsPath = LS_EXE,
  metaFile = META_FILE,
  version = null,
  dryRun = false,
  origPrompt = ORIG_PROMPT,
  patchedPrompt = PATCHED_PROMPT,
} = {}) {
  validatePrompts(origPrompt, patchedPrompt);
  if (!fs.existsSync(lsPath)) throw new Error(`找不到 ${lsPath}`);

  const meta = readMeta(metaFile);
  const buf = fs.readFileSync(lsPath);
  const info = inspectBuffer(buf, {
    origPrompt,
    patchedPrompt,
    previousPatchedPrompt: meta?.patchedPrompt ?? null,
  });

  if (info.overlapsWebZip) {
    throw new Error(`命中区间 [${info.offset}, ${info.offset + info.byteLength}) 与内嵌前端 ZIP 重叠，拒绝修改`);
  }
  if (info.status === 'ambiguous') {
    throw new Error(`language_server.exe 中存在多处候选位置 (${info.anchorOffsets.join(', ')})，无法安全原位替换`);
  }
  if (info.status === 'prompt_changed') {
    throw new Error(`上游对话标题提示词已变更（偏移 0x${info.offset.toString(16)}）：\n${info.currentPromptPreview}`);
  }
  if (info.status === 'not_found') {
    throw new Error(`未在 ${lsPath} 中找到对话标题生成提示词`);
  }

  if (info.status === 'patched') {
    log('中文对话标题补丁已处于最新状态，无需重复写入');
    return {
      changed: false,
      status: 'patched',
      offset: info.offset,
      lsSize: buf.length,
    };
  }

  if (dryRun) {
    return {
      changed: false,
      wouldChange: true,
      status: info.status,
      offset: info.offset,
      lsSize: buf.length,
    };
  }

  const curSha = sha256Buffer(buf);
  const patchedBuf = Buffer.from(patchedPrompt, 'utf8');
  const expectedSha = sha256WithReplacement(buf, info.offset, patchedBuf);
  let origSha256 = curSha;
  if (info.status === 'outdated_patch') {
    origSha256 = (meta?.origSha256 && (!meta.version || !version || meta.version === version))
      ? meta.origSha256
      : sha256WithReplacement(buf, info.offset, Buffer.from(origPrompt, 'utf8'));
  }

  atomicWritePatchedRange(lsPath, info.offset, patchedBuf, expectedSha);
  writeMeta({
    version: version ?? meta?.version ?? null,
    offset: info.offset,
    byteLength: patchedBuf.length,
    origSha256,
    patchedSha256: expectedSha,
    patchedPrompt,
    updatedAt: new Date().toISOString(),
  }, metaFile);

  const after = inspectLsTitleState(lsPath, metaFile, { origPrompt, patchedPrompt });
  if (after.status !== 'patched' || after.offset !== info.offset) {
    throw new Error(`写入后校验异常：status=${after.status}`);
  }
  log(`中文对话标题补丁注入完成（偏移 0x${info.offset.toString(16)}，${patchedBuf.length} 字节）`);
  return {
    changed: true,
    status: 'patched',
    offset: info.offset,
    lsSize: buf.length,
    origSha256,
    patchedSha256: expectedSha,
  };
}

export function restoreLsTitlePatch({
  lsPath = LS_EXE,
  metaFile = META_FILE,
  version = null,
  dryRun = false,
  origPrompt = ORIG_PROMPT,
  patchedPrompt = PATCHED_PROMPT,
} = {}) {
  validatePrompts(origPrompt, patchedPrompt);
  if (!fs.existsSync(lsPath)) throw new Error(`找不到 ${lsPath}`);

  const meta = readMeta(metaFile);
  const buf = fs.readFileSync(lsPath);
  const info = inspectBuffer(buf, {
    origPrompt,
    patchedPrompt,
    previousPatchedPrompt: meta?.patchedPrompt ?? null,
  });

  if (info.overlapsWebZip) {
    throw new Error(`命中区间 [${info.offset}, ${info.offset + info.byteLength}) 与内嵌前端 ZIP 重叠，拒绝还原`);
  }
  if (info.status === 'ambiguous') {
    throw new Error(`language_server.exe 中存在多处候选位置 (${info.anchorOffsets.join(', ')})，无法安全还原`);
  }

  if (info.status === 'unpatched') {
    if (!dryRun) removeMeta(metaFile);
    log('language_server.exe 当前未注入中文标题补丁，无需还原');
    return { changed: false, status: 'unpatched', offset: info.offset, lsSize: buf.length };
  }

  if (info.status === 'prompt_changed' || info.status === 'not_found') {
    log('当前版本未检测到中文标题补丁（可能已被官方更新覆盖），无需还原');
    return { changed: false, status: info.status, offset: info.offset, lsSize: buf.length };
  }

  if (dryRun) {
    return {
      changed: false,
      wouldChange: true,
      status: info.status,
      offset: info.offset,
      lsSize: buf.length,
    };
  }

  const origBuf = Buffer.from(origPrompt, 'utf8');
  const expectedSha = sha256WithReplacement(buf, info.offset, origBuf);
  if (meta?.origSha256 && (!meta.version || !version || meta.version === version) && meta.origSha256 !== expectedSha) {
    throw new Error(`还原后预期 SHA-256 (${expectedSha}) 与原始记录 (${meta.origSha256}) 不一致，拒绝修改`);
  }

  atomicWritePatchedRange(lsPath, info.offset, origBuf, expectedSha);
  const after = inspectLsTitleState(lsPath, metaFile, { origPrompt, patchedPrompt });
  if (after.status !== 'unpatched' || after.offset !== info.offset) {
    throw new Error(`还原后校验异常：status=${after.status}`);
  }
  removeMeta(metaFile);
  log(`已还原 language_server.exe 原始对话标题提示词（偏移 0x${info.offset.toString(16)}）`);
  return {
    changed: true,
    status: 'unpatched',
    offset: info.offset,
    lsSize: buf.length,
    restoredSha256: expectedSha,
  };
}

async function main() {
  const args = parseArgs();
  const dryRun = args.has('--dry-run');
  log(`===== agy-zh-title patch 开始${dryRun ? ' (DRY-RUN)' : ''} 目标 ${LS_EXE}`);

  const { version } = appInfo(ASAR);
  log(`Antigravity 版本: ${version}`);

  if (!dryRun && args.has('--wait-exit')) await waitAllExit({ exe: EXE, lsExe: LS_EXE });
  if (!dryRun && (runningAppCount(EXE) > 0 || runningLsCount(LS_EXE) > 0)) {
    throw new Error('Antigravity 或 language_server.exe 正在运行，请先退出，或加 --wait-exit');
  }

  const res = applyLsTitlePatch({ lsPath: LS_EXE, metaFile: META_FILE, version, dryRun });
  if (dryRun) {
    log(`DRY-RUN 预检通过（status=${res.status}, offset=0x${res.offset.toString(16)}）`);
  } else if (args.has('--relaunch')) {
    relaunch(EXE);
  }
  log('===== agy-zh-title patch 结束');
}

if (isEntry(import.meta.url)) {
  main().catch((e) => {
    log(`失败：${e.stack || e.message}`);
    process.exit(1);
  });
}
