// 检查 language_server.exe 中文步骤与状态补丁状态。
// 用法：node check.mjs [--json]
import fs from 'node:fs';
import { ASAR, LS_EXE, appInfo } from './lib/app.mjs';
import { PROJECT_DIR, META_FILE, parseArgs } from './lib/common.mjs';
import { inspectLsStepsState } from './patch.mjs';

const STATUS_LABELS = {
  patched: '已注入',
  unpatched: '未注入',
  partial: '部分注入',
  outdated_patch: '旧版补丁待升级',
  prompt_changed: '上游提示词已变更',
  not_found: '未找到目标描述',
  ambiguous: '匹配位置不唯一',
  overlap: '命中区间存在重叠',
};

const args = parseArgs();
const r = {
  projectDir: PROJECT_DIR,
  lsExe: LS_EXE,
  metaFile: META_FILE,
  version: appInfo(ASAR).version,
};

try {
  if (!fs.existsSync(LS_EXE)) {
    r.error = `找不到 ${LS_EXE}`;
  } else {
    const st = inspectLsStepsState(LS_EXE, META_FILE);
    r.lsSize = st.lsSize;
    r.status = st.status;
    r.statusLabel = STATUS_LABELS[st.status] || st.status;
    r.patchedCount = st.patchedCount;
    r.totalCount = st.totalCount;
    r.overlapsWebZip = st.overlapsWebZip;
    r.hasOverlap = st.hasOverlap;
    r.metaVersion = st.meta?.version ?? null;
    r.metaMatchesVersion = !!(st.meta?.version && r.version !== 'unknown' && st.meta.version === r.version);
    r.items = st.items.map((it) => ({
      id: it.id,
      label: it.label,
      kind: it.kind,
      status: it.status,
      statusLabel: STATUS_LABELS[it.status] || it.status,
      offset: it.offset,
      offsetHex: it.offset >= 0 ? `0x${it.offset.toString(16)}` : null,
      byteLength: it.byteLength,
      overlapsWebZip: it.overlapsWebZip,
      currentPreview: it.currentPreview,
    }));
  }
} catch (e) {
  r.error = `检查 language_server.exe 失败：${e.message}`;
}

if (args.has('--json')) {
  console.log(JSON.stringify(r, null, 2));
} else {
  const L = [];
  L.push(`项目目录：${r.projectDir}`);
  L.push(`目标文件：${r.lsExe}`);
  if (r.error) {
    L.push(r.error);
  } else {
    const sizeMb = (r.lsSize / (1024 * 1024)).toFixed(2);
    L.push(`客户端版本：${r.version}    文件大小：${sizeMb} MB (${r.lsSize} bytes)`);
    L.push(`步骤补丁状态：${r.statusLabel} (${r.status}, ${r.patchedCount}/${r.totalCount})`);
    L.push(`元信息文件：${r.metaFile}（${r.metaVersion ? `记录版本 ${r.metaVersion}${r.metaMatchesVersion ? '，匹配' : '，不匹配'}` : '无记录'}）`);
    L.push('逐项明细：');
    for (const it of r.items) {
      L.push(`  - [${it.statusLabel}] ${it.id} (${it.label}) | 偏移 ${it.offsetHex ?? '无'} | ${it.byteLength} 字节`);
      if (it.currentPreview) {
        L.push(`    当前二进制片段：${it.currentPreview}`);
      }
    }
  }
  console.log(L.join('\n'));
}
