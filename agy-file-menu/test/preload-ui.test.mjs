// agy-file-menu 渲染层 Preload 文件右键识别与菜单模块单测：
// 覆盖 7 类本地文件元素（含 Main World __reactFiber$ 链）、非文件元素放行、选中文本优先复制及 5 个菜单动作 IPC 契约。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = path.resolve(here, '../src/file-menu-preload.js');
const PRELOAD_CODE = fs.readFileSync(PRELOAD_PATH, 'utf8');

function loadJsdom() {
  const candidates = [
    path.resolve(here, '../package.json'),
    path.resolve(here, '../../agy-zh-cn/patcher/package.json'),
    path.resolve(here, '../../agy-weekly-quota/package.json'),
  ];
  for (const pkg of candidates) {
    if (!fs.existsSync(pkg)) continue;
    try {
      return createRequire(pkg)('jsdom');
    } catch { /* try next */ }
  }
  return createRequire(import.meta.url)('jsdom');
}

const { JSDOM } = loadJsdom();
const flush = () => new Promise((r) => setTimeout(r, 15));

function createEnv(t, {
  html = '<!doctype html><html><body><div id="app"></div></body></html>',
  url = 'http://127.0.0.1:52345/',
  pickMenuId = null,
  withWebFrame = true,
  withElectronClipboard = true,
  execResult = { ok: true },
  preBoot = null,
} = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const win = dom.window;

  const shownMenus = [];
  const execCalls = [];
  const clipboardWrites = [];
  const executedScripts = [];
  let nextPick = pickMenuId;
  let nextExecResult = execResult;

  const electronMock = {
    ipcRenderer: {
      invoke: async (channel, payload) => {
        const cloned = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload));
        if (channel === 'window:show-context-menu') {
          shownMenus.push(cloned);
          return typeof nextPick === 'function' ? nextPick(cloned) : nextPick;
        }
        if (channel === 'agy-file-menu:exec') {
          execCalls.push(cloned);
          return typeof nextExecResult === 'function' ? nextExecResult(cloned) : nextExecResult;
        }
        return null;
      },
    },
  };

  if (withWebFrame) {
    electronMock.webFrame = {
      executeJavaScript: (code) => {
        executedScripts.push(code);
        return win.eval(code);
      },
    };
  }

  if (withElectronClipboard) {
    electronMock.clipboard = {
      writeText: (txt) => {
        clipboardWrites.push({ via: 'electron', text: txt });
      },
    };
  }

  win.require = (id) => (id === 'electron' ? electronMock : {});
  if (preBoot) preBoot(win);
  win.eval(PRELOAD_CODE);

  function rightClick(targetEl) {
    let bubbleReached = false;
    const onBubble = () => { bubbleReached = true; };
    win.document.body.addEventListener('contextmenu', onBubble);
    const ev = new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    const notCancelled = targetEl.dispatchEvent(ev);
    win.document.body.removeEventListener('contextmenu', onBubble);
    return {
      defaultPrevented: ev.defaultPrevented || !notCancelled,
      propagationStopped: !bubbleReached,
      ctxAttr: win.document.documentElement.getAttribute('data-agy-file-ctx'),
    };
  }

  return {
    dom,
    win,
    doc: win.document,
    shownMenus,
    execCalls,
    clipboardWrites,
    executedScripts,
    setNextPick: (v) => { nextPick = v; },
    setExecResult: (v) => { nextExecResult = v; },
    rightClick,
  };
}

function buildFiberChain(leafProps, ancestorPropsList = []) {
  let cur = null;
  for (let i = ancestorPropsList.length - 1; i >= 0; i--) {
    cur = { memoizedProps: ancestorPropsList[i], return: cur };
  }
  return { memoizedProps: leafProps, return: cur };
}

