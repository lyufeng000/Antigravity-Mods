// 双项目补丁无冲突共存、独立卸载还原与 repatch-all.mjs 端到端测试（伪安装目录，不触碰真实客户端）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDep } from '../patcher/lib/deps.mjs';

const asar = loadDep('@electron/asar');
const { JSDOM } = loadDep('jsdom');

const here = path.dirname(fileURLToPath(import.meta.url));
const QUOTA_PATCHER = path.resolve(here, '../patcher');
const ANTIGRAVITY_ROOT = path.resolve(here, '../..');
const ZH_PATCHER = path.join(ANTIGRAVITY_ROOT, 'agy-zh-cn', 'patcher');
const MINI_DICT = path.join(ZH_PATCHER, 'test', 'fixtures', 'mini-dict.json');
const REPATCH_ALL = path.join(ANTIGRAVITY_ROOT, 'repatch-all.mjs');

const BASE = fs.existsSync('D:\\Data\\.temp') ? 'D:\\Data\\.temp\\agy-quota' : path.join(os.tmpdir(), 'agy-quota');
const ROOT = path.join(BASE, `coexist-test-${process.pid}`);
const INSTALL = path.join(ROOT, 'install');
const ASAR = path.join(INSTALL, 'resources', 'app.asar');
const BACKUP = path.join(ROOT, 'shared-backup');

const env = {
  ...process.env,
  AGY_INSTALL_DIR: INSTALL,
  AGY_BACKUP_DIR: BACKUP,
  AGY_ZH_BACKUP_DIR: BACKUP,
  AGY_QUOTA_BACKUP_DIR: BACKUP,
  AGY_QUOTA_CONFIG_FILE: path.join(ROOT, 'accounts.json'),
  AGY_ZH_TEMP: path.join(ROOT, 'work-zh'),
  AGY_QUOTA_TEMP: path.join(ROOT, 'work-quota'),
  AGY_REPATCH_TEMP: path.join(ROOT, 'work-repatch'),
};

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const runNode = (script, ...args) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
const preloadOf = (f) => { asar.uncacheAll?.(); return asar.extractFile(f, 'dist/preload.js').toString('utf8'); };
const mainOf = (f) => { asar.uncacheAll?.(); return asar.extractFile(f, 'dist/main.js').toString('utf8'); };
const count = (s, sub) => s.split(sub).length - 1;

const ORIGINAL_PRELOAD = '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n';
let origHash;

