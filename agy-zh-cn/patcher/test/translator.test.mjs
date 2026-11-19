// translator.js 运行时行为测试（jsdom）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, '..', 'translator.js'), 'utf8');

const DICT = {
  meta: {},
  exact: {
    Settings: '设置', Delete: '删除', 'Background Tasks': '后台任务', 'Search conversations': '搜索对话',
    'Close panel': '关闭面板', 'Send message': '发送消息', 'Agent Manager': 'Agent 管理器', Untouched: null,
  },
  patterns: {
    '{0} files changed': '已更改 {0} 个文件',
    'Delete {0}': '删除 {0}',
    'Delete {0} files': '删除 {0} 个文件',
    'Running {0} tasks': '正在运行 {0} 个任务',
    '{0} of {1}': '第 {0} 个，共 {1} 个',
  },
};

const flush = () => new Promise((r) => setImmediate(r));
async function setup(html, dict = DICT) {
  const dom = new JSDOM(`<!doctype html><html><head><title>Settings</title></head><body>${html}</body></html>`, { runScripts: 'outside-only' });
  const code = SRC.replace('/*__AGY_ZH_DICT__*/{}', () => JSON.stringify(dict));
  dom.window.eval(code);
  // jsdom 里脚本执行时 readyState 还是 loading，与 Electron preload 相同，等 DOMContentLoaded
  if (dom.window.document.readyState === 'loading') await new Promise((r) => dom.window.document.addEventListener('DOMContentLoaded', r, { once: true }));
  return { dom, win: dom.window, doc: dom.window.document, api: dom.window.__AGY_ZH__ };
}

test('exact：整段匹配、保留首尾空白、大小写敏感、null 不翻译', async () => {
  const { doc } = await setup('<button id="a">Settings</button><p id="b">  Background Tasks \n</p><i id="c">settings</i><i id="d">Untouched</i><i id="e">Settings page</i>');
  assert.equal(doc.getElementById('a').textContent, '设置');
  assert.equal(doc.getElementById('b').textContent, '  后台任务 \n');
  assert.equal(doc.getElementById('c').textContent, 'settings');
  assert.equal(doc.getElementById('d').textContent, 'Untouched');
  assert.equal(doc.getElementById('e').textContent, 'Settings page');
});

test('patterns：占位符回填、递归翻译一层、更具体的模式优先', async () => {
  const { doc, api } = await setup('<p id="a">12 files changed</p><p id="b">Delete Settings</p><p id="c">Delete 3 files</p><p id="d">Delete foo.txt</p><p id="e">2 of 5</p>');
  assert.equal(doc.getElementById('a').textContent, '已更改 12 个文件');
  assert.equal(doc.getElementById('b').textContent, '删除 设置');
  assert.equal(doc.getElementById('c').textContent, '删除 3 个文件');
  assert.equal(doc.getElementById('d').textContent, '删除 foo.txt');
  assert.equal(doc.getElementById('e').textContent, '第 2 个，共 5 个');
  assert.equal(api.tr('nothing here'), null);
});

function groupSpan(doc, parts) {
  const span = doc.createElement('span');
  for (const p of parts) span.appendChild(doc.createTextNode(p));
  return span;
}

test('group：多个相邻文本节点拼接后匹配，译文写入第一个节点，其余置空', async () => {
  const { doc } = await setup('<div id="root"></div>');
  const span = groupSpan(doc, ['Running ', '3', ' tasks']);
  doc.getElementById('root').appendChild(span);
  await flush();
  assert.equal(span.textContent, '正在运行 3 个任务');
  assert.equal(span.childNodes[0].data, '正在运行 3 个任务');
  assert.equal(span.childNodes[1].data, '');
  assert.equal(span.childNodes[2].data, '');
});

test('group：React 改写某个节点后重新拼接翻译，不出现中英混杂', async () => {
  const { doc } = await setup('<div id="root"></div>');
  const span = groupSpan(doc, ['Running ', '3', ' tasks']);
  doc.getElementById('root').appendChild(span);
  await flush();
  // React 只会改值发生变化的那个文本节点
  span.childNodes[1].data = '5';
  await flush();
  assert.equal(span.textContent, '正在运行 5 个任务');
  // 改成不在词典里的句子：应完整恢复英文，而不是半中半英
  span.childNodes[0].data = 'Stopped ';
  await flush();
  assert.equal(span.textContent, 'Stopped 5 tasks');
  // 再改回来，又能整句翻译
  span.childNodes[0].data = 'Running ';
  span.childNodes[1].data = '7';
  await flush();
  assert.equal(span.textContent, '正在运行 7 个任务');
});

