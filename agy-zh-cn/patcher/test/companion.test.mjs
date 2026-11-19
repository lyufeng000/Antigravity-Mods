// 配套脚本单元测试：scan-missed-static、collect-runtime-strings、merge-translations、launch-detached
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';

import { scanMissedStaticFromCode } from '../scan-missed-static.mjs';
import {
  parseRuntimeLines,
  extractRpcStrings,
  suggestPatternsForText,
  classifyRuntimeRecords,
} from '../collect-runtime-strings.mjs';
import { mergeTranslations } from '../merge-translations.mjs';
import { buildWorkerArgs, formatWmiCommandLine } from '../launch-detached.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PATCHER = path.resolve(here, '..');
const GLOSS = path.resolve(PATCHER, '..', 'i18n', 'glossary.md');
const BASE = fs.existsSync('D:\\Data\\.temp') ? 'D:\\Data\\.temp\\agy-zh' : path.join(os.tmpdir(), 'agy-zh');
const ROOT = path.join(BASE, `companion-test-${process.pid}`);

before(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
});

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('scanMissedStaticFromCode：识别 switch/case、枚举映射与提示调用，过滤技术噪声与已知词条', () => {
  const sample = `
    function statusLabel(s) {
      switch (s) {
        case 1: return "Waiting for review";
        case 2: return "Pending";
        case 3: return "Already Known";
        case 4: return "GET";
        default: return "flex items-center px-2";
      }
    }
    const BADGES = { a: "New", b: "Limited time", c: "Fast" };
    function notify() {
      yl("Copied to clipboard");
      yl(\`Deleted \${n} items\`);
      console.log("debug value here");
      fetch("https://example.com/api");
      el.classList.add("camelCaseToken");
    }
  `;
  const known = new Set(['Already Known', 'New']);
  const items = scanMissedStaticFromCode(sample, { knownSet: known, file: 'sample.js' });
  const map = new Map(items.map((x) => [x.en, x]));

  assert.ok(map.has('Waiting for review'));
  assert.ok(map.has('Pending'));
  assert.ok(map.has('Limited time'));
  assert.ok(map.has('Fast'));
  assert.ok(map.has('Copied to clipboard'));
  assert.ok(map.has('Deleted {0} items'));
  assert.equal(map.get('Deleted {0} items').pattern, true);

  assert.ok(!map.has('Already Known'));
  assert.ok(!map.has('New'));
  assert.ok(!map.has('GET'));
  assert.ok(!map.has('flex items-center px-2'));
  assert.ok(!map.has('debug value here'));
  assert.ok(!map.has('https://example.com/api'));
  assert.ok(!map.has('camelCaseToken'));
});

test('collect-runtime-strings：RPC 提取、模式建议与词典去重（含 pattern 匹配）', () => {
  const rpc = extractRpcStrings({
    userStatus: {
      userStatus: {
        cascadeModelConfigData: {
          clientModelConfigs: [
            { tagTitle: 'New', tagDescription: 'Carbon that may offload routine steps to Hydrogen.' },
            { tagTitle: 'Fast', tagDescription: 'Limited time' },
          ],
          clientModelSorts: [{ name: 'Recommended' }],
        },
      },
    },
    availableModels: {
      response: { models: { m1: { tagTitle: 'Notice', tagDescription: 'Will expire soon.' } } },
    },
    cascadeNuxes: {
      nuxes: [{ title: 'Creating a Project', body: 'Projects serve as your workspace.\n\nSearch with ![s](icon://search) here.' }],
    },
  });

  const clipLines = parseRuntimeLines(`
    [agy-zh] ignored header
    You have used some / your weekly limit, it will fully refresh in 6 days, 21 hours.
    You have used all of your daily limit, it will fully refresh in 4 hours, 10 minutes.
  `);
  assert.equal(clipLines.length, 2);

  const dict = {
    exact: { New: '新', Fast: null },
    patterns: {
      'You have used some / your weekly limit, it will fully refresh in {0}.': '你已用掉部分本周额度，将在 {0}后完全恢复。',
    },
  };
  const recs = [
    ...rpc,
    ...clipLines.map((en) => ({ en, source: 'clipboard' })),
  ];
  const classified = classifyRuntimeRecords(recs, dict);
  const missingSet = new Set(classified.missing.map((x) => x.en));

  assert.equal(classified.alreadyCovered >= 3, true);
  assert.ok(!missingSet.has('New'));
  assert.ok(!missingSet.has('Fast'));
  assert.ok(!missingSet.has('You have used some / your weekly limit, it will fully refresh in 6 days, 21 hours.'));
  assert.ok(missingSet.has('Notice'));
  assert.ok(missingSet.has('Creating a Project'));
  assert.ok(missingSet.has('Projects serve as your workspace.'));

  const sug = suggestPatternsForText('You have used all of your daily limit, it will fully refresh in 4 hours, 10 minutes.');
  assert.deepEqual(sug, [
    'You have used all of your daily limit, it will fully refresh in {0}.',
    '{0} hours, {1} minutes',
  ]);

  // 宽泛 pattern 保护与 translator.js 一致：不再把 Neon NUX 正文或 Turn on 误判为已覆盖
  const broadDict = {
    exact: {},
    patterns: {
      '{0} of {1}': '{0} / {1}',
      'Turn {0}': '第 {0} 轮',
      'On {0}': '位于 {0}',
    },
  };
  const broadRes = classifyRuntimeRecords([
    '1 of 10',
    '01:23 of 05:00',
    'Turn 3',
    'Our best balance of intelligence, cost, and latency. Get building today with Neon.',
    'Turn on notifications to stay updated.',
    'On November 30, 2026, GPT-OSS will be removed.',
  ], broadDict);
  const broadMissing = new Set(broadRes.missing.map((x) => x.en));
  assert.equal(broadRes.alreadyCovered, 3);
  assert.ok(broadMissing.has('Our best balance of intelligence, cost, and latency. Get building today with Neon.'));
  assert.ok(broadMissing.has('Turn on notifications to stay updated.'));
  assert.ok(broadMissing.has('On November 30, 2026, GPT-OSS will be removed.'));
});