test('代码规范与启动守卫：不含注入标记、通过语法检查、防重入、SSH 远程窗口与外部域名直接退出', (t) => {
  assert.equal(PRELOAD_CODE.includes('/*AGY-FILE-MENU-BEGIN*/'), false, '严禁包含 BEGIN 标记');
  assert.equal(PRELOAD_CODE.includes('/*AGY-FILE-MENU-END*/'), false, '严禁包含 END 标记');
  execFileSync(process.execPath, ['--check', PRELOAD_PATH], { stdio: 'pipe' });

  // 防重入保护：重复执行不会注册双份监听器
  const env1 = createEnv(t, {
    html: '<!doctype html><html><body><span id="chip" data-uri="file:///F:/Code/a.js">a.js</span></body></html>',
  });
  env1.win.eval(PRELOAD_CODE);
  env1.rightClick(env1.doc.getElementById('chip'));
  assert.equal(env1.shownMenus.length, 1, '重复执行脚本应只弹出一次菜单');

  // SSH 远程窗口直接退出
  const envSsh = createEnv(t, {
    html: '<!doctype html><html><body><span id="chip" data-uri="file:///F:/Code/a.js">a.js</span></body></html>',
    preBoot: (w) => {
      w.process = { argv: ['Antigravity.exe', '--agy-backend=ssh'] };
    },
  });
  assert.equal(Boolean(envSsh.win.__AGY_FILE_MENU_BOOTED__), false, 'SSH 窗口不应激活模块');
  const sshRes = envSsh.rightClick(envSsh.doc.getElementById('chip'));
  assert.equal(sshRes.defaultPrevented, false);
  assert.equal(envSsh.shownMenus.length, 0);

  // 非本地 Hub 外部站点直接退出
  const envRemoteUrl = createEnv(t, {
    url: 'https://docs.google.com/document/d/1',
    html: '<!doctype html><html><body><span id="chip" data-uri="file:///F:/Code/a.js">a.js</span></body></html>',
  });
  assert.equal(Boolean(envRemoteUrl.win.__AGY_FILE_MENU_BOOTED__), false);
  assert.equal(envRemoteUrl.shownMenus.length, 0);
});

