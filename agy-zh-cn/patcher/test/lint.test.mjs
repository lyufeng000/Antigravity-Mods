// lint-dict 测试：小词典零错误、坏词典逐项报错、单复数后缀放行、术语表解析
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintDict, parseGlossary } from '../lib/lint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PATCHER = path.resolve(here, '..');
const GLOSS = fs.readFileSync(path.resolve(PATCHER, '..', 'i18n', 'glossary.md'), 'utf8');
const lint = (exact, patterns = {}, meta = {}) => lintDict({ meta, exact, patterns }, GLOSS);
const msgs = (r) => r.issues.filter((i) => i.level === 'error').map((i) => i.msg).join('\n');

test('CLI：fixtures 小词典零错误，退出码 0', () => {
  const r = spawnSync(process.execPath, [path.join(PATCHER, 'lint-dict.mjs'), '--dict', path.join(here, 'fixtures', 'mini-dict.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /错误 0，警告 0/);
});

test('CLI：坏词典有错误，退出码 1', () => {
  const r = spawnSync(process.execPath, [path.join(PATCHER, 'lint-dict.mjs'), '--dict', path.join(here, 'fixtures', 'bad-dict.json')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /错误 1\d，/);
});

test('术语表解析：拆分 " / "、去掉括号限定、识别多义与保留原文', () => {
  const t = Object.fromEntries(parseGlossary(GLOSS).map((x) => [x.en, x]));
  assert.deepEqual(t.Archived.zh, ['已归档']);
  assert.deepEqual(t['Sign out'].zh, ['退出登录']);
  assert.equal(t.Plan.amb, true);
  assert.equal(t.Run.amb, true);
  assert.equal(t.Worker.amb, true);
  assert.equal(t.Commit.amb, false);
  assert.equal(t.Commit.keep, 'Commit');
  assert.deepEqual(t.Conversation.forbid, ['会话']);
  assert.ok(!('New X' in t) && !('Toggle X' in t));
});

test('占位符、硬标识、空格与标点', () => {
  assert.match(msgs(lint({}, { '{0} of {1}': '{0} 个' })), /占位符不一致/);
  assert.match(msgs(lint({ 'Open in Chrome': '在浏览器中打开' })), /硬标识“Chrome”/);
  assert.match(msgs(lint({ 'Use `npm run dev`': '使用开发命令' })), /硬标识“npm run dev”/);
  assert.match(msgs(lint({ 'Toggle sidebar (Ctrl+B)': '切换侧边栏' })), /硬标识“Ctrl\+B”/);
  assert.match(msgs(lint({ 'Saving...': '正在保存...' })), /省略号/);
  assert.match(msgs(lint({ 'Open MCP settings': '打开MCP设置' })), /半角空格/);
  assert.match(msgs(lint({ 'Done.': '完成 。' })), /全角标点两侧/);
  assert.equal(lint({ 'Open MCP settings': '打开 MCP 设置' }).errors, 0);
});

test('术语一致性：强校验报错、多义降级为警告、长词条覆盖短词条、lintIgnore', () => {
  assert.match(msgs(lint({ 'Delete conversation': '删除会话' })), /不应译为“会话”/);
  assert.match(msgs(lint({ 'Install plugin': '安装扩展程序' })), /“Plugin”应译为“插件”/);
  assert.match(msgs(lint({ 'Show diffs': '显示 Diffs' })), /单数/);
  assert.match(msgs(lint({ 'New worktree': '新建工作树' })), /工作树|Worktree/);
  const amb = lint({ 'Upgrade plan': '升级方案' });
  assert.equal(amb.errors, 0);
  assert.ok(amb.warnings >= 1);
  assert.equal(lint({ 'Open aux pane': '打开辅助面板' }).errors, 0); // "Pane"被"Aux pane"覆盖
  assert.equal(lint({ 'Running {0} tasks': '正在运行 {0} 个任务' }).errors, 0);
  const ig = lint({ 'Install plugin': '安装扩展程序' }, {}, { lintIgnore: ['Install plugin'] });
  assert.equal(ig.errors, 0);
  // lintIgnore 同样把空格类错误降级为警告（{n} 自带首尾空格的情况），但占位符不一致仍报错
  const sp = lint({}, { 'Continue{0}': '继续{0}', 'Submit {0}': '提交' }, { lintIgnore: ['Continue{0}', 'Submit {0}'] });
  assert.equal(sp.errors, 1, msgs(sp));
  assert.match(msgs(sp), /占位符不一致/);
  assert.ok(sp.issues.some((i) => i.level === 'warn' && /半角空格/.test(i.msg)));
});

test('单复数后缀 {n}：译文省略时放行，单数复数同一条', () => {
  const r = lint({}, {
    '{0} tool{1} enabled': '已启用 {0} 个 Tool',
    'Push {0} commit{1} to {2}': '将 {0} 个 Commit 推送到 {2}',
  });
  assert.equal(r.errors, 0, msgs(r));
  // 不紧贴单词末尾的占位符不能省略
  assert.match(msgs(lint({}, { 'Push {0} to {1}': '推送 {0}' })), /占位符不一致/);
});

test('残留英文与原样照抄给出警告', () => {
  const r = lint({ 'Open the settings page now': 'Open the settings page now' });
  assert.ok(r.issues.some((i) => i.level === 'warn' && /残留大段英文/.test(i.msg)));
});