test('增量：新增节点、文本改写、单文本节点替换都会翻译', async () => {
  const { doc } = await setup('<div id="root"><b id="x">Settings</b></div>');
  const root = doc.getElementById('root');
  const div = doc.createElement('div');
  div.innerHTML = '<ul><li>Delete</li><li><a title="Close panel">Background Tasks</a></li></ul>';
  root.appendChild(div);
  await flush();
  assert.equal(div.querySelectorAll('li')[0].textContent, '删除');
  assert.equal(div.querySelector('a').textContent, '后台任务');
  assert.equal(div.querySelector('a').getAttribute('title'), '关闭面板');
  const x = doc.getElementById('x');
  x.firstChild.data = 'Delete';           // React 的 commitTextUpdate
  await flush();
  assert.equal(x.textContent, '删除');
  x.textContent = '4 files changed';     // React 的 setTextContent
  await flush();
  assert.equal(x.textContent, '已更改 4 个文件');
});

test('跳过区域：代码、编辑器、终端、可编辑区、Markdown、用户消息、手动标记', async () => {
  const skipHtml = [
    '<pre>Settings</pre>', '<code>Settings</code>', '<textarea placeholder="Send message">Settings</textarea>',
    '<div contenteditable="true" aria-label="Send message"><p>Settings</p></div>', '<div class="monaco-editor"><span>Settings</span></div>',
    '<div class="xterm"><span>Settings</span></div>', '<div data-agy-zh-skip><span>Settings</span></div>',
    '<div data-markdown-root=""><p>Settings</p><p><span>Delete</span></p></div>',
    '<div class="agy-user-bubble"><span>Settings</span></div>', '<div data-testid="user-message-bubble"><span>Settings</span></div>',
    '<div data-testid="live-agent-turn"><span>Settings</span></div>',
  ].join('');
  const { doc } = await setup(`<div id="root">${skipHtml}<input type="text" value="Settings" placeholder="Search conversations"><span id="ok">Settings</span></div>`);
  const root = doc.getElementById('root');
  assert.equal(doc.getElementById('ok').textContent, '设置');
  assert.equal(doc.querySelector('pre').textContent, 'Settings');
  assert.equal(doc.querySelector('code').textContent, 'Settings');
  assert.equal(doc.querySelector('textarea').value, 'Settings');
  assert.equal(doc.querySelector('textarea').getAttribute('placeholder'), '发送消息'); // 输入框本身的提示文字照常翻译
  assert.equal(doc.querySelector('[contenteditable] p').textContent, 'Settings');
  assert.equal(doc.querySelector('[contenteditable]').getAttribute('aria-label'), '发送消息');
  assert.equal(doc.querySelector('input').value, 'Settings');
  assert.equal(doc.querySelector('input').getAttribute('placeholder'), '搜索对话');
  for (const sel of ['.monaco-editor span', '.xterm span', '[data-agy-zh-skip] span', '[data-markdown-root] p',
    '.agy-user-bubble span', '[data-testid="user-message-bubble"] span', '[data-testid="live-agent-turn"] span']) {
    assert.equal(doc.querySelector(sel).textContent, 'Settings', sel);
  }
  // 动态插入到跳过区域里的内容也不翻译
  const md = doc.querySelector('[data-markdown-root]');
  const p = doc.createElement('p'); p.textContent = 'Delete'; md.appendChild(p);
  md.querySelector('span').firstChild.data = 'Settings';
  doc.querySelector('pre').firstChild.data = 'Delete';
  await flush();
  assert.equal(p.textContent, 'Delete');
  assert.equal(md.querySelector('span').textContent, 'Settings');
  assert.equal(doc.querySelector('pre').textContent, 'Delete');
  assert.ok(root);
});

