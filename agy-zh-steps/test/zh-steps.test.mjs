import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  TARGETS,
  validateTargets,
  buildEqualLengthBuffer,
  inspectBuffer,
} from '../patcher/lib/targets.mjs';
import {
  inspectLsStepsState,
  applyLsStepsPatch,
  restoreLsStepsPatch,
} from '../patcher/patch.mjs';
import {
  ORIG_PROMPT as TITLE_ORIG_PROMPT,
  PATCHED_PROMPT as TITLE_PATCHED_PROMPT,
} from '../../agy-zh-title/patcher/lib/prompt.mjs';
import {
  inspectLsTitleState,
  applyLsTitlePatch,
  restoreLsTitlePatch,
} from '../../agy-zh-title/patcher/patch.mjs';

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

function makeSyntheticBinary({
  overrides = {},
  repeatTargetId = null,
  includeTitlePrompt = false,
  putTargetInZip = null,
} = {}) {
  const head = Buffer.from('SYNTHETIC_PE_HEADER_AND_CODE_'.repeat(30), 'utf8');
  const sep = Buffer.from('_SECTION_PADDING_BYTES_'.repeat(12), 'utf8');
  const tail = Buffer.from('_RODATA_TAIL_PADDING_'.repeat(50), 'utf8');

  const parts = [head];
  const segments = [];
  let cursor = head.length;

  if (includeTitlePrompt) {
    const tBuf = Buffer.from(TITLE_ORIG_PROMPT, 'utf8');
    segments.push({ id: 'title_prompt', offset: cursor, len: tBuf.length });
    parts.push(tBuf, sep);
    cursor += tBuf.length + sep.length;
  }

  for (const t of TARGETS) {
    const val = overrides[t.id] !== undefined ? overrides[t.id] : t.orig;
    const pBuf = Buffer.from(val, 'utf8');
    segments.push({ id: t.id, offset: cursor, len: pBuf.length });
    parts.push(pBuf, sep);
    cursor += pBuf.length + sep.length;
    if (repeatTargetId === t.id) {
      parts.push(pBuf, sep);
      cursor += pBuf.length + sep.length;
    }
  }

  parts.push(tail);
  let zipBuf = buildSyntheticZip();
  if (putTargetInZip) {
    const t = TARGETS.find((item) => item.id === putTargetInZip);
    const payload = Buffer.from(t.orig, 'utf8');
    const fileName = Buffer.from('main.js\0compiled_tailwind.css', 'utf8');
    const cd = Buffer.alloc(46 + fileName.length, 0);
    cd.writeUInt32LE(0x02014b50, 0);
    fileName.copy(cd, 46);
    const eocd = Buffer.alloc(22, 0);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(payload.length, 16);
    zipBuf = Buffer.concat([payload, cd, eocd]);
  }
  parts.push(zipBuf);

  return {
    buf: Buffer.concat(parts),
    segments,
    head,
    sep,
  };
}

