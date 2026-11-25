// agy-win-notify 独立补丁、幂等重打、按块剥离（与汉化/文件菜单共存）及 preload 字节不变验证
// 使用临时目录中的伪客户端与 fixture，不触碰真实客户端安装目录与真实备份池。
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
  MAIN_MARK_BEGIN, MAIN_MARK_END, ANY_PATCH_RE,
} from '../patcher/lib/common.mjs';
import {
  stripMainWinNotifyBlock, buildMainWinNotifyBlock,
} from '../patcher/patch.mjs';

const asar = loadDep('@electron/asar');

const here = path.dirname(fileURLToPath(import.meta.url));
const WIN_NOTIFY_PATCHER = path.resolve(here, '../patcher');
const ANTIGRAVITY_ROOT = path.resolve(here, '../..');
const ZH_PATCHER = path.join(ANTIGRAVITY_ROOT, 'agy-zh-cn', 'patcher');
const FILE_MENU_PATCHER = path.join(ANTIGRAVITY_ROOT, 'agy-file-menu', 'patcher');
const MINI_DICT = path.join(ZH_PATCHER, 'test', 'fixtures', 'mini-dict.json');

const BASE = fs.existsSync('D:\\Data\\.temp') ? 'D:\\Data\\.temp\\agy-win-notify' : path.join(os.tmpdir(), 'agy-win-notify');
const ROOT = path.join(BASE, `coexist-test-${process.pid}`);
const INSTALL = path.join(ROOT, 'install');
const ASAR = path.join(INSTALL, 'resources', 'app.asar');
const BACKUP = path.join(ROOT, 'shared-backup');
const FIXTURE_DIR = path.join(ROOT, 'fixtures');
const FIXTURE_FILE_MENU_PRELOAD = path.join(FIXTURE_DIR, 'file-menu-preload.fixture.js');
const FIXTURE_FILE_MENU_MAIN = path.join(FIXTURE_DIR, 'file-menu-main.fixture.js');

const env = {
  ...process.env,
  AGY_INSTALL_DIR: INSTALL,
  AGY_BACKUP_DIR: BACKUP,
  AGY_ZH_BACKUP_DIR: BACKUP,
  AGY_FILE_MENU_BACKUP_DIR: BACKUP,
  AGY_WIN_NOTIFY_BACKUP_DIR: BACKUP,
  AGY_FILE_MENU_PRELOAD_SCRIPT: FIXTURE_FILE_MENU_PRELOAD,
  AGY_FILE_MENU_MAIN_SCRIPT: FIXTURE_FILE_MENU_MAIN,
  AGY_ZH_TEMP: path.join(ROOT, 'work-zh'),
  AGY_FILE_MENU_TEMP: path.join(ROOT, 'work-file-menu'),
  AGY_WIN_NOTIFY_TEMP: path.join(ROOT, 'work-win-notify'),
};

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const shaBuf = (b) => crypto.createHash('sha256').update(b).digest('hex');
const runNode = (script, ...args) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
const preloadBufOf = (f) => { asar.uncacheAll?.(); return asar.extractFile(f, 'dist/preload.js'); };
const mainOf = (f) => { asar.uncacheAll?.(); return asar.extractFile(f, 'dist/main.js').toString('utf8'); };
const count = (s, sub) => s.split(sub).length - 1;

const ORIGINAL_PRELOAD = '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n';
const ORIGINAL_MAIN = '"use strict";\nconsole.log("antigravity-main");\n';
let origHash;
let origPreloadSha;

before(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  fs.writeFileSync(FIXTURE_FILE_MENU_PRELOAD, '(function () { globalThis.__FM_PRELOAD__ = true; })();\n');
  fs.writeFileSync(FIXTURE_FILE_MENU_MAIN, '(function () { globalThis.__FM_MAIN__ = true; })();\n');

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
  origPreloadSha = shaBuf(Buffer.from(ORIGINAL_PRELOAD, 'utf8'));
});

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('1. buildMainWinNotifyBlock 与 stripMainWinNotifyBlock 契约及标记防呆', () => {
  assert.equal(MAIN_MARK_BEGIN, '/*AGY-WIN-NOTIFY-MAIN-BEGIN*/');
  assert.equal(MAIN_MARK_END, '/*AGY-WIN-NOTIFY-MAIN-END*/');
  assert.ok(ANY_PATCH_RE.test(MAIN_MARK_BEGIN));

  const block = buildMainWinNotifyBlock();
  assert.ok(block.includes(MAIN_MARK_BEGIN));
  assert.ok(block.includes(MAIN_MARK_END));
  assert.equal(stripMainWinNotifyBlock('const a = 1;\n' + block), 'const a = 1;\n');
  assert.equal(stripMainWinNotifyBlock('const a = 1;' + block), 'const a = 1;');
  assert.equal(stripMainWinNotifyBlock('const a = 1;\n'), 'const a = 1;\n');

  const badScript = path.join(FIXTURE_DIR, 'bad-mark.js');
  fs.writeFileSync(badScript, `// ${MAIN_MARK_BEGIN}\nvoid 0;\n`);
  assert.throws(() => buildMainWinNotifyBlock(badScript), /不应包含注入起止标记/);
});

