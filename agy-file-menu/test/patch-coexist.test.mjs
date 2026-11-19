// 三项目补丁（agy-zh-cn + agy-weekly-quota + agy-file-menu）共存、按块卸载、幂等注入与 repatch-all.mjs 端到端测试
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
  stripFileMenuBlock, stripMainFileMenuBlock, buildFileMenuBlock, buildMainFileMenuBlock,
} from '../patcher/patch.mjs';

const asar = loadDep('@electron/asar');

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE_MENU_PATCHER = path.resolve(here, '../patcher');
const ANTIGRAVITY_ROOT = path.resolve(here, '../..');
const QUOTA_PATCHER = path.join(ANTIGRAVITY_ROOT, 'agy-weekly-quota', 'patcher');
const ZH_PATCHER = path.join(ANTIGRAVITY_ROOT, 'agy-zh-cn', 'patcher');
const MINI_DICT = path.join(ZH_PATCHER, 'test', 'fixtures', 'mini-dict.json');
const REPATCH_ALL = path.join(ANTIGRAVITY_ROOT, 'repatch-all.mjs');

const BASE = fs.existsSync('D:\\Data\\.temp') ? 'D:\\Data\\.temp\\agy-file-menu' : path.join(os.tmpdir(), 'agy-file-menu');
const ROOT = path.join(BASE, `coexist-test-${process.pid}`);
const INSTALL = path.join(ROOT, 'install');
const ASAR = path.join(INSTALL, 'resources', 'app.asar');
const BACKUP = path.join(ROOT, 'shared-backup');
const FIXTURE_DIR = path.join(ROOT, 'fixtures');
const FIXTURE_PRELOAD = path.join(FIXTURE_DIR, 'file-menu-preload.fixture.js');
const FIXTURE_MAIN_IPC = path.join(FIXTURE_DIR, 'file-menu-main-ipc.fixture.js');