test('mergeTranslations：路由 patterns/exact、保护 manualAdditions、去重元信息与 lint 门禁', () => {
  const base = {
    meta: { appVersion: '2.31.2', lintIgnore: [], manualAdditions: ['Working copy'] },
    exact: { 'Working copy': '工作副本', '{0} stale': '旧条目' },
    patterns: {},
  };
  const shardPayload = {
    items: [
      { en: 'Settings', zh: '设置' },
      { en: 'Working copy', zh: null }, // 不应覆盖手工非空条目
      { en: '{0} stale', zh: '{0} 个陈旧项' }, // 应迁移至 patterns 并删除 exact 里的残留
      { en: 'Pending item', zh: undefined }, // 未翻译应跳过
    ],
  };
  const mapPayload = {
    exact: { 'Fork conversation': 'Fork 对话' },
    lintIgnore: ['Working copy'],
  };

  const r = mergeTranslations(base, [shardPayload, mapPayload], {
    markManual: true,
    appVersion: '2.32.1',
  });
  assert.equal(r.dict.exact.Settings, '设置');
  assert.equal(r.dict.exact['Fork conversation'], 'Fork 对话');
  assert.equal(r.dict.exact['Working copy'], '工作副本');
  assert.equal(Object.hasOwn(r.dict.exact, '{0} stale'), false);
  assert.equal(r.dict.patterns['{0} stale'], '{0} 个陈旧项');
  assert.equal(r.dict.meta.appVersion, '2.32.1');
  assert.equal(r.stats.skippedManual, 1);
  assert.ok(r.dict.meta.manualAdditions.includes('Settings'));

  // CLI 门禁测试：脏词条应拒绝写入并返回退出码 1
  const dictFile = path.join(ROOT, 'dict.json');
  const dirtyFile = path.join(ROOT, 'dirty.json');
  fs.writeFileSync(dictFile, JSON.stringify({ meta: {}, exact: {}, patterns: {} }, null, 2));
  fs.writeFileSync(dirtyFile, JSON.stringify({ items: [{ en: 'Install plugin', zh: '安装扩展程序' }] }));

  const cliFail = spawnSync(
    process.execPath,
    [path.join(PATCHER, 'merge-translations.mjs'), dirtyFile, '--dict', dictFile, '--glossary', GLOSS],
    { encoding: 'utf8' }
  );
  assert.equal(cliFail.status, 1);
  assert.match(cliFail.stderr, /拒绝写入/);
  assert.deepEqual(JSON.parse(fs.readFileSync(dictFile, 'utf8')).exact, {});

  // 合法词条通过门禁并写入
  const goodFile = path.join(ROOT, 'good.json');
  fs.writeFileSync(goodFile, JSON.stringify({ items: [{ en: 'Install plugin', zh: '安装插件' }] }));
  const cliOk = spawnSync(
    process.execPath,
    [path.join(PATCHER, 'merge-translations.mjs'), goodFile, '--dict', dictFile, '--glossary', GLOSS],
    { encoding: 'utf8' }
  );
  assert.equal(cliOk.status, 0, cliOk.stderr + cliOk.stdout);
  assert.equal(JSON.parse(fs.readFileSync(dictFile, 'utf8')).exact['Install plugin'], '安装插件');
});

test('launch-detached：命令行组装与 --dry-only 预检端到端通过', async () => {
  const wArgs = buildWorkerArgs('patch', {
    scriptDir: PATCHER,
    pluginDir: 'C:\\tmp\\my plugin',
    dictPath: 'C:\\tmp\\my plugin\\i18n\\zh-CN.json',
    relaunch: true,
  });
  assert.ok(wArgs.includes('--wait-exit'));
  assert.ok(wArgs.includes('--relaunch'));
  const cmd = formatWmiCommandLine('C:\\Program Files\\nodejs\\node.exe', wArgs);
  assert.match(cmd, /^"C:\\Program Files\\nodejs\\node\.exe" /);
  assert.match(cmd, /"C:\\tmp\\my plugin"/);

  // 造一个极简伪安装目录跑 launch-detached.mjs --dry-only
  const fakeRoot = path.join(ROOT, 'fake-install');
  const srcDir = path.join(ROOT, 'fake-src');
  fs.mkdirSync(path.join(srcDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'package.json'), '{"name":"antigravity","productName":"Antigravity","version":"2.32.1"}');
  fs.writeFileSync(path.join(srcDir, 'dist', 'preload.js'), '"use strict";\n');
  const fakeAsar = path.join(fakeRoot, 'resources', 'app.asar');
  fs.mkdirSync(path.dirname(fakeAsar), { recursive: true });
  await asar.createPackage(srcDir, fakeAsar);

  const miniDict = path.join(here, 'fixtures', 'mini-dict.json');
  const r = spawnSync(
    process.execPath,
    [path.join(PATCHER, 'launch-detached.mjs'), 'patch', '--dry-only', '--dict', miniDict, '--glossary', GLOSS],
    {
      encoding: 'utf8',
      env: { ...process.env, AGY_INSTALL_DIR: fakeRoot, AGY_ZH_TEMP: path.join(ROOT, 'tmp-work') },
    }
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /预检 1\/2/);
  assert.match(r.stdout, /预检 2\/2/);
  assert.match(r.stdout, /--dry-only/);
});
