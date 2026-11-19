import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  ANCHOR,
  ORIG_PROMPT,
  PATCHED_PROMPT,
  validatePrompts,
  buildEqualLengthBuffer,
  inspectBuffer,
} from '../patcher/lib/prompt.mjs';
import {
  inspectLsTitleState,
  applyLsTitlePatch,
  restoreLsTitlePatch,
} from '../patcher/patch.mjs';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// 构造含尾部模拟 ZIP 的合成二进制（仅在临时目录操作）
function buildSyntheticZip() {
  const fileName = Buffer.from('main.js\0compiled_tailwind.css', 'utf8');
  const cd = Buffer.alloc(46 + fileName.length, 0);
  cd.writeUInt32LE(0x02014b50, 0);
  fileName.copy(cd, 46);
  const eocd = Buffer.alloc(22, 0);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(0, 16);
  return Buffer.concat([cd, eocd]);
}

function makeSyntheticBinary(payloadStr = ORIG_PROMPT, { repeat = 1 } = {}) {
  const head = Buffer.from('SYNTHETIC_PE_HEADER_AND_CODE_'.repeat(30), 'utf8');
  const mid = Buffer.from('_MIDDLE_PADDING_BYTES_'.repeat(10), 'utf8');
  const tail = Buffer.from('_RODATA_TAIL_PADDING_'.repeat(25), 'utf8');
  const payload = Buffer.from(payloadStr, 'utf8');
  const parts = [head];
  for (let i = 0; i < repeat; i++) {
    if (i > 0) parts.push(mid);
    parts.push(payload);
  }
  parts.push(tail, buildSyntheticZip());
  return {
    buf: Buffer.concat(parts),
    offset: head.length,
    head,
    tailZipStart: head.length + payload.length,
  };
}