const env = {
  ...process.env,
  AGY_INSTALL_DIR: INSTALL,
  AGY_BACKUP_DIR: BACKUP,
  AGY_ZH_BACKUP_DIR: BACKUP,
  AGY_QUOTA_BACKUP_DIR: BACKUP,
  AGY_FILE_MENU_BACKUP_DIR: BACKUP,
  AGY_QUOTA_CONFIG_FILE: path.join(ROOT, 'accounts.json'),
  AGY_FILE_MENU_PRELOAD_SCRIPT: FIXTURE_PRELOAD,
  AGY_FILE_MENU_MAIN_SCRIPT: FIXTURE_MAIN_IPC,
  AGY_ZH_TEMP: path.join(ROOT, 'work-zh'),
  AGY_QUOTA_TEMP: path.join(ROOT, 'work-quota'),
  AGY_FILE_MENU_TEMP: path.join(ROOT, 'work-file-menu'),
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

  // 使用 fixture 脚本测试注入与剥离，不依赖 src/ 下并行开发中的文件状态
  fs.writeFileSync(
    FIXTURE_PRELOAD,
    '(function () {\n'
      + '  if (globalThis.__AGY_FILE_MENU_BOOTED__) return;\n'
      + '  Object.defineProperty(globalThis, "__AGY_FILE_MENU_BOOTED__", { value: true });\n'
      + '  globalThis.__AGY_FILE_MENU_FIXTURE_RUNS__ = (globalThis.__AGY_FILE_MENU_FIXTURE_RUNS__ || 0) + 1;\n'
      + '})();\n',
  );
  fs.writeFileSync(
    FIXTURE_MAIN_IPC,
    '(function () {\n'
      + '  if (globalThis.__AGY_FILE_MENU_MAIN_BOOTED__) return;\n'
      + '  Object.defineProperty(globalThis, "__AGY_FILE_MENU_MAIN_BOOTED__", { value: true });\n'
      + '  globalThis.__AGY_FILE_MENU_MAIN_FIXTURE_RUNS__ = (globalThis.__AGY_FILE_MENU_MAIN_FIXTURE_RUNS__ || 0) + 1;\n'
      + '})();\n',
  );

  const src = path.join(ROOT, 'src');
  const w = (rel, s, mode) => {
    const f = path.join(src, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, s);
    if (mode) fs.chmodSync(f, mode);
  };
  w('package.json', '{\n  "name": "antigravity",\n  "productName": "Antigravity",\n  "version": "9.9.9",\n  "main": "dist/main.js"\n}\n');
  w('dist/preload.js', ORIGINAL_PRELOAD);
  w('dist/main.js', ORIGINAL_MAIN);
  w('node_modules/chrome-devtools-mcp/package.json', '{"name":"chrome-devtools-mcp"}');
  w('node_modules/chrome-devtools-mcp/build/index.js', 'module.exports = 1;\n');

  const b = src.split(path.sep).join('/');
  const unpack = `${b}/node_modules/chrome-devtools-mcp/**`;
  const mk = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `import * as asar from '@electron/asar'; await asar.createPackageWithOptions(${JSON.stringify(src)}, ${JSON.stringify(ASAR)}, { unpack: ${JSON.stringify(unpack)} });`],
    { cwd: ZH_PATCHER, encoding: 'utf8' },
  );
  assert.equal(mk.status, 0, mk.stderr);
  origHash = sha(ASAR);
});

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('构建与剥离纯函数契约：固定标记位、ANY_PATCH_RE 匹配、内嵌标记防呆与重复剥离幂等', () => {
  assert.equal(MARK_BEGIN, '/*AGY-FILE-MENU-BEGIN*/');
  assert.equal(MARK_END, '/*AGY-FILE-MENU-END*/');
  assert.equal(MAIN_MARK_BEGIN, '/*AGY-FILE-MENU-MAIN-BEGIN*/');
  assert.equal(MAIN_MARK_END, '/*AGY-FILE-MENU-MAIN-END*/');
  assert.ok(ANY_PATCH_RE.test(MARK_BEGIN));
  assert.ok(ANY_PATCH_RE.test(MAIN_MARK_BEGIN));

  const pBlock = buildFileMenuBlock(FIXTURE_PRELOAD);
  const mBlock = buildMainFileMenuBlock(FIXTURE_MAIN_IPC);
  assert.equal(count(pBlock, MARK_BEGIN), 1);
  assert.equal(count(pBlock, MARK_END), 1);
  assert.equal(count(mBlock, MAIN_MARK_BEGIN), 1);
  assert.equal(count(mBlock, MAIN_MARK_END), 1);

  const fakePreload = `${ORIGINAL_PRELOAD}\n/*AGY-ZH-BEGIN*/\nvoid 0;\n/*AGY-ZH-END*/\n/*AGY-QUOTA-BEGIN*/\nvoid 1;\n/*AGY-QUOTA-END*/${pBlock}${pBlock}`;
  const strippedP = stripFileMenuBlock(fakePreload);
  assert.equal(count(strippedP, MARK_BEGIN), 0);
  assert.equal(count(strippedP, MARK_END), 0);
  assert.equal(count(strippedP, '/*AGY-ZH-BEGIN*/'), 1);
  assert.equal(count(strippedP, '/*AGY-QUOTA-BEGIN*/'), 1);

  const fakeMain = `${ORIGINAL_MAIN}\n/*AGY-QUOTA-MAIN-BEGIN*/\nvoid 2;\n/*AGY-QUOTA-MAIN-END*/${mBlock}${mBlock}`;
  const strippedM = stripMainFileMenuBlock(fakeMain);
  assert.equal(count(strippedM, MAIN_MARK_BEGIN), 0);
  assert.equal(count(strippedM, MAIN_MARK_END), 0);
  assert.equal(count(strippedM, '/*AGY-QUOTA-MAIN-BEGIN*/'), 1);

  const badFixture = path.join(FIXTURE_DIR, 'bad-marker.js');
  fs.writeFileSync(badFixture, `var x = "${MARK_BEGIN}";\n`);
  assert.throws(() => buildFileMenuBlock(badFixture), /不应包含注入起止标记/);
});