test('2. 独立 patch --dry-run / patch / 幂等重打 / check --json / restore 与 preload 字节不变', () => {
  const dry = runNode(path.join(WIN_NOTIFY_PATCHER, 'patch.mjs'), '--dry-run');
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.equal(sha(ASAR), origHash, 'dry-run 不得修改 app.asar');

  const p1 = runNode(path.join(WIN_NOTIFY_PATCHER, 'patch.mjs'));
  assert.equal(p1.status, 0, p1.stdout + p1.stderr);
  assert.equal(shaBuf(preloadBufOf(ASAR)), origPreloadSha, '独立注入后 dist/preload.js 必须字节完全不变');
  assert.equal(count(mainOf(ASAR), MAIN_MARK_BEGIN), 1);

  // 重复执行 patch.mjs 保持幂等（标记恰好 1 处）
  const p2 = runNode(path.join(WIN_NOTIFY_PATCHER, 'patch.mjs'));
  assert.equal(p2.status, 0, p2.stdout + p2.stderr);
  assert.equal(count(mainOf(ASAR), MAIN_MARK_BEGIN), 1);
  assert.equal(shaBuf(preloadBufOf(ASAR)), origPreloadSha);

  const chk = runNode(path.join(WIN_NOTIFY_PATCHER, 'check.mjs'), '--json');
  assert.equal(chk.status, 0, chk.stderr);
  const st = JSON.parse(chk.stdout);
  assert.equal(st.winNotifyPatched, true);
  assert.equal(st.version, '9.9.9');
  assert.equal(st.backup.length, 1);
  assert.equal(st.backup[0].matches, true);

  const res = runNode(path.join(WIN_NOTIFY_PATCHER, 'restore.mjs'));
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(sha(ASAR), origHash, '独立 restore 必须精确还原原包 SHA-256');
  assert.equal(shaBuf(preloadBufOf(ASAR)), origPreloadSha);
});

test('3. 与 agy-zh-cn 和 agy-file-menu 共存时，单独 restore 仅剥离 AGY-WIN-NOTIFY-MAIN 块', () => {
  // 依次注入 汉化 -> 文件菜单 -> 通知修复
  const zh = runNode(path.join(ZH_PATCHER, 'patch.mjs'), '--dict', MINI_DICT);
  assert.equal(zh.status, 0, zh.stdout + zh.stderr);

  const fm = runNode(path.join(FILE_MENU_PATCHER, 'patch.mjs'));
  assert.equal(fm.status, 0, fm.stdout + fm.stderr);

  const wn = runNode(path.join(WIN_NOTIFY_PATCHER, 'patch.mjs'));
  assert.equal(wn.status, 0, wn.stdout + wn.stderr);

  const preloadMid = preloadBufOf(ASAR).toString('utf8');
  const mainMid = mainOf(ASAR);
  assert.equal(count(preloadMid, '/*AGY-ZH-BEGIN*/'), 1);
  assert.equal(count(preloadMid, '/*AGY-FILE-MENU-BEGIN*/'), 1);
  assert.equal(count(mainMid, '/*AGY-FILE-MENU-MAIN-BEGIN*/'), 1);
  assert.equal(count(mainMid, MAIN_MARK_BEGIN), 1);

  // 单独还原 agy-win-notify：只能剥离自身块，保留汉化与文件菜单
  const wnRestore = runNode(path.join(WIN_NOTIFY_PATCHER, 'restore.mjs'));
  assert.equal(wnRestore.status, 0, wnRestore.stdout + wnRestore.stderr);

  const preloadAfter = preloadBufOf(ASAR).toString('utf8');
  const mainAfter = mainOf(ASAR);
  assert.equal(count(preloadAfter, '/*AGY-ZH-BEGIN*/'), 1);
  assert.equal(count(preloadAfter, '/*AGY-FILE-MENU-BEGIN*/'), 1);
  assert.equal(count(mainAfter, '/*AGY-FILE-MENU-MAIN-BEGIN*/'), 1);
  assert.equal(count(mainAfter, MAIN_MARK_BEGIN), 0);

  // 清理剩余补丁后也应能完整回到原包 SHA-256
  assert.equal(runNode(path.join(FILE_MENU_PATCHER, 'restore.mjs')).status, 0);
  assert.equal(runNode(path.join(ZH_PATCHER, 'restore.mjs')).status, 0);
  assert.equal(sha(ASAR), origHash);
});