test('精准识别全部 7 类本地文件元素（DOM 属性与 Main World React Fiber 链）', async (t) => {
  const html = `<!doctype html><html><body>
    <!-- a) 文件胶囊与引用芯片 [data-uri] -->
    <span id="pill" data-uri="file:///F:/Code/Antigravity/README.md"><b id="pill-inner">README.md</b></span>

    <!-- b) 变更文件列表行 [data-file-uri] -->
    <div id="changed-row" data-testid="changed-file-row" data-file-uri="file:///F:/Code/Antigravity/repatch-all.mjs">
      <span data-testid="file-title-name">repatch-all.mjs</span>
      <span>+42 -5</span>
    </div>

    <!-- c) Markdown 本地文件链接 a[href] -->
    <a id="md-file-uri" href="file:///F:/Code/%E4%B8%AD%E6%96%87%20%E8%AF%B4%E6%98%8E.md#L10-L20">中文 说明.md</a>
    <a id="md-win-path" href="C:\\Users\\lyufeng\\notes.txt">notes.txt</a>
    <a id="md-posix-path" href="/home/lyufeng/app.ts">app.ts</a>

    <!-- d) Artifact 卡片：内部 [data-uri] 优先 + Fiber uri + Fiber artifact.sourceUri + 排除网页书签卡片 -->
    <div id="art-inner" data-testid="artifact-card">
      <span data-uri="file:///F:/Code/inner-priority.md">inner-priority.md</span>
    </div>
    <div id="art-fiber-uri" data-testid="bubble-artifact-card"><span id="art-fiber-uri-child">实施计划</span></div>
    <div id="art-fiber-source" data-testid="artifact-card"><span>架构设计</span></div>
    <div id="art-bookmark" data-testid="bubble-artifact-card"><span>Official Docs Bookmark</span></div>

    <!-- e) 右侧工作区文件树节点 [role="treeitem"]（文件与目录） -->
    <div id="tree-file" role="treeitem"><span id="tree-file-label">index.js</span></div>
    <div id="tree-dir" role="treeitem"><span>src</span></div>

    <!-- f) 本地图片/媒体附件：Fiber memoizedProps.originalFilePath -->
    <div id="media-wrap"><img id="media-img" src="blob:http://127.0.0.1:52345/abcd-1234" alt="架构图.png" /></div>

    <!-- g) 打开的本地文件查看器代码/预览区 [data-active-file-uri] -->
    <div id="viewer" class="file-viewer-root" data-active-file-uri="file:///F:/Code/Antigravity/viewer-target.js">
      <div id="viewer-code-line">const answer = 42;</div>
      <span id="viewer-inner-chip" data-uri="file:///F:/Code/Antigravity/inner-ref.js">inner-ref.js</span>
      <a id="viewer-ext-link" href="https://example.com/spec">External Spec</a>
    </div>

    <!-- h) 真实主对话与子代理对话容器内部的文件胶囊（祖先带 data-cascade-id 不能误排除） -->
    <div data-testid="conversation-view" data-cascade-id="01140f09-6e1d">
      <bdi class="context-scope-mention" data-quotable-inline="true">
        <span id="chat-pill" data-uri="file:///f%3A/Code/Antigravity/agy-weekly-quota/accounts.json" data-quotable-inline="true" role="button" tabindex="0">
          <span id="chat-pill-text">accounts.json</span>
        </span>
      </bdi>
    </div>
    <div data-testid="subagent-tab-conversation" data-cascade-id="sub-1">
      <span id="subagent-pill" data-uri="file:///f%3A/Code/Antigravity/README.md" role="button" tabindex="0">README.md</span>
    </div>
  </body></html>`;

  const env = createEnv(t, { html, pickMenuId: 'agy-fm-copy-path' });
  const { doc, rightClick, execCalls, shownMenus } = env;
  assert.equal(env.executedScripts.length, 1, '应通过 webFrame.executeJavaScript 注入 Main World 探针');

  // 挂载模拟的 Main World React Fiber 链
  doc.getElementById('art-inner').__reactFiber$xyz = buildFiberChain({}, [
    { uri: 'file:///F:/Code/should-not-win.md' },
  ]);
  doc.getElementById('art-fiber-uri').__reactFiber$xyz = buildFiberChain({ className: 'card' }, [
    { asChild: true },
    { uri: 'file:///F:/Code/Antigravity/plan.md', target: { isBookmarkCard: false } },
  ]);
  doc.getElementById('art-fiber-source').__reactFiber$xyz = buildFiberChain({}, [
    {},
    {},
    { artifact: { sourceUri: 'F:\\Code\\Antigravity\\design.md', title: '架构设计文档' } },
  ]);
  doc.getElementById('art-bookmark').__reactFiber$xyz = buildFiberChain({}, [
    { href: 'https://antigravity.google/docs', bookmarkUri: 'file:///C:/brain/doc.url.json' },
    { uri: 'file:///C:/brain/doc.url.json', target: { isBookmarkCard: true, targetUrl: 'https://antigravity.google/docs' } },
  ]);
  doc.getElementById('tree-file').__reactFiber$1a2b = buildFiberChain({}, [
    { entry: { uri: 'file:///F:/Code/Antigravity/src/index.js', fileType: 1 }, name: 'index.js' },
  ]);
  doc.getElementById('tree-dir').__reactFiber$1a2b = buildFiberChain({}, [
    {},
    { entry: { uri: 'file:///F:/Code/Antigravity/src', fileType: 2 }, name: 'src' },
  ]);
  // 测试深层（12 层 fiber.return）的媒体附件 originalFilePath
  const deepAncestors = Array.from({ length: 11 }, () => ({}));
  deepAncestors.push({ mediaType: 'image', originalFilePath: 'C:\\Users\\lyufeng\\Pictures\\arch.png' });
  doc.getElementById('media-img').__reactFiber$media9 = buildFiberChain({ src: 'blob:123' }, deepAncestors);

  const expectHit = async (elId, expectedTarget, expectedCopyLabel) => {
    const beforeMenuCount = shownMenus.length;
    const beforeExecCount = execCalls.length;
    const res = rightClick(doc.getElementById(elId));
    await flush();

    assert.equal(res.defaultPrevented, true, `${elId} 应执行 preventDefault`);
    assert.equal(res.propagationStopped, true, `${elId} 应执行 stopPropagation`);
    assert.ok(res.ctxAttr, `${elId} 应同步写入 data-agy-file-ctx`);
    const parsedCtx = JSON.parse(res.ctxAttr);
    assert.equal(parsedCtx.targetUri, expectedTarget);

    assert.equal(shownMenus.length, beforeMenuCount + 1, `${elId} 应调用原生菜单`);
    assert.equal(execCalls.length, beforeExecCount + 1, `${elId} 点击复制路径应触发 IPC`);
    assert.deepEqual(execCalls.at(-1), { action: 'copy-path', target: expectedTarget });

    if (expectedCopyLabel !== undefined) {
      env.setNextPick('agy-fm-copy');
      env.clipboardWrites.length = 0;
      rightClick(doc.getElementById(elId));
      await flush();
      assert.equal(env.clipboardWrites[0]?.text, expectedCopyLabel, `${elId} 默认复制文本应准确`);
      env.setNextPick('agy-fm-copy-path');
    }
  };

  // a) [data-uri]
  await expectHit('pill-inner', 'file:///F:/Code/Antigravity/README.md', 'README.md');
  // b) [data-file-uri]
  await expectHit('changed-row', 'file:///F:/Code/Antigravity/repatch-all.mjs', 'repatch-all.mjs');
  // c) a[href] 本地文件
  await expectHit('md-file-uri', 'file:///F:/Code/%E4%B8%AD%E6%96%87%20%E8%AF%B4%E6%98%8E.md#L10-L20', '中文 说明.md');
  await expectHit('md-win-path', 'C:\\Users\\lyufeng\\notes.txt', 'notes.txt');
  await expectHit('md-posix-path', '/home/lyufeng/app.ts', 'app.ts');
  // d) Artifact 卡片（3 种本地命中 + 1 种纯网页书签卡片排除）
  await expectHit('art-inner', 'file:///F:/Code/inner-priority.md', 'inner-priority.md');
  await expectHit('art-fiber-uri-child', 'file:///F:/Code/Antigravity/plan.md', 'plan.md');
  await expectHit('art-fiber-source', 'F:\\Code\\Antigravity\\design.md', '架构设计文档');

  const bmRes = rightClick(doc.getElementById('art-bookmark'));
  await flush();
  assert.equal(bmRes.defaultPrevented, false, '纯网页书签 Artifact 卡片应直接放行');
  assert.equal(bmRes.ctxAttr, null, '未命中时应移除 data-agy-file-ctx');

  // e) [role="treeitem"] 文件与目录
  await expectHit('tree-file-label', 'file:///F:/Code/Antigravity/src/index.js', 'index.js');
  await expectHit('tree-dir', 'file:///F:/Code/Antigravity/src', 'src');

  // f) 本地图片/媒体附件 originalFilePath
  await expectHit('media-img', 'C:\\Users\\lyufeng\\Pictures\\arch.png', '架构图.png');

  // g) [data-active-file-uri] 代码区兜底 vs 内层芯片优先 vs 内层网页链接放行
  await expectHit('viewer-code-line', 'file:///F:/Code/Antigravity/viewer-target.js', 'viewer-target.js');
  await expectHit('viewer-inner-chip', 'file:///F:/Code/Antigravity/inner-ref.js', 'inner-ref.js');

  const extInViewer = rightClick(doc.getElementById('viewer-ext-link'));
  await flush();
  assert.equal(extInViewer.defaultPrevented, false, '文件查看器内部的 https 链接必须放行而非回退外层文件');
  assert.equal(extInViewer.ctxAttr, null);

  // h) 主对话视图与子代理对话视图容器（外层均挂有 data-cascade-id）内右键文件胶囊应正常弹出 6 项中文菜单
  await expectHit('chat-pill-text', 'file:///f%3A/Code/Antigravity/agy-weekly-quota/accounts.json', 'accounts.json');
  assert.deepEqual(shownMenus.at(-1), [
    { id: 'agy-fm-copy', label: '复制', disabled: false },
    { id: 'agy-fm-copy-path', label: '复制文件路径' },
    { type: 'separator' },
    { id: 'agy-fm-reveal', label: '在资源管理器里打开' },
    { id: 'agy-fm-open-app', label: '使用默认程序打开' },
    { id: 'agy-fm-open-browser', label: '使用默认浏览器打开' },
  ]);
  await expectHit('subagent-pill', 'file:///f%3A/Code/Antigravity/README.md', 'README.md');
});