before(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  const src = path.join(ROOT, 'src');
  const w = (rel, s) => { const f = path.join(src, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
  w('package.json', '{\n  "name": "antigravity",\n  "productName": "Antigravity",\n  "version": "9.9.9",\n  "main": "dist/main.js"\n}\n');
  w('dist/preload.js', ORIGINAL_PRELOAD);
  w('dist/main.js', 'console.log("main");\n');
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

test('分步叠加注入：汉化补丁 + 周额度补丁共存、共享纯净备份不污染、DOM 协同零冲突', async () => {
  // 1. 先打汉化补丁
  const rZh = runNode(path.join(ZH_PATCHER, 'patch.mjs'), '--dict', MINI_DICT);
  assert.equal(rZh.status, 0, rZh.stdout + rZh.stderr);

  // 2. 再打周额度补丁
  const rQuota = runNode(path.join(QUOTA_PATCHER, 'patch.mjs'));
  assert.equal(rQuota.status, 0, rQuota.stdout + rQuota.stderr);

  // 3. 重复打周额度补丁验证幂等性
  const rQuota2 = runNode(path.join(QUOTA_PATCHER, 'patch.mjs'));
  assert.equal(rQuota2.status, 0, rQuota2.stdout + rQuota2.stderr);

  const preload = preloadOf(ASAR);
  const mainCode = mainOf(ASAR);
  assert.equal(count(preload, '/*AGY-ZH-BEGIN*/'), 1, '汉化块保留且唯一');
  assert.equal(count(preload, '/*AGY-QUOTA-BEGIN*/'), 1, '周额度 preload 块存在且唯一');
  assert.equal(count(mainCode, '/*AGY-QUOTA-MAIN-BEGIN*/'), 1, '周额度 main 配置桥块存在且唯一');

  // 共享备份仍然是未经任何修改的官方纯净包
  const backups = fs.readdirSync(BACKUP);
  assert.deepEqual(backups, ['app.asar.9.9.9']);
  assert.equal(sha(path.join(BACKUP, 'app.asar.9.9.9')), origHash, '共享备份绝不能被已打补丁的包污染');

  // 在同一 JSDOM 页面内同时执行两个注入块，确认界面汉化与英文 Resets in 互不干扰
  const injected = preload.slice(preload.indexOf('/*AGY-ZH-BEGIN*/'));
  const dom = new JSDOM(
    '<!doctype html><html><head><title>Settings</title></head><body><div role="navigation"><div id="ft"><button data-testid="settings-button">Background Tasks</button></div></div></body></html>',
    { url: 'http://127.0.0.1:55123/', runScripts: 'outside-only', pretendToBeVisual: true },
  );
  dom.window.eval(injected);
  const ls = dom.window.__JETSKI_LS_CLIENT_DECORATOR__({
    getUserStatus: async () => ({ userStatus: { email: 'coexist@example.com' } }),
    retrieveUserQuotaSummary: async () => ({
      response: {
        groups: [{
          displayName: 'Gemini Models',
          buckets: [{ window: 'weekly', remainingFraction: 1, resetTime: { seconds: Math.floor((Date.now() + 86400_000 * 6 + 3600_000 * 23 + 1200_000) / 1000), nanos: 0 } }],
        }],
      },
    }),
  });
  await ls.getUserStatus({});
  await ls.retrieveUserQuotaSummary({});
  await new Promise((r) => setTimeout(r, 30));

  const doc = dom.window.document;
  assert.equal(doc.title, '设置', '汉化补丁正常生效');
  assert.equal(doc.querySelector('[data-testid="settings-button"]').textContent, '后台任务', '按钮汉化正常生效');
  const slot = doc.getElementById('agy-weekly-quota-slot');
  assert.ok(slot, '周额度插槽正常渲染');
  assert.equal(slot.querySelector('[data-role="pct"]').textContent, '剩余 100%');
  assert.equal(slot.querySelector('[data-role="reset"]').textContent, 'Resets in 6d 23h', '英文倒计时保持原样不被翻译破坏');
  dom.window.close();
});

test('独立按块卸载：单独卸载任一补丁均保留另一补丁，全部卸载后精确还原原包哈希', () => {
  // 1. 单独卸载周额度补丁 -> 保留汉化补丁，同时干净剥离 main.js 中的配置桥
  const uQuota = runNode(path.join(QUOTA_PATCHER, 'restore.mjs'));
  assert.equal(uQuota.status, 0, uQuota.stdout + uQuota.stderr);
  let preload = preloadOf(ASAR);
  assert.equal(count(preload, '/*AGY-QUOTA-BEGIN*/'), 0);
  assert.equal(count(mainOf(ASAR), '/*AGY-QUOTA-MAIN-BEGIN*/'), 0);
  assert.equal(count(preload, '/*AGY-ZH-BEGIN*/'), 1, '卸载周额度时必须保留汉化块');

  // 2. 重新打上周额度，然后单独卸载汉化补丁 -> 保留周额度补丁
  assert.equal(runNode(path.join(QUOTA_PATCHER, 'patch.mjs')).status, 0);
  const uZh = runNode(path.join(ZH_PATCHER, 'restore.mjs'));
  assert.equal(uZh.status, 0, uZh.stdout + uZh.stderr);
  preload = preloadOf(ASAR);
  assert.equal(count(preload, '/*AGY-ZH-BEGIN*/'), 0);
  assert.equal(count(preload, '/*AGY-QUOTA-BEGIN*/'), 1, '卸载汉化时必须保留周额度块');

  // 3. 再卸载最后一个补丁 -> 直接从纯净备份恢复字节级一致的原包
  const uLast = runNode(path.join(QUOTA_PATCHER, 'restore.mjs'));
  assert.equal(uLast.status, 0, uLast.stdout + uLast.stderr);
  assert.equal(sha(ASAR), origHash, '全部卸载后应与初始原包 SHA-256 完全一致');
});

test('repatch-all.mjs 统一编排器：单次解包同时注入双补丁、状态检查与一键全量还原', () => {
  // 模拟客户端升级为新版本 10.0.0（备份目录尚无 10.0.0 备份）
  const pkgUpdate = runNode(path.join(ANTIGRAVITY_ROOT, 'repatch-all.mjs'), 'check', '--json');
  assert.equal(pkgUpdate.status, 0, pkgUpdate.stderr);
  assert.equal(JSON.parse(pkgUpdate.stdout).anyPatched, false);

  // 一键合并注入双补丁（不校验生产大词典 lint 以加速单测，仍完整注入真实词典与插槽）
  const p = runNode(REPATCH_ALL, 'patch', '--no-relaunch', '--no-lint');
  assert.equal(p.status, 0, p.stdout + p.stderr);

  const chk = runNode(REPATCH_ALL, 'check', '--json');
  assert.equal(chk.status, 0, chk.stderr);
  const st = JSON.parse(chk.stdout);
  assert.equal(st.zhPatched, true);
  assert.equal(st.quotaPatched, true);
  assert.equal(st.backups[0].matches, true);

  // 一键完整还原官方原版
  const r = runNode(REPATCH_ALL, 'restore', '--no-relaunch');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(sha(ASAR), origHash);
});
