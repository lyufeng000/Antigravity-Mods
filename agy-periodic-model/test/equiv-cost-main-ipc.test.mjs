// 等效月 API 费用主进程统计模块单测：
// 1. 订阅档位识别与 Ultra/Pro 严格不混合；
// 2. 每打开 Antigravity 一次每个邮箱最多计算 1 次；
// 3. 高精度小数 remainingFraction 增量与多账号时间线归属、排除 3P 模型；
// 4. 先按邮箱各自求均值再跨邮箱平均；
// 5. 保留最近 20 次记录上限；
// 6. 重置周期、小波动防抖与手动锁价保护。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../src/periodic-model-main-ipc.js';

const api = globalThis.__AGY_PERIODIC_MODEL_MAIN_API__;
const BASE = fs.existsSync('D:\\Data\\.temp')
  ? 'D:\\Data\\.temp\\agy-periodic-model-test'
  : path.join(os.tmpdir(), 'agy-periodic-model-test');

function makeSandbox(t, name) {
  const root = path.join(BASE, `${name}-${process.pid}-${Math.random().toString(36).slice(2, 7)}`);
  const brainDir = path.join(root, 'brain');
  const storeFile = path.join(root, 'equiv-api-cost.json');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(brainDir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, brainDir, storeFile };
}

