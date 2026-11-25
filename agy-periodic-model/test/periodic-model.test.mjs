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

test('原地替换原生下拉面板：不弹新窗、隐藏底部查看用量、去蓝点、且未支持元素禁用无预览不卡手', () => {
  const { dom, popover, panel, nativeList, nativeFooter, picked, openStates } = bootEnv();
  const doc = dom.window.document;

  // 不应创建全屏独立模态框
  assert.equal(doc.getElementById('agy-periodic-model-root'), null);
  assert.equal(popover.getAttribute('data-agy-pm-popover'), '1');
  assert.equal(nativeList.getAttribute('data-agy-pm-hidden'), '1');
  assert.equal(nativeFooter.getAttribute('data-agy-pm-hidden'), '1', '周期表模式下应隐藏底部原生查看用量区域');

  const inline = panel.querySelector('[data-testid="agy-periodic-model-inline"]');
  assert.ok(inline, '应在原生 panel 内部渲染周期表');
  assert.equal(inline.getAttribute('data-agy-zh-skip'), '1');
  assert.equal(inline.querySelectorAll('.agy-pm-tab-dot').length, 0, '顶部页签不应显示蓝点');

  for (const sym of ['H', 'C', 'Ne', 'Ar']) {
    const cell = inline.querySelector(`[data-testid="agy-pm-element-${sym}"]`);
    assert.ok(cell, `应渲染元素 ${sym}`);
    assert.equal(cell.getAttribute('data-supported'), 'true');
  }

  // 未支持元素 Na 应彻底禁用、无 title 提示、且悬停/聚焦不会切换详情卡
  const naCell = inline.querySelector('[data-testid="agy-pm-element-Na"]');
  assert.equal(naCell.getAttribute('data-supported'), 'false');
  assert.equal(naCell.disabled, true);
  assert.equal(naCell.getAttribute('title'), null);
  naCell.dispatchEvent(new dom.window.MouseEvent('mouseenter', { bubbles: false }));
  naCell.dispatchEvent(new dom.window.FocusEvent('focus', { bubbles: false }));
  const detail = inline.querySelector('[data-testid="agy-pm-detail-card"]');
  assert.match(detail.textContent, /Gemini 4 Neon/);
  assert.doesNotMatch(detail.textContent, /Sodium/);
  assert.equal(detail.getAttribute('data-supported'), 'true');
  assert.ok(detail.querySelectorAll('[data-testid="agy-pm-detail-effort"]').length > 0);

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
  const { dom, popover, panel, nativeList, nativeFooter } = bootEnv();

  // 切到原版列表
  panel.querySelector('[data-testid="agy-pm-native-btn"]').click();
  assert.equal(popover.getAttribute('data-agy-pm-popover'), null);
  assert.equal(nativeList.getAttribute('data-agy-pm-hidden'), null);
  assert.equal(nativeFooter.getAttribute('data-agy-pm-hidden'), null);

  // 一键切回周期表
  panel.querySelector('[data-testid="agy-pm-back-periodic"]').click();
  assert.equal(popover.getAttribute('data-agy-pm-popover'), '1');
  assert.equal(nativeList.getAttribute('data-agy-pm-hidden'), '1');
  assert.equal(nativeFooter.getAttribute('data-agy-pm-hidden'), '1');

  // Best of N 模式不替换原版
  const bon = bootEnv({ bestOfNConfig: { isBestOfNEnabled: true } });
  assert.equal(bon.panel.querySelector('[data-testid="agy-periodic-model-inline"]'), null);
  assert.equal(bon.nativeList.getAttribute('data-agy-pm-hidden'), null);
  assert.equal(bon.nativeFooter.getAttribute('data-agy-pm-hidden'), null);
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

test('右上角展示 4 个额度饼状图（含悬停说明），且详情卡与列表仅显示周额度不冒充 5 小时额度', async () => {
  const { dom, panel } = bootEnv();
  try {
    const api = dom.window.__AGY_PERIODIC_MODEL_API__;

    // 尚未拉取周额度时，详情卡绝不把 5h quotaInfo (98%) 冒充展示，顶部渲染 4 个占位饼图
    assert.equal(panel.querySelector('[data-testid="agy-pm-weekly-quota"]'), null);
    assert.doesNotMatch(panel.textContent, /98%/);
    const placeholderPies = [...panel.querySelectorAll('[data-testid="agy-pm-quota-pie"]')];
    assert.equal(placeholderPies.length, 4);
    assert.deepEqual(
      placeholderPies.map((p) => p.querySelector('.agy-pm-quota-pie-pct').textContent),
      ['--', '--', '--', '--'],
    );

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

    // 顶部右上角 4 个饼状图：含 SVG circle、百分比与悬停提示（指明是哪个额度）
    const piesWrap = panel.querySelector('[data-testid="agy-pm-quota-pies"]');
    assert.ok(piesWrap);
    const pies = [...piesWrap.querySelectorAll('[data-testid="agy-pm-quota-pie"]')];
    assert.equal(pies.length, 4);
    assert.deepEqual(
      pies.map((p) => p.querySelector('.agy-pm-quota-pie-pct').textContent),
      ['44%', '94%', '90%', '97%'],
    );
    assert.deepEqual(
      pies.map((p) => p.getAttribute('data-quota-title')),
      ['Gemini · 周额度', 'Gemini · 5h 额度', 'Claude / GPT · 周额度', 'Claude / GPT · 5h 额度'],
    );
    for (const pie of pies) {
      assert.equal(pie.querySelectorAll('svg circle').length, 2, '每个饼状图应含底圆与扇形 SVG circle');
      assert.equal(pie.getAttribute('title'), null, '应禁用系统原生 title 悬停框，避免双重提示');
      assert.ok(pie.querySelector('.agy-pm-quota-tip-title').textContent.length > 0);
      assert.match(pie.querySelector('.agy-pm-quota-tip-meta').textContent, /剩余 \d+%/);
    }

    // 周期表底部详情条（Gemini 4 Neon）应显示 Gemini 周额度 44%，绝不是 5h 的 94%
    const detailCard = panel.querySelector('[data-testid="agy-pm-detail-card"]');
    const detailQuota = detailCard.querySelector('[data-testid="agy-pm-weekly-quota"]');
    assert.ok(detailQuota);
    assert.equal(detailQuota.textContent, '周额度 44%');
    assert.doesNotMatch(detailCard.textContent, /94%/);

    // 切换到 Claude 分类应显示 3p 周额度 90%，绝不是 5h 的 97%
    panel.querySelector('[data-testid="agy-pm-tab-claude"]').click();
    const claudeRow = panel.querySelector('[data-testid="agy-pm-list-row"]');
    const claudeQuota = claudeRow.querySelector('[data-testid="agy-pm-weekly-quota"]');
    assert.ok(claudeQuota);
    assert.equal(claudeQuota.textContent, '周额度 90%');
    assert.doesNotMatch(claudeRow.textContent, /97%/);
  } finally {
    dom.window.close();
  }
});

test('统一 Orchestrator Planner 模式：选择 Carbon 的 Orchestrator 必须同步调用 orchestratorPick.select(Carbon)，绝不错误映射成 Neon', () => {
  const models = sampleModels().map((m) => {
    if (m.label === 'Orchestrator (Neon)') return { ...m, modelId: 'gemini-pro-orchestrator-neon' };
    if (m.label === 'Orchestrator (Carbon)') return { ...m, modelId: 'gemini-pro-orchestrator-carbon' };
    if (m.label === 'Orchestrator (Argon)') return { ...m, modelId: 'gemini-pro-orchestrator-argon' };
    return { ...m, modelId: m.label.toLowerCase().replace(/[^a-z0-9]+/g, '-') };
  });
  const planners = models.filter((m) => /^Gemini 4 (Neon|Carbon|Argon) /.test(m.label));
  const neonXHigh = models.find((m) => m.label === 'Gemini 4 Neon (XHigh)');
  const carbonHigh = models.find((m) => m.label === 'Gemini 4 Carbon (High)');
  const carbonMedium = models.find((m) => m.label === 'Gemini 4 Carbon (Medium)');

  const dom = new JSDOM('<!doctype html><html class="dark"><body><button data-testid="model-selector-trigger">Gemini 4 Neon High</button></body></html>', {
    url: 'http://127.0.0.1:51917/',
    runScripts: 'outside-only',
  });
  const code = fs.readFileSync(PRELOAD_SCRIPT, 'utf8');
  new vm.Script(code, { filename: 'periodic-model-preload.js' }).runInContext(dom.getInternalVMContext());

  try {
    const events = [];
    const openStates = [];
    const orchestratorPick = {
      model: 0, // UNSPECIFIED（默认会落回 Neon XHigh）
      select: (val) => {
        events.push({ type: 'planner', value: val });
        orchestratorPick.model = val;
      },
    };
    const outerCtrl = {
      selectedModel: models[0], // Gemini 4 Neon (High)
      setSelectedModel: (m) => {
        events.push({ type: 'model', label: m.label, value: m.value });
        outerCtrl.selectedModel = m;
      },
      modelOptions: models,
      modelSorts: [{ name: 'Recommended', groups: [{ groupName: '', options: models }] }],
      open: true,
      setIsOpen: (v) => openStates.push(v),
      customModels: [],
      bestOfNConfig: { isBestOfNEnabled: false },
      orchestratorPick,
    };
    // 模拟真实 Antigravity Fiber 链路：panel -> v7c.Provider (含 orchestratorPlanners/DefaultPlanner) -> J7c (外层不关菜单的 setSelectedModel)
    const providerValue = {
      ...outerCtrl,
      setSelectedModel: (m) => {
        outerCtrl.setSelectedModel(m);
        openStates.push(false);
      },
      orchestratorPlanners: planners,
      orchestratorDefaultPlanner: neonXHigh,
    };

    const doc = dom.window.document;
    const popover = doc.createElement('div');
    popover.className = 'agy-overlay surface-glass bg-card';
    const panel = doc.createElement('div');
    panel.setAttribute('data-testid', 'model-selector-panel');
    const nativeList = doc.createElement('div');
    nativeList.innerHTML = '<div data-testid="model-selector-header">Model</div><span data-testid="model-selector-orchestrator-model">Gemini 4 Neon Extra High</span>';
    panel.appendChild(nativeList);
    popover.appendChild(panel);
    panel.__reactFiber$test = {
      memoizedProps: {},
      return: {
        memoizedProps: { value: providerValue },
        return: {
          memoizedProps: outerCtrl,
          return: null,
        },
      },
    };
    doc.body.appendChild(popover);
    dom.window.__AGY_PERIODIC_MODEL_API__.scanPanels();

    // 1. 锁定 6 C (Carbon) 并点击 Orchestrator -> 必须先 orchestratorPick.select(427) 再 setSelectedModel(Orchestrator (Carbon))
    panel.querySelector('[data-testid="agy-pm-quick-C"]').click();
    const orchBtn = panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]');
    assert.ok(orchBtn);
    assert.equal(orchBtn.getAttribute('role'), 'switch');
    assert.equal(orchBtn.getAttribute('aria-checked'), 'false');
    orchBtn.click();

    assert.deepEqual(events, [
      { type: 'planner', value: carbonHigh.value },
      { type: 'model', label: 'Orchestrator (Carbon)', value: 667 },
    ]);
    assert.deepEqual(openStates, [], '应沿用外层 J7c 的 setSelectedModel，保持菜单打开');
    const activeOrchBtn = panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]');
    assert.ok(activeOrchBtn.classList.contains('is-active'));
    assert.equal(activeOrchBtn.getAttribute('aria-checked'), 'true');
    assert.equal(activeOrchBtn.textContent, 'Orchestrator');
    assert.ok(panel.querySelector('[data-testid="agy-pm-detail-effort"][data-effort="high"].is-active'));
    assert.match(panel.textContent, /Orchestrator · Gemini 4 Carbon \(High\)/);

    // 切到 Neon 预览时，Neon 的 Orchestrator 按钮不应错误高亮
    panel.querySelector('[data-testid="agy-pm-quick-Ne"]').click();
    assert.equal(panel.querySelector('[data-testid="agy-pm-detail-orchestrator"].is-active'), null);
    assert.equal(panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]').getAttribute('aria-checked'), 'false');

    // 2. 在 Orchestrator 分类页签里可直接精准选择 Carbon 的 Medium 规划器
    events.length = 0;
    panel.querySelector('[data-testid="agy-pm-tab-orchestrator"]').click();
    const carbonOrchRow = panel.querySelector('[data-testid="agy-pm-list-row"][data-model-base="Orchestrator · Gemini 4 Carbon"]');
    assert.ok(carbonOrchRow, 'Orchestrator 分类应按 planner 分组展示 Orchestrator · Gemini 4 Carbon');
    const medBtn = carbonOrchRow.querySelector('[data-testid="agy-pm-list-effort"][data-model-label="Gemini 4 Carbon (Medium)"]');
    assert.ok(medBtn);
    medBtn.click();

    assert.deepEqual(events, [
      { type: 'planner', value: carbonMedium.value },
      { type: 'model', label: 'Orchestrator (Carbon)', value: 667 },
    ]);
    assert.ok(
      panel.querySelector('[data-testid="agy-pm-list-row"][data-model-base="Orchestrator · Gemini 4 Carbon"] [data-model-label="Gemini 4 Carbon (Medium)"].is-active'),
    );

    // 3. 切回周期表后关闭 Carbon 的 Orchestrator 开关 -> 保留 Medium 档位退出；再次开启仍保留 Medium
    events.length = 0;
    panel.querySelector('[data-testid="agy-pm-tab-periodic"]').click();
    panel.querySelector('[data-testid="agy-pm-quick-C"]').click();
    panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]').click();
    assert.deepEqual(events, [
      { type: 'model', label: 'Gemini 4 Carbon (Medium)', value: carbonMedium.value },
    ]);
    assert.equal(panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]').getAttribute('aria-checked'), 'false');
    assert.ok(panel.querySelector('[data-testid="agy-pm-detail-effort"][data-effort="medium"].is-active'));

    events.length = 0;
    panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]').click();
    assert.deepEqual(events, [
      { type: 'planner', value: carbonMedium.value },
      { type: 'model', label: 'Orchestrator (Carbon)', value: 667 },
    ]);
    assert.equal(panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]').getAttribute('aria-checked'), 'true');
  } finally {
    dom.window.close();
  }
});