test('属性：title / placeholder / aria-label，React 改写属性后重新翻译', async () => {
  const { doc } = await setup('<button id="b" title="Delete" aria-label="Close panel" data-x="Settings">x</button><input id="i" placeholder="Search conversations">');
  const b = doc.getElementById('b');
  assert.equal(b.getAttribute('title'), '删除');
  assert.equal(b.getAttribute('aria-label'), '关闭面板');
  assert.equal(b.getAttribute('data-x'), 'Settings');
  assert.equal(doc.getElementById('i').getAttribute('placeholder'), '搜索对话');
  b.setAttribute('title', '3 files changed');
  await flush();
  assert.equal(b.getAttribute('title'), '已更改 3 个文件');
  b.setAttribute('title', 'Custom label');
  await flush();
  assert.equal(b.getAttribute('title'), 'Custom label');
});

test('死循环防护：翻译后不再产生变更；与其他脚本来回改写时会熔断', async () => {
  const { win, doc, api } = await setup('<div id="root"><span id="s">Settings</span><span id="g"></span></div>');
  const g = doc.getElementById('g');
  g.append(doc.createTextNode('Running '), doc.createTextNode('2'), doc.createTextNode(' tasks'));
  await flush(); await flush();
  // 稳定后再观察一段时间，不应再有任何写入
  let records = 0;
  const watch = new win.MutationObserver((l) => { records += l.length; });
  watch.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  const w0 = api.stats.writes;
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(records, 0);
  assert.equal(api.stats.writes, w0);
  watch.disconnect();

  // 一个“敌对”脚本：每次看到中文就改回英文
  const s = doc.getElementById('s');
  const hostile = new win.MutationObserver(() => { if (s.firstChild.data !== 'Settings') s.firstChild.data = 'Settings'; });
  hostile.observe(s, { subtree: true, characterData: true });
  s.firstChild.data = 'Delete';
  for (let i = 0; i < 200; i++) await flush();
  hostile.disconnect();
  assert.ok(api.stats.frozen >= 1, '应触发熔断');
  const w1 = api.stats.writes;
  for (let i = 0; i < 20; i++) await flush();
  assert.equal(api.stats.writes, w1, '熔断后不再写入');
});

test('document.title：初始标题与后续修改都翻译', async () => {
  const { doc } = await setup('<p>x</p>');
  assert.equal(doc.title, '设置');
  doc.title = 'Delete';
  await flush();
  assert.equal(doc.title, '删除');
  doc.title = '9 files changed';
  await flush();
  assert.equal(doc.title, '已更改 9 个文件');
});

test('未注入词典时脚本原样运行不报错、不做任何事', async () => {
  const dom = new JSDOM('<!doctype html><body><p id="a">Settings</p></body>', { runScripts: 'outside-only' });
  dom.window.eval(SRC);
  assert.equal(dom.window.document.getElementById('a').textContent, 'Settings');
  assert.equal(dom.window.__AGY_ZH__, undefined);
});

test('性能：大词典 + 数千节点的首屏遍历', async () => {
  const exact = {}, patterns = {};
  for (let i = 0; i < 3000; i++) exact[`Menu item number ${i}`] = `菜单项 ${i}`;
  for (let i = 0; i < 800; i++) patterns[`Option ${i} has {0} values`] = `选项 ${i} 有 {0} 个值`;
  Object.assign(exact, DICT.exact); Object.assign(patterns, DICT.patterns);
  const rows = [];
  for (let i = 0; i < 1500; i++) {
    rows.push(`<div class="row" title="Delete"><span>Menu item number ${i}</span><span>Option ${i % 800} has ${i} values</span><span>user text ${i} that does not match</span><span>Running <!-- -->${i}<!-- --> tasks</span></div>`);
  }
  const { doc, api } = await setup(`<div id="root">${rows.join('')}</div>`, { meta: {}, exact, patterns });
  const ms = api.stats.lastScanMs;
  console.log(`  首屏遍历 ${doc.querySelectorAll('span').length} 个元素用时 ${ms.toFixed(1)} ms（jsdom，远慢于 Chromium）`);
  assert.equal(doc.querySelector('.row span').textContent, '菜单项 0');
  assert.equal(doc.querySelectorAll('.row span')[1].textContent, '选项 0 有 0 个值');
  assert.equal(doc.querySelectorAll('.row span')[3].textContent, '正在运行 0 个任务'); // 夹着注释节点的分组
  assert.equal(doc.querySelector('.row').getAttribute('title'), '删除');
  assert.ok(ms < 1500, `遍历耗时 ${ms} ms`);
  // 再扫一遍（全部命中缓存与 written 记录），应更快
  api.scan(doc.getElementById('root'));
  console.log(`  二次遍历用时 ${api.stats.lastScanMs.toFixed(1)} ms`);
});

