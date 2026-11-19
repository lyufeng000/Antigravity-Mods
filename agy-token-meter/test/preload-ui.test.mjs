import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadDep } from '../patcher/lib/deps.mjs';

const { JSDOM } = loadDep('jsdom');
const here = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = path.resolve(here, '../src/token-meter-preload.js');
const PRELOAD_SRC = fs.readFileSync(PRELOAD_PATH, 'utf8');

function createHarness() {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body>'
    + '<div data-testid="agent-input-box" class="flex flex-col w-full shrink-0">'
    + '  <div id="antigravity.agentSidePanelInputBox" class="surface-composer">输入框卡片</div>'
    + '  <div data-testid="input-box-bottom-toolbar">模型选择器</div>'
    + '</div>'
    + '</body></html>',
    { url: 'http://127.0.0.1:3000/' },
  );

  const { window } = dom;
  const box = window.document.querySelector('[data-testid="agent-input-box"]');
  box['__reactFiber$demo'] = {
    memoizedProps: { cascadeId: 'conv-live-1' },
    return: null,
  };

  // 模拟先装好了周额度装饰器，验证链式共存不覆盖
  let quotaDecoratorCalls = 0;
  window.__JETSKI_LS_CLIENT_DECORATOR__ = (client) => {
    quotaDecoratorCalls++;
    return client;
  };

  let copiedText = '';
  const fakeDiskStats = {
    updatedAtMs: 1700000000000,
    dayKey: '2026-11-18',
    today: { input: 100000, cacheRead: 2200000, output: 12000, total: 2312000, steps: 24, conversations: 3 },
    week: { input: 500000, cacheRead: 11500000, output: 80000, total: 12080000, steps: 110, conversations: 12 },
    sessions: {
      'conv-live-1': {
        input: 50000,
        cacheRead: 550000,
        output: 10112,
        total: 610112,
        steps: 15,
        turns: 2,
        lastContext: 45200,
        lastStepAtMs: 1700000000000,
      },
    },
  };

  const fakeElectron = {
    ipcRenderer: {
      sendSync: () => fakeDiskStats,
      invoke: async () => fakeDiskStats,
      on: () => {},
    },
    webFrame: {
      executeJavaScript: async (code) => {
        vm.runInContext(code, sandbox);
      },
    },
    clipboard: {
      writeText: (txt) => { copiedText = txt; },
    },
  };

  const activeTimers = new Set();
  const activeTimeouts = new Set();
  const origSetTimeout = window.setTimeout.bind(window);
  const origClearTimeout = window.clearTimeout.bind(window);
  const origSetInterval = window.setInterval.bind(window);
  const origClearInterval = window.clearInterval.bind(window);
  let sandbox;
  sandbox = {
    window,
    globalThis: window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    MutationObserver: window.MutationObserver,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    requestAnimationFrame: (fn) => {
      const id = setTimeout(fn, 0);
      activeTimeouts.add(id);
      return id;
    },
    setTimeout: (fn, ms) => {
      const id = origSetTimeout(fn, ms);
      activeTimeouts.add(id);
      return id;
    },
    clearTimeout: (id) => {
      activeTimeouts.delete(id);
      return origClearTimeout(id);
    },
    setInterval: (fn, ms) => {
      const id = origSetInterval(fn, ms);
      activeTimers.add(id);
      return id;
    },
    clearInterval: (id) => {
      activeTimers.delete(id);
      return origClearInterval(id);
    },
    console,
    require: (id) => (id === 'electron' ? fakeElectron : null),
  };
  window.require = sandbox.require;
  window.setInterval = sandbox.setInterval;
  window.clearInterval = sandbox.clearInterval;
  window.setTimeout = sandbox.setTimeout;
  window.clearTimeout = sandbox.clearTimeout;

  vm.createContext(sandbox);
  vm.runInContext(PRELOAD_SRC, sandbox);

  const api = window.__AGY_TOKEN_METER_PRELOAD_API__;
  const cleanup = () => {
    for (const id of activeTimers) origClearInterval(id);
    for (const id of activeTimeouts) origClearTimeout(id);
    activeTimers.clear();
    activeTimeouts.clear();
    dom.window.close();
  };
  return {
    dom, window, api, box,
    getCopied: () => copiedText,
    getQuotaDecoratorCalls: () => quotaDecoratorCalls,
    cleanup,
  };
}