test('非文件目标放行边界：输入框、textarea、contenteditable、role=tab、会话行及各类非本地协议链接', async (t) => {
  const html = `<!doctype html><html><body>
    <div id="viewer" data-active-file-uri="file:///F:/Code/active.js">
      <input id="inp" type="text" value="hello" />
      <textarea id="ta">comment</textarea>
      <div id="ce" contenteditable="true"><span id="ce-span" data-uri="file:///F:/Code/in-editor.js">@in-editor.js</span></div>
    </div>
    <button id="tab-btn" role="tab"><span id="tab-span" data-uri="file:///F:/Code/tab.js">tab.js</span></button>
    <div class="agy-aux-tab"><button id="aux-tab" data-tab-id="t1"><span id="aux-span">tab2.js</span></button></div>
    <div id="cascade-row" data-testid="conversation-row-sidebar" data-cascade-id="conv-001"><span id="cascade-span">会话标题</span></div>
    <a id="lnk-https" href="https://google.com">Google</a>
    <a id="lnk-http" href="http://localhost:3000/api">Local HTTP</a>
    <a id="lnk-mailto" href="mailto:dev@example.com">Email</a>
    <a id="lnk-agy" href="antigravity://open/settings">AGY</a>
    <a id="lnk-recipe" href="recipe://run/test">Recipe</a>
    <a id="lnk-ctx" href="ai-context-provider://docs/item">Context</a>
  </body></html>`;

  const env = createEnv(t, { html, withWebFrame: false });
  const { doc, rightClick, shownMenus } = env;

  const excludedIds = [
    'inp',
    'ta',
    'ce-span',
    'tab-btn',
    'tab-span',
    'aux-span',
    'cascade-span',
    'lnk-https',
    'lnk-http',
    'lnk-mailto',
    'lnk-agy',
    'lnk-recipe',
    'lnk-ctx',
  ];

  for (const id of excludedIds) {
    const res = rightClick(doc.getElementById(id));
    await flush();
    assert.equal(res.defaultPrevented, false, `非文件目标 #${id} 不应被 preventDefault`);
    assert.equal(res.propagationStopped, false, `非文件目标 #${id} 不应被 stopPropagation`);
    assert.equal(res.ctxAttr, null, `非文件目标 #${id} 不应残留 data-agy-file-ctx`);
  }
  assert.equal(shownMenus.length, 0, '所有排除元素均不应弹出文件菜单');
});

