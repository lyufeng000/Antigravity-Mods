// 四项目补丁（agy-zh-cn + agy-weekly-quota + agy-file-menu + agy-token-meter）共存、按块卸载、幂等注入与 repatch-all.mjs 端到端测试
// 使用临时目录中的伪客户端与 fixture 脚本，不触碰真实客户端安装目录与真实备份池。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDep } from '../patcher/lib/deps.mjs';
import {
  MARK_BEGIN, MARK_END, MAIN_MARK_BEGIN, MAIN_MARK_END, ANY_PATCH_RE,
} from '../patcher/lib/common.mjs';
import {
  stripTokenMeterBlock, stripMainTokenMeterBlock, buildTokenMeterBlock, buildMainTokenMeterBlock,
} from '../patcher/patch.mjs';

const asar = loadDep('@electron/asar');

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_METER_PATCHER = path.resolve(here, '../patcher');
const ANTIGRAVITY_ROOT = path.resolve(here, '../..');
const QUOTA_PATCHER = path.join(ANTIGRAVITY_ROOT, 'agy-weekly-quota', 'patcher');
const FILE_MENU_PATCHER = path.join(ANTIGRAVITY_ROOT, 'agy-file-menu', 'patcher');
const ZH_PATCHER = path.join(ANTIGRAVITY_ROOT, 'agy-zh-cn', 'patcher');
const MINI_DICT = path.join(ZH_PATCHER, 'test', 'fixtures', 'mini-dict.json');
const REPATCH_ALL = path.join(ANTIGRAVITY_ROOT, 'repatch-all.mjs');

const BASE = fs.existsSync('D:\\Data\\.temp') ? 'D:\\Data\\.temp\\agy-token-meter' : path.join(os.tmpdir(), 'agy-token-meter');
const ROOT = path.join(BASE, `coexist-test-${process.pid}`);
const INSTALL = path.join(ROOT, 'install');
const ASAR = path.join(INSTALL, 'resources', 'app.asar');
const BACKUP = path.join(ROOT, 'shared-backup');
const FIXTURE_DIR = path.join(ROOT, 'fixtures');
const FIXTURE_PRELOAD = path.join(FIXTURE_DIR, 'token-meter-preload.fixture.js');
const FIXTURE_MAIN_IPC = path.join(FIXTURE_DIR, 'token-meter-main-ipc.fixture.js');

const env = {
  ...process.env,
  AGY_INSTALL_DIR: INSTALL,
  AGY_BACKUP_DIR: BACKUP,
  AGY_ZH_BACKUP_DIR: BACKUP,
  AGY_QUOTA_BACKUP_DIR: BACKUP,
  AGY_FILE_MENU_BACKUP_DIR: BACKUP,
  AGY_TOKEN_METER_BACKUP_DIR: BACKUP,
  AGY_QUOTA_CONFIG_FILE: path.join(ROOT, 'accounts.json'),
  AGY_TOKEN_METER_PRELOAD_SCRIPT: FIXTURE_PRELOAD,
  AGY_TOKEN_METER_MAIN_SCRIPT: FIXTURE_MAIN_IPC,
  AGY_ZH_TEMP: path.join(ROOT, 'work-zh'),
  AGY_QUOTA_TEMP: path.join(ROOT, 'work-quota'),
  AGY_FILE_MENU_TEMP: path.join(ROOT, 'work-file-menu'),
  AGY_TOKEN_METER_TEMP: path.join(ROOT, 'work-token-meter'),
  AGY_REPATCH_TEMP: path.join(ROOT, 'work-repatch'),
};

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const runNode = (script, ...args) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
const preloadOf = (f) => { asar.uncacheAll?.(); return asar.extractFile(f, 'dist/preload.js').toString('utf8'); };
const mainOf = (f) => { asar.uncacheAll?.(); return asar.extractFile(f, 'dist/main.js').toString('utf8'); };
const count = (s, sub) => s.split(sub).length - 1;

const ORIGINAL_PRELOAD = '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n';
const ORIGINAL_MAIN = '"use strict";\nconsole.log("antigravity-main");\n';
let origHash;