test('输入框下方挂载状态栏、旁路 LS 流式更新 tok/s 与 BigInt 费用/上下文占比、悬停向上弹出详情', async () => {
  const { window, api, box, getCopied, getQuotaDecoratorCalls, cleanup } = createHarness();
  try {
    await new Promise((r) => setTimeout(r, 30));

    const bar = box.querySelector(`[${api.BAR_ATTR}="1"]`);
    assert.ok(bar, '状态栏应挂载在 agent-input-box 内部');
    assert.equal(box.lastElementChild, bar, '状态栏应位于输入框与原生底栏最下方');
    assert.equal(bar.getAttribute('data-agy-zh-skip'), '1');

    // 模拟宿主通过 __JETSKI_LS_CLIENT_DECORATOR__ 装饰 LS client（验证与周额度共存且支持 BigInt）
    const fakeRawClient = {
      streamAgentStateUpdates() {
        const frames = [
          {
            status: 2,
            costSummary: {
              total: {
                cumulativeTotal: {
                  input: { tokens: 216939n },
                  cacheRead: { tokens: 10630008n },
                  output: { tokens: 55867n },
                  thinking: { tokens: 12000n },
                  response: { tokens: 43867n },
                  estimatedCostUsd: 0.6289,
                },
              },
            },
            contextWindowUsage: {
              estimatedTokensUsed: 160000,
              maxContextTokens: 1000000,
            },
            mainTrajectoryUpdate: {
              stepsUpdate: {
                totalLength: 106,
                indices: [0, 105],
                steps: [
                  { step: { case: 'userInput', value: {} } },
                  {
                    status: 3,
                    step: { case: 'plannerResponse', value: { response: 'hello' } },
                    metadata: { completedAt: '2026-11-18T00:00:00Z' },
                  },
                ],
              },
              generatorMetadatasUpdate: {
                generatorMetadatas: [
                  {
                    chatModel: {
                      usage: { outputTokens: 384n },
                      streamingDuration: { seconds: 2n, nanos: 0 },
                      timeToFirstToken: { seconds: 0n, nanos: 840000000 },
                    },
                  },
                ],
              },
            },
          },
        ];
        return {
          async *[Symbol.asyncIterator]() {
            for (const f of frames) yield { update: f };
          },
        };
      },
      async getCascadeTrajectory() {
        return { trajectory: { steps: [{ step: { case: 'userInput' } }], generatorMetadata: [] } };
      },
    };

    const decorated = window.__JETSKI_LS_CLIENT_DECORATOR__(fakeRawClient);
    assert.equal(getQuotaDecoratorCalls(), 1, '不能覆盖原有周额度装饰器');

    for await (const _msg of decorated.streamAgentStateUpdates({ conversationId: 'conv-live-1' })) {
      // 消费流
    }
    await new Promise((r) => setTimeout(r, 150));

    assert.match(bar.textContent, /2 轮 106 步/);
    assert.match(bar.textContent, /192 tok\/s/);
    assert.match(bar.textContent, /↑ 10,846,947 tok/);
    assert.match(bar.textContent, /↓ 55,867 tok/);
    assert.match(bar.textContent, /\$0\.629/);
    assert.match(bar.textContent, /缓存命中\s*98%/);
    assert.match(bar.textContent, /16%/);

    // 鼠标悬停不再自动弹窗，避免遮挡视野
    bar.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
    assert.equal(window.document.getElementById(api.POPOVER_ID), null);

    // 单击打开详情浮层，包含 TTFT、今日/本周全量及复制按钮
    bar.click();
    await new Promise((r) => setTimeout(r, 230));
    const pop = window.document.getElementById(api.POPOVER_ID);
    assert.ok(pop);
    assert.equal(pop.parentElement, window.document.body);
    assert.match(pop.textContent, /192 tok\/s/);
    assert.match(pop.textContent, /首字 0\.84s/);
    assert.match(pop.textContent, /今日全量/);
    assert.match(pop.textContent, /本周全量/);

    const copyBtn = Array.from(pop.querySelectorAll('button')).find((b) => b.textContent === '复制');
    assert.ok(copyBtn);
    copyBtn.click();
    assert.match(getCopied(), /192 tok\/s/);
    assert.match(getCopied(), /今日全量: 2,312,000/);

    // 点击外部关闭弹窗
    window.document.body.click();
    assert.equal(window.document.getElementById(api.POPOVER_ID), null);

    // 双击切换极简模式
    bar.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(api.getMode(), 'compact');
    assert.match(bar.textContent, /192 tok\/s/);
    assert.match(bar.textContent, /今日 2\.31M/);
  } finally {
    cleanup();
  }
});
