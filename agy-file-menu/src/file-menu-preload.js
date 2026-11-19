// Antigravity 本地文件右键菜单渲染层模块（运行在 dist/preload.js 隔离世界，配合 Main World Fiber 探针与主进程 IPC）
(function () {
  'use strict';

  var g = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
  if (!g || !g.document || g.__AGY_FILE_MENU_BOOTED__) return;
  if (g.top && g.self && g.top !== g.self) return;

  function isSshRemoteWindow(winObj) {
    var proc = (winObj && winObj.process) || (typeof process !== 'undefined' ? process : null);
    var argv = proc && Array.isArray(proc.argv) ? proc.argv : null;
    if (!argv) return false;
    var prefix = '--agy-backend=';
    for (var i = 0; i < argv.length; i++) {
      var arg = argv[i];
      if (typeof arg === 'string' && arg.indexOf(prefix) === 0) {
        if (arg.slice(prefix.length) === 'ssh') return true;
      }
    }
    return false;
  }

  if (isSshRemoteWindow(g)) return;

  var loc = g.location;
  if (loc && loc.protocol && loc.hostname) {
    var isLocalHub = /^https?:$/.test(loc.protocol) && (loc.hostname === '127.0.0.1' || loc.hostname === 'localhost');
    var isTestHost = loc.protocol === 'about:' || loc.hostname === 'example.com' || loc.hostname === 'jsdom.local';
    if (!isLocalHub && !isTestHost) return;
  }

  Object.defineProperty(g, '__AGY_FILE_MENU_BOOTED__', { value: true });

  var CTX_ATTR = 'data-agy-file-ctx';
  var PROBE_READY_ATTR = 'data-agy-file-probe';
  var MAX_FIBER_DEPTH = 30;

  // 纯函数探针工厂：不依赖任何外部闭包变量，可安全序列化注入 Main World，也可在单测或预加载环境中直接调用
  function createFileProbe(maxFiberDepth) {
    var depthLimit = typeof maxFiberDepth === 'number' && maxFiberDepth > 0 ? maxFiberDepth : 30;

    function isNonLocalProtocol(raw) {
      if (typeof raw !== 'string') return false;
      var s = raw.trim();
      if (!s) return false;
      if (/^\/\//.test(s)) return true;
      if (/^file:\/\//i.test(s)) return false;
      if (/^(?:staged|unstaged):file:\/\//i.test(s)) return false;
      return /^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(s);
    }

    function normalizeLocalUri(raw) {
      if (typeof raw !== 'string') return '';
      var s = raw.trim();
      if (!s) return '';

      if (/^(?:staged|unstaged):/i.test(s)) {
        var stripped = s.replace(/^(?:staged|unstaged):/i, '');
        if (/^(?:file:\/\/|[a-zA-Z]:[\\/]|\/[^/]|\\\\)/i.test(stripped)) {
          s = stripped;
        }
      }

      if (/^file:\/\//i.test(s)) {
        var withoutHash = s.replace(/[?#].*$/, '').replace(/^file:\/\/(?:localhost)?/i, '');
        return withoutHash.length > 0 ? s : '';
      }

      if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(s)) return '';
      if (/^[a-zA-Z]:[\\/]/.test(s)) return s;
      if (/^\\\\[^\\/?*<>|]+\\[^\\/?*<>|]+/.test(s)) return s;
      if (s.charAt(0) === '/' && s.charAt(1) !== '/') return s;

      return '';
    }

    function getBasename(targetUri) {
      if (typeof targetUri !== 'string') return '';
      var s = targetUri.trim();
      if (!s) return '';
      var noHash = s.replace(/[?#].*$/, '');
      if (/^file:\/\//i.test(noHash)) {
        noHash = noHash.replace(/^file:\/\/(?:localhost)?/i, '');
        try {
          noHash = decodeURIComponent(noHash);
        } catch (_) {}
      }
      var trimmed = noHash.replace(/[\\/]+$/, '');
      if (!trimmed) return s;
      var parts = trimmed.split(/[\\/]/);
      for (var i = parts.length - 1; i >= 0; i--) {
        if (parts[i]) return parts[i];
      }
      return trimmed;
    }

    function cleanLabel(raw) {
      if (typeof raw !== 'string') return '';
      var s = raw.replace(/\s+/g, ' ').trim();
      if (!s || s.length > 240) return '';
      return s;
    }

    function isBookmarkArtifactSuffix(rawUri) {
      if (typeof rawUri !== 'string') return false;
      var base = rawUri.split('#', 1)[0].split('?', 1)[0].trim().toLowerCase();
      return base.slice(-9) === '.url.json' || base.slice(-4) === '.url';
    }

    function getReactFiber(el) {
      if (!el || (typeof el !== 'object' && typeof el !== 'function')) return null;
      var keys;
      try {
        keys = Object.keys(el);
      } catch (_) {
        keys = [];
      }
      var i;
      for (i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) {
          return el[keys[i]] || null;
        }
      }
      var ownNames;
      try {
        ownNames = Object.getOwnPropertyNames(el);
      } catch (_) {
        ownNames = [];
      }
      for (i = 0; i < ownNames.length; i++) {
        if (ownNames[i].indexOf('__reactFiber$') === 0 || ownNames[i].indexOf('__reactInternalInstance$') === 0) {
          return el[ownNames[i]] || null;
        }
      }
      for (i = 0; i < ownNames.length; i++) {
        if (ownNames[i].indexOf('__reactProps$') === 0 && el[ownNames[i]]) {
          return { memoizedProps: el[ownNames[i]], return: null };
        }
      }
      return null;
    }

    function isExcludedControl(startEl) {
      var cur = startEl;
      while (cur && cur.nodeType === 1) {
        var tag = (cur.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
        if (cur.isContentEditable === true) return true;
        var ce = cur.getAttribute ? cur.getAttribute('contenteditable') : null;
        if (ce !== null) {
          var ceNorm = ce.trim().toLowerCase();
          if (ceNorm === '' || ceNorm === 'true' || ceNorm === 'plaintext-only') return true;
        }
        var cls = typeof cur.className === 'string' ? cur.className : '';
        if (cls && /\b(?:agy-aux-tab|monaco-editor|xterm)\b/.test(cls)) return true;
        var role = cur.getAttribute ? cur.getAttribute('role') : null;
        if (role === 'tab') return true;
        if (cur.hasAttribute && cur.hasAttribute('data-tab-id')) return true;
        var testId = cur.getAttribute ? cur.getAttribute('data-testid') : '';
        if (testId && (testId.indexOf('conversation-row-') === 0 || testId === 'side-question-row')) {
          return true;
        }
        cur = cur.parentElement;
      }
      return false;
    }

    function extractFileRowLabel(el) {
      if (!el) return '';
      if (el.hasAttribute && (el.hasAttribute('data-line-start') || el.hasAttribute('data-diff-type'))) {
        return '';
      }
      var cls = typeof el.className === 'string' ? el.className : '';
      if (cls && /\bcode-line\b/.test(cls)) return '';
      if (el.querySelector) {
        var titleEl = el.querySelector('[data-testid="file-title-name"]');
        if (titleEl) {
          var t = cleanLabel(titleEl.textContent);
          if (t) return t;
        }
      }
      return cleanLabel(el.textContent);
    }

    function extractCardTitle(cardEl, props) {
      if (props && typeof props === 'object') {
        if (typeof props.displayName === 'string' && props.displayName.trim()) return cleanLabel(props.displayName);
        if (typeof props.title === 'string' && props.title.trim()) return cleanLabel(props.title);
        if (props.artifact && typeof props.artifact === 'object') {
          if (typeof props.artifact.title === 'string' && props.artifact.title.trim()) return cleanLabel(props.artifact.title);
          if (typeof props.artifact.displayName === 'string' && props.artifact.displayName.trim()) return cleanLabel(props.artifact.displayName);
        }
      }
      if (cardEl && (!cardEl.children || cardEl.children.length === 0)) {
        return cleanLabel(cardEl.textContent);
      }
      return '';
    }

    function isFiberPropsBookmark(p) {
      if (!p || typeof p !== 'object') return false;
      if (p.isBookmarkCard === true) return true;
      if (p.target && typeof p.target === 'object') {
        if (p.target.isBookmarkCard === true) return true;
        if (isNonLocalProtocol(p.target.targetUrl)) return true;
      }
      if (p.bookmarkUri) return true;
      if (isNonLocalProtocol(p.targetUrl)) return true;
      if (p.artifact && typeof p.artifact === 'object') {
        if (p.artifact.isBookmark === true || p.artifact.type === 'bookmark' || p.artifact.type === 'url') return true;
        if (p.artifact.payload && p.artifact.payload.case === 'urlArtifactPayload') return true;
        if (isNonLocalProtocol(p.artifact.url) || isNonLocalProtocol(p.artifact.sourceUri) || isNonLocalProtocol(p.artifact.uri)) {
          return true;
        }
      }
      if (isNonLocalProtocol(p.uri) || isNonLocalProtocol(p.href)) return true;
      return false;
    }

    function probeArtifactCard(cardEl) {
      var fiber = getReactFiber(cardEl);
      var f = fiber;
      var step = 0;
      var foundUri = '';
      var foundProps = null;

      while (f && step < depthLimit) {
        if (f !== fiber && f.stateNode && f.stateNode.nodeType === 1 && f.stateNode !== cardEl) {
          if (typeof f.stateNode.contains === 'function' && f.stateNode.contains(cardEl)) break;
        }
        var p = f.memoizedProps || f.pendingProps;
        if (p && typeof p === 'object') {
          if (isFiberPropsBookmark(p)) return null;
          if (!foundUri) {
            var candidates = [
              p.uri,
              p.artifact && p.artifact.sourceUri,
              p.artifact && p.artifact.uri,
              p.sourceUri
            ];
            for (var c = 0; c < candidates.length; c++) {
              var cand = candidates[c];
              if (typeof cand !== 'string' || !cand.trim()) continue;
              if (isNonLocalProtocol(cand) || isBookmarkArtifactSuffix(cand)) return null;
              var norm = normalizeLocalUri(cand);
              if (norm) {
                foundUri = norm;
                foundProps = p;
                break;
              }
            }
          }
        }
        f = f['return'];
        step++;
      }

      if (cardEl && cardEl.querySelector) {
        var innerUriEl = cardEl.querySelector('[data-uri]');
        if (innerUriEl) {
          var rawInner = innerUriEl.getAttribute('data-uri') || '';
          if (isNonLocalProtocol(rawInner) || isBookmarkArtifactSuffix(rawInner)) return null;
          var localInner = normalizeLocalUri(rawInner);
          if (localInner) {
            return {
              targetUri: localInner,
              labelText: cleanLabel(innerUriEl.textContent) || extractCardTitle(cardEl, foundProps)
            };
          }
        }
        if (cardEl.querySelector('[data-testid="artifact-card-url-split-button"]')) {
          return null;
        }
      }

      if (foundUri) {
        return {
          targetUri: foundUri,
          labelText: extractCardTitle(cardEl, foundProps)
        };
      }
      return null;
    }

    function probeTreeItem(treeEl) {
      if (treeEl && treeEl.hasAttribute) {
        if (treeEl.hasAttribute('data-uri')) {
          var dUri = normalizeLocalUri(treeEl.getAttribute('data-uri') || '');
          if (dUri) return { targetUri: dUri, labelText: cleanLabel(treeEl.textContent) };
        }
        if (treeEl.hasAttribute('data-file-uri')) {
          var fUri = normalizeLocalUri(treeEl.getAttribute('data-file-uri') || '');
          if (fUri) return { targetUri: fUri, labelText: cleanLabel(treeEl.textContent) };
        }
      }

      var rootFiber = getReactFiber(treeEl);
      var f = rootFiber;
      var step = 0;
      while (f && step < depthLimit) {
        if (f !== rootFiber && f.stateNode && f.stateNode.nodeType === 1 && f.stateNode !== treeEl) {
          if (f.stateNode.getAttribute && f.stateNode.getAttribute('role') === 'treeitem') break;
        }
        var p = f.memoizedProps || f.pendingProps;
        if (p && typeof p === 'object') {
          var entry = p.entry && typeof p.entry === 'object' ? p.entry : null;
          var rawCand = (entry && (entry.uri || entry.path || entry.filePath)) || p.fileUri || p.uri || '';
          var localCand = normalizeLocalUri(rawCand);
          if (localCand) {
            var label = (typeof p.name === 'string' && cleanLabel(p.name)) ||
              (entry && typeof entry.name === 'string' && cleanLabel(entry.name)) ||
              cleanLabel(treeEl.textContent);
            return { targetUri: localCand, labelText: label };
          }
        }
        f = f['return'];
        step++;
      }
      return null;
    }

    function probeMediaFiber(el) {
      var f = getReactFiber(el);
      var step = 0;
      while (f && step < depthLimit) {
        var p = f.memoizedProps || f.pendingProps;
        if (p && typeof p === 'object' && typeof p.originalFilePath === 'string') {
          var localMedia = normalizeLocalUri(p.originalFilePath);
          if (localMedia) {
            var altText = (el && el.getAttribute && (el.getAttribute('alt') || el.getAttribute('title'))) || '';
            return { targetUri: localMedia, labelText: cleanLabel(altText) };
          }
        }
        f = f['return'];
        step++;
      }
      return null;
    }

    function probeTarget(rawTarget) {
      if (!rawTarget) return null;
      var startEl = rawTarget.nodeType === 1 ? rawTarget : rawTarget.parentElement;
      if (!startEl || startEl.nodeType !== 1) return null;
      if (isExcludedControl(startEl)) return null;

      var el = startEl;
      while (el && el.nodeType === 1) {
        var tag = (el.tagName || '').toLowerCase();

        // c) Markdown 本地文件链接；非本地协议链接直接放行不回退外层
        if (tag === 'a' && el.hasAttribute && el.hasAttribute('href')) {
          var rawHref = el.getAttribute('href') || '';
          var localHref = normalizeLocalUri(rawHref);
          if (localHref) {
            return { targetUri: localHref, labelText: cleanLabel(el.textContent) };
          }
          return null;
        }

        // a) 文件胶囊与引用芯片：[data-uri]
        if (el.hasAttribute && el.hasAttribute('data-uri')) {
          var rawDataUri = el.getAttribute('data-uri') || '';
          var localDataUri = normalizeLocalUri(rawDataUri);
          if (localDataUri) {
            return { targetUri: localDataUri, labelText: cleanLabel(el.textContent) };
          }
          if (isNonLocalProtocol(rawDataUri)) return null;
        }

        // b) 变更文件列表行：[data-file-uri]
        if (el.hasAttribute && el.hasAttribute('data-file-uri')) {
          var rawFileUri = el.getAttribute('data-file-uri') || '';
          var localFileUri = normalizeLocalUri(rawFileUri);
          if (localFileUri) {
            return { targetUri: localFileUri, labelText: extractFileRowLabel(el) };
          }
          if (isNonLocalProtocol(rawFileUri)) return null;
        }

        // d) Artifact 卡片与右侧概览行：[data-testid="artifact-card"] / [data-testid="bubble-artifact-card"] / [data-testid="artifact-row"]
        var testId = el.getAttribute ? el.getAttribute('data-testid') : '';
        if (testId === 'artifact-card' || testId === 'bubble-artifact-card' || testId === 'artifact-row') {
          return probeArtifactCard(el);
        }

        // e) 右侧工作区文件树节点：[role="treeitem"]
        var role = el.getAttribute ? el.getAttribute('role') : '';
        if (role === 'treeitem') {
          var treeHit = probeTreeItem(el);
          if (treeHit) return treeHit;
        }

        // f) 本地图片/媒体附件：Main World Fiber memoizedProps.originalFilePath
        var mediaHit = probeMediaFiber(el);
        if (mediaHit) return mediaHit;

        // g) 打开的本地文件查看器代码/预览区：[data-active-file-uri]
        if (el.hasAttribute && el.hasAttribute('data-active-file-uri')) {
          var rawActiveUri = el.getAttribute('data-active-file-uri') || '';
          var localActiveUri = normalizeLocalUri(rawActiveUri);
          if (localActiveUri) {
            return { targetUri: localActiveUri, labelText: '' };
          }
        }

        el = el.parentElement;
      }

      return null;
    }

    return {
      probeTarget: probeTarget,
      normalizeLocalUri: normalizeLocalUri,
      getBasename: getBasename
    };
  }

  // 注入到 Main World 的捕获探针（内部不引用外部闭包变量）
  function installMainWorldProbe(createProbeFn, ctxAttr, readyAttr, maxFiberDepth) {
    var w = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
    if (!w || w.__AGY_FILE_MENU_MAIN_PROBE__) return;
    Object.defineProperty(w, '__AGY_FILE_MENU_MAIN_PROBE__', { value: true });

    var api = createProbeFn(maxFiberDepth);
    var probeSeq = 0;
    if (w.document && w.document.documentElement) {
      w.document.documentElement.setAttribute(readyAttr, '1');
    }

    w.addEventListener('contextmenu', function mainWorldProbe(ev) {
      var doc = w.document;
      var root = doc && doc.documentElement;
      if (!root) return;
      if (root.getAttribute(readyAttr) !== '1') {
        root.setAttribute(readyAttr, '1');
      }
      var hit = api.probeTarget(ev ? ev.target : null);
      if (hit && hit.targetUri) {
        root.setAttribute(ctxAttr, JSON.stringify({
          targetUri: hit.targetUri,
          labelText: hit.labelText || '',
          seq: ++probeSeq,
          ts: Date.now()
        }));
      } else {
        root.removeAttribute(ctxAttr);
      }
    }, true);
  }

  var ipc = null;
  var webFrame = null;
  var clipboard = null;
  try {
    var reqFn = typeof require === 'function' ? require : (typeof g.require === 'function' ? g.require : null);
    if (reqFn) {
      var electronMod = reqFn('electron');
      if (electronMod) {
        ipc = electronMod.ipcRenderer || null;
        webFrame = electronMod.webFrame || null;
        clipboard = electronMod.clipboard || null;
      }
    }
  } catch (_) {}

  var localProbe = createFileProbe(MAX_FIBER_DEPTH);
  var lastConsumedSeq = -1;

  (function injectMainWorldProbe() {
    var injectedViaElectron = false;
    try {
      if (webFrame && typeof webFrame.executeJavaScript === 'function') {
        var script = '(' + installMainWorldProbe.toString() + ')('
          + createFileProbe.toString() + ','
          + JSON.stringify(CTX_ATTR) + ','
          + JSON.stringify(PROBE_READY_ATTR) + ','
          + String(MAX_FIBER_DEPTH) + ');';
        Promise.resolve(webFrame.executeJavaScript(script)).catch(function () {});
        injectedViaElectron = true;
      }
    } catch (_) {}
    if (!injectedViaElectron) {
      installMainWorldProbe(createFileProbe, CTX_ATTR, PROBE_READY_ATTR, MAX_FIBER_DEPTH);
    }
  })();

  function readProbedContext(ev) {
    var doc = g.document;
    var root = doc && doc.documentElement;
    if (!root) return null;

    var raw = root.getAttribute(CTX_ATTR);
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.targetUri === 'string' && parsed.targetUri) {
          var validUri = localProbe.normalizeLocalUri(parsed.targetUri);
          var fresh = typeof parsed.ts === 'number' && Math.abs(Date.now() - parsed.ts) < 800;
          if (validUri && fresh) {
            if (typeof parsed.seq === 'number') {
              if (parsed.seq !== lastConsumedSeq) {
                lastConsumedSeq = parsed.seq;
                return {
                  targetUri: validUri,
                  labelText: typeof parsed.labelText === 'string' ? parsed.labelText : ''
                };
              }
            } else {
              return {
                targetUri: validUri,
                labelText: typeof parsed.labelText === 'string' ? parsed.labelText : ''
              };
            }
          }
        }
      } catch (_) {}
    }

    var fallbackHit = localProbe.probeTarget(ev ? ev.target : null);
    if (fallbackHit && fallbackHit.targetUri) {
      if (!raw) {
        root.setAttribute(CTX_ATTR, JSON.stringify({
          targetUri: fallbackHit.targetUri,
          labelText: fallbackHit.labelText || '',
          ts: Date.now()
        }));
      }
      return fallbackHit;
    }
    root.removeAttribute(CTX_ATTR);

    return null;
  }

  function getSelectedText() {
    try {
      if (typeof g.getSelection === 'function') {
        var sel = g.getSelection();
        if (sel && typeof sel.toString === 'function') {
          return sel.toString() || '';
        }
      }
    } catch (_) {}
    return '';
  }

  function fallbackNavigatorCopy(str) {
    try {
      var nav = g.navigator;
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        Promise.resolve(nav.clipboard.writeText(str)).catch(function () {});
      }
    } catch (_) {}
  }

  function writeCopyText(text) {
    if (!text) return;
    var str = String(text);
    if (clipboard && typeof clipboard.writeText === 'function') {
      try {
        clipboard.writeText(str);
        return;
      } catch (_) {}
    }
    if (ipc && typeof ipc.invoke === 'function') {
      try {
        Promise.resolve(ipc.invoke('agy-file-menu:exec', {
          action: 'copy-text',
          text: str
        })).then(function (res) {
          if (!res || !res.ok) fallbackNavigatorCopy(str);
        }, function () {
          fallbackNavigatorCopy(str);
        });
        return;
      } catch (_) {}
    }
    fallbackNavigatorCopy(str);
  }

  function invokeFileAction(action, targetUri) {
    if (!ipc || typeof ipc.invoke !== 'function') return;
    try {
      Promise.resolve(ipc.invoke('agy-file-menu:exec', {
        action: action,
        target: targetUri
      })).catch(function () {});
    } catch (_) {}
  }

  function handleMenuSelection(picked, copyText, targetUri) {
    var id = typeof picked === 'string'
      ? picked
      : (picked && typeof picked === 'object' && typeof picked.id === 'string' ? picked.id : '');
    if (!id) return;

    if (id === 'agy-fm-copy') {
      writeCopyText(copyText);
    } else if (id === 'agy-fm-copy-path') {
      invokeFileAction('copy-path', targetUri);
    } else if (id === 'agy-fm-reveal') {
      invokeFileAction('reveal-in-explorer', targetUri);
    } else if (id === 'agy-fm-open-app') {
      invokeFileAction('open-with-default-app', targetUri);
    } else if (id === 'agy-fm-open-browser') {
      invokeFileAction('open-in-default-browser', targetUri);
    }
  }

  function onPreloadContextMenu(ev) {
    var ctx = readProbedContext(ev);
    if (!ctx || !ctx.targetUri) return;
    if (!ipc || typeof ipc.invoke !== 'function') return;

    ev.preventDefault();
    ev.stopPropagation();

    var targetUri = ctx.targetUri;
    var labelText = ctx.labelText || '';
    var selText = getSelectedText();
    var copyText = selText || labelText || localProbe.getBasename(targetUri);

    var items = [
      { id: 'agy-fm-copy', label: '复制', disabled: !copyText },
      { id: 'agy-fm-copy-path', label: '复制文件路径' },
      { type: 'separator' },
      { id: 'agy-fm-reveal', label: '在资源管理器里打开' },
      { id: 'agy-fm-open-app', label: '使用默认程序打开' },
      { id: 'agy-fm-open-browser', label: '使用默认浏览器打开' }
    ];

    try {
      Promise.resolve(ipc.invoke('window:show-context-menu', items)).then(function (picked) {
        handleMenuSelection(picked, copyText, targetUri);
      }, function () {});
    } catch (_) {}
  }

  var boundDoc = null;
  function ensureDocBound() {
    if (g.document && g.document !== boundDoc && typeof g.document.addEventListener === 'function') {
      boundDoc = g.document;
      boundDoc.addEventListener('contextmenu', onPreloadContextMenu, true);
    }
  }
  ensureDocBound();
  if (typeof g.addEventListener === 'function') {
    g.addEventListener('contextmenu', ensureDocBound, true);
    g.addEventListener('DOMContentLoaded', ensureDocBound);
  }
})();