function withTempWorkspace(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-zh-steps-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('validateTargets 校验全部 9 项严格等长 UTF-8、struct_tag 与 json_prop 语法合法且 anchor 匹配', () => {
  const summary = validateTargets();
  assert.equal(summary.count, 9);
  assert.equal(TARGETS.length, 9);
  for (const t of TARGETS) {
    const origBytes = Buffer.byteLength(t.orig, 'utf8');
    const patchedBytes = Buffer.byteLength(t.patched, 'utf8');
    assert.equal(origBytes, patchedBytes, `${t.id} 字节长度必须相等`);
    assert.ok(t.orig.startsWith(t.anchor), `${t.id} orig 必须以 anchor 开头`);
    assert.ok(t.patched.startsWith(t.anchor), `${t.id} patched 必须以 anchor 开头`);
    if (t.kind === 'struct_tag') {
      assert.ok(t.patched.endsWith('"'));
      const marker = 'jsonschema_description:"';
      const idx = t.patched.indexOf(marker);
      assert.ok(idx >= 0);
      const inner = t.patched.slice(idx + marker.length, -1);
      assert.equal(/[\\"\r\n]/.test(inner), false, `${t.id} 不得含非法引号或转义`);
    }
    if (t.kind === 'json_prop') {
      assert.doesNotThrow(() => JSON.parse(`{ ${t.orig} } }`));
      assert.doesNotThrow(() => JSON.parse(`{ ${t.patched} } }`));
    }
  }
});

test('applyLsStepsPatch 正常一次性原子替换 9 处、保持总长及间隔/ZIP 区间无损并写入 meta', () => {
  withTempWorkspace((dir) => {
    const lsPath = path.join(dir, 'language_server.exe');
    const metaFile = path.join(dir, 'language_server.steps-meta.json');
    const { buf: origBuf, segments } = makeSyntheticBinary();
    fs.writeFileSync(lsPath, origBuf);
    const origSha = sha256(origBuf);

    const before = inspectLsStepsState(lsPath, metaFile);
    assert.equal(before.status, 'unpatched');
    assert.equal(before.patchedCount, 0);
    assert.equal(before.unpatchedCount, 9);
    assert.equal(before.overlapsWebZip, false);
    assert.equal(before.hasOverlap, false);

    const res = applyLsStepsPatch({ lsPath, metaFile, version: '2.34.0' });
    assert.equal(res.changed, true);
    assert.equal(res.status, 'patched');
    assert.equal(res.patchedCount, 9);
    assert.equal(res.totalCount, 9);

    const patchedBuf = fs.readFileSync(lsPath);
    assert.equal(patchedBuf.length, origBuf.length);

    // 校验 9 处以外的所有字节（含间隙与尾部模拟 ZIP）与原文件逐字节一致
    let cursor = 0;
    for (let i = 0; i < TARGETS.length; i++) {
      const t = TARGETS[i];
      const seg = segments[i];
      assert.ok(
        patchedBuf.subarray(cursor, seg.offset).equals(origBuf.subarray(cursor, seg.offset)),
        `${t.id} 前置间隔字节被意外修改`,
      );
      assert.equal(patchedBuf.subarray(seg.offset, seg.offset + seg.len).toString('utf8'), t.patched);
      cursor = seg.offset + seg.len;
    }
    assert.ok(patchedBuf.subarray(cursor).equals(origBuf.subarray(cursor)), '尾部数据及 ZIP 被意外修改');

    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    assert.equal(meta.version, '2.34.0');
    assert.equal(meta.beforeSha256, origSha);
    assert.equal(meta.afterSha256, sha256(patchedBuf));
    assert.equal(Object.keys(meta.targets).length, 9);
    for (const t of TARGETS) {
      assert.equal(meta.targets[t.id].patched, t.patched);
    }
  });
});

test('幂等性：已注入文件再次 applyLsStepsPatch 返回 changed=false 且哈希不变', () => {
  withTempWorkspace((dir) => {
    const lsPath = path.join(dir, 'language_server.exe');
    const metaFile = path.join(dir, 'language_server.steps-meta.json');
    const { buf: origBuf } = makeSyntheticBinary();
    fs.writeFileSync(lsPath, origBuf);

    applyLsStepsPatch({ lsPath, metaFile, version: '2.34.0' });
    const firstSha = sha256(fs.readFileSync(lsPath));

    const second = applyLsStepsPatch({ lsPath, metaFile, version: '2.34.0' });
    assert.equal(second.changed, false);
    assert.equal(second.status, 'patched');
    assert.equal(sha256(fs.readFileSync(lsPath)), firstSha);
  });
});

test('无损回滚：restoreLsStepsPatch 还原后与原文件 SHA-256 逐位一致并清理 meta', () => {
  withTempWorkspace((dir) => {
    const lsPath = path.join(dir, 'language_server.exe');
    const metaFile = path.join(dir, 'language_server.steps-meta.json');
    const { buf: origBuf } = makeSyntheticBinary();
    fs.writeFileSync(lsPath, origBuf);
    const origSha = sha256(origBuf);

    applyLsStepsPatch({ lsPath, metaFile, version: '2.34.0' });
    assert.ok(fs.existsSync(metaFile));

    const restored = restoreLsStepsPatch({ lsPath, metaFile, version: '2.34.0' });
    assert.equal(restored.changed, true);
    assert.equal(restored.status, 'unpatched');
    assert.equal(sha256(fs.readFileSync(lsPath)), origSha);
    assert.equal(fs.existsSync(metaFile), false);

    const secondRestore = restoreLsStepsPatch({ lsPath, metaFile, version: '2.34.0' });
    assert.equal(secondRestore.changed, false);
    assert.equal(secondRestore.status, 'unpatched');
  });
});

test('升级路径与部分状态：outdated_patch 与 partial 状态均可平滑升级到最新并无损回滚', () => {
  withTempWorkspace((dir) => {
    const lsPath = path.join(dir, 'language_server.exe');
    const metaFile = path.join(dir, 'language_server.steps-meta.json');
    const { buf: origBuf } = makeSyntheticBinary();
    const origSha = sha256(origBuf);

    // 1. 模拟部分已注入（仅第 0、1 项为最新 patched，其余为 orig）
    const partialMap = {
      [TARGETS[0].id]: TARGETS[0].patched,
      [TARGETS[1].id]: TARGETS[1].patched,
    };
    const { buf: partialBuf } = makeSyntheticBinary({ overrides: partialMap });
    fs.writeFileSync(lsPath, partialBuf);
    const partialState = inspectLsStepsState(lsPath, metaFile);
    assert.equal(partialState.status, 'partial');
    assert.equal(partialState.patchedCount, 2);

    const upgradedFromPartial = applyLsStepsPatch({ lsPath, metaFile, version: '2.34.0' });
    assert.equal(upgradedFromPartial.changed, true);
    assert.equal(upgradedFromPartial.status, 'patched');
    const restored1 = restoreLsStepsPatch({ lsPath, metaFile, version: '2.34.0' });
    assert.equal(restored1.changed, true);
    assert.equal(sha256(fs.readFileSync(lsPath)), origSha);

    // 2. 模拟旧版等长补丁（outdated_patch）
    const oldMap = {};
    for (const t of TARGETS) {
      const targetLen = Buffer.byteLength(t.orig, 'utf8');
      if (t.kind === 'struct_tag' || t.kind === 'json_prop') {
        oldMap[t.id] = buildEqualLengthBuffer(`${t.anchor}OLD_ZH_PATCH_${t.id}`, targetLen - 1).toString('utf8') + '"';
      } else {
        oldMap[t.id] = buildEqualLengthBuffer(`${t.anchor} OLD_ZH_PATCH_${t.id}`, targetLen).toString('utf8');
      }
    }
    const oldTargets = TARGETS.map((t) => ({ ...t, patched: oldMap[t.id] }));
    fs.writeFileSync(lsPath, origBuf);
    applyLsStepsPatch({ lsPath, metaFile, version: '2.34.0', targets: oldTargets });

    const beforeUpgrade = inspectLsStepsState(lsPath, metaFile);
    assert.equal(beforeUpgrade.status, 'outdated_patch');

    const upgraded = applyLsStepsPatch({ lsPath, metaFile, version: '2.34.0' });
    assert.equal(upgraded.changed, true);
    assert.equal(upgraded.status, 'patched');
    assert.equal(upgraded.beforeSha256, origSha);

    const restored2 = restoreLsStepsPatch({ lsPath, metaFile, version: '2.34.0' });
    assert.equal(restored2.changed, true);
    assert.equal(sha256(fs.readFileSync(lsPath)), origSha);
  });
});

test('异常防护：prompt_changed / not_found / ambiguous / overlapsWebZip 均拒绝改写且保持哈希不变', () => {
  withTempWorkspace((dir) => {
    const metaFile = path.join(dir, 'language_server.steps-meta.json');
    const t0 = TARGETS[0];
    const t2 = TARGETS[2];

    // 1. prompt_changed
    const changedPath = path.join(dir, 'changed.exe');
    const { buf: changedBuf } = makeSyntheticBinary({
      overrides: { [t0.id]: `${t0.anchor} Upstream prompt changed significantly.` },
    });
    fs.writeFileSync(changedPath, changedBuf);
    const changedSha = sha256(changedBuf);
    assert.equal(inspectBuffer(changedBuf).status, 'prompt_changed');
    assert.throws(() => applyLsStepsPatch({ lsPath: changedPath, metaFile }), /已变更/);
    assert.equal(sha256(fs.readFileSync(changedPath)), changedSha);

    // 2. not_found
    const missingPath = path.join(dir, 'missing.exe');
    const { buf: missingBuf } = makeSyntheticBinary({
      overrides: { [t2.id]: 'Completely unrelated string without anchor.' },
    });
    fs.writeFileSync(missingPath, missingBuf);
    const missingSha = sha256(missingBuf);
    assert.equal(inspectBuffer(missingBuf).status, 'not_found');
    assert.throws(() => applyLsStepsPatch({ lsPath: missingPath, metaFile }), /未在/);
    assert.equal(sha256(fs.readFileSync(missingPath)), missingSha);

    // 3. ambiguous
    const dupPath = path.join(dir, 'dup.exe');
    const { buf: dupBuf } = makeSyntheticBinary({ repeatTargetId: TARGETS[1].id });
    fs.writeFileSync(dupPath, dupBuf);
    const dupSha = sha256(dupBuf);
    assert.equal(inspectBuffer(dupBuf).status, 'ambiguous');
    assert.throws(() => applyLsStepsPatch({ lsPath: dupPath, metaFile }), /多处候选位置/);
    assert.equal(sha256(fs.readFileSync(dupPath)), dupSha);

    // 4. overlapsWebZip
    const zipOverlapPath = path.join(dir, 'zip-overlap.exe');
    const { buf: zipOverlapBuf } = makeSyntheticBinary({
      overrides: { [t2.id]: 'UNRELATED_SKIP_OUTSIDE_ZIP' },
      putTargetInZip: t2.id,
    });
    fs.writeFileSync(zipOverlapPath, zipOverlapBuf);
    const zipOverlapSha = sha256(zipOverlapBuf);
    const zipSt = inspectBuffer(zipOverlapBuf);
    assert.equal(zipSt.overlapsWebZip, true);
    assert.throws(() => applyLsStepsPatch({ lsPath: zipOverlapPath, metaFile }), /ZIP 重叠/);
    assert.equal(sha256(fs.readFileSync(zipOverlapPath)), zipOverlapSha);
  });
});

test('dryRun: true 仅校验且不修改目标文件、不写 meta', () => {
  withTempWorkspace((dir) => {
    const lsPath = path.join(dir, 'language_server.exe');
    const metaFile = path.join(dir, 'language_server.steps-meta.json');
    const { buf: origBuf } = makeSyntheticBinary();
    fs.writeFileSync(lsPath, origBuf);
    const origSha = sha256(origBuf);

    const res = applyLsStepsPatch({ lsPath, metaFile, version: '2.34.0', dryRun: true });
    assert.equal(res.changed, false);
    assert.equal(res.wouldChange, true);
    assert.equal(res.status, 'unpatched');
    assert.equal(sha256(fs.readFileSync(lsPath)), origSha);
    assert.equal(fs.existsSync(metaFile), false);
  });
});

test('双补丁共存测试：与 agy-zh-title 任意顺序注入及任意顺序独立还原互不干扰且完全可逆', () => {
  withTempWorkspace((dir) => {
    const lsPath = path.join(dir, 'language_server.exe');
    const titleMeta = path.join(dir, 'language_server.title-meta.json');
    const stepsMeta = path.join(dir, 'language_server.steps-meta.json');
    const { buf: origBuf } = makeSyntheticBinary({ includeTitlePrompt: true });
    const origSha = sha256(origBuf);

    // 场景 A：先打 title 再打 steps → 单独还原 title（验证 steps 仍 patched）→ 再还原 steps
    fs.writeFileSync(lsPath, origBuf);
    applyLsTitlePatch({ lsPath, metaFile: titleMeta, version: '2.34.0' });
    applyLsStepsPatch({ lsPath, metaFile: stepsMeta, version: '2.34.0' });

    assert.equal(inspectLsTitleState(lsPath, titleMeta).status, 'patched');
    assert.equal(inspectLsStepsState(lsPath, stepsMeta).status, 'patched');

    const resTitleFirst = restoreLsTitlePatch({ lsPath, metaFile: titleMeta, version: '2.34.0' });
    assert.equal(resTitleFirst.changed, true);
    assert.equal(inspectLsTitleState(lsPath, titleMeta).status, 'unpatched');
    assert.equal(inspectLsStepsState(lsPath, stepsMeta).status, 'patched');

    const resStepsSecond = restoreLsStepsPatch({ lsPath, metaFile: stepsMeta, version: '2.34.0' });
    assert.equal(resStepsSecond.changed, true);
    assert.equal(sha256(fs.readFileSync(lsPath)), origSha);

    // 场景 B：先打 steps 再打 title → 单独还原 steps（验证 title 仍 patched）→ 再还原 title
    applyLsStepsPatch({ lsPath, metaFile: stepsMeta, version: '2.34.0' });
    applyLsTitlePatch({ lsPath, metaFile: titleMeta, version: '2.34.0' });

    assert.equal(inspectLsStepsState(lsPath, stepsMeta).status, 'patched');
    assert.equal(inspectLsTitleState(lsPath, titleMeta).status, 'patched');

    const resStepsFirst = restoreLsStepsPatch({ lsPath, metaFile: stepsMeta, version: '2.34.0' });
    assert.equal(resStepsFirst.changed, true);
    assert.equal(inspectLsStepsState(lsPath, stepsMeta).status, 'unpatched');
    assert.equal(inspectLsTitleState(lsPath, titleMeta).status, 'patched');

    // 验证 TITLE_PATCHED_PROMPT 在单独还原 steps 后仍完整保留
    assert.ok(fs.readFileSync(lsPath).includes(Buffer.from(TITLE_PATCHED_PROMPT, 'utf8')));

    const resTitleSecond = restoreLsTitlePatch({ lsPath, metaFile: titleMeta, version: '2.34.0' });
    assert.equal(resTitleSecond.changed, true);
    assert.equal(sha256(fs.readFileSync(lsPath)), origSha);
  });
});