test('单复数后缀 {n}：译文省略时单数、复数都能匹配同一条 pattern', async () => {
  const dict = {
    meta: {},
    exact: {},
    patterns: {
      '{0} tool{1} enabled': '已启用 {0} 个 Tool',
      'Push {0} commit{1} to {2}': '将 {0} 个 Commit 推送到 {2}',
      'Show all subagent{0}': '显示全部子 Agent',
      'Review {0} comment{1}': '审查 {0} 条评论{1}', // 译文用到了 {1}：按普通占位符处理
    },
  };
  const { doc, api } = await setup('<p id="a">1 tool enabled</p><p id="b">3 tools enabled</p><p id="c"></p>', dict);
  assert.equal(doc.getElementById('a').textContent, '已启用 1 个 Tool');
  assert.equal(doc.getElementById('b').textContent, '已启用 3 个 Tool');
  assert.equal(api.tr('Push 1 commit to origin/main'), '将 1 个 Commit 推送到 origin/main');
  assert.equal(api.tr('Push 12 commits to origin'), '将 12 个 Commit 推送到 origin');
  assert.equal(api.tr('Show all subagent'), '显示全部子 Agent');
  assert.equal(api.tr('Show all subagents'), '显示全部子 Agent');
  assert.equal(api.tr('3 toolsXenabled'), null);
  assert.equal(api.tr('3 toolbox enabled'), null);           // 后缀只允许 s/es/ies，不会误吞
  assert.equal(api.tr('Review 2 comments!'), '审查 2 条评论s!');
  // React 分组渲染：createElement("p", null, n, " tool", n === 1 ? "" : "s", " enabled")
  const c = doc.getElementById('c');
  c.append(doc.createTextNode('2'), doc.createTextNode(' tool'), doc.createTextNode('s'), doc.createTextNode(' enabled'));
  await flush();
  assert.equal(c.textContent, '已启用 2 个 Tool');
  c.childNodes[0].data = '1'; c.childNodes[2].data = '';
  await flush();
  assert.equal(c.textContent, '已启用 1 个 Tool');
});

