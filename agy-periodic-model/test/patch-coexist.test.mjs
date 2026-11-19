import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MARK_BEGIN, MARK_END, ANY_PATCH_RE, PRELOAD_SCRIPT } from '../patcher/lib/common.mjs';
import { buildPeriodicModelBlock, stripPeriodicModelBlock } from '../patcher/patch.mjs';

test('补丁块语法正确、可幂等剥离，且与汉化/周额度/文件菜单/Tokens 四补丁无冲突共存', () => {
  const basePreload = 'const electron = require("electron");\n'
    + '/*AGY-ZH-BEGIN*/\nvoid 0;\n/*AGY-ZH-END*/\n'
    + '/*AGY-QUOTA-BEGIN*/\nvoid 0;\n/*AGY-QUOTA-END*/\n'
    + '/*AGY-FILE-MENU-BEGIN*/\nvoid 0;\n/*AGY-FILE-MENU-END*/\n'
    + '/*AGY-TOKEN-METER-BEGIN*/\nvoid 0;\n/*AGY-TOKEN-METER-END*/\n';

  const block = buildPeriodicModelBlock(PRELOAD_SCRIPT);
  assert.ok(ANY_PATCH_RE.test(block), '新补丁标记块应被 ANY_PATCH_RE 识别');

  const injected = basePreload + block;
  assert.equal(injected.split(MARK_BEGIN).length - 1, 1);
  assert.equal(injected.split(MARK_END).length - 1, 1);

  const tmpFile = path.join(os.tmpdir(), `agy-periodic-test-${process.pid}.js`);
  try {
    fs.writeFileSync(tmpFile, injected, 'utf8');
    execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe' });
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }

  const stripped = stripPeriodicModelBlock(injected);
  assert.ok(!stripped.includes(MARK_BEGIN));
  assert.ok(!stripped.includes(MARK_END));
  assert.ok(stripped.includes('/*AGY-ZH-BEGIN*/'));
  assert.ok(stripped.includes('/*AGY-QUOTA-BEGIN*/'));
  assert.ok(stripped.includes('/*AGY-FILE-MENU-BEGIN*/'));
  assert.ok(stripped.includes('/*AGY-TOKEN-METER-BEGIN*/'));
});