function appendTranscript(brainDir, convId, entries) {
  const dir = path.join(brainDir, convId, '.system_generated', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.appendFileSync(path.join(dir, 'transcript.jsonl'), content, 'utf8');
}

test('classifyAccountTier 准确区分 Ultra / Pro / Free / unknown', () => {
  assert.deepEqual(
    api.classifyAccountTier({ userTier: { id: 'g1-ultra-tier', name: 'Google AI Ultra' } }),
    { tier: 'ultra', tierName: 'Google AI Ultra' },
  );
  assert.deepEqual(
    api.classifyAccountTier({ g1Tier: 'g1-pro-tier', planInfo: { planName: 'Google AI Pro' } }),
    { tier: 'pro', tierName: 'g1-pro-tier' },
  );
  assert.deepEqual(
    api.classifyAccountTier({ planStatus: { planInfo: { teamsTier: 'TEAMS_TIER_PRO_ULTIMATE' } } }),
    { tier: 'ultra', tierName: 'Ultra' },
  );
  assert.deepEqual(
    api.classifyAccountTier({ userTier: { id: 'free-tier', name: 'Free' } }),
    { tier: 'free', tierName: 'Free' },
  );
  assert.deepEqual(api.classifyAccountTier({}), { tier: 'unknown', tierName: '' });
});

test('每次打开 Agy 仅算 1 次、按时间线归属、排除 Claude/GPT、先按邮箱均值再跨邮箱平均、Ultra/Pro 绝不混合', () => {
  const { brainDir, storeFile } = makeSandbox(test, 'tier-isolation');
  const t0 = new Date('2026-11-20T00:00:00.000Z').getTime();
  const resetMs = t0 + 7 * 86400 * 1000;

  // 第 1 次打开：三个邮箱分别建基线（两个 Ultra + 一个 Pro）
  let now = t0;
  const s1 = api.createEquivCostStore({ storeFile, brainDir, launchId: 'launch-1', nowFn: () => now });
  s1.reportUser({ email: 'u1@gmail.com', tier: 'ultra', tierName: 'Google AI Ultra', ts: t0 });
  s1.reportQuota({ email: 'u1@gmail.com', remainingFraction: 1.0, resetTimeMs: resetMs, ts: t0 });

  now = t0 + 1000;
  s1.reportUser({ email: 'u2@gmail.com', tier: 'ultra', tierName: 'Google AI Ultra', ts: now });
  s1.reportQuota({ email: 'u2@gmail.com', remainingFraction: 0.9, resetTimeMs: resetMs, ts: now });

  now = t0 + 2000;
  s1.reportUser({ email: 'p1@gmail.com', tier: 'pro', tierName: 'Google AI Pro', ts: now });
  s1.reportQuota({ email: 'p1@gmail.com', remainingFraction: 1.0, resetTimeMs: resetMs, ts: now });

  // 切回 u1 后再运行 u1 的对话（符合真实时间线：当前登录是 u1）
  now = t0 + 3000;
  s1.reportUser({ email: 'u1@gmail.com', tier: 'ultra', tierName: 'Google AI Ultra', ts: now });

  // 在 t0 + 1h ~ t0 + 2h：u1 用 Gemini 4 Neon 跑了 $10，同时用 Claude 跑了 $50（3P 应排除）
  // 1M output @ $12/M => $12；或 500k output ($6) + 2M input ($4) = $10
  appendTranscript(brainDir, 'conv-u1', [
    {
      type: 'PLANNER_RESPONSE',
      model: 'gemini-4-neon-xhigh',
      input_tokens: 2_000_000,
      cache_read_tokens: 0,
      output_tokens: 500_000,
      created_at: new Date(t0 + 3600_000).toISOString(),
    },
    {
      type: 'PLANNER_RESPONSE',
      model: 'claude-opus-5-5-high',
      input_tokens: 1_000_000,
      cache_read_tokens: 0,
      output_tokens: 1_000_000,
      created_at: new Date(t0 + 3700_000).toISOString(),
    },
  ]);

  // 同一 launch-1 内再次收到 u1 的 quota，不得重复结算或改动基线
  now = t0 + 3800_000;
  const resSameLaunch = s1.reportQuota({ email: 'u1@gmail.com', remainingFraction: 0.9, resetTimeMs: resetMs, ts: now });
  assert.equal(resSameLaunch.totalRecords, 0, '同一次打开 Agy 对同一邮箱不得重复计算');

  // 第 2 次打开 Agy（launch-2）：
  // 1) u1 从 1.0 降到 0.9（delta = 0.1），cost = $10 -> 周等效 = $100 -> 月等效 = $100 * 30 / 7 = $428.57
  now = t0 + 4000_000;
  const s2 = api.createEquivCostStore({ storeFile, brainDir, launchId: 'launch-2', nowFn: () => now });
  s2.reportUser({ email: 'u1@gmail.com', tier: 'ultra', tierName: 'Google AI Ultra', ts: now });
  const afterU1 = s2.reportQuota({ email: 'u1@gmail.com', remainingFraction: 0.9, resetTimeMs: resetMs, ts: now });
  assert.equal(afterU1.totalRecords, 1);
  assert.ok(Math.abs(afterU1.avgMonthlyUsd - (100 * 30 / 7)) < 0.05);

  // 同 launch-2 再次上报 u1（比如点击刷新按钮降到 0.85）不得重复计算
  const afterU1Refresh = s2.reportQuota({ email: 'u1@gmail.com', remainingFraction: 0.85, resetTimeMs: resetMs, ts: now + 5000 });
  assert.equal(afterU1Refresh.totalRecords, 1, '同一次打开点击刷新额度不触发二次计算');

  // 2) u2 运行 $14（Neon 1M input $2 + 1M output $12 = $14），从 0.9 降到 0.8（delta = 0.1）
  now = t0 + 5000_000;
  s2.reportUser({ email: 'u2@gmail.com', tier: 'ultra', tierName: 'Google AI Ultra', ts: now });
  appendTranscript(brainDir, 'conv-u2', [
    {
      type: 'PLANNER_RESPONSE',
      model: 'gemini-4-neon-high',
      input_tokens: 1_000_000,
      cache_read_tokens: 0,
      output_tokens: 1_000_000,
      created_at: new Date(t0 + 5100_000).toISOString(),
    },
  ]);
  // 第 3 次打开结算 u2 -> 周等效 $140 -> 月等效 $140 * 30 / 7 = $600
  now = t0 + 6000_000;
  const s3 = api.createEquivCostStore({ storeFile, brainDir, launchId: 'launch-3', nowFn: () => now });
  s3.reportUser({ email: 'u2@gmail.com', tier: 'ultra', tierName: 'Google AI Ultra', ts: now });
  const afterU2 = s3.reportQuota({ email: 'u2@gmail.com', remainingFraction: 0.8, resetTimeMs: resetMs, ts: now });
  const expectedU1 = Math.round((100 * 30 / 7) * 100) / 100;
  const expectedU2 = Math.round((140 * 30 / 7) * 100) / 100;
  const expectedUltraMean = Math.round(((expectedU1 + expectedU2) / 2) * 100) / 100;
  assert.equal(afterU2.activeTier, 'ultra');
  assert.equal(afterU2.accountBreakdown.length, 2);
  assert.ok(Math.abs(afterU2.avgMonthlyUsd - expectedUltraMean) < 0.05);

  // 3) Pro 账号 p1 消耗 $3，从 1.0 降到 0.8（delta = 0.2）-> 周等效 $15 -> 月等效 $15 * 30 / 7 = $64.29
  now = t0 + 7000_000;
  s3.reportUser({ email: 'p1@gmail.com', tier: 'pro', tierName: 'Google AI Pro', ts: now });
  appendTranscript(brainDir, 'conv-p1', [
    {
      type: 'PLANNER_RESPONSE',
      model: 'gemini-4-hydrogen-xhigh',
      input_tokens: 0,
      cache_read_tokens: 0,
      output_tokens: 1_000_000, // Hydrogen output $3/M
      created_at: new Date(t0 + 7100_000).toISOString(),
    },
  ]);
  now = t0 + 8000_000;
  const s4 = api.createEquivCostStore({ storeFile, brainDir, launchId: 'launch-4', nowFn: () => now });
  s4.reportUser({ email: 'p1@gmail.com', tier: 'pro', tierName: 'Google AI Pro', ts: now });
  const proState = s4.reportQuota({ email: 'p1@gmail.com', remainingFraction: 0.8, resetTimeMs: resetMs, ts: now });
  const expectedPro = Math.round((15 * 30 / 7) * 100) / 100;
  assert.equal(proState.activeTier, 'pro');
  assert.equal(proState.accountBreakdown.length, 1, 'Pro 视角绝不能混入 Ultra 账号');
  assert.ok(Math.abs(proState.avgMonthlyUsd - expectedPro) < 0.05);

  // 切回 Ultra 账号 u1（未刷新新记录），显示仍是 Ultra 均值，绝不混入 Pro
  const ultraViewAgain = s4.reportUser({ email: 'u1@gmail.com', tier: 'ultra', tierName: 'Google AI Ultra', ts: now + 1000 });
  assert.equal(ultraViewAgain.activeTier, 'ultra');
  assert.equal(ultraViewAgain.accountBreakdown.length, 2);
  assert.ok(Math.abs(ultraViewAgain.avgMonthlyUsd - expectedUltraMean) < 0.05);
});

test('先按邮箱各自求平均再跨邮箱平均（不因单邮箱采样次数多而拉偏权重），且只保留最近 20 次记录', () => {
  const { brainDir, storeFile } = makeSandbox(test, 'rolling-20');
  const t0 = new Date('2026-11-01T00:00:00.000Z').getTime();
  const resetMs = t0 + 7 * 86400 * 1000;

  let now = t0;
  const initS = api.createEquivCostStore({ storeFile, brainDir, launchId: 'l-init', nowFn: () => now });
  initS.reportUser({ email: 'a@gmail.com', tier: 'ultra', ts: now });
  initS.reportQuota({ email: 'a@gmail.com', remainingFraction: 1.0, resetTimeMs: resetMs, ts: now });
  now += 1000;
  initS.reportUser({ email: 'b@gmail.com', tier: 'ultra', ts: now });
  initS.reportQuota({ email: 'b@gmail.com', remainingFraction: 1.0, resetTimeMs: resetMs, ts: now });

  // a@gmail.com 跑 21 次每次消耗 $2.8（输出 1M @ $12 * 0.2333... -> 直接用 1M input $2 => $2 / 0.02 = $100 周 = 428.57 月），共 21 次
  // b@gmail.com 跑 1 次消耗 $4 => 0.02 跌幅 => $200 周 = 857.14 月
  let fracA = 1.0;
  for (let i = 1; i <= 21; i++) {
    now = t0 + i * 100_000;
    const s = api.createEquivCostStore({ storeFile, brainDir, launchId: `la-${i}`, nowFn: () => now });
    s.reportUser({ email: 'a@gmail.com', tier: 'ultra', ts: now });
    appendTranscript(brainDir, 'conv-a', [{
      type: 'PLANNER_RESPONSE',
      model: 'gemini-4-neon-xhigh',
      input_tokens: 1_000_000,
      cache_read_tokens: 0,
      output_tokens: 0,
      created_at: new Date(now + 10_000).toISOString(),
    }]);
    now += 20_000;
    fracA -= 0.02;
    s.reportQuota({ email: 'a@gmail.com', remainingFraction: fracA, resetTimeMs: resetMs, ts: now });
  }

  now += 100_000;
  const sb = api.createEquivCostStore({ storeFile, brainDir, launchId: 'lb-1', nowFn: () => now });
  sb.reportUser({ email: 'b@gmail.com', tier: 'ultra', ts: now });
  appendTranscript(brainDir, 'conv-b', [{
    type: 'PLANNER_RESPONSE',
    model: 'gemini-4-neon-xhigh',
    input_tokens: 2_000_000,
    cache_read_tokens: 0,
    output_tokens: 0,
    created_at: new Date(now + 10_000).toISOString(),
  }]);
  now += 20_000;
  const finalState = sb.reportQuota({ email: 'b@gmail.com', remainingFraction: 0.98, resetTimeMs: resetMs, ts: now });

  const disk = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  assert.equal(disk.records.length, 20, 'equiv-api-cost.json 必须严格只保留最近 20 次记录');
  assert.equal(finalState.totalRecords, 20);
  // 当前窗口内有 a (19 条，每条 $428.57) 和 b (1 条，$857.14)，跨邮箱均值应为 (428.57 + 857.14) / 2 = 642.86
  const meanA = 100 * 30 / 7;
  const meanB = 200 * 30 / 7;
  const expectedCrossEmailMean = (meanA + meanB) / 2;
  assert.ok(Math.abs(finalState.avgMonthlyUsd - expectedCrossEmailMean) < 0.1, `实际=${finalState.avgMonthlyUsd}, 期望=${expectedCrossEmailMean}`);
});

test('小波动 (<0.2%) 不急于结算且保留原基线；服务端实时更新单价但尊重 locked=true 手动锁价', () => {
  const { brainDir, storeFile } = makeSandbox(test, 'debounce-lock');
  const t0 = new Date('2026-11-21T00:00:00.000Z').getTime();
  const resetMs = t0 + 7 * 86400 * 1000;

  let now = t0;
  const s1 = api.createEquivCostStore({ storeFile, brainDir, launchId: 'd-1', nowFn: () => now });
  s1.reportUser({ email: 'dev@gmail.com', tier: 'pro', ts: now });
  s1.reportQuota({ email: 'dev@gmail.com', remainingFraction: 1.0, resetTimeMs: resetMs, ts: now });

  // 第二次启动：额度仅波动 0.001 (< 0.002)，不结算且不丢失 1.0 基线
  now = t0 + 100_000;
  appendTranscript(brainDir, 'conv-dev', [{
    type: 'PLANNER_RESPONSE',
    model: 'gemini-4-neon-xhigh',
    input_tokens: 500_000, // $1
    cache_read_tokens: 0,
    output_tokens: 0,
    created_at: new Date(t0 + 50_000).toISOString(),
  }]);
  const s2 = api.createEquivCostStore({ storeFile, brainDir, launchId: 'd-2', nowFn: () => now });
  s2.reportUser({ email: 'dev@gmail.com', tier: 'pro', ts: now });
  const r2 = s2.reportQuota({ email: 'dev@gmail.com', remainingFraction: 0.999, resetTimeMs: resetMs, ts: now });
  assert.equal(r2.totalRecords, 0, '跌幅小于 0.2% 时不应结算');

  // 第三次启动：累计跌到 0.99 (delta = 0.01)，应从 t0 的 1.0 基线结算（包含 $1）
  now = t0 + 200_000;
  const s3 = api.createEquivCostStore({ storeFile, brainDir, launchId: 'd-3', nowFn: () => now });
  s3.reportUser({ email: 'dev@gmail.com', tier: 'pro', ts: now });
  const r3 = s3.reportQuota({ email: 'dev@gmail.com', remainingFraction: 0.99, resetTimeMs: resetMs, ts: now });
  assert.equal(r3.totalRecords, 1);
  assert.ok(Math.abs(r3.avgMonthlyUsd - (100 * 30 / 7)) < 0.05);

  // 测试服务端更新单价（未锁定时更新）
  s3.reportPricing([{
    modelName: 'gemini-4-neon-xhigh',
    inputPricePerMillionTokens: 2.5,
    cacheReadPricePerMillionTokens: 0.25,
    outputPricePerMillionTokens: 15.0,
    isEstimated: false,
  }]);
  let disk = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  assert.equal(disk.pricing.neon.inputPerMillion, 2.5);
  assert.equal(disk.pricing.neon.outputPerMillion, 15.0);
  assert.equal(disk.pricing.neon.source, 'live');

  // 手动锁价后不再被覆盖
  disk.pricing.neon.inputPerMillion = 3.0;
  disk.pricing.neon.locked = true;
  fs.writeFileSync(storeFile, JSON.stringify(disk, null, 2), 'utf8');
  s3.reportPricing([{
    modelName: 'gemini-4-neon-xhigh',
    inputPricePerMillionTokens: 9.9,
    cacheReadPricePerMillionTokens: 0.99,
    outputPricePerMillionTokens: 99.0,
    isEstimated: false,
  }]);
  disk = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  assert.equal(disk.pricing.neon.inputPerMillion, 3.0, 'locked=true 时严禁被自动覆盖');
});

test('中途首次接入但本机已有本周期 transcript 时，首次打开 Agy 立即算出等效月费用，后续重启各自结算 1 次', () => {
  const { brainDir, storeFile } = makeSandbox(test, 'mid-cycle-first-open');
  const resetMs = new Date('2026-11-30T21:49:36.000Z').getTime();
  const cycleStartMs = resetMs - 7 * 86400 * 1000;
  const open1Ts = new Date('2026-11-24T01:04:00.000Z').getTime();
  const open2Ts = new Date('2026-11-24T01:25:20.000Z').getTime();

  // 模拟装补丁前同一周周期内已用 Gemini 4 Neon 跑了 $14（2M input=$4 + 0.833333M? -> 1M input=$2 + 1M output=$12 = $14）
  appendTranscript(brainDir, 'conv-pre', [
    {
      type: 'PLANNER_RESPONSE',
      model: 'gemini-4-neon-xhigh',
      input_tokens: 1_000_000,
      cache_read_tokens: 0,
      output_tokens: 1_000_000,
      created_at: new Date(cycleStartMs + 3600_000).toISOString(),
    },
    {
      type: 'PLANNER_RESPONSE',
      model: 'claude-opus-5-5-high',
      input_tokens: 5_000_000,
      cache_read_tokens: 0,
      output_tokens: 1_000_000,
      created_at: new Date(cycleStartMs + 7200_000).toISOString(),
    },
  ]);

  // 第一次打开 Agy，remainingFraction = 0.8545（已消耗 0.1455），resetTime 有 1 分钟抖动也应正常对齐
  const s1 = api.createEquivCostStore({ storeFile, brainDir, launchId: 'mid-1', nowFn: () => open1Ts });
  s1.reportUser({ email: 'mid@example.com', tier: 'ultra', tierName: 'Google AI Ultra', ts: open1Ts });
  const r1 = s1.reportQuota({ email: 'mid@example.com', remainingFraction: 0.8545, resetTimeMs: resetMs, ts: open1Ts });
  assert.equal(r1.totalRecords, 1, '首次打开且本机已有本周期 transcript 时应立即算出 1 条记录');
  const expected1 = Math.round(((14 / 0.1455) * (30 / 7)) * 100) / 100;
  assert.ok(Math.abs(r1.avgMonthlyUsd - expected1) < 0.1, `实际=${r1.avgMonthlyUsd}, 期望=${expected1}`);

  // 同次打开再次触发不得重复写记录
  const r1Dup = s1.reportQuota({ email: 'mid@example.com', remainingFraction: 0.8500, resetTimeMs: resetMs, ts: open1Ts + 10_000 });
  assert.equal(r1Dup.totalRecords, 1);

  // 第二次重启 Agy（即便 remainingFraction 微幅回调或重置时间抖动 60s）仍只产生第 2 条记录
  const s2 = api.createEquivCostStore({ storeFile, brainDir, launchId: 'mid-2', nowFn: () => open2Ts });
  s2.reportUser({ email: 'mid@example.com', tier: 'ultra', tierName: 'Google AI Ultra', ts: open2Ts });
  const r2 = s2.reportQuota({ email: 'mid@example.com', remainingFraction: 0.8560, resetTimeMs: resetMs + 60_000, ts: open2Ts });
  assert.equal(r2.totalRecords, 2, '第二次打开 Agy 应完成第 2 次计算记录');
});