test('Toast 与 NUX 卡片内的 [data-markdown-root] 豁免翻译，内部代码仍跳过，普通聊天正文继续跳过', async () => {
  const dict = {
    meta: {},
    exact: {
      Settings: '设置',
      Delete: '删除',
      'Send message': '发送消息',
      'Search conversations': '搜索对话',
      'View archived in the sidebar (': '在侧边栏（',
      'menu).': '菜单）中查看已归档内容。',
      'Introducing Gemini 4 Neon': '推出 Gemini 4 Neon',
      'Our best balance of intelligence, cost, and latency. Get building today with Neon.': '智能、成本与延迟的最佳平衡。立即使用 Neon 开始构建。',
    },
    patterns: {
      '{0} of {1}': '{0} / {1}',
    },
  };
  const html = [
    '<div data-testid="toast-notification"><div data-markdown-root="">',
    '<p id="toast-msg">View archived in the sidebar (<svg aria-hidden="true"></svg> menu).</p>',
    '<code id="toast-code">Settings</code><pre id="toast-pre">Delete</pre><kbd id="toast-kbd">Settings</kbd>',
    '<textarea id="toast-ta" placeholder="Send message">Settings</textarea>',
    '<input id="toast-in" placeholder="Search conversations" value="Settings">',
    '<div id="toast-ce" contenteditable="true" aria-label="Send message"><p>Settings</p></div>',
    '</div></div>',
    '<div data-testid="nux-card"><div data-markdown-root="">',
    '<h3 id="nux-title">Introducing Gemini 4 Neon</h3>',
    '<p id="nux-body">Our best balance of intelligence, cost, and latency. Get building today with Neon.</p>',
    '<code id="nux-code">Settings</code>',
    '</div></div>',
    '<div id="chat-md" data-markdown-root=""><p id="chat-p">Settings</p><p id="chat-neon">Our best balance of intelligence, cost, and latency. Get building today with Neon.</p></div>',
  ].join('');

  const { doc, api } = await setup(html, dict);
  // Toast 内拆分文本节点（中间夹 <svg>）被正确翻译，保留前导空格
  const toastMsg = doc.getElementById('toast-msg');
  assert.equal(toastMsg.childNodes[0].data, '在侧边栏（');
  assert.equal(toastMsg.childNodes[1].tagName.toLowerCase(), 'svg');
  assert.equal(toastMsg.childNodes[2].data, ' 菜单）中查看已归档内容。');
  // Toast 内的代码与输入内容依然严格跳过，输入框属性正常翻译
  assert.equal(doc.getElementById('toast-code').textContent, 'Settings');
  assert.equal(doc.getElementById('toast-pre').textContent, 'Delete');
  assert.equal(doc.getElementById('toast-kbd').textContent, 'Settings');
  assert.equal(doc.getElementById('toast-ta').value, 'Settings');
  assert.equal(doc.getElementById('toast-ta').getAttribute('placeholder'), '发送消息');
  assert.equal(doc.getElementById('toast-in').value, 'Settings');
  assert.equal(doc.getElementById('toast-in').getAttribute('placeholder'), '搜索对话');
  assert.equal(doc.getElementById('toast-ce').querySelector('p').textContent, 'Settings');
  assert.equal(doc.getElementById('toast-ce').getAttribute('aria-label'), '发送消息');
  // NUX 卡片内 Markdown 正文被正确翻译，且内部 code 跳过
  assert.equal(doc.getElementById('nux-title').textContent, '推出 Gemini 4 Neon');
  assert.equal(doc.getElementById('nux-body').textContent, '智能、成本与延迟的最佳平衡。立即使用 Neon 开始构建。');
  assert.equal(doc.getElementById('nux-code').textContent, 'Settings');
  // 普通聊天正文 [data-markdown-root] 依然 100% 跳过
  assert.equal(doc.getElementById('chat-p').textContent, 'Settings');
  assert.equal(doc.getElementById('chat-neon').textContent, 'Our best balance of intelligence, cost, and latency. Get building today with Neon.');

  // 动态插入与更新：Toast/NUX 放行、其内部 code 跳过、普通聊天 Markdown 跳过
  const dynNux = doc.createElement('p');
  dynNux.textContent = 'Delete';
  doc.querySelector('[data-testid="nux-card"] [data-markdown-root]').appendChild(dynNux);
  const dynCodeSpan = doc.createElement('span');
  dynCodeSpan.textContent = 'Delete';
  doc.getElementById('toast-code').appendChild(dynCodeSpan);
  const dynChat = doc.createElement('p');
  dynChat.textContent = 'Delete';
  doc.getElementById('chat-md').appendChild(dynChat);
  await flush();
  assert.equal(dynNux.textContent, '删除');
  assert.equal(dynCodeSpan.textContent, 'Delete');
  assert.equal(dynChat.textContent, 'Delete');
  // 手动 scan 普通聊天内部元素同样跳过
  api.scan(doc.getElementById('chat-p'));
  assert.equal(doc.getElementById('chat-p').textContent, 'Settings');
});

