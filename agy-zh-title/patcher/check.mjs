// 检查 language_server.exe 中文对话标题补丁状态。
// 用法：node check.mjs [--json]
import fs from 'node:fs';
import { ASAR, LS_EXE, appInfo } from './lib/app.mjs';
import { PROJECT_DIR, META_FILE, parseArgs } from './lib/common.mjs';
import { inspectLsTitleState } from './patch.mjs';

const STATUS_LABELS = {
  patched: '已注入',
  unpatched: '未注入',
  outdated_patch: '旧版补丁待升级',
  prompt_changed: '上游提示词已变更',
  not_found: '未找到目标提示词',
  ambiguous: '匹配位置不唯一',
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
    const st = inspectLsTitleState(LS_EXE, META_FILE);
    r.lsSize = st.lsSize;
    r.status = st.status;
    r.statusLabel = STATUS_LABELS[st.status] || st.status;
    r.offset = st.offset;
    r.offsetHex = st.offset >= 0 ? `0x${st.offset.toString(16)}` : null;
    r.byteLength = st.byteLength;
    r.overlapsWebZip = st.overlapsWebZip;
    r.metaVersion = st.meta?.version ?? null;
    r.metaMatchesVersion = !!(st.meta?.version && r.version !== 'unknown' && st.meta.version === r.version);
    r.currentPromptPreview = st.currentPromptPreview;
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
    L.push(`标题补丁状态：${r.statusLabel} (${r.status})    命中偏移：${r.offsetHex ?? '无'}    长度：${r.byteLength} 字节`);
    L.push(`元信息文件：${r.metaFile}（${r.metaVersion ? `记录版本 ${r.metaVersion}${r.metaMatchesVersion ? '，匹配' : '，不匹配'}` : '无记录'}）`);
    if (r.currentPromptPreview) {
      L.push(`当前二进制片段：${r.currentPromptPreview}`);
    }
  }
  console.log(L.join('\n'));
}