test('统一 Orchestrator 模式打开面板时，即便底层 selectedModel 是 Orchestrator (Neon)，只要 planner 为 Carbon 就自动锁定并高亮 Carbon', () => {
  const models = sampleModels().map((m) => {
    if (m.label === 'Orchestrator (Neon)') return { ...m, modelId: 'gemini-pro-orchestrator-neon' };
    if (m.label === 'Orchestrator (Carbon)') return { ...m, modelId: 'gemini-pro-orchestrator-carbon' };
    if (m.label === 'Orchestrator (Argon)') return { ...m, modelId: 'gemini-pro-orchestrator-argon' };
    return { ...m, modelId: m.label.toLowerCase().replace(/[^a-z0-9]+/g, '-') };
  });
  const planners = models.filter((m) => /^Gemini 4 (Neon|Carbon|Argon) /.test(m.label));
  const orchNeon = models.find((m) => m.label === 'Orchestrator (Neon)');
  const neonXHigh = models.find((m) => m.label === 'Gemini 4 Neon (XHigh)');

  const dom = new JSDOM('<!doctype html><html class="dark"><body></body></html>', {
    url: 'http://127.0.0.1:51917/',
    runScripts: 'outside-only',
  });
  new vm.Script(fs.readFileSync(PRELOAD_SCRIPT, 'utf8'), { filename: 'periodic-model-preload.js' }).runInContext(dom.getInternalVMContext());

  try {
    const outerCtrl = {
      selectedModel: orchNeon,
      setSelectedModel() {},
      modelOptions: models,
      modelSorts: [{ name: 'Recommended', groups: [{ groupName: '', options: models }] }],
      open: true,
      setIsOpen() {},
      customModels: [],
      bestOfNConfig: { isBestOfNEnabled: false },
      orchestratorPick: { model: 0, select() {} }, // UNSPECIFIED，依赖用户全局设置（由原生 DOM 文本透出）
    };
    const providerValue = {
      ...outerCtrl,
      orchestratorPlanners: planners,
      orchestratorDefaultPlanner: neonXHigh,
    };

    const doc = dom.window.document;
    const popover = doc.createElement('div');
    popover.className = 'agy-overlay';
    const panel = doc.createElement('div');
    panel.setAttribute('data-testid', 'model-selector-panel');
    const nativeList = doc.createElement('div');
    nativeList.innerHTML = '<div data-testid="model-selector-header">Model</div><span data-testid="model-selector-orchestrator-model">Gemini 4 Carbon High</span>';
    panel.appendChild(nativeList);
    popover.appendChild(panel);
    panel.__reactFiber$test = {
      memoizedProps: {},
      return: {
        memoizedProps: { value: providerValue },
        return: { memoizedProps: outerCtrl, return: null },
      },
    };
    doc.body.appendChild(popover);
    dom.window.__AGY_PERIODIC_MODEL_API__.scanPanels();

    const detail = panel.querySelector('[data-testid="agy-pm-detail-card"]');
    assert.match(detail.textContent, /Gemini 4 Carbon/);
    const orchSwitch = detail.querySelector('[data-testid="agy-pm-detail-orchestrator"]');
    assert.ok(orchSwitch.classList.contains('is-active'));
    assert.equal(orchSwitch.getAttribute('role'), 'switch');
    assert.equal(orchSwitch.getAttribute('aria-checked'), 'true');
    assert.equal(orchSwitch.textContent, 'Orchestrator');
    assert.ok(detail.querySelector('[data-testid="agy-pm-detail-effort"][data-effort="high"].is-active'));
  } finally {
    dom.window.close();
  }
});

