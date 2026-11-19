import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../src/token-meter-main-ipc.js';

const api = globalThis.__AGY_TOKEN_METER_MAIN_API__;

const BASE = fs.existsSync('D:\\Data\\.temp') ? 'D:\\Data\\.temp\\agy-token-meter' : path.join(os.tmpdir(), 'agy-token-meter');
const ROOT = path.join(BASE, `main-ipc-test-${process.pid}`);
const BRAIN = path.join(ROOT, 'brain');

function writeTranscript(convId, lines) {
  const dir = path.join(BRAIN, convId, '.system_generated', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
}

before(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(BRAIN, { recursive: true });
});

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('增量解析、今日/本周时间窗与上下文规模统计准确', () => {
  // 固定当前时间：2026-11-18T10:00:00（本地时区周三）
  const nowMs = new Date(2026, 10, 18, 10, 0, 0).getTime();
  const todayIso = new Date(2026, 10, 18, 8, 30, 0).toISOString();
  const mondayIso = new Date(2026, 10, 16, 14, 0, 0).toISOString();
  const lastWeekIso = new Date(2026, 10, 10, 9, 0, 0).toISOString();

  writeTranscript('conv-a', [
    { step_index: 0, type: 'USER_INPUT', content: 'hi', created_at: mondayIso },
    { step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 1000, cache_read_tokens: 2000, output_tokens: 300, created_at: mondayIso },
    { step_index: 2, type: 'PLANNER_RESPONSE', input_tokens: 500, cache_read_tokens: 3000, output_tokens: 200, created_at: todayIso },
  ]);
  writeTranscript('conv-b', [
    { step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 4000, cache_read_tokens: 0, output_tokens: 500, created_at: lastWeekIso },
  ]);

  const tracker = api.createTokenTracker({ brainDir: BRAIN, nowFn: () => nowMs });
  assert.equal(tracker.scanAll(), true);
  assert.equal(tracker.scanAll(), false); // 未变动不重复读

  const snap1 = tracker.getSnapshot('conv-a');
  assert.equal(snap1.session.input, 1500);
  assert.equal(snap1.session.cacheRead, 5000);
  assert.equal(snap1.session.output, 500);
  assert.equal(snap1.session.total, 7000);
  assert.equal(snap1.session.steps, 2);
  assert.equal(snap1.session.turns, 1);
  assert.equal(snap1.session.lastContext, 3700);

  assert.equal(snap1.today.total, 3700);
  assert.equal(snap1.today.conversations, 1);
  assert.equal(snap1.week.total, 7000);
  assert.equal(snap1.week.conversations, 1);

  // 追加半行后补全，验证断点续读与防半行
  const tfA = path.join(BRAIN, 'conv-a', '.system_generated', 'logs', 'transcript.jsonl');
  const nextLine = JSON.stringify({
    step_index: 3,
    type: 'PLANNER_RESPONSE',
    input_tokens: 200,
    cache_read_tokens: 3800,
    output_tokens: 150,
    created_at: new Date(2026, 10, 18, 9, 55, 0).toISOString(),
  });
  fs.appendFileSync(tfA, nextLine.slice(0, 20), 'utf8');
  assert.equal(tracker.scanConversation('conv-a'), true);
  assert.equal(tracker.getSnapshot('conv-a').session.steps, 2);

  fs.appendFileSync(tfA, nextLine.slice(20) + '\n', 'utf8');
  assert.equal(tracker.scanConversation('conv-a'), true);
  const snap2 = tracker.getSnapshot('conv-a');
  assert.equal(snap2.session.steps, 3);
  assert.equal(snap2.session.total, 11150);
  assert.equal(snap2.session.lastContext, 4150);
  assert.equal(snap2.today.total, 7850);
});

test('extractConvIdFromWatchPath 仅识别 transcript.jsonl 相关变更', () => {
  assert.equal(api.extractConvIdFromWatchPath('abc-123\\.system_generated\\logs\\transcript.jsonl'), 'abc-123');
  assert.equal(api.extractConvIdFromWatchPath('abc-123/.system_generated/logs/transcript.jsonl'), 'abc-123');
  assert.equal(api.extractConvIdFromWatchPath('abc-123/scratch/foo.txt'), '');
  assert.equal(api.extractConvIdFromWatchPath(''), '');
});
