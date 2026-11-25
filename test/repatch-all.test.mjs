import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { TEMP_ROOT } from '../agy-zh-cn/patcher/lib/app.mjs';
import {
  ALL_PATCH_IDS,
  PATCH_REGISTRY,
  checkRemoteUpdate,
  extractListArg,
  normalizePatchId,
  performRemoteUpdate,
  resolveSelectedPatches,
} from '../repatch-all.mjs';
import {
  RUNTIME_FILES,
  inspectPlugin,
  installPlugin,
  uninstallPlugin,
} from '../agy-compact-retitle/scripts/install-plugin.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('PATCH_REGISTRY 注册完整 9 项补丁且 ID 唯一', () => {
  assert.equal(PATCH_REGISTRY.length, 9);
  assert.equal(new Set(ALL_PATCH_IDS).size, 9);
  assert.ok(ALL_PATCH_IDS.includes('compact-retitle'));
  assert.equal(PATCH_REGISTRY.find((p) => p.id === 'compact-retitle')?.needsRestart, false);
});

test('normalizePatchId 支持短 ID 与 agy- 前缀，非法 ID 明确报错', () => {
  assert.equal(normalizePatchId('zh-cn'), 'zh-cn');
  assert.equal(normalizePatchId('agy-zh-cn'), 'zh-cn');
  assert.equal(normalizePatchId(' AGY-WIN-NOTIFY '), 'win-notify');
  assert.throws(() => normalizePatchId(''), /不能为空/);
  assert.throws(() => normalizePatchId('non-existent'), /未知补丁 ID/);
});

test('resolveSelectedPatches 支持 --only / --exclude 筛选与互斥/空集校验', () => {
  assert.deepEqual(resolveSelectedPatches(), ALL_PATCH_IDS);
  assert.deepEqual(
    resolveSelectedPatches({ only: 'agy-compact-retitle, zh-cn' }),
    ['zh-cn', 'compact-retitle'],
  );
  assert.deepEqual(
    resolveSelectedPatches({ exclude: ['zh-steps', 'agy-zh-title'] }),
    ALL_PATCH_IDS.filter((id) => id !== 'zh-steps' && id !== 'zh-title'),
  );
  assert.throws(
    () => resolveSelectedPatches({ only: 'zh-cn', exclude: 'win-notify' }),
    /不能同时使用/,
  );
  assert.throws(() => resolveSelectedPatches({ only: '' }), /未选中任何有效补丁/);
  assert.throws(() => resolveSelectedPatches({ exclude: ALL_PATCH_IDS }), /为空/);
});

test('extractListArg 兼容空格传参、等号传参及重复参数', () => {
  assert.equal(extractListArg(['patch'], '--only'), undefined);
  assert.deepEqual(extractListArg(['patch', '--only', 'zh-cn,win-notify'], '--only'), ['zh-cn,win-notify']);
  assert.deepEqual(extractListArg(['patch', '--only=zh-cn,win-notify'], '--only'), ['zh-cn,win-notify']);
  assert.deepEqual(extractListArg(['--only', 'zh-cn', '--only=compact-retitle'], '--only'), ['zh-cn', 'compact-retitle']);
  assert.throws(() => extractListArg(['patch', '--only'], '--only'), /缺少补丁 ID 列表/);
});

test('compact-retitle inspectPlugin / installPlugin / uninstallPlugin 生命周期（含目录联接识别）', (t) => {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
  const tempBase = fs.mkdtempSync(path.join(TEMP_ROOT, 'repatch-plugin-test-'));
  t.after(() => fs.rmSync(tempBase, { recursive: true, force: true }));

  const dest = path.join(tempBase, 'agy-compact-retitle');

  const initSt = inspectPlugin(dest);
  assert.equal(initSt.status, 'not_installed');
  assert.equal(initSt.installed, false);
  assert.equal(initSt.missingFiles.length, RUNTIME_FILES.length);

  const instRes = installPlugin(dest);
  assert.equal(instRes.files.length, RUNTIME_FILES.length);
  const afterInst = inspectPlugin(dest);
  assert.equal(afterInst.status, 'installed');
  assert.equal(afterInst.installed, true);
  assert.deepEqual(afterInst.missingFiles, []);
  assert.deepEqual(afterInst.outdatedFiles, []);

  // 篡改其中一个已部署文件，应识别为 outdated
  const hookFile = path.join(dest, 'hooks.json');
  fs.writeFileSync(hookFile, '{"tampered":true}\n');
  const outdatedSt = inspectPlugin(dest);
  assert.equal(outdatedSt.status, 'outdated');
  assert.equal(outdatedSt.installed, false);
  assert.deepEqual(outdatedSt.outdatedFiles, ['hooks.json']);

  // 重新安装覆盖后恢复 installed
  installPlugin(dest);
  assert.equal(inspectPlugin(dest).status, 'installed');

  // 卸载后再检查回到 not_installed
  const rmRes = uninstallPlugin(dest);
  assert.equal(rmRes.removed, true);
  assert.equal(inspectPlugin(dest).status, 'not_installed');
  assert.equal(uninstallPlugin(dest).removed, false);

  // 模拟 Windows 目录联接（junction），应识别为 junction 且卸载时绝不误删源码目录
  const srcRoot = path.join(ROOT_DIR, 'agy-compact-retitle');
  fs.symlinkSync(srcRoot, dest, 'junction');
  const junctionSt = inspectPlugin(dest);
  assert.equal(junctionSt.status, 'junction');
  assert.equal(junctionSt.installed, false);
  const rmJunc = uninstallPlugin(dest);
  assert.equal(rmJunc.removed, true);
  assert.equal(fs.existsSync(path.join(srcRoot, 'plugin.json')), true);
});