test('分步叠加与重复幂等注入：汉化 + 周额度 + 文件菜单三补丁共存且标记不翻倍、共享备份不污染', () => {
  // 1. 注入汉化补丁
  const rZh = runNode(path.join(ZH_PATCHER, 'patch.mjs'), '--dict', MINI_DICT);
  assert.equal(rZh.status, 0, rZh.stdout + rZh.stderr);

  // 2. 注入周额度补丁
  const rQuota = runNode(path.join(QUOTA_PATCHER, 'patch.mjs'));
  assert.equal(rQuota.status, 0, rQuota.stdout + rQuota.stderr);

  // 3. 先执行 agy-file-menu dry-run，确认不会提前改动现有双补丁包
  const beforeFmHash = sha(ASAR);
  const rFmDry = runNode(path.join(FILE_MENU_PATCHER, 'patch.mjs'), '--dry-run');
  assert.equal(rFmDry.status, 0, rFmDry.stdout + rFmDry.stderr);
  assert.equal(sha(ASAR), beforeFmHash, 'dry-run 不应修改目标 app.asar');

  // 4. 正式注入文件右键菜单补丁，并连续重复注入验证幂等性（不翻倍）
  const rFm1 = runNode(path.join(FILE_MENU_PATCHER, 'patch.mjs'));
  assert.equal(rFm1.status, 0, rFm1.stdout + rFm1.stderr);
  const rFm2 = runNode(path.join(FILE_MENU_PATCHER, 'patch.mjs'));
  assert.equal(rFm2.status, 0, rFm2.stdout + rFm2.stderr);

  const preload = preloadOf(ASAR);
  const mainCode = mainOf(ASAR);
  assert.equal(count(preload, '/*AGY-ZH-BEGIN*/'), 1, '汉化 preload 块保留且唯一');
  assert.equal(count(preload, '/*AGY-QUOTA-BEGIN*/'), 1, '周额度 preload 块保留且唯一');
  assert.equal(count(preload, MARK_BEGIN), 1, '文件菜单 preload 块存在且唯一（重复注入不翻倍）');
  assert.equal(count(mainCode, '/*AGY-QUOTA-MAIN-BEGIN*/'), 1, '周额度 main 块保留且唯一');
  assert.equal(count(mainCode, MAIN_MARK_BEGIN), 1, '文件菜单 main 块存在且唯一（重复注入不翻倍）');

  // check.mjs JSON 输出校验
  const chk = runNode(path.join(FILE_MENU_PATCHER, 'check.mjs'), '--json');
  assert.equal(chk.status, 0, chk.stderr);
  const st = JSON.parse(chk.stdout);
  assert.equal(st.fileMenuPatched, true);
  assert.equal(st.zhPatched, true);
  assert.equal(st.quotaPatched, true);

  // 共享备份保持官方原包未污染
  const backups = fs.readdirSync(BACKUP);
  assert.deepEqual(backups, ['app.asar.9.9.9']);
  assert.equal(sha(path.join(BACKUP, 'app.asar.9.9.9')), origHash, '共享备份绝不能被已打补丁的包污染');
});

