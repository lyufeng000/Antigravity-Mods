// 原位等长替换 language_server.exe 内置步骤清单、状态摘要及辅助标签描述，并支持共存感知无损还原。
// 用法：node patch.mjs [--dry-run] [--wait-exit] [--relaunch]
import fs from 'node:fs';
import { ASAR, EXE, LS_EXE, appInfo } from './lib/app.mjs';
import {
  META_FILE, log, sha256Buffer, sha256WithReplacements,
  readMeta, writeMeta, removeMeta,
  runningAppCount, runningLsCount, waitAllExit, relaunch,
  atomicWritePatchedRanges, isEntry, parseArgs,
} from './lib/common.mjs';
import { TARGETS, validateTargets, inspectBuffer } from './lib/targets.mjs';

export function inspectLsStepsState(
  lsPath = LS_EXE,
  metaFile = META_FILE,
  { targets = TARGETS } = {},
) {
  const meta = readMeta(metaFile);
  const buf = fs.readFileSync(lsPath);
  const res = inspectBuffer(buf, {
    targets,
    previousPatchedMap: meta?.targets ?? null,
  });
  return {
    lsPath,
    lsSize: buf.length,
    ...res,
    meta,
  };
}

function assertInspectSafe(info, actionLabel) {
  if (info.status === 'ambiguous') {
    const list = info.items.filter((it) => it.status === 'ambiguous').map((it) => `${it.id}(${it.anchorOffsets.join(',')})`).join('; ');
    throw new Error(`language_server.exe 中存在多处候选位置 [${list}]，无法安全${actionLabel}`);
  }
  if (info.status === 'prompt_changed') {
    const details = info.items
      .filter((it) => it.status === 'prompt_changed')
      .map((it) => `${it.id} (偏移 0x${it.offset.toString(16)}): ${it.currentPreview}`)
      .join('\n');
    throw new Error(`上游工具描述或标签已变更，拒绝${actionLabel}：\n${details}`);
  }
  if (info.status === 'not_found') {
    const missing = info.items.filter((it) => it.status === 'not_found').map((it) => it.id).join(', ');
    throw new Error(`未在 binaries 中找到目标描述 [${missing}]，无法${actionLabel}`);
  }
  if (info.status === 'overlap' || info.hasOverlap) {
    throw new Error(`命中区间存在重叠，拒绝${actionLabel}`);
  }
  if (info.overlapsWebZip) {
    const bad = info.items.find((it) => it.overlapsWebZip);
    throw new Error(`命中区间 ${bad.id} [${bad.offset}, ${bad.offset + bad.byteLength}) 与内嵌前端 ZIP 重叠，拒绝${actionLabel}`);
  }
}

export function applyLsStepsPatch({
  lsPath = LS_EXE,
  metaFile = META_FILE,
  version = null,
  dryRun = false,
  targets = TARGETS,
} = {}) {
  validateTargets(targets);
  if (!fs.existsSync(lsPath)) throw new Error(`找不到 ${lsPath}`);

  const meta = readMeta(metaFile);
  const buf = fs.readFileSync(lsPath);
  const info = inspectBuffer(buf, {
    targets,
    previousPatchedMap: meta?.targets ?? null,
  });

  assertInspectSafe(info, '原位替换');

  if (info.status === 'patched') {
    log(`中文步骤与状态补丁已处于最新状态（${info.patchedCount}/${info.totalCount}），无需重复写入`);
    return {
      changed: false,
      status: 'patched',
      patchedCount: info.patchedCount,
      totalCount: info.totalCount,
      items: info.items,
      lsSize: buf.length,
    };
  }

  if (dryRun) {
    return {
      changed: false,
      wouldChange: true,
      status: info.status,
      patchedCount: info.patchedCount,
      totalCount: info.totalCount,
      items: info.items,
      lsSize: buf.length,
    };
  }

  const targetById = new Map(targets.map((t) => [t.id, t]));
  const ranges = [];
  const origAllRanges = [];
  for (const item of info.items) {
    const t = targetById.get(item.id);
    if (item.status !== 'patched') {
      ranges.push({ offset: item.offset, replacementBuf: Buffer.from(t.patched, 'utf8') });
    }
    origAllRanges.push({ offset: item.offset, replacementBuf: Buffer.from(t.orig, 'utf8') });
  }

  const curSha = sha256Buffer(buf);
  const expectedSha = sha256WithReplacements(buf, ranges);
  let beforeSha256 = curSha;
  if (info.status !== 'unpatched') {
    const sameVersion = !meta?.version || !version || meta.version === version;
    if (meta?.beforeSha256 && meta?.afterSha256 === curSha && sameVersion) {
      beforeSha256 = meta.beforeSha256;
    } else {
      beforeSha256 = sha256WithReplacements(buf, origAllRanges);
    }
  }

  atomicWritePatchedRanges(lsPath, ranges, expectedSha);

  const targetMeta = {};
  for (const item of info.items) {
    const t = targetById.get(item.id);
    targetMeta[item.id] = {
      offset: item.offset,
      byteLength: item.byteLength,
      patched: t.patched,
    };
  }

  writeMeta({
    version: version ?? meta?.version ?? null,
    updatedAt: new Date().toISOString(),
    beforeSha256,
    afterSha256: expectedSha,
    targets: targetMeta,
  }, metaFile);

  const after = inspectLsStepsState(lsPath, metaFile, { targets });
  if (after.status !== 'patched') {
    throw new Error(`写入后校验异常：status=${after.status}`);
  }
  log(`中文步骤与状态补丁注入完成（共替换 ${ranges.length} 处，最新覆盖 ${after.patchedCount}/${after.totalCount}）`);
  return {
    changed: true,
    status: 'patched',
    patchedCount: after.patchedCount,
    totalCount: after.totalCount,
    items: after.items,
    lsSize: buf.length,
    beforeSha256,
    afterSha256: expectedSha,
  };
}

