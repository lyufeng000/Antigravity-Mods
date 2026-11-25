import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  findLatestCheckpoint,
  handleHookEvent,
  isRecentCheckpoint,
} from '../scripts/compact-retitle.mjs';
import {
  sanitizeTitle,
  updateConversationTitle,
} from '../scripts/set-title.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK_CLI = path.resolve(HERE, '..', 'scripts', 'compact-retitle.mjs');

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agy-compact-retitle-test-'));
}

function writeTranscript(filePath, entries) {
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(filePath, lines, 'utf8');
}

test('无 CHECKPOINT 时 pre-invocation 与 stop 均返回空对象', () => {
  const dir = makeTempWorkspace();
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  const stateDir = path.join(dir, 'state');
  writeTranscript(transcriptPath, [
    { step_index: 1, type: 'USER_INPUT', status: 'DONE', content: 'hi' },
    { step_index: 2, type: 'PLANNER_RESPONSE', status: 'DONE', content: 'hello' },
  ]);

  const basePayload = {
    conversationId: 'conv-no-ckpt',
    transcriptPath,
  };

  assert.deepEqual(
    handleHookEvent({ ...basePayload, hookEventName: 'PreInvocation' }, { stateDir, mode: 'pre-invocation' }),
    {},
  );
  assert.deepEqual(
    handleHookEvent({ ...basePayload, hookEventName: 'Stop', terminationReason: 'NO_TOOL_CALL' }, { stateDir, mode: 'stop' }),
    {},
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('自动压缩后在 pre-invocation 注入 systemMessage，且同 step_index 幂等不重复触发', () => {
  const dir = makeTempWorkspace();
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  const stateDir = path.join(dir, 'state');
  const nowMs = Date.parse('2026-11-25T12:00:00Z');
  writeTranscript(transcriptPath, [
    { step_index: 10, type: 'USER_INPUT', status: 'DONE', content: 'work' },
    {
      step_index: 11,
      type: 'CHECKPOINT',
      status: 'DONE',
      created_at: '2026-11-25T11:59:30Z',
      content: '# Resuming from a compaction',
    },
  ]);

  const first = handleHookEvent(
    { conversationId: 'conv-auto', transcriptPath, hookEventName: 'PreInvocation' },
    { stateDir, mode: 'pre-invocation', nowMs },
  );
  assert.equal(Array.isArray(first.injectSteps), true);
  assert.equal(first.injectSteps.length, 1);
  const msg = first.injectSteps[0].systemMessage.systemMessage;
  assert.match(msg, /CHECKPOINT #11/);
  assert.match(msg, /set-title\.mjs/);

  // 二次调用 PreInvocation 与 Stop 均应幂等返回 {}
  const secondPre = handleHookEvent(
    { conversationId: 'conv-auto', transcriptPath, hookEventName: 'PreInvocation' },
    { stateDir, mode: 'pre-invocation', nowMs: nowMs + 1000 },
  );
  assert.deepEqual(secondPre, {});

  const secondStop = handleHookEvent(
    {
      conversationId: 'conv-auto',
      transcriptPath,
      hookEventName: 'Stop',
      terminationReason: 'NO_TOOL_CALL',
    },
    { stateDir, mode: 'stop', nowMs: nowMs + 2000 },
  );
  assert.deepEqual(secondStop, {});
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stop 在 NO_TOOL_CALL 与 TERMINAL_STEP_TYPE 下触发 continue，但在护栏条件下返回空对象', () => {
  const dir = makeTempWorkspace();
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  const stateDir = path.join(dir, 'state');
  const nowMs = Date.parse('2026-11-25T12:00:00Z');

  writeTranscript(transcriptPath, [
    { step_index: 20, type: 'USER_INPUT', status: 'DONE', content: '/compact' },
    {
      step_index: 21,
      type: 'CHECKPOINT',
      status: 'DONE',
      created_at: '2026-11-25T11:59:50Z',
      content: '# Resuming from a compaction',
    },
  ]);

  // continuationActive=true 不触发且不消费该 checkpoint
  assert.deepEqual(
    handleHookEvent(
      {
        conversationId: 'conv-stop',
        transcriptPath,
        hookEventName: 'Stop',
        continuationActive: true,
        terminationReason: 'NO_TOOL_CALL',
      },
      { stateDir, mode: 'stop', nowMs },
    ),
    {},
  );

  // 非白名单 terminationReason 不触发
  for (const reason of ['USER_CANCELED', 'ERROR', 'MAX_INVOCATIONS']) {
    assert.deepEqual(
      handleHookEvent(
        {
          conversationId: 'conv-stop',
          transcriptPath,
          hookEventName: 'Stop',
          terminationReason: reason,
        },
        { stateDir, mode: 'stop', nowMs },
      ),
      {},
    );
  }

  // TERMINAL_STEP_TYPE 正常触发
  const triggered = handleHookEvent(
    {
      conversationId: 'conv-stop',
      transcriptPath,
      hookEventName: 'Stop',
      terminationReason: 'TERMINAL_STEP_TYPE',
    },
    { stateDir, mode: 'stop', nowMs },
  );
  assert.equal(triggered.decision, 'continue');
  assert.match(triggered.reason, /CHECKPOINT #21/);
  assert.match(triggered.reason, /set-title\.mjs/);

  // 另一个新会话在 NO_TOOL_CALL 下也能正常触发
  writeTranscript(transcriptPath, [
    {
      step_index: 31,
      type: 'CHECKPOINT',
      status: 'DONE',
      created_at: '2026-11-25T11:59:55Z',
      content: '# Resuming from a compaction',
    },
  ]);
  const triggeredNoTool = handleHookEvent(
    {
      conversationId: 'conv-stop-2',
      transcriptPath,
      hookEventName: 'Stop',
      terminationReason: 'NO_TOOL_CALL',
    },
    { stateDir, mode: 'stop', nowMs },
  );
  assert.equal(triggeredNoTool.decision, 'continue');
  assert.match(triggeredNoTool.reason, /CHECKPOINT #31/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('旧对话历史 CHECKPOINT 首次静默建基线，后续新压缩可再次触发', () => {
  const dir = makeTempWorkspace();
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  const stateDir = path.join(dir, 'state');
  const nowMs = Date.parse('2026-11-25T12:00:00Z');

  writeTranscript(transcriptPath, [
    {
      step_index: 50,
      type: 'CHECKPOINT',
      status: 'DONE',
      created_at: '2026-11-25T10:00:00Z',
      content: 'old compaction',
    },
  ]);

  assert.equal(isRecentCheckpoint('2026-11-25T10:00:00Z', nowMs), false);
  const initRes = handleHookEvent(
    { conversationId: 'conv-old', transcriptPath, hookEventName: 'PreInvocation' },
    { stateDir, mode: 'pre-invocation', nowMs },
  );
  assert.deepEqual(initRes, {});

  // 随后新增一次压缩
  fs.appendFileSync(
    transcriptPath,
    `${JSON.stringify({
      step_index: 95,
      type: 'CHECKPOINT',
      status: 'DONE',
      created_at: '2026-11-25T12:00:10Z',
      content: 'new compaction',
    })}\n`,
    'utf8',
  );
  const nextRes = handleHookEvent(
    { conversationId: 'conv-old', transcriptPath, hookEventName: 'PreInvocation' },
    { stateDir, mode: 'pre-invocation', nowMs: nowMs + 15_000 },
  );
  assert.equal(nextRes.injectSteps.length, 1);
  assert.match(nextRes.injectSteps[0].systemMessage.systemMessage, /CHECKPOINT #95/);

  // 同一对话再次发生第二次压缩（step 140）
  fs.appendFileSync(
    transcriptPath,
    `${JSON.stringify({
      step_index: 140,
      type: 'CHECKPOINT',
      status: 'DONE',
      created_at: '2026-11-25T12:05:00Z',
      content: 'third compaction',
    })}\n`,
    'utf8',
  );
  const thirdRes = handleHookEvent(
    {
      conversationId: 'conv-old',
      transcriptPath,
      hookEventName: 'Stop',
      terminationReason: 'NO_TOOL_CALL',
    },
    { stateDir, mode: 'stop', nowMs: nowMs + 305_000 },
  );
  assert.equal(thirdRes.decision, 'continue');
  assert.match(thirdRes.reason, /CHECKPOINT #140/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('findLatestCheckpoint 容错坏行并返回最新 DONE CHECKPOINT', () => {
  const dir = makeTempWorkspace();
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ step_index: 5, type: 'CHECKPOINT', status: 'DONE', created_at: '2026-11-25T11:00:00Z' }),
      '{"broken json CHECKPOINT',
      JSON.stringify({ step_index: 12, type: 'CHECKPOINT', status: 'RUNNING', created_at: '2026-11-25T11:50:00Z' }),
    ].join('\n'),
    'utf8',
  );
  assert.deepEqual(findLatestCheckpoint(transcriptPath), {
    stepIndex: 5,
    createdAt: '2026-11-25T11:00:00Z',
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI 子进程端到端调用与坏 JSON fail-open 返回 {}', () => {
  const dir = makeTempWorkspace();
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  const stateDir = path.join(dir, 'state');
  writeTranscript(transcriptPath, [
    {
      step_index: 7,
      type: 'CHECKPOINT',
      status: 'DONE',
      created_at: new Date().toISOString(),
      content: 'recent compact',
    },
  ]);

  const good = spawnSync(process.execPath, [HOOK_CLI, 'stop'], {
    input: JSON.stringify({
      conversationId: 'conv-cli-e2e',
      transcriptPath,
      hookEventName: 'Stop',
      terminationReason: 'NO_TOOL_CALL',
    }),
    env: { ...process.env, PLUGIN_DATA: stateDir },
    encoding: 'utf8',
  });
  assert.equal(good.status, 0);
  const parsedGood = JSON.parse(good.stdout.trim());
  assert.equal(parsedGood.decision, 'continue');
  assert.match(parsedGood.reason, /CHECKPOINT #7/);

  const bad = spawnSync(process.execPath, [HOOK_CLI, 'pre-invocation'], {
    input: '{invalid-json',
    env: { ...process.env, PLUGIN_DATA: stateDir },
    encoding: 'utf8',
  });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout.trim(), '{}');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('set-title sanitizeTitle 与 updateConversationTitle 边界校验', async () => {
  assert.equal(sanitizeTitle('  "压缩后自动重命名" \n'), '压缩后自动重命名');
  assert.equal(sanitizeTitle('《Antigravity 钩子开发》'), 'Antigravity 钩子开发');
  assert.equal(sanitizeTitle('「标题\t整理」'), '标题 整理');
  assert.throws(() => sanitizeTitle('   '), /不能为空/);

  const calls = [];
  const childFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          id: 'child-1',
          metadata: { parentConversationId: 'parent-0' },
          annotations: { title: '子代理' },
        }),
    };
  };
  const skippedRes = await updateConversationTitle({
    title: '不应该生效的标题',
    lsAddress: '127.0.0.1:59911',
    csrfToken: 'tok-1',
    conversationId: 'child-1',
    fetchImpl: childFetch,
  });
  assert.deepEqual(skippedRes, { skipped: true, reason: 'child_conversation' });
  assert.equal(calls.length, 1);

  const normalCalls = [];
  const normalFetch = async (url, init) => {
    normalCalls.push({ url, init });
    if (url.endsWith('/GetConversation')) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            id: 'conv-main',
            metadata: {},
            annotations: { title: '旧标题' },
          }),
      };
    }
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          id: 'conv-main',
          annotations: { title: '重构压缩后标题钩子' },
        }),
    };
  };
  const updated = await updateConversationTitle({
    title: '「重构压缩后标题钩子」',
    lsAddress: '127.0.0.1:59911',
    csrfToken: 'csrf-xyz',
    conversationId: 'conv-main',
    fetchImpl: normalFetch,
  });
  assert.deepEqual(updated, {
    skipped: false,
    oldTitle: '旧标题',
    newTitle: '重构压缩后标题钩子',
  });
  assert.equal(normalCalls.length, 2);
  assert.equal(
    normalCalls[1].url,
    'http://127.0.0.1:59911/product.v1.ConversationService/UpdateConversation',
  );
  assert.equal(normalCalls[1].init.headers['Connect-Protocol-Version'], '1');
  assert.equal(normalCalls[1].init.headers['x-antigravity-csrf-token'], 'csrf-xyz');
  assert.deepEqual(JSON.parse(normalCalls[1].init.body), {
    conversationId: 'conv-main',
    annotations: { title: '重构压缩后标题钩子' },
  });
});