test('菜单结构、选中文本优先复制、剪贴板回退以及全部 5 个菜单项点击后的 IPC 参数断言', async (t) => {
  const targetUri = 'file:///F:/Code/Antigravity/agy-file-menu/src/file-menu-preload.js';
  const html = `<!doctype html><html><body>
    <div id="viewer" data-active-file-uri="${targetUri}">
      <p id="sel-para">selected snippet text</p>
    </div>
    <span id="chip" data-uri="${targetUri}">preload-chip-label</span>
  </body></html>`;

  const env = createEnv(t, { html, pickMenuId: 'agy-fm-copy' });
  const { win, doc, rightClick, shownMenus, execCalls, clipboardWrites, setNextPick } = env;

  // 1. 选中文本时：复制项优先写入选中文本，并校验完整 6 项菜单结构（含分隔线）
  const range = doc.createRange();
  range.selectNodeContents(doc.getElementById('sel-para'));
  const sel = win.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  assert.equal(win.getSelection().toString(), 'selected snippet text');

  rightClick(doc.getElementById('chip'));
  await flush();

  assert.equal(shownMenus.length, 1);
  assert.deepEqual(shownMenus[0], [
    { id: 'agy-fm-copy', label: '复制', disabled: false },
    { id: 'agy-fm-copy-path', label: '复制文件路径' },
    { type: 'separator' },
    { id: 'agy-fm-reveal', label: '在资源管理器里打开' },
    { id: 'agy-fm-open-app', label: '使用默认程序打开' },
    { id: 'agy-fm-open-browser', label: '使用默认浏览器打开' },
  ]);
  assert.deepEqual(clipboardWrites, [{ via: 'electron', text: 'selected snippet text' }]);
  assert.equal(execCalls.length, 0, '普通复制直接走剪贴板，不调主进程文件动作 IPC');

  // 清空选区后，复制回退到 labelText
  sel.removeAllRanges();
  clipboardWrites.length = 0;
  rightClick(doc.getElementById('chip'));
  await flush();
  assert.deepEqual(clipboardWrites, [{ via: 'electron', text: 'preload-chip-label' }]);

  // 2. 依次验证其余 4 个菜单项点击后的 IPC 通道与 payload 参数契约
  const actionMatrix = [
    ['agy-fm-copy-path', 'copy-path'],
    ['agy-fm-reveal', 'reveal-in-explorer'],
    ['agy-fm-open-app', 'open-with-default-app'],
    ['agy-fm-open-browser', 'open-in-default-browser'],
  ];

  for (const [menuId, expectedAction] of actionMatrix) {
    execCalls.length = 0;
    setNextPick(menuId);
    rightClick(doc.getElementById('chip'));
    await flush();
    assert.equal(execCalls.length, 1, `点击 ${menuId} 应触发一次 agy-file-menu:exec`);
    assert.deepEqual(execCalls[0], {
      action: expectedAction,
      target: targetUri,
    });
  }

  // 3. 当 electron.clipboard 不可用（沙箱模式）时，优先走 agy-file-menu:exec copy-text，失败再回退 navigator.clipboard.writeText
  let navCopied = '';
  const envFallback = createEnv(t, {
    html: `<!doctype html><html><body><span id="c" data-uri="${targetUri}">fallback-label</span></body></html>`,
    pickMenuId: 'agy-fm-copy',
    withElectronClipboard: false,
    execResult: { ok: true },
    preBoot: (w) => {
      Object.defineProperty(w.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (txt) => { navCopied = txt; },
        },
      });
    },
  });
  envFallback.rightClick(envFallback.doc.getElementById('c'));
  await flush();
  assert.deepEqual(envFallback.execCalls, [{ action: 'copy-text', text: 'fallback-label' }]);
  assert.equal(navCopied, '', 'copy-text IPC 成功时不应重复写 navigator.clipboard');

  envFallback.execCalls.length = 0;
  envFallback.setExecResult({ ok: false, error: 'clipboard_unavailable' });
  envFallback.rightClick(envFallback.doc.getElementById('c'));
  await flush();
  assert.deepEqual(envFallback.execCalls, [{ action: 'copy-text', text: 'fallback-label' }]);
  assert.equal(navCopied, 'fallback-label', 'copy-text IPC 返回失败时应回退 navigator.clipboard.writeText');
});