export function restoreLsStepsPatch({
  lsPath = LS_EXE,
  metaFile = META_FILE,
  version = null,
  dryRun = false,
  targets = TARGETS,
} = {}) {
  validateTargets(targets);
  if (!fs.existsSync(lsPath)) throw new Error(`找不到 ${lsPath}`);

  const meta = readMeta(metaFile);
  const buf = fs.readFileSync(lsPath);
  const info = inspectBuffer(buf, {
    targets,
    previousPatchedMap: meta?.targets ?? null,
  });

  if (info.overlapsWebZip) {
    const bad = info.items.find((it) => it.overlapsWebZip);
    throw new Error(`命中区间 ${bad.id} [${bad.offset}, ${bad.offset + bad.byteLength}) 与内嵌前端 ZIP 重叠，拒绝还原`);
  }
  if (info.status === 'ambiguous') {
    const list = info.items.filter((it) => it.status === 'ambiguous').map((it) => it.id).join(', ');
    throw new Error(`language_server.exe 中存在多处候选位置 [${list}]，无法安全还原`);
  }
  if (info.status === 'overlap' || info.hasOverlap) {
    throw new Error('命中区间存在重叠，拒绝还原');
  }

  if (info.status === 'unpatched') {
    if (!dryRun) removeMeta(metaFile);
    log('language_server.exe 当前未注入中文步骤与状态补丁，无需还原');
    return {
      changed: false,
      status: 'unpatched',
      patchedCount: 0,
      totalCount: info.totalCount,
      items: info.items,
      lsSize: buf.length,
    };
  }

  if (info.status === 'prompt_changed' || info.status === 'not_found') {
    log('当前版本未检测到可安全还原的中文步骤补丁（可能已被官方更新覆盖），无需还原');
    return {
      changed: false,
      status: info.status,
      patchedCount: info.patchedCount,
      totalCount: info.totalCount,
      items: info.items,
      lsSize: buf.length,
    };
  }

  if (dryRun) {
    return {
      changed: false,
      wouldChange: true,
      status: info.status,
      patchedCount: info.patchedCount,
      totalCount: info.totalCount,
      items: info.items,
      lsSize: buf.length,
    };
  }

  const targetById = new Map(targets.map((t) => [t.id, t]));
  const ranges = [];
  for (const item of info.items) {
    if (item.status !== 'patched' && item.status !== 'outdated_patch') continue;
    const t = targetById.get(item.id);
    ranges.push({ offset: item.offset, replacementBuf: Buffer.from(t.orig, 'utf8') });
  }

  const curSha = sha256Buffer(buf);
  const expectedSha = sha256WithReplacements(buf, ranges);
  // 仅当当前文件与本模块记录的 afterSha256 完全匹配（未被其他共存补丁如 agy-zh-title 随后改动过）时校验 beforeSha256
  if (
    meta?.beforeSha256
    && meta?.afterSha256 === curSha
    && (!meta.version || !version || meta.version === version)
    && meta.beforeSha256 !== expectedSha
  ) {
    throw new Error(`还原后预期 SHA-256 (${expectedSha}) 与原始记录 (${meta.beforeSha256}) 不一致，拒绝修改`);
  }

  atomicWritePatchedRanges(lsPath, ranges, expectedSha);
  const after = inspectLsStepsState(lsPath, metaFile, { targets });
  if (after.status !== 'unpatched') {
    throw new Error(`还原后校验异常：status=${after.status}`);
  }
  removeMeta(metaFile);
  log(`已还原 language_server.exe 原始步骤与状态描述（共还原 ${ranges.length} 处）`);
  return {
    changed: true,
    status: 'unpatched',
    patchedCount: 0,
    totalCount: after.totalCount,
    items: after.items,
    lsSize: buf.length,
    restoredSha256: expectedSha,
  };
}

async function main() {
  const args = parseArgs();
  const dryRun = args.has('--dry-run');
  log(`===== agy-zh-steps patch 开始${dryRun ? ' (DRY-RUN)' : ''} 目标 ${LS_EXE}`);

  const { version } = appInfo(ASAR);
  log(`Antigravity 版本: ${version}`);

  if (!dryRun && args.has('--wait-exit')) await waitAllExit({ exe: EXE, lsExe: LS_EXE });
  if (!dryRun && (runningAppCount(EXE) > 0 || runningLsCount(LS_EXE) > 0)) {
    throw new Error('Antigravity 或 language_server.exe 正在运行，请先退出，或加 --wait-exit');
  }

  const res = applyLsStepsPatch({ lsPath: LS_EXE, metaFile: META_FILE, version, dryRun });
  if (dryRun) {
    log(`DRY-RUN 预检通过（status=${res.status}, ${res.patchedCount}/${res.totalCount}）`);
  } else if (args.has('--relaunch')) {
    relaunch(EXE);
  }
  log('===== agy-zh-steps patch 结束');
}

if (isEntry(import.meta.url)) {
  main().catch((e) => {
    log(`失败：${e.stack || e.message}`);
    process.exit(1);
  });
}