test('Orchestrator 开关保留左侧思考等级 + 切元素就近降档（XHigh -> High，不掉到 Medium）', () => {
  const models = sampleModels().map((m) => {
    if (m.label === 'Orchestrator (Neon)') return { ...m, modelId: 'gemini-pro-orchestrator-neon' };
    if (m.label === 'Orchestrator (Carbon)') return { ...m, modelId: 'gemini-pro-orchestrator-carbon' };
    if (m.label === 'Orchestrator (Argon)') return { ...m, modelId: 'gemini-pro-orchestrator-argon' };
    return { ...m, modelId: m.label.toLowerCase().replace(/[^a-z0-9]+/g, '-') };
  });
  const planners = models.filter((m) => /^Gemini 4 (Neon|Carbon|Argon) /.test(m.label));
  const neonXHigh = models.find((m) => m.label === 'Gemini 4 Neon (XHigh)');
  const carbonHigh = models.find((m) => m.label === 'Gemini 4 Carbon (High)');
  const carbonMedium = models.find((m) => m.label === 'Gemini 4 Carbon (Medium)');
  const hydrogenHigh = models.find((m) => m.label === 'Gemini 4 Hydrogen (High)');

  const dom = new JSDOM('<!doctype html><html class="dark"><body></body></html>', {
    url: 'http://127.0.0.1:51917/',
    runScripts: 'outside-only',
  });
  new vm.Script(fs.readFileSync(PRELOAD_SCRIPT, 'utf8'), { filename: 'periodic-model-preload.js' }).runInContext(dom.getInternalVMContext());

  try {
    const events = [];
    const orchestratorPick = {
      model: 0,
      select: (val) => {
        events.push({ type: 'planner', value: val });
        orchestratorPick.model = val;
      },
    };
    const outerCtrl = {
      selectedModel: neonXHigh, // 起始在 Gemini 4 Neon (XHigh)
      setSelectedModel: (m) => {
        events.push({ type: 'model', label: m.label, value: m.value });
        outerCtrl.selectedModel = m;
      },
      modelOptions: models,
      modelSorts: [{ name: 'Recommended', groups: [{ groupName: '', options: models }] }],
      open: true,
      setIsOpen() {},
      customModels: [],
      bestOfNConfig: { isBestOfNEnabled: false },
      orchestratorPick,
    };
    const providerValue = {
      ...outerCtrl,
      orchestratorPlanners: planners,
      orchestratorDefaultPlanner: neonXHigh,
    };

    const doc = dom.window.document;
    const popover = doc.createElement('div');
    popover.className = 'agy-overlay';
    const panel = doc.createElement('div');
    panel.setAttribute('data-testid', 'model-selector-panel');
    const nativeList = doc.createElement('div');
    nativeList.innerHTML = '<div data-testid="model-selector-header">Model</div><span data-testid="model-selector-orchestrator-model">Gemini 4 Neon Extra High</span>';
    panel.appendChild(nativeList);
    popover.appendChild(panel);
    panel.__reactFiber$test = {
      memoizedProps: {},
      return: {
        memoizedProps: { value: providerValue },
        return: { memoizedProps: outerCtrl, return: null },
      },
    };
    doc.body.appendChild(popover);
    dom.window.__AGY_PERIODIC_MODEL_API__.scanPanels();

    // 1. 从 Neon (XHigh) 点 6 C -> 就近降档为 Gemini 4 Carbon (High)，绝不掉到 Medium
    panel.querySelector('[data-testid="agy-pm-element-C"]').click();
    assert.deepEqual(events, [
      { type: 'model', label: 'Gemini 4 Carbon (High)', value: carbonHigh.value },
    ]);

    // 2. 在 Carbon (High) 上打开 Orchestrator 开关 -> 沿用 High
    events.length = 0;
    panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]').click();
    assert.deepEqual(events, [
      { type: 'planner', value: carbonHigh.value },
      { type: 'model', label: 'Orchestrator (Carbon)', value: 667 },
    ]);
    assert.ok(panel.querySelector('[data-testid="agy-pm-element-C"].is-selected'));
    assert.ok(panel.querySelector('[data-testid="agy-pm-detail-effort"][data-effort="high"].is-active'));
    assert.equal(panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]').getAttribute('aria-checked'), 'true');

    // 3. Orchestrator 开启状态下点左侧 Medium -> 保持 Orchestrator 开启，只改规划器到 Medium
    events.length = 0;
    panel.querySelector('[data-testid="agy-pm-detail-effort"][data-effort="medium"]').click();
    assert.deepEqual(events, [
      { type: 'planner', value: carbonMedium.value },
      { type: 'model', label: 'Orchestrator (Carbon)', value: 667 },
    ]);
    assert.ok(panel.querySelector('[data-testid="agy-pm-detail-effort"][data-effort="medium"].is-active'));
    assert.equal(panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]').getAttribute('aria-checked'), 'true');

    // 4. 关闭 Orchestrator 开关 -> 退出到普通 Gemini 4 Carbon (Medium)，保留 Medium
    events.length = 0;
    panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]').click();
    assert.deepEqual(events, [
      { type: 'model', label: 'Gemini 4 Carbon (Medium)', value: carbonMedium.value },
    ]);
    assert.ok(panel.querySelector('[data-testid="agy-pm-detail-effort"][data-effort="medium"].is-active'));
    assert.equal(panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]').getAttribute('aria-checked'), 'false');

    // 5. 再次打开 Orchestrator 开关 -> 仍保留 Medium
    events.length = 0;
    panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]').click();
    assert.deepEqual(events, [
      { type: 'planner', value: carbonMedium.value },
      { type: 'model', label: 'Orchestrator (Carbon)', value: 667 },
    ]);
    assert.equal(panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]').getAttribute('aria-checked'), 'true');

    // 6. 在 Orchestrator · Neon (XHigh) 下点 6 C -> 保持 Orchestrator 模式并就近降档到 Carbon (High)
    events.length = 0;
    panel.querySelector('[data-testid="agy-pm-element-Ne"]').click();
    panel.querySelector('[data-testid="agy-pm-detail-effort"][data-effort="xhigh"]').click();
    assert.equal(orchestratorPick.model, neonXHigh.value);

    events.length = 0;
    panel.querySelector('[data-testid="agy-pm-element-C"]').click();
    assert.deepEqual(events, [
      { type: 'planner', value: carbonHigh.value },
      { type: 'model', label: 'Orchestrator (Carbon)', value: 667 },
    ]);
    assert.equal(panel.querySelector('[data-testid="agy-pm-detail-orchestrator"]').getAttribute('aria-checked'), 'true');

    // 7. 在 Orchestrator · Carbon (High) 下点击不支持 Orchestrator 的 1 H -> 退回普通 Gemini 4 Hydrogen (High)，保留 High
    events.length = 0;
    panel.querySelector('[data-testid="agy-pm-element-H"]').click();
    assert.deepEqual(events, [
      { type: 'model', label: 'Gemini 4 Hydrogen (High)', value: hydrogenHigh.value },
    ]);
  } finally {
    dom.window.close();
  }
});