test('Electron IPC 拦截：window:show-context-menu 与 notification:send', async () => {
  const dict = {
    meta: {},
    exact: {
      Rename: '重命名',
      Archive: '归档',
      Delete: '删除',
      'More Actions': '更多操作',
      'Pin conversation': '置顶对话',
      'Dangerous action': '危险操作',
      'Secondary hint': '辅助说明',
      'Task completed': '任务已完成',
      'Agent finished running': 'Agent 已完成运行',
    },
    patterns: {
      'Delete {0}': '删除 {0}',
    },
  };
  const { api } = await setup('<p>x</p>', dict);

  const calls = [];
  const mockIpc = {
    invoke(channel, payload, extra) {
      calls.push({ channel, payload, extra });
      return Promise.resolve('ok');
    },
  };
  assert.equal(api.installIpcHook(mockIpc), true);
  // 重复安装保持幂等，不重复包装
  const wrappedFn = mockIpc.invoke;
  assert.equal(api.installIpcHook(mockIpc), true);
  assert.equal(mockIpc.invoke, wrappedFn);

  const origMenu = [
    { id: 'rename', type: 'normal', label: 'Rename', accelerator: 'F2', checked: false, disabled: false },
    { type: 'separator' },
    {
      id: 'more',
      label: 'More Actions',
      sublabel: 'Secondary hint',
      toolTip: 'Dangerous action',
      submenu: [
        { id: 'pin', label: 'Pin conversation', checked: true },
        { id: 'del', label: 'Delete foo.txt', disabled: true },
        { id: 'unmatched', label: 'Export Raw Trace' },
      ],
    },
    {
      id: 'nested-items',
      label: 'Archive',
      items: [{ id: 'sub-del', label: 'Delete' }],
    },
  ];
  const res = await mockIpc.invoke('window:show-context-menu', origMenu, { x: 10 });
  assert.equal(res, 'ok');
  assert.equal(calls.length, 1);
  const sentMenu = calls[0].payload;
  assert.deepEqual(calls[0].extra, { x: 10 });
  // 不修改调用方原对象
  assert.equal(origMenu[0].label, 'Rename');
  assert.equal(origMenu[2].submenu[0].label, 'Pin conversation');
  // 翻译结果与元数据保留
  assert.equal(sentMenu[0].label, '重命名');
  assert.equal(sentMenu[0].id, 'rename');
  assert.equal(sentMenu[0].type, 'normal');
  assert.equal(sentMenu[0].accelerator, 'F2');
  assert.equal(sentMenu[0].checked, false);
  assert.equal(sentMenu[0].disabled, false);
  assert.deepEqual({ ...sentMenu[1] }, { type: 'separator' });
  assert.equal(sentMenu[2].label, '更多操作');
  assert.equal(sentMenu[2].sublabel, '辅助说明');
  assert.equal(sentMenu[2].toolTip, '危险操作');
  assert.equal(sentMenu[2].submenu[0].label, '置顶对话');
  assert.equal(sentMenu[2].submenu[0].checked, true);
  assert.equal(sentMenu[2].submenu[1].label, '删除 foo.txt');
  assert.equal(sentMenu[2].submenu[1].disabled, true);
  assert.equal(sentMenu[2].submenu[2].label, 'Export Raw Trace');
  assert.equal(sentMenu[3].label, '归档');
  assert.equal(sentMenu[3].items[0].label, '删除');
  // 未命中 label 录入 misses 漏译池
  assert.ok(api.misses.has('Export Raw Trace'));

  // notification:send 拦截与浅克隆
  const origNote = { title: 'Task completed', body: 'Agent finished running', silent: true, tag: 't1' };
  await mockIpc.invoke('notification:send', origNote);
  assert.equal(origNote.title, 'Task completed');
  assert.equal(calls[1].payload.title, '任务已完成');
  assert.equal(calls[1].payload.body, 'Agent 已完成运行');
  assert.equal(calls[1].payload.silent, true);
  assert.equal(calls[1].payload.tag, 't1');

  // 非目标频道原样透传
  const other = { label: 'Rename' };
  await mockIpc.invoke('other:channel', other);
  assert.equal(calls[2].payload, other);

  // 只读 invoke 属性（getter-only / writable:false）通过 Object.defineProperty 挂载成功
  const roCalls = [];
  const roIpc = {};
  Object.defineProperty(roIpc, 'invoke', {
    value: (ch, arg) => { roCalls.push({ ch, arg }); return Promise.resolve(1); },
    writable: false,
    configurable: true,
  });
  assert.equal(api.installIpcHook(roIpc), true);
  await roIpc.invoke('window:show-context-menu', [{ id: 'a', label: 'Rename' }]);
  assert.equal(roCalls[0].arg[0].label, '重命名');
});

