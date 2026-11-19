import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadDep } from '../patcher/lib/deps.mjs';
import { PRELOAD_SCRIPT } from '../patcher/lib/common.mjs';

const { JSDOM } = loadDep('jsdom');

function sampleModels() {
  return [
    { label: 'Gemini 4 Neon (High)', value: 532, tagTitle: 'New', tagDescription: 'For most deep reasoning and complex problems', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Gemini 4 Neon (XHigh)', value: 535, tagTitle: 'New', tagDescription: 'For most deep reasoning and complex problems', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Gemini 4 Neon (Medium)', value: 533, tagTitle: 'New', tagDescription: 'For most deep reasoning and complex problems', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Gemini 4 Neon (Low)', value: 534, tagTitle: 'New', tagDescription: 'For most deep reasoning and complex problems', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Gemini 4 Carbon (Medium)', value: 437, tagTitle: 'New', tagDescription: 'For your hardest, long-horizon tasks', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Gemini 4 Carbon (High)', value: 427, tagTitle: 'New', tagDescription: 'For your hardest, long-horizon tasks', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Gemini 4 Carbon (Low)', value: 438, tagTitle: 'New', tagDescription: 'For your hardest, long-horizon tasks', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Gemini 4 Argon (Medium)', value: 418, tagTitle: 'New', tagDescription: 'The original Gemini 4 model for advanced workflows', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Gemini 4 Argon (High)', value: 417, tagTitle: 'New', tagDescription: 'The original Gemini 4 model for advanced workflows', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Gemini 4 Argon (Low)', value: 419, tagTitle: 'New', tagDescription: 'The original Gemini 4 model for advanced workflows', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Gemini 4 Hydrogen (High)', value: 525, tagTitle: 'New', tagDescription: 'For speed and efficiency in execution tasks', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Gemini 4 Hydrogen (XHigh)', value: 528, tagTitle: 'New', tagDescription: 'For speed and efficiency in execution tasks', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Gemini 4 Hydrogen (Medium)', value: 526, tagTitle: 'New', tagDescription: 'For speed and efficiency in execution tasks', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Gemini 4 Hydrogen (Low)', value: 527, tagTitle: 'New', tagDescription: 'For speed and efficiency in execution tasks', quotaInfo: { remainingFraction: 0.98 } },
    { label: 'Orchestrator (Neon)', value: 537, tagTitle: 'New', tagDescription: 'Neon that may offload routine steps to Hydrogen.' },
    { label: 'Orchestrator (Carbon)', value: 667, tagTitle: 'New', tagDescription: 'Carbon that may offload routine steps to Hydrogen.' },
    { label: 'Orchestrator (Argon)', value: 681, tagTitle: 'New', tagDescription: 'Argon that may offload routine steps to Hydrogen.' },
    { label: 'Gemini 3.8 Flash (High)', value: 318 },
    { label: 'Gemini 3.8 Flash (Medium)', value: 319 },
    { label: 'Gemini 3.8 Flash (Low)', value: 320 },
    { label: 'Claude Opus 5.5 (Low)', value: 400, tagTitle: 'New', quotaInfo: { remainingFraction: 1 } },
    { label: 'Claude Opus 5.5 (Medium)', value: 401, tagTitle: 'New', quotaInfo: { remainingFraction: 1 } },
    { label: 'Claude Opus 5.5 (High)', value: 402, tagTitle: 'New', quotaInfo: { remainingFraction: 1 } },
    { label: 'Claude Sonnet 5.5 (Low)', value: 403, tagTitle: 'New', quotaInfo: { remainingFraction: 1 } },
    { label: 'Claude Sonnet 5.5 (Medium)', value: 404, tagTitle: 'New', quotaInfo: { remainingFraction: 1 } },
    { label: 'Claude Sonnet 5.5 (High)', value: 405, tagTitle: 'New', quotaInfo: { remainingFraction: 1 } },
    { label: 'GPT-OSS 120B (Medium)', value: 999, tagTitle: 'Notice', tagDescription: 'GPT-OSS notice' },
  ];
}

function bootEnv(customCtrl = {}) {
  const dom = new JSDOM('<!doctype html><html class="dark"><body><button data-testid="model-selector-trigger">Gemini 4 Neon High</button></body></html>', {
    url: 'http://127.0.0.1:51917/',
    runScripts: 'outside-only',
  });
  const code = fs.readFileSync(PRELOAD_SCRIPT, 'utf8');
  const script = new vm.Script(code, { filename: 'periodic-model-preload.js' });
  script.runInContext(dom.getInternalVMContext());

  const models = sampleModels();
  const picked = [];
  const openStates = [];
  const ctrl = {
    selectedModel: models[0], // Gemini 4 Neon (High)
    setSelectedModel: (m, ctx) => picked.push({ label: m.label, ctx }),
    modelOptions: models,
    modelSorts: [{ name: 'Recommended', groups: [{ groupName: '', options: models }] }],
    open: true,
    setIsOpen: (v) => openStates.push(v),
    customModels: [],
    bestOfNConfig: { isBestOfNEnabled: false },
    ...customCtrl,
  };

  // 模拟 Antigravity 原生 Popover DOM 结构（.agy-overlay > [data-testid="model-selector-panel"]）
  const doc = dom.window.document;
  const popover = doc.createElement('div');
  popover.className = 'agy-overlay surface-glass bg-card max-w-80 !w-max';

  const panel = doc.createElement('div');
  panel.setAttribute('data-testid', 'model-selector-panel');

  const nativeList = doc.createElement('div');
  nativeList.innerHTML = '<div data-testid="model-selector-header">模型</div><div data-testid="model-selector-item">Gemini 4 Neon</div>';

  const nativeFooter = doc.createElement('div');
  nativeFooter.setAttribute('data-testid', 'native-usage-footer');
  nativeFooter.textContent = '查看用量';

  panel.appendChild(nativeList);
  panel.appendChild(nativeFooter);
  popover.appendChild(panel);
  panel.__reactFiber$test = {
    memoizedProps: {},
    return: { memoizedProps: ctrl, return: null },
  };
  doc.body.appendChild(popover);

  // 直接触发一次同步扫描（jsdom 下 rAF 异步）
  dom.window.__AGY_PERIODIC_MODEL_API__.scanPanels();

  return { dom, popover, panel, nativeList, nativeFooter, ctrl, picked, openStates };
}

test('原地替换原生下拉面板：不弹新窗、保留底部查看用量、仅点亮 4 元素且未支持元素禁选', () => {
  const { dom, popover, panel, nativeList, nativeFooter, picked, openStates } = bootEnv();
  const doc = dom.window.document;

  // 不应创建全屏独立模态框
  assert.equal(doc.getElementById('agy-periodic-model-root'), null);
  assert.equal(popover.getAttribute('data-agy-pm-popover'), '1');
  assert.equal(nativeList.getAttribute('data-agy-pm-hidden'), '1');
  assert.equal(nativeFooter.getAttribute('data-agy-pm-hidden'), null, '应保留底部原生查看用量区域');

  const inline = panel.querySelector('[data-testid="agy-periodic-model-inline"]');
  assert.ok(inline, '应在原生 panel 内部渲染周期表');
  assert.equal(inline.getAttribute('data-agy-zh-skip'), '1');

  for (const sym of ['H', 'C', 'Ne', 'Ar']) {
    const cell = inline.querySelector(`[data-testid="agy-pm-element-${sym}"]`);
    assert.ok(cell, `应渲染元素 ${sym}`);
    assert.equal(cell.getAttribute('data-supported'), 'true');
  }

  // 未支持元素 Na 悬停可预览但严格禁选
  const naCell = inline.querySelector('[data-testid="agy-pm-element-Na"]');
  assert.equal(naCell.getAttribute('data-supported'), 'false');
  naCell.dispatchEvent(new dom.window.MouseEvent('mouseenter', { bubbles: false }));
  const detail = inline.querySelector('[data-testid="agy-pm-detail-card"]');
  assert.match(detail.textContent, /Sodium/);
  assert.equal(detail.getAttribute('data-supported'), 'false');

  naCell.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(picked.length, 0);
  assert.equal(openStates.length, 0);

  // 点击已支持元素 H -> 沿用当前 High 思考等级选中，且绝不自动关闭菜单（方便继续选思考等级）
  inline.querySelector('[data-testid="agy-pm-element-H"]').click();
  assert.equal(picked.length, 1);
  assert.equal(picked[0].label, 'Gemini 4 Hydrogen (High)');
  assert.deepEqual(openStates, [], '选中模型后不应自动关闭菜单');
  assert.ok(inline.querySelector('[data-testid="agy-pm-element-H"].is-selected'), '菜单保持打开并高亮新选中的元素 H');

  // 紧接着直接点底部 XHigh 思考等级 -> 生效且依然不自动关闭菜单
  const xhighBtn = inline.querySelector('[data-testid="agy-pm-detail-effort"][data-effort="xhigh"]');
  assert.ok(xhighBtn);
  xhighBtn.click();
  assert.equal(picked.length, 2);
  assert.equal(picked[1].label, 'Gemini 4 Hydrogen (XHigh)');
  assert.deepEqual(openStates, [], '选中思考等级后也不应自动关闭菜单');
  assert.ok(inline.querySelector('[data-testid="agy-pm-detail-effort"][data-effort="xhigh"].is-active'));
  dom.window.close();
});

test('数据未变化时重复 scanPanels 不会销毁重建思考等级按钮，杜绝 hover 跳变', () => {
  const { dom, panel } = bootEnv();
  const effortBtnBefore = panel.querySelector('[data-testid="agy-pm-detail-effort"][data-effort="high"]');
  assert.ok(effortBtnBefore);

  // 模拟定时兜底连续多次扫描
  dom.window.__AGY_PERIODIC_MODEL_API__.scanPanels();
  dom.window.__AGY_PERIODIC_MODEL_API__.scanPanels();
  dom.window.__AGY_PERIODIC_MODEL_API__.scanPanels();

  const effortBtnAfter = panel.querySelector('[data-testid="agy-pm-detail-effort"][data-effort="high"]');
  assert.strictEqual(effortBtnAfter, effortBtnBefore, '未变化时必须是同一个 DOM 节点，防止 hover 闪烁跳变');
  dom.window.close();
});

test('通过底部快捷调档位锁定元素并精确选择 XHigh 档位（保持菜单打开）', () => {
  const { dom, panel, picked, openStates } = bootEnv();
  panel.querySelector('[data-testid="agy-pm-quick-H"]').click();
  const xhighBtn = panel.querySelector('[data-testid="agy-pm-detail-effort"][data-effort="xhigh"]');
  assert.ok(xhighBtn);
  xhighBtn.click();

  assert.equal(picked.length, 1);
  assert.equal(picked[0].label, 'Gemini 4 Hydrogen (XHigh)');
  assert.deepEqual(openStates, []);
  dom.window.close();
});

test('二级菜单兼顾不在周期表里的模型，并支持精准选档位与搜索回车', () => {
  const { dom, panel, picked } = bootEnv();
  panel.querySelector('[data-testid="agy-pm-tab-other"]').click();
  const bases = [...panel.querySelectorAll('[data-testid="agy-pm-list-row"]')].map((r) => r.getAttribute('data-model-base'));
  assert.ok(bases.includes('Claude Opus 5.5'));
  assert.ok(bases.includes('Gemini 3.8 Flash'));
  assert.ok(bases.includes('Orchestrator (Neon)'));
  assert.ok(bases.includes('GPT-OSS 120B'));
  assert.ok(!bases.includes('Gemini 4 Neon'));

  // 在搜索框输入中文元素名并回车（沿用当前 High 思考等级）
  const search = panel.querySelector('[data-testid="agy-pm-search"]');
  search.value = '碳';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(picked.length, 1);
  assert.equal(picked[0].label, 'Gemini 4 Carbon (High)');
  dom.window.close();
});

test('可在原版列表与周期表之间原地无损来回切换；Best of N 模式自动透传原版', () => {
  const { dom, popover, panel, nativeList } = bootEnv();

  // 切到原版列表
  panel.querySelector('[data-testid="agy-pm-native-btn"]').click();
  assert.equal(popover.getAttribute('data-agy-pm-popover'), null);
  assert.equal(nativeList.getAttribute('data-agy-pm-hidden'), null);

  // 一键切回周期表
  panel.querySelector('[data-testid="agy-pm-back-periodic"]').click();
  assert.equal(popover.getAttribute('data-agy-pm-popover'), '1');
  assert.equal(nativeList.getAttribute('data-agy-pm-hidden'), '1');

  // Best of N 模式不替换原版
  const bon = bootEnv({ bestOfNConfig: { isBestOfNEnabled: true } });
  assert.equal(bon.panel.querySelector('[data-testid="agy-periodic-model-inline"]'), null);
  assert.equal(bon.nativeList.getAttribute('data-agy-pm-hidden'), null);
  dom.window.close();
  bon.dom.window.close();
});

test('模拟真实 Electron Isolated World -> webFrame.executeJavaScript(Main World) 延迟挂载自动原地替换', async () => {
  const mainDom = new JSDOM('<!doctype html><html class="dark"><body><button data-testid="model-selector-trigger">Gemini 4 Neon High</button></body></html>', {
    url: 'http://127.0.0.1:51917/',
    runScripts: 'outside-only',
  });
  const preloadCode = fs.readFileSync(PRELOAD_SCRIPT, 'utf8');
  let executedScripts = 0;

  // 在完全隔离的上下文模拟 dist/preload.js，只通过 webFrame.executeJavaScript 向 mainDom 注入
  const isolatedSandbox = {
    window: {
      document: { addEventListener() {} },
      location: { protocol: 'http:', hostname: '127.0.0.1' },
      addEventListener() {},
    },
    process: { argv: [] },
    require: (id) => {
      if (id === 'electron') {
        return {
          webFrame: {
            executeJavaScript(src) {
              executedScripts++;
              new vm.Script(src, { filename: 'main-world-injected.js' }).runInContext(mainDom.getInternalVMContext());
              return Promise.resolve();
            },
          },
        };
      }
      throw new Error('unexpected require: ' + id);
    },
  };
  isolatedSandbox.window.top = isolatedSandbox.window;
  isolatedSandbox.window.self = isolatedSandbox.window;
  isolatedSandbox.globalThis = isolatedSandbox.window;

  new vm.Script(preloadCode, { filename: 'periodic-model-preload.js' }).runInNewContext(isolatedSandbox);
  assert.equal(executedScripts, 1, '应通过 webFrame.executeJavaScript 注入到 Main World');

  // 延迟插入原生 model-selector-panel，且 Fiber 仅挂在 trigger 上测试兜底回查
  const models = sampleModels();
  const doc = mainDom.window.document;
  const trigger = doc.querySelector('[data-testid="model-selector-trigger"]');
  trigger.setAttribute('aria-expanded', 'true');
  trigger.__reactFiber$main = {
    memoizedProps: {},
    return: {
      memoizedProps: {
        selectedModel: models[0],
        setSelectedModel() {},
        modelOptions: models,
        modelSorts: [{ name: 'Recommended', groups: [{ groupName: '', options: models }] }],
        open: true,
        setIsOpen() {},
      },
      return: null,
    },
  };

  const popover = doc.createElement('div');
  popover.className = 'agy-overlay surface-glass';
  const panel = doc.createElement('div');
  panel.setAttribute('data-testid', 'model-selector-panel');
  panel.innerHTML = '<div><div data-testid="model-selector-header">模型</div></div>';
  popover.appendChild(panel);
  doc.body.appendChild(popover);

  await new Promise((r) => setTimeout(r, 80));
  assert.ok(panel.querySelector('[data-testid="agy-periodic-model-inline"]'), 'MutationObserver 应自动原地替换延迟挂载的面板');
  assert.equal(popover.getAttribute('data-agy-pm-popover'), '1');
  mainDom.window.close();
});

test('显示周额度而非 5 小时额度：按分组区分 Gemini 周额度与 Claude/GPT 周额度，且链式装饰器无冲突', async () => {
  const { dom, panel } = bootEnv();
  try {
    const api = dom.window.__AGY_PERIODIC_MODEL_API__;

    // 尚未拉取周额度时，绝不把 5h quotaInfo (98%) 冒充展示
    assert.equal(panel.querySelector('[data-testid="agy-pm-weekly-quota"]'), null);
    assert.doesNotMatch(panel.textContent, /98%/);

    // 通过链式 __JETSKI_LS_CLIENT_DECORATOR__ 模拟原生客户端调用 retrieveUserQuotaSummary
    const fakeClient = {
      async retrieveUserQuotaSummary() {
        return {
          response: {
            groups: [
              {
                displayName: 'Gemini Models',
                description: 'Models within this group: Gemini 4 Neon, Gemini 4 Carbon, Gemini 4 Argon, Gemini 4 Hydrogen, Orchestrator (Neon), Gemini 3.8 Flash',
                buckets: [
                  { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.4370533, resetTime: '2026-11-25T01:40:47Z' },
                  { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.9444208, resetTime: '2026-11-19T17:20:41Z' },
                ],
              },
              {
                displayName: 'Claude and GPT models',
                description: 'Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B',
                buckets: [
                  { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0.8956475, resetTime: '2026-11-25T17:09:51Z' },
                  { bucketId: '3p-5h', window: '5h', remainingFraction: 0.97373664, resetTime: '2026-11-19T19:58:53Z' },
                ],
              },
            ],
          },
        };
      },
    };
    const decorated = dom.window.__JETSKI_LS_CLIENT_DECORATOR__(fakeClient);
    await decorated.retrieveUserQuotaSummary();
    await new Promise((r) => setTimeout(r, 30));
    api.scanPanels();

    // 周期表底部详情条（Gemini 4 Neon）应显示 Gemini 周额度 44%，绝不是 5h 的 94%
    const detailQuota = panel.querySelector('[data-testid="agy-pm-detail-card"] [data-testid="agy-pm-weekly-quota"]');
    assert.ok(detailQuota);
    assert.equal(detailQuota.textContent, '周额度 44%');
    assert.doesNotMatch(panel.textContent, /94%/);

    // 切换到 Claude 分类应显示 3p 周额度 90%，绝不是 5h 的 97%
    panel.querySelector('[data-testid="agy-pm-tab-claude"]').click();
    const claudeQuota = panel.querySelector('[data-testid="agy-pm-list-row"] [data-testid="agy-pm-weekly-quota"]');
    assert.ok(claudeQuota);
    assert.equal(claudeQuota.textContent, '周额度 90%');
    assert.doesNotMatch(panel.textContent, /97%/);
  } finally {
    dom.window.close();
  }
});
