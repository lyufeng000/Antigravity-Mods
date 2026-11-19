// patch / restore / check 的端到端测试：用一个伪造的安装目录，不碰真实安装
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const PATCHER = path.resolve(here, '..');
const BASE = fs.existsSync('D:\\Data\\.temp') ? 'D:\\Data\\.temp\\agy-zh' : path.join(os.tmpdir(), 'agy-zh');
const ROOT = path.join(BASE, `test-${process.pid}`);
const INSTALL = path.join(ROOT, 'install');
const ASAR = path.join(INSTALL, 'resources', 'app.asar');
const DICT = path.join(here, 'fixtures', 'mini-dict.json');
const env = {
  ...process.env, AGY_INSTALL_DIR: INSTALL, AGY_ZH_TEMP: path.join(ROOT, 'work'), AGY_ZH_BACKUP_DIR: path.join(ROOT, 'backup'),
};
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const run = (script, ...args) => spawnSync(process.execPath, [path.join(PATCHER, script), ...args], { env, encoding: 'utf8' });
// @electron/asar 按路径缓存包头，文件被替换后必须清缓存
const preloadOf = (f) => { asar.uncacheAll(); return asar.extractFile(f, 'dist/preload.js').toString('utf8'); };
const marks = (s) => s.split('/*AGY-ZH-BEGIN*/').length - 1;
const ORIGINAL_PRELOAD = '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nconst electron_1 = require("electron");\n';
let origHash;

before(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  const src = path.join(ROOT, 'src');
  const w = (rel, s) => { const f = path.join(src, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
  w('package.json', '{\n  "name": "antigravity",\n  "productName": "Antigravity",\n  "version": "9.9.9",\n  "main": "dist/main.js"\n}\n');
  w('dist/preload.js', ORIGINAL_PRELOAD);
  w('dist/main.js', 'console.log("main");\n');
  w('node_modules/chrome-devtools-mcp/package.json', '{"name":"chrome-devtools-mcp"}');
  w('node_modules/chrome-devtools-mcp/build/index.js', 'module.exports = 1;\n');
  w('node_modules/chrome-devtools-mcp/.hidden/x.txt', 'dot\n');
  w('node_modules/other/index.js', 'module.exports = 2;\n');
  // 在子进程里打包：@electron/asar 写完后句柄释放时机不确定，在 Windows 上会让之后的 rename 覆盖失败
  const b = src.split(path.sep).join('/');
  const unpack = `{${b}/node_modules/chrome-devtools-mcp/**,${b}/node_modules/chrome-devtools-mcp/.hidden/x.txt}`;
  const mk = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import * as asar from '@electron/asar'; await asar.createPackageWithOptions(${JSON.stringify(src)}, ${JSON.stringify(ASAR)}, { unpack: ${JSON.stringify(unpack)} });`],
  { cwd: PATCHER, encoding: 'utf8' });
  assert.equal(mk.status, 0, mk.stderr);
  origHash = sha(ASAR);
});
after(() => { fs.rmSync(ROOT, { recursive: true, force: true }); });

test('patch --dry-run：在临时目录完成注入与校验，不改安装目录', () => {
  const r = run('patch.mjs', '--dry-run', '--dict', DICT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /校验通过/);
  assert.equal(sha(ASAR), origHash, '安装目录的 app.asar 不应被修改');
  assert.ok(!fs.existsSync(path.join(ROOT, 'backup')), 'dry-run 不应创建备份');
  const out = path.join(ROOT, 'work', 'dry', 'out', 'app.asar');
  assert.equal(marks(preloadOf(out)), 1);
  assert.ok(fs.existsSync(path.join(ROOT, 'work', 'patch.log')));
});

test('patch：真实注入（伪安装目录）、备份唯一、重复注入保持幂等、unpacked 标记一致', () => {
  const r1 = run('patch.mjs', '--dict', DICT);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  const once = preloadOf(ASAR);
  assert.equal(marks(once), 1);
  assert.ok(once.startsWith(ORIGINAL_PRELOAD.trimEnd()));
  const backups = fs.readdirSync(path.join(ROOT, 'backup'));
  assert.deepEqual(backups, ['app.asar.9.9.9']);
  assert.equal(sha(path.join(ROOT, 'backup', backups[0])), origHash);

  const r2 = run('patch.mjs', '--dict', DICT);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  const twice = preloadOf(ASAR);
  assert.equal(marks(twice), 1, '注入块只能出现一次');
  assert.equal(twice, once, '重复注入结果应完全一致');
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'backup')), ['app.asar.9.9.9']);
  assert.equal(sha(path.join(ROOT, 'backup', 'app.asar.9.9.9')), origHash, '备份不应被已打补丁的文件覆盖');

  const hdr = asar.getRawHeader(ASAR).header;
  const cdm = hdr.files.node_modules.files['chrome-devtools-mcp'].files;
  assert.equal(cdm['package.json'].unpacked, true);
  assert.equal(cdm.build.files['index.js'].unpacked, true);
  assert.equal(cdm['.hidden'].files['x.txt'].unpacked, true);
  assert.ok(!hdr.files.node_modules.files.other.files['index.js'].unpacked);
  // 安装目录里的 app.asar.unpacked 保持原样，仍被新包头引用
  assert.equal(fs.readFileSync(path.join(`${ASAR}.unpacked`, 'node_modules', 'chrome-devtools-mcp', 'build', 'index.js'), 'utf8'), 'module.exports = 1;\n');
  assert.ok(!fs.readdirSync(path.join(ROOT, 'work')).some((d) => d.startsWith('work-')), '真实模式的工作目录应清理');
});

test('注入后的 preload 在页面里能实际翻译', async () => {
  const code = preloadOf(ASAR);
  const block = code.slice(code.indexOf('/*AGY-ZH-BEGIN*/'));
  const dom = new JSDOM('<!doctype html><html><head><title>Settings</title></head><body><button>Background Tasks</button><span>3 files changed</span><pre>Settings</pre></body></html>', { runScripts: 'outside-only' });
  dom.window.eval(block);
  const doc = dom.window.document;
  if (doc.readyState === 'loading') await new Promise((r) => doc.addEventListener('DOMContentLoaded', r, { once: true }));
  assert.equal(doc.querySelector('button').textContent, '后台任务');
  assert.equal(doc.querySelector('span').textContent, '已更改 3 个文件');
  assert.equal(doc.querySelector('pre').textContent, 'Settings');
  assert.equal(doc.title, '设置');
});

test('check：报告版本、补丁状态、备份与词典条数', () => {
  const r = run('check.mjs', '--dict', DICT, '--json');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.version, '9.9.9');
  assert.equal(j.patched, true);
  assert.equal(j.backup[0].matches, true);
  assert.equal(j.dict.exact.keep, 1);
  assert.ok(j.dict.exact.translated > 5);
});

test('restore：还原为原件；版本不一致时提示无需还原', () => {
  const r = run('restore.mjs');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(sha(ASAR), origHash);
  assert.match(run('restore.mjs').stdout, /未打补丁，无需还原/);

  // 模拟自动更新：再打补丁，然后把备份改成旧版本号
  assert.equal(run('patch.mjs', '--dict', DICT).status, 0);
  fs.renameSync(path.join(ROOT, 'backup', 'app.asar.9.9.9'), path.join(ROOT, 'backup', 'app.asar.1.0.0'));
  const r2 = run('restore.mjs');
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /已被自动更新覆盖，无需还原/);
});