test('顶栏原版按钮右侧展示平均等效月API费用：$xx（按Neon计算），并随状态同步更新', async () => {
  const { dom, panel } = bootEnv();
  try {
    const tools = panel.querySelector('.agy-pm-tools');
    assert.ok(tools);
    const nativeBtn = tools.querySelector('[data-testid="agy-pm-native-btn"]');
    const equivBox = tools.querySelector('[data-testid="agy-pm-equiv-cost"]');
    assert.ok(nativeBtn && equivBox, '应在原版按钮右侧渲染等效月 API 费用栏');
    assert.equal(nativeBtn.nextElementSibling, equivBox.parentElement);
    assert.equal(equivBox.querySelector('.agy-pm-equiv-cost-text').textContent, '平均等效月API费用：--（按Neon计算）');

    dom.window.__AGY_PERIODIC_MODEL_API__.setEquivCostState({
      activeEmail: 'u1@gmail.com',
      activeTier: 'ultra',
      activeTierLabel: 'Google AI Ultra',
      avgMonthlyUsd: 245.4,
      accountBreakdown: [
        { email: 'u1@gmail.com', avgMonthlyUsd: 210, sampleCount: 3 },
        { email: 'u2@gmail.com', avgMonthlyUsd: 280.8, sampleCount: 1 },
      ],
      totalMatchedSamples: 4,
      totalRecords: 6,
      maxRecords: 20,
      neonPricing: { inputPerMillion: 2, cacheReadPerMillion: 0.2, outputPerMillion: 12, source: 'live' },
    });

    const updatedBox = panel.querySelector('[data-testid="agy-pm-equiv-cost"]');
    assert.equal(updatedBox.querySelector('.agy-pm-equiv-cost-text').textContent, '平均等效月API费用：$245（按Neon计算）');
    const styleText = panel.ownerDocument.getElementById('agy-periodic-model-style')?.textContent || '';
    assert.doesNotMatch(styleText, /\.agy-pm-equiv-cost[^}]*line-height:\s*1\b/, '等效费用文本行高不得为 1，防止裁剪中文字符下沿');
    assert.match(styleText, /\.agy-pm-equiv-cost-text[^}]*line-height:\s*25px/);
    assert.match(updatedBox.textContent, /Google AI Ultra · Ultra\/Pro 不混合/);
    assert.match(updatedBox.textContent, /u1@gmail\.com：\$210\/月（3 次采样均值）/);
    assert.match(updatedBox.textContent, /最近 6\/20 次/);

    // 重复扫描不变数据时不重建等效费用节点
    const boxRef = updatedBox;
    dom.window.__AGY_PERIODIC_MODEL_API__.scanPanels();
    assert.equal(panel.querySelector('[data-testid="agy-pm-equiv-cost"]'), boxRef);
  } finally {
    dom.window.close();
  }
});