function withTempWorkspace(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-zh-title-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('validatePrompts 校验 ORIG_PROMPT 与 PATCHED_PROMPT 严格 626 字节且均以 ANCHOR 开头', () => {
  const info = validatePrompts();
  assert.equal(info.origBytes, 626);
  assert.equal(info.patchedBytes, 626);
  assert.equal(Buffer.byteLength(ORIG_PROMPT, 'utf8'), 626);
  assert.equal(Buffer.byteLength(PATCHED_PROMPT, 'utf8'), 626);
  assert.ok(ORIG_PROMPT.startsWith(ANCHOR));
  assert.ok(PATCHED_PROMPT.startsWith(ANCHOR));
});

test('applyLsTitlePatch 正常原位替换、保持总长及前后/ZIP 区间无损并写入 meta', () => {
  withTempWorkspace((dir) => {
    const lsPath = path.join(dir, 'language_server.exe');
    const metaFile = path.join(dir, 'language_server.title-meta.json');
    const { buf: origBuf, offset, head, tailZipStart } = makeSyntheticBinary(ORIG_PROMPT);
    fs.writeFileSync(lsPath, origBuf);
    const origSha = sha256(origBuf);

    const before = inspectLsTitleState(lsPath, metaFile);
    assert.equal(before.status, 'unpatched');
    assert.equal(before.offset, offset);
    assert.equal(before.overlapsWebZip, false);
    assert.ok(before.webZipRange && before.webZipRange.start > tailZipStart);

    const res = applyLsTitlePatch({ lsPath, metaFile, version: '2.33.0' });
    assert.equal(res.changed, true);
    assert.equal(res.status, 'patched');
    assert.equal(res.offset, offset);

    const patchedBuf = fs.readFileSync(lsPath);
    assert.equal(patchedBuf.length, origBuf.length);
    assert.ok(patchedBuf.subarray(0, offset).equals(head));
    assert.ok(patchedBuf.subarray(offset + 626).equals(origBuf.subarray(offset + 626)));
    assert.equal(patchedBuf.subarray(offset, offset + 626).toString('utf8'), PATCHED_PROMPT);

    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    assert.equal(meta.version, '2.33.0');
    assert.equal(meta.offset, offset);
    assert.equal(meta.byteLength, 626);
    assert.equal(meta.origSha256, origSha);
    assert.equal(meta.patchedSha256, sha256(patchedBuf));
    assert.equal(meta.patchedPrompt, PATCHED_PROMPT);
  });
});

test('幂等性：已注入文件再次 applyLsTitlePatch 返回 changed=false 且哈希不变', () => {
  withTempWorkspace((dir) => {
    const lsPath = path.join(dir, 'language_server.exe');
    const metaFile = path.join(dir, 'language_server.title-meta.json');
    const { buf: origBuf } = makeSyntheticBinary(ORIG_PROMPT);
    fs.writeFileSync(lsPath, origBuf);

    applyLsTitlePatch({ lsPath, metaFile, version: '2.33.0' });
    const firstSha = sha256(fs.readFileSync(lsPath));

    const second = applyLsTitlePatch({ lsPath, metaFile, version: '2.33.0' });
    assert.equal(second.changed, false);
    assert.equal(second.status, 'patched');
    assert.equal(sha256(fs.readFileSync(lsPath)), firstSha);
  });
});

test('无损回滚：restoreLsTitlePatch 还原后与原文件 SHA-256 逐位完全一致并清理 meta', () => {
  withTempWorkspace((dir) => {
    const lsPath = path.join(dir, 'language_server.exe');
    const metaFile = path.join(dir, 'language_server.title-meta.json');
    const { buf: origBuf } = makeSyntheticBinary(ORIG_PROMPT);
    fs.writeFileSync(lsPath, origBuf);
    const origSha = sha256(origBuf);

    applyLsTitlePatch({ lsPath, metaFile, version: '2.33.0' });
    assert.ok(fs.existsSync(metaFile));

    const restored = restoreLsTitlePatch({ lsPath, metaFile, version: '2.33.0' });
    assert.equal(restored.changed, true);
    assert.equal(restored.status, 'unpatched');
    assert.equal(sha256(fs.readFileSync(lsPath)), origSha);
    assert.equal(fs.existsSync(metaFile), false);

    const state = inspectLsTitleState(lsPath, metaFile);
    assert.equal(state.status, 'unpatched');
  });
});

test('提示词升级路径：旧版 626 字节补丁识别为 outdated_patch 并可平滑升级与还原', () => {
  withTempWorkspace((dir) => {
    const lsPath = path.join(dir, 'language_server.exe');
    const metaFile = path.join(dir, 'language_server.title-meta.json');
    const { buf: origBuf } = makeSyntheticBinary(ORIG_PROMPT);
    fs.writeFileSync(lsPath, origBuf);
    const origSha = sha256(origBuf);

    const oldPatchedPrompt = buildEqualLengthBuffer(
      `${ANCHOR} Always respond with a brief Chinese title (4-12 chars).`,
      626,
    ).toString('utf8');

    const first = applyLsTitlePatch({
      lsPath,
      metaFile,
      version: '2.33.0',
      patchedPrompt: oldPatchedPrompt,
    });
    assert.equal(first.changed, true);

    const stateBeforeUpgrade = inspectLsTitleState(lsPath, metaFile);
    assert.equal(stateBeforeUpgrade.status, 'outdated_patch');

    const upgraded = applyLsTitlePatch({ lsPath, metaFile, version: '2.33.0' });
    assert.equal(upgraded.changed, true);
    assert.equal(upgraded.origSha256, origSha);

    const restored = restoreLsTitlePatch({ lsPath, metaFile, version: '2.33.0' });
    assert.equal(restored.changed, true);
    assert.equal(sha256(fs.readFileSync(lsPath)), origSha);
  });
});

test('异常防护：prompt_changed / not_found / ambiguous 均拒绝改写且保持哈希不变', () => {
  withTempWorkspace((dir) => {
    const metaFile = path.join(dir, 'language_server.title-meta.json');

    // 1. prompt_changed
    const changedPath = path.join(dir, 'changed.exe');
    const { buf: changedBuf } = makeSyntheticBinary(`${ANCHOR} Upstream prompt was redesigned.`);
    fs.writeFileSync(changedPath, changedBuf);
    const changedSha = sha256(changedBuf);
    assert.equal(inspectBuffer(changedBuf).status, 'prompt_changed');
    assert.throws(() => applyLsTitlePatch({ lsPath: changedPath, metaFile }), /已变更/);
    assert.equal(sha256(fs.readFileSync(changedPath)), changedSha);

    // 2. not_found
    const missingPath = path.join(dir, 'missing.exe');
    const { buf: missingBuf } = makeSyntheticBinary('Some unrelated binary content without anchor.');
    fs.writeFileSync(missingPath, missingBuf);
    const missingSha = sha256(missingBuf);
    assert.equal(inspectBuffer(missingBuf).status, 'not_found');
    assert.throws(() => applyLsTitlePatch({ lsPath: missingPath, metaFile }), /未在/);
    assert.equal(sha256(fs.readFileSync(missingPath)), missingSha);

    // 3. ambiguous
    const dupPath = path.join(dir, 'dup.exe');
    const { buf: dupBuf } = makeSyntheticBinary(ORIG_PROMPT, { repeat: 2 });
    fs.writeFileSync(dupPath, dupBuf);
    const dupSha = sha256(dupBuf);
    assert.equal(inspectBuffer(dupBuf).status, 'ambiguous');
    assert.throws(() => applyLsTitlePatch({ lsPath: dupPath, metaFile }), /多处候选位置/);
    assert.equal(sha256(fs.readFileSync(dupPath)), dupSha);
  });
});

test('dryRun: true 仅校验且不修改目标文件、不写 meta', () => {
  withTempWorkspace((dir) => {
    const lsPath = path.join(dir, 'language_server.exe');
    const metaFile = path.join(dir, 'language_server.title-meta.json');
    const { buf: origBuf } = makeSyntheticBinary(ORIG_PROMPT);
    fs.writeFileSync(lsPath, origBuf);
    const origSha = sha256(origBuf);

    const res = applyLsTitlePatch({ lsPath, metaFile, version: '2.33.0', dryRun: true });
    assert.equal(res.changed, false);
    assert.equal(res.wouldChange, true);
    assert.equal(res.status, 'unpatched');
    assert.equal(sha256(fs.readFileSync(lsPath)), origSha);
    assert.equal(fs.existsSync(metaFile), false);
  });
});