test('独立按块卸载：单独卸载文件菜单仅剥离自身双块并保留 AGY-ZH 与 AGY-QUOTA，三者全卸后字节级还原原包', () => {
  // 1. 单独卸载 agy-file-menu -> 必须保留汉化与周额度（含 main 配置桥）
  const uFm = runNode(path.join(FILE_MENU_PATCHER, 'restore.mjs'));
  assert.equal(uFm.status, 0, uFm.stdout + uFm.stderr);

  let preload = preloadOf(ASAR);
  let mainCode = mainOf(ASAR);
  assert.equal(count(preload, MARK_BEGIN), 0, 'preload 文件菜单块已剥离');
  assert.equal(count(mainCode, MAIN_MARK_BEGIN), 0, 'main 文件菜单块已剥离');
  assert.equal(count(preload, '/*AGY-ZH-BEGIN*/'), 1, '卸载文件菜单时必须保留汉化块');
  assert.equal(count(preload, '/*AGY-QUOTA-BEGIN*/'), 1, '卸载文件菜单时必须保留周额度 preload 块');
  assert.equal(count(mainCode, '/*AGY-QUOTA-MAIN-BEGIN*/'), 1, '卸载文件菜单时必须保留周额度 main 块');

  // 2. 重新打回文件菜单，再依次卸载汉化、周额度 -> 文件菜单仍完整保留
  assert.equal(runNode(path.join(FILE_MENU_PATCHER, 'patch.mjs')).status, 0);
  const uZh = runNode(path.join(ZH_PATCHER, 'restore.mjs'));
  assert.equal(uZh.status, 0, uZh.stdout + uZh.stderr);
  const uQuota = runNode(path.join(QUOTA_PATCHER, 'restore.mjs'));
  assert.equal(uQuota.status, 0, uQuota.stdout + uQuota.stderr);

  preload = preloadOf(ASAR);
  mainCode = mainOf(ASAR);
  assert.equal(count(preload, '/*AGY-ZH-BEGIN*/'), 0);
  assert.equal(count(preload, '/*AGY-QUOTA-BEGIN*/'), 0);
  assert.equal(count(mainCode, '/*AGY-QUOTA-MAIN-BEGIN*/'), 0);
  assert.equal(count(preload, MARK_BEGIN), 1, '其余补丁卸载后文件菜单 preload 块仍完整保留');
  assert.equal(count(mainCode, MAIN_MARK_BEGIN), 1, '其余补丁卸载后文件菜单 main 块仍完整保留');

  // 3. 卸载最后一个补丁（文件菜单） -> 直接从纯净备份精确恢复原包 SHA-256
  const uLast = runNode(path.join(FILE_MENU_PATCHER, 'restore.mjs'));
  assert.equal(uLast.status, 0, uLast.stdout + uLast.stderr);
  assert.equal(sha(ASAR), origHash, '三补丁全部卸载后必须与初始纯净原包 SHA-256 完全一致');
});

test('repatch-all.mjs 三补丁联合编排器：dry-only 预检、合并注入、重复幂等重打、状态检查与一键全量还原', () => {
  const chk0 = runNode(REPATCH_ALL, 'check', '--json');
  assert.equal(chk0.status, 0, chk0.stderr);
  const st0 = JSON.parse(chk0.stdout);
  assert.equal(st0.zhPatched, false);
  assert.equal(st0.quotaPatched, false);
  assert.equal(st0.fileMenuPatched, false);
  assert.equal(st0.anyPatched, false);

  // 1. --dry-only 预检不修改安装目录
  const dry = runNode(REPATCH_ALL, 'patch', '--dry-only', '--no-lint');
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.equal(sha(ASAR), origHash, '--dry-only 不得修改安装目录');

  // 2. 首次合并注入三补丁 + 再次合并重打三补丁（幂等性验证）
  const p1 = runNode(REPATCH_ALL, 'patch', '--no-relaunch', '--no-lint');
  assert.equal(p1.status, 0, p1.stdout + p1.stderr);
  const p2 = runNode(REPATCH_ALL, 'patch', '--no-relaunch', '--no-lint');
  assert.equal(p2.status, 0, p2.stdout + p2.stderr);

  const preload = preloadOf(ASAR);
  const mainCode = mainOf(ASAR);
  assert.equal(count(preload, '/*AGY-ZH-BEGIN*/'), 1);
  assert.equal(count(preload, '/*AGY-QUOTA-BEGIN*/'), 1);
  assert.equal(count(preload, MARK_BEGIN), 1);
  assert.equal(count(mainCode, '/*AGY-QUOTA-MAIN-BEGIN*/'), 1);
  assert.equal(count(mainCode, MAIN_MARK_BEGIN), 1);

  const chk1 = runNode(REPATCH_ALL, 'check', '--json');
  assert.equal(chk1.status, 0, chk1.stderr);
  const st1 = JSON.parse(chk1.stdout);
  assert.equal(st1.zhPatched, true);
  assert.equal(st1.quotaPatched, true);
  assert.equal(st1.fileMenuPatched, true);
  assert.equal(st1.anyPatched, true);
  assert.equal(st1.backups[0].matches, true);

  // 3. 一键全量还原官方纯净原包
  const r = runNode(REPATCH_ALL, 'restore', '--no-relaunch');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(sha(ASAR), origHash, 'repatch-all restore 后必须精确还原原包 SHA-256');
});