test('Electron preload 环境：在 DOMContentLoaded 之前自动检测 electron_1.ipcRenderer 并挂载', async () => {
  const dom = new JSDOM('<!doctype html><html><body><p>Settings</p></body></html>', { runScripts: 'outside-only' });
  const code = SRC.replace('/*__AGY_ZH_DICT__*/{}', () => JSON.stringify(DICT));
  const captured = [];
  dom.window.__MOCK_CAPTURED__ = captured;
  dom.window.eval(`
    const electron_1 = {
      ipcRenderer: {
        invoke(ch, arg) { window.__MOCK_CAPTURED__.push({ ch, arg }); return Promise.resolve(true); }
      }
    };
    ${code}
    // 紧接脚本执行（无需等 DOMContentLoaded）立刻调用 IPC，应已被拦截翻译
    electron_1.ipcRenderer.invoke('window:show-context-menu', [{ id: 's', label: 'Settings' }]);
  `);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].arg[0].label, '设置');
});

test('过宽 pattern 保护：{0} of {1}、Turn {0} 及计数/短前缀模板不误伤普通英文句子', async () => {
  const dict = {
    meta: {},
    exact: {},
    patterns: {
      '{0} of {1}': '{0} / {1}',
      'Turn {0}': '第 {0} 轮',
      '{0} on': '已开启 {0} 个',
      '{0} result{1}': '{0} 条结果',
      '{0} selected': '已选择 {0} 项',
      'Up {0}': '已运行 {0}',
      'On {0}': '位于 {0}',
      '{0}, from {1}': '{0}，来自 {1}',
      'in {0}': '在 {0} 中',
      'for {0}': '针对 {0}',
      'Available for {0} project': '适用于 {0} 项目',
    },
  };
  const { api } = await setup('<p>x</p>', dict);

  // {0} of {1}：数字、计数上限、时长正常翻译，普通英文长句绝不误伤
  assert.equal(api.tr('1 of 10'), '1 / 10');
  assert.equal(api.tr('3 of 100+'), '3 / 100+');
  assert.equal(api.tr('01:23 of 05:00'), '01:23 / 05:00');
  assert.equal(api.tr('Our best balance of intelligence, cost, and latency.'), null);
  assert.equal(api.tr('Our best balance of intelligence, cost, and latency. Get building today with Neon.'), null);

  // Turn {0}：轮次编号正常翻译，Turn on / Turn off 句子绝不误伤
  assert.equal(api.tr('Turn 3'), '第 3 轮');
  assert.equal(api.tr('Turn 3 / 10'), '第 3 / 10 轮');
  assert.equal(api.tr('Turn on notifications.'), null);
  assert.equal(api.tr('Turn on notifications to stay updated.'), null);
  assert.equal(api.tr('Turn off notifications.'), null);

  // 其他计数型、时长型、短前缀模板：正常短标签翻译，普通英文短语/句子不误伤
  assert.equal(api.tr('3 on'), '已开启 3 个');
  assert.equal(api.tr('forced on'), null);
  assert.equal(api.tr('5 results'), '5 条结果');
  assert.equal(api.tr('No results'), null);
  assert.equal(api.tr('4 selected'), '已选择 4 项');
  assert.equal(api.tr('No folder selected'), null);
  assert.equal(api.tr('Up 2h 30m'), '已运行 2h 30m');
  assert.equal(api.tr('Up <1m'), '已运行 <1m');
  assert.equal(api.tr('Up to 10 files can be attached.'), null);
  assert.equal(api.tr('On macOS'), '位于 macOS');
  assert.equal(api.tr('On November 30, 2026, GPT-OSS will be removed.'), null);
  assert.equal(api.tr('Python, from Marketplace'), 'Python，来自 Marketplace');
  assert.equal(api.tr('Import skills, from local folders or remote repos, to extend your agent.'), null);
  assert.equal(api.tr('in Browser'), '在 Browser 中');
  assert.equal(api.tr('in the top left.'), null);
  assert.equal(api.tr('for GitHub'), '针对 GitHub');
  assert.equal(api.tr('for more details, check the docs.'), null);
  // “项目”不是量词“项”，非数字项目名仍正常匹配
  assert.equal(api.tr('Available for MyApp project'), '适用于 MyApp 项目');
});