before(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  fs.writeFileSync(
    FIXTURE_PRELOAD,
    '(function () {\n'
      + '  if (globalThis.__AGY_TOKEN_METER_BOOTED__) return;\n'
      + '  Object.defineProperty(globalThis, "__AGY_TOKEN_METER_BOOTED__", { value: true });\n'
      + '})();\n',
  );
  fs.writeFileSync(
    FIXTURE_MAIN_IPC,
    '(function () {\n'
      + '  if (globalThis.__AGY_TOKEN_METER_MAIN_BOOTED__) return;\n'
      + '  Object.defineProperty(globalThis, "__AGY_TOKEN_METER_MAIN_BOOTED__", { value: true });\n'
      + '})();\n',
  );

  const src = path.join(ROOT, 'fake-src');
  fs.mkdirSync(path.join(src, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ productName: 'Antigravity', version: '2.99.0' }));
  fs.writeFileSync(path.join(src, 'dist', 'preload.js'), ORIGINAL_PRELOAD);
  fs.writeFileSync(path.join(src, 'dist', 'main.js'), ORIGINAL_MAIN);
  fs.mkdirSync(path.dirname(ASAR), { recursive: true });
  const mk = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `import * as asar from '@electron/asar'; await asar.createPackage(${JSON.stringify(src)}, ${JSON.stringify(ASAR)});`],
    { cwd: ZH_PATCHER, encoding: 'utf8' },
  );
  assert.equal(mk.status, 0, mk.stderr);
  origHash = sha(ASAR);
});

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('构建与剥离实时 Tokens 注入块不伤及其他补丁块', () => {
  const blockP = buildTokenMeterBlock(FIXTURE_PRELOAD);
  const blockM = buildMainTokenMeterBlock(FIXTURE_MAIN_IPC);
  const mixedPreload = ORIGINAL_PRELOAD + '/*AGY-ZH-BEGIN*/const z=1;/*AGY-ZH-END*/' + blockP;
  const mixedMain = ORIGINAL_MAIN + '/*AGY-QUOTA-MAIN-BEGIN*/const q=1;/*AGY-QUOTA-MAIN-END*/' + blockM;
  const sP = stripTokenMeterBlock(mixedPreload);
  const sM = stripMainTokenMeterBlock(mixedMain);
  assert.ok(sP.includes('/*AGY-ZH-BEGIN*/') && !sP.includes(MARK_BEGIN));
  assert.ok(sM.includes('/*AGY-QUOTA-MAIN-BEGIN*/') && !sM.includes(MAIN_MARK_BEGIN));
});

test('四补丁依次叠加、单独剥离 agy-token-meter 与 repatch-all 四补丁联合编排', () => {
  let r = runNode(path.join(ZH_PATCHER, 'patch.mjs'), '--dict', MINI_DICT);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  r = runNode(path.join(QUOTA_PATCHER, 'patch.mjs'));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  r = runNode(path.join(FILE_MENU_PATCHER, 'patch.mjs'));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  r = runNode(path.join(TOKEN_METER_PATCHER, 'patch.mjs'));
  assert.equal(r.status, 0, r.stderr + r.stdout);

  const p1 = preloadOf(ASAR);
  const m1 = mainOf(ASAR);
  assert.equal(count(p1, '/*AGY-ZH-BEGIN*/'), 1);
  assert.equal(count(p1, '/*AGY-QUOTA-BEGIN*/'), 1);
  assert.equal(count(p1, '/*AGY-FILE-MENU-BEGIN*/'), 1);
  assert.equal(count(p1, MARK_BEGIN), 1);
  assert.equal(count(m1, '/*AGY-QUOTA-MAIN-BEGIN*/'), 1);
  assert.equal(count(m1, '/*AGY-FILE-MENU-MAIN-BEGIN*/'), 1);
  assert.equal(count(m1, MAIN_MARK_BEGIN), 1);

  // 仅卸载 agy-token-meter，其余三补丁完好
  r = runNode(path.join(TOKEN_METER_PATCHER, 'restore.mjs'));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const p2 = preloadOf(ASAR);
  const m2 = mainOf(ASAR);
  assert.equal(count(p2, '/*AGY-ZH-BEGIN*/'), 1);
  assert.equal(count(p2, '/*AGY-QUOTA-BEGIN*/'), 1);
  assert.equal(count(p2, '/*AGY-FILE-MENU-BEGIN*/'), 1);
  assert.equal(count(p2, MARK_BEGIN), 0);
  assert.equal(count(m2, MAIN_MARK_BEGIN), 0);

  // repatch-all 一键注入并 check 校验四补丁全绿
  r = runNode(REPATCH_ALL, 'patch', '--no-relaunch');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  r = runNode(REPATCH_ALL, 'check', '--json');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const st = JSON.parse(r.stdout);
  assert.equal(st.zhPatched, true);
  assert.equal(st.quotaPatched, true);
  assert.equal(st.fileMenuPatched, true);
  assert.equal(st.tokenMeterPatched, true);

  // repatch-all 完整还原
  r = runNode(REPATCH_ALL, 'restore', '--no-relaunch');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(sha(ASAR), origHash);
  assert.equal(ANY_PATCH_RE.test(preloadOf(ASAR)), false);
});