test('子进程运行 node repatch-all.mjs check --json 返回合法 JSON 且包含全部 9 项补丁状态', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT_DIR, 'repatch-all.mjs'), 'check', '--json'], {
    encoding: 'utf8',
    cwd: ROOT_DIR,
  });
  const parsed = JSON.parse(out);
  assert.ok(parsed.version);
  assert.ok(parsed.patches && typeof parsed.patches === 'object');
  for (const id of ALL_PATCH_IDS) {
    assert.ok(parsed.patches[id], `缺少 patches.${id}`);
    assert.equal(typeof parsed.patches[id].installed, 'boolean');
    assert.equal(typeof parsed.patches[id].status, 'string');
  }
});

function gitRun(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

test('checkRemoteUpdate 与 performRemoteUpdate 在本地裸仓库完整闭环（含脏工作区保护）', (t) => {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
  const tempBase = fs.mkdtempSync(path.join(TEMP_ROOT, 'repatch-git-test-'));
  t.after(() => fs.rmSync(tempBase, { recursive: true, force: true }));

  const nonGitDir = path.join(tempBase, 'plain');
  fs.mkdirSync(nonGitDir, { recursive: true });
  assert.equal(checkRemoteUpdate({ cwd: nonGitDir }).status, 'not_git');

  const bareDir = path.join(tempBase, 'remote.git');
  const seedDir = path.join(tempBase, 'seed');
  const clientDir = path.join(tempBase, 'client');

  fs.mkdirSync(bareDir, { recursive: true });
  gitRun(bareDir, ['init', '--bare']);

  gitRun(tempBase, ['clone', bareDir, seedDir]);
  gitRun(seedDir, ['config', 'user.email', 'test@example.com']);
  gitRun(seedDir, ['config', 'user.name', 'Test User']);
  gitRun(seedDir, ['checkout', '-b', 'main']);
  fs.writeFileSync(path.join(seedDir, 'README.md'), 'v1\n');
  gitRun(seedDir, ['add', 'README.md']);
  gitRun(seedDir, ['commit', '-m', 'Initial v1']);
  gitRun(seedDir, ['push', '-u', 'origin', 'main']);

  gitRun(tempBase, ['clone', '--branch', 'main', bareDir, clientDir]);
  const st0 = checkRemoteUpdate({ cwd: clientDir });
  assert.equal(st0.status, 'up_to_date');
  assert.equal(st0.branch, 'main');
  assert.equal(st0.dirty, false);

  // 上游推入新提交
  fs.writeFileSync(path.join(seedDir, 'README.md'), 'v2\n');
  gitRun(seedDir, ['add', 'README.md']);
  gitRun(seedDir, ['commit', '-m', 'Release v2']);
  gitRun(seedDir, ['push', 'origin', 'main']);

  const stBehind = checkRemoteUpdate({ cwd: clientDir });
  assert.equal(stBehind.status, 'behind');
  assert.equal(stBehind.behind, 1);
  assert.equal(stBehind.commits[0].subject, 'Release v2');

  // 本地存在未提交改动时应返回 dirty_behind，且 performRemoteUpdate 拒绝覆盖
  fs.writeFileSync(path.join(clientDir, 'README.md'), 'local-dirty\n');
  const stDirty = checkRemoteUpdate({ cwd: clientDir });
  assert.equal(stDirty.status, 'dirty_behind');
  assert.equal(stDirty.dirty, true);

  const blocked = performRemoteUpdate({ cwd: clientDir, autoInstallDeps: false });
  assert.equal(blocked.status, 'dirty_behind');
  assert.equal(fs.readFileSync(path.join(clientDir, 'README.md'), 'utf8'), 'local-dirty\n');

  // 还原脏改动后正常 fast-forward 拉取
  gitRun(clientDir, ['checkout', '--', 'README.md']);
  const updated = performRemoteUpdate({ cwd: clientDir, autoInstallDeps: false });
  assert.equal(updated.status, 'updated');
  assert.equal(updated.pulledCount, 1);
  assert.notEqual(updated.newHead, updated.oldHead);
  assert.equal(fs.readFileSync(path.join(clientDir, 'README.md'), 'utf8').trim(), 'v2');
  assert.equal(checkRemoteUpdate({ cwd: clientDir }).status, 'up_to_date');
});
