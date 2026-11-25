import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MARK_BEGIN, MARK_END, MAIN_MARK_BEGIN, MAIN_MARK_END, ANY_PATCH_RE, PRELOAD_SCRIPT, MAIN_IPC_SCRIPT,
} from '../patcher/lib/common.mjs';
import {
  buildPeriodicModelBlock, stripPeriodicModelBlock,
  buildMainPeriodicModelBlock, stripMainPeriodicModelBlock,
} from '../patcher/patch.mjs';

test('补丁块语法正确、可幂等剥离，且与汉化/周额度/文件菜单/Tokens 四补丁在 preload 与 main 中无冲突共存', () => {
  const basePreload = 'const electron = require("electron");\n'
    + '/*AGY-ZH-BEGIN*/\nvoid 0;\n/*AGY-ZH-END*/\n'
    + '/*AGY-QUOTA-BEGIN*/\nvoid 0;\n/*AGY-QUOTA-END*/\n'
    + '/*AGY-FILE-MENU-BEGIN*/\nvoid 0;\n/*AGY-FILE-MENU-END*/\n'
    + '/*AGY-TOKEN-METER-BEGIN*/\nvoid 0;\n/*AGY-TOKEN-METER-END*/\n';

  const block = buildPeriodicModelBlock(PRELOAD_SCRIPT);
  assert.ok(ANY_PATCH_RE.test(block), '新 preload 补丁标记块应被 ANY_PATCH_RE 识别');

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

  // main.js 主进程块语法与共存幂等校验
  const baseMain = 'const electron = require("electron");\n'
    + '/*AGY-QUOTA-MAIN-BEGIN*/\nvoid 0;\n/*AGY-QUOTA-MAIN-END*/\n'
    + '/*AGY-FILE-MENU-MAIN-BEGIN*/\nvoid 0;\n/*AGY-FILE-MENU-MAIN-END*/\n'
    + '/*AGY-TOKEN-METER-MAIN-BEGIN*/\nvoid 0;\n/*AGY-TOKEN-METER-MAIN-END*/\n';
  const tmpStore = path.join(os.tmpdir(), `agy-pm-equiv-${process.pid}.json`);
  const mainBlock = buildMainPeriodicModelBlock(MAIN_IPC_SCRIPT, tmpStore);
  assert.ok(ANY_PATCH_RE.test(mainBlock), '新 main 补丁标记块应被 ANY_PATCH_RE 识别');

  const injectedMain = baseMain + mainBlock;
  assert.equal(injectedMain.split(MAIN_MARK_BEGIN).length - 1, 1);
  assert.equal(injectedMain.split(MAIN_MARK_END).length - 1, 1);

  const tmpMainFile = path.join(os.tmpdir(), `agy-periodic-main-test-${process.pid}.js`);
  try {
    fs.writeFileSync(tmpMainFile, injectedMain, 'utf8');
    execFileSync(process.execPath, ['--check', tmpMainFile], { stdio: 'pipe' });
  } finally {
    fs.rmSync(tmpMainFile, { force: true });
  }

  const strippedMain = stripMainPeriodicModelBlock(injectedMain);
  assert.ok(!strippedMain.includes(MAIN_MARK_BEGIN));
  assert.ok(!strippedMain.includes(MAIN_MARK_END));
  assert.ok(strippedMain.includes('/*AGY-QUOTA-MAIN-BEGIN*/'));
  assert.ok(strippedMain.includes('/*AGY-FILE-MENU-MAIN-BEGIN*/'));
  assert.ok(strippedMain.includes('/*AGY-TOKEN-METER-MAIN-BEGIN*/'));
});
