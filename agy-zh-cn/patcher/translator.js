/* Antigravity 简体中文运行时翻译脚本。
 * 由 patch.mjs 内联进 resources/app.asar 的 dist/preload.js（preload 运行在沙箱里，不能 require 本地文件），
 * 下面的占位注释会被替换成词典 JSON：{ meta, exact: {英文: 中文|null}, patterns: {"{0} files changed": "已更改 {0} 个文件"} }。
 * 只做整段匹配，不做子串替换；聊天正文、Markdown、代码、编辑器、终端、可编辑区一律跳过。
 */
(function () {
  'use strict';
  var DICT = /*__AGY_ZH_DICT__*/{};
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;

  var ATTRS = ['title', 'placeholder', 'aria-label'];

  // 跳过区域。依据（对 language_server.exe 内嵌 main.js 的静态分析）：
  // - [data-markdown-root]：Markdown 渲染组件的根节点，Agent 回复正文、产物文档、自动化说明（automation-instructions-markdown）都由它渲染；
  //   例外：Toast 归档提示（[data-testid="toast-notification"]）与 NUX 引导卡（[data-testid="nux-card"]）内的 [data-markdown-root] 放行界面文本，
  //   但其内部的 code/pre/kbd/samp/textarea/input/[contenteditable] 等仍严格跳过；
  // - .agy-user-bubble / [data-testid=user-message-bubble]：用户消息气泡（用户自己输入的原文）；
  // - [data-testid=live-user-turn] / [data-testid=live-agent-turn]：语音对话的实时转写文本；
  // - .monaco-editor（代码与差异编辑器）、.xterm（终端）、pre/code（代码块）、textarea / 可编辑区（输入框内容）；
  // - [data-agy-zh-skip]：手动打标的不翻译区域；script/style 等非可见内容。
  var SKIP_BASE = [
    'script', 'style', 'noscript', 'template', 'pre', 'code', 'kbd', 'samp', 'textarea', 'input',
    '[contenteditable]:not([contenteditable="false"])', '.monaco-editor', '.xterm', '[data-agy-zh-skip]',
    '.agy-user-bubble', '[data-testid="user-message-bubble"]',
    '[data-testid="live-user-turn"]', '[data-testid="live-agent-turn"]'
  ].join(',');
  var MD_ALLOW_ANCESTOR = '[data-testid="toast-notification"],[data-testid="nux-card"]';
  // 命中 SKIP_BASE 但自身的 placeholder/title/aria-label 仍需翻译的元素（输入框本身是界面的一部分，只是内容不能动）
  var ATTR_OK = 'textarea,input,[contenteditable]';

  // ---------- 词典编译 ----------
  var exact = new Map();
  var src = DICT.exact || {};
  for (var ek in src) {
    if (typeof src[ek] === 'string' && src[ek] !== '') exact.set(ek.trim(), src[ek]);
  }

  var escRe = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  // 计数型/序数型/时长型占位符收紧：防止 "{0} of {1}"、"Turn {0}"、"{0} on"、"{0} results" 等误伤普通英文句子
  var numericSlotRe = function (key, to, part) {
    var esc = escRe(part);
    if (/^\{\d+\}\s+of\s+\{\d+\}$/.test(key)) return '(\\d+(?:[,.:]\\d+)*(?:[kKmM])?\\+?)';
    if (/^Up\s+\{\d+\}$/.test(key) && /^已运行\s*\{\d+\}$/.test(to)) return '([<>~]?\\d[^\\n.!?]{0,30})';
    if (new RegExp('第\\s*' + esc + '\\s*[轮步页张次个条项行]').test(to)) return '(\\d+(?:\\s*\\/\\s*\\d+)?\\+?)';
    if (new RegExp(esc + '\\s*(?:个(?!人|性)|条(?!件|目)|项(?!目)|处(?!理)|张(?!贴)|次(?!数)|轮|步|份|页(?!面)|行(?!为|业|程)|天(?!气)|小时|分钟|秒|周(?!期)|月(?!份)|年(?!份)|%)').test(to)) {
      return '([<>~]?\\d+(?:[,.:]\\d+)*(?:[kKmM])?\\+?)';
    }
    return null;
  };
  var pre = new Map(), suf = new Map(), gen = []; // 按首字符 / 尾字符分桶，减少逐条正则测试
  var pats = [];
  var psrc = DICT.patterns || {};
  for (var pk in psrc) {
    var to = psrc[pk];
    if (typeof to !== 'string' || to === '') continue;
    var key = pk.trim();
    var litText = key.replace(/\{\d+\}/g, '');
    if (!/[A-Za-z]/.test(litText)) continue;
    var litLetters = (litText.match(/[A-Za-z]/g) || []).length;
    // 极短字面量（非冒号前缀）模板的自由捕获保护，防止 "On {0}" / "in {0}" / "{0}, from {1}" / "New {0}" 等误吞完整英文长句
    var shortGuard = litLetters <= 6 && litText.indexOf(':') < 0;
    var maxCapWords = litLetters <= 4 ? 4 : 6;
    var parts = key.split(/(\{\d+\})/);
    var re = '^', nums = [], seen = {}, lit = 0, opt = false, guarded = [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      var ph = /^\{(\d+)\}$/.exec(part);
      if (ph) {
        // 紧贴单词末尾、译文又没用到的占位符是英文单复数后缀（"{0} tool{1} enabled"），中文省略，按可选后缀匹配
        if (i > 0 && /[A-Za-z]$/.test(parts[i - 1]) && !/^[A-Za-z]/.test(parts[i + 1] || '') && to.indexOf(part) < 0) {
          re += '(?:s|es|ies)?'; opt = true; continue;
        }
        if (seen[ph[1]]) { re += '\\' + seen[ph[1]]; continue; }
        nums.push(ph[1]); seen[ph[1]] = nums.length;
        var nre = numericSlotRe(key, to, part);
        if (nre) { re += nre; }
        else { re += '([\\s\\S]+?)'; if (shortGuard) guarded.push(nums.length); }
      } else { re += escRe(part); lit += part.length; }
    }
    if (!nums.length && !opt) continue;
    pats.push({
      re: new RegExp(re + '$'), nums: nums, to: to, lit: lit, minLen: lit + nums.length,
      first: parts[0], last: parts[parts.length - 1], guarded: guarded, maxCapWords: maxCapWords
    });
  }
  // 字面量越长越具体，优先匹配（"Delete {0} files" 先于 "Delete {0}"）
  pats.sort(function (a, b) { return b.lit - a.lit; });
  pats.forEach(function (p, idx) {
    p.rank = idx;
    var bucket, k;
    if (p.first) { bucket = pre; k = p.first[0]; } else if (p.last) { bucket = suf; k = p.last[p.last.length - 1]; }
    if (!bucket) { gen.push(p); return; }
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(p);
  });

  if (!exact.size && !pats.length) return; // 未注入词典（模板原样运行）时什么都不做

  var matchPat = function (p, k) {
    var m = p.re.exec(k);
    if (!m) return null;
    if (p.guarded.length) {
      var words = 0;
      for (var i = 0; i < p.guarded.length; i++) {
        var cap = m[p.guarded[i]].trim();
        if (!cap) continue;
        if (/\n|[.!?…](?:\s|$)|[,;]\s/.test(cap)) return null;
        words += cap.split(/\s+/).length;
        if (words > p.maxCapWords) return null;
      }
    }
    return m;
  };

  var cache = new Map();
  var trExact = function (v) {
    var t = v.trim();
    var hit = t && exact.get(t);
    return hit ? v.replace(t, function () { return hit; }) : v;
  };
  var trCore = function (k, depth) {
    depth = depth || 0;
    var hit = exact.get(k);
    if (hit) return hit;
    var best = null, bestM = null;
    var lists = [pre.get(k[0]), suf.get(k[k.length - 1]), gen];
    for (var li = 0; li < 3; li++) {
      var list = lists[li];
      if (!list) continue;
      for (var j = 0; j < list.length; j++) {
        var p = list[j];
        if (best && p.rank >= best.rank) break;
        if (k.length < p.minLen) continue;
        var m = matchPat(p, k);
        if (m) { best = p; bestM = m; break; }
      }
    }
    if (!best) return null;
    var caps = {};
    best.nums.forEach(function (n, gi) { caps[n] = bestM[gi + 1]; });
    // 捕获值本身能翻译时递归翻译（例如 "Delete {0}" 中的 {0}、"refresh in {0}" 中的 "6 days, 21 hours"）；
    // 捕获值一定比原文短，递归必然终止，这里再限制深度防止意外
    return best.to.replace(/\{(\d+)\}/g, function (all, n) {
      if (!(n in caps)) return all;
      var c = caps[n];
      if (depth >= 2) return trExact(c);
      var t = c.trim(), sub = t && /[A-Za-z]/.test(t) ? trCore(t, depth + 1) : null;
      return sub == null ? c : c.replace(t, function () { return sub; });
    });
  };
  // 对外的翻译函数：按 trim 后整段匹配，保留原文首尾空白；无译文返回 null
  var tr = function (s) {
    if (!s || !/[A-Za-z]/.test(s)) return null;
    var k = s.trim();
    var r;
    if (cache.has(k)) r = cache.get(k);
    else {
      r = trCore(k);
      if (cache.size > 20000) cache.clear();
      cache.set(k, r);
    }
    if (r == null || r === k) return null;
    var lead = s.length - s.replace(/^\s+/, '').length;
    var trail = s.length - s.replace(/\s+$/, '').length;
    return s.slice(0, lead) + r + s.slice(s.length - trail);
  };

  // ---------- 漏译收集 ----------
  // 有些文字由服务器运行时下发（额度说明、布局选项等），静态提取看不到。
  // 这里记录界面上出现过、但词典里没有的英文；按 Ctrl+Alt+Shift+Z 复制到剪贴板，交给维护者补译。
  var known = new Set();
  for (var nk in src) if (src[nk] == null) known.add(nk.trim());
  for (var np in psrc) if (psrc[np] == null) known.add(np.trim());
  var misses = new Map();
  var record = function (s) {
    if (!s || misses.size >= 3000) return;
    var t = s.trim();
    if (t.length < 2 || t.length > 300 || !/[A-Za-z]{2,}/.test(t) || known.has(t) || /[\u3400-\u9fff]/.test(t)) return;
    if (/^[\w.\-/:@#%+=~]+$/.test(t) && !/^[A-Z][a-z]+$/.test(t)) return; // 路径、标识符、数字、版本号
    misses.set(t, (misses.get(t) || 0) + 1);
  };
  var copyMisses = function () {
    var text = Array.from(misses.keys()).sort().join('\n');
    var done = function (ok) {
      var tip = document.createElement('div');
      tip.setAttribute('data-agy-zh-skip', '');
      tip.textContent = ok ? '[agy-zh] 已复制 ' + misses.size + ' 条未翻译文字到剪贴板' : '[agy-zh] 复制失败';
      tip.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:32px;transform:translateX(-50%);padding:8px 14px;border-radius:8px;background:#222;color:#fff;font:13px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)';
      document.body.appendChild(tip);
      setTimeout(function () { tip.remove(); }, 2500);
    };
    var fallback = function () {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy'); ta.remove(); done(ok);
      } catch (e) { done(false); }
    };
    try { navigator.clipboard.writeText(text).then(function () { done(true); }, fallback); } catch (e) { fallback(); }
  };
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.altKey && e.shiftKey && (e.key === 'Z' || e.key === 'z' || e.code === 'KeyZ')) { e.preventDefault(); copyMisses(); }
  }, true);

  // ---------- Electron 原生菜单与通知 IPC 拦截 ----------
  var translateMenuItems = function (items) {
    if (!Array.isArray(items)) return items;
    return items.map(function (item) {
      if (!item || typeof item !== 'object') return item;
      var copy = Object.assign({}, item);
      if (typeof copy.label === 'string') {
        var r = tr(copy.label);
        if (r != null) copy.label = r;
        else record(copy.label);
      }
      if (typeof copy.sublabel === 'string') {
        var sr = tr(copy.sublabel);
        if (sr != null) copy.sublabel = sr;
      }
      if (typeof copy.toolTip === 'string') {
        var tt = tr(copy.toolTip);
        if (tt != null) copy.toolTip = tt;
      }
      if (Array.isArray(copy.submenu)) copy.submenu = translateMenuItems(copy.submenu);
      if (Array.isArray(copy.items)) copy.items = translateMenuItems(copy.items);
      return copy;
    });
  };

  var translateNotificationOptions = function (opts) {
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) return opts;
    var copy = Object.assign({}, opts);
    if (typeof copy.title === 'string') {
      var t = tr(copy.title);
      if (t != null) copy.title = t;
      else record(copy.title);
    }
    if (typeof copy.body === 'string') {
      var b = tr(copy.body);
      if (b != null) copy.body = b;
      else record(copy.body);
    }
    return copy;
  };

  var installIpcHook = function (ipc) {
    if (!ipc) {
      try {
        if (typeof electron_1 !== 'undefined' && electron_1 && electron_1.ipcRenderer) ipc = electron_1.ipcRenderer;
      } catch (e) { /* 忽略 */ }
    }
    if (!ipc) {
      try {
        if (typeof require === 'function') {
          var elMod = require('electron');
          if (elMod && elMod.ipcRenderer) ipc = elMod.ipcRenderer;
        }
      } catch (e) { /* 忽略 */ }
    }
    if (!ipc || typeof ipc.invoke !== 'function') return false;
    if (ipc.invoke.__agyZhWrapped) return true;
    var origInvoke = ipc.invoke;
    var wrappedInvoke = function (channel) {
      var args = Array.prototype.slice.call(arguments);
      try {
        if (channel === 'window:show-context-menu' && Array.isArray(args[1])) {
          args[1] = translateMenuItems(args[1]);
        } else if (channel === 'notification:send' && args[1] && typeof args[1] === 'object') {
          args[1] = translateNotificationOptions(args[1]);
        }
      } catch (e) { /* 翻译异常不影响原 IPC 调用 */ }
      return origInvoke.apply(this, args);
    };
    wrappedInvoke.__agyZhWrapped = true;
    try {
      ipc.invoke = wrappedInvoke;
      if (ipc.invoke === wrappedInvoke) return true;
    } catch (e) { /* 只读属性，回退 defineProperty */ }
    try {
      Object.defineProperty(ipc, 'invoke', {
        value: wrappedInvoke,
        configurable: true,
        writable: true
      });
      return ipc.invoke === wrappedInvoke;
    } catch (e) {
      return false;
    }
  };
  // preload 阶段立即挂载 IPC 拦截，无需等待 DOMContentLoaded
  installIpcHook();

  // ---------- DOM 写入与死循环防护 ----------
  var orig = new WeakMap();     // 文本节点 -> 英文原值
  var written = new WeakMap();  // 文本节点 -> 我们写入的值
  var oAttr = new WeakMap();    // 元素 -> {属性: 英文原值}
  var wAttr = new WeakMap();    // 元素 -> {属性: 我们写入的值}
  var burst = new WeakMap();    // 节点 -> {t, n}：1 秒内被我们改写的次数
  var frozen = new WeakSet();   // 熔断后不再处理的节点（与其他脚本来回改写时）
  var stats = { writes: 0, frozen: 0, scans: 0, lastScanMs: 0 };
  var now = function () { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); };

  var allow = function (node) {
    if (frozen.has(node)) return false;
    var t = Date.now(), b = burst.get(node);
    if (!b || t - b.t > 1000) { b = { t: t, n: 0 }; burst.set(node, b); }
    if (++b.n > 30) { frozen.add(node); stats.frozen++; return false; }
    return true;
  };
  var writeText = function (node, v) {
    written.set(node, v);
    if (node.data !== v && allow(node)) { node.data = v; stats.writes++; }
  };
  // 取文本节点当前的英文原值：当前值等于我们写入的值说明没被外部改过，否则以当前值为新的原值
  var origOf = function (node) {
    var cur = node.data;
    if (written.has(node) && written.get(node) === cur) return orig.get(node);
    orig.set(node, cur);
    written.delete(node);
    return cur;
  };

  var processText = function (node) {
    if (frozen.has(node)) return;
    var o = origOf(node);
    var r = tr(o);
    if (r == null) record(o);
    var want = r == null ? o : r;
    if (want !== node.data) writeText(node, want);
    else if (r != null) written.set(node, want);
  };

  // React 的 createElement("span", null, "Running ", n, " tasks") 会渲染成多个相邻文本节点：拼接后整体匹配
  var processGroup = function (texts) {
    var origs = texts.map(origOf);
    var r = tr(origs.join(''));
    if (r == null) { record(origs.join('')); texts.forEach(processText); return; }
    writeText(texts[0], r);
    for (var i = 1; i < texts.length; i++) writeText(texts[i], '');
  };

  var processAttrs = function (el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var name = ATTRS[i];
      var cur = el.getAttribute(name);
      if (cur == null || !/[A-Za-z]/.test(cur) && !(wAttr.get(el) || {})[name]) continue;
      var wa = wAttr.get(el), oa = oAttr.get(el);
      if (!wa) { wa = {}; wAttr.set(el, wa); }
      if (!oa) { oa = {}; oAttr.set(el, oa); }
      var o;
      if (wa[name] === cur) o = oa[name];
      else { o = cur; oa[name] = cur; delete wa[name]; }
      var r = tr(o);
      if (r == null) {
        record(o);
        if (cur !== o) { wa[name] = o; el.setAttribute(name, o); }
        continue;
      }
      wa[name] = r;
      if (r !== cur && allow(el)) { el.setAttribute(name, r); stats.writes++; }
    }
  };

  // 处理一个元素自身：属性 + 直接文本子节点（全为文本且 ≥2 个时按分组处理）
  var processShallow = function (el) {
    if (el.hasAttribute && (el.hasAttribute('title') || el.hasAttribute('placeholder') || el.hasAttribute('aria-label'))) processAttrs(el);
    var texts = null, allText = true;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) (texts || (texts = [])).push(c);
      else if (c.nodeType !== 8) allText = false;
    }
    if (!texts) return;
    if (allText && texts.length >= 2) processGroup(texts);
    else for (var i = 0; i < texts.length; i++) processText(texts[i]);
  };

  var isSkippedMarkdown = function (el) {
    return !!(el.hasAttribute && el.hasAttribute('data-markdown-root') && !el.closest(MD_ALLOW_ANCESTOR));
  };
  // 0：正常；1：自身命中跳过但可翻译属性；2：完全跳过
  var skipState = function (el) {
    var p = el.parentElement;
    if (p) {
      if (p.closest(SKIP_BASE)) return 2;
      for (var md = p.closest('[data-markdown-root]'); md; md = md.parentElement && md.parentElement.closest('[data-markdown-root]')) {
        if (!md.closest(MD_ALLOW_ANCESTOR)) return 2;
      }
    }
    if (el.matches(SKIP_BASE)) return el.matches(ATTR_OK) ? 1 : 2;
    if (isSkippedMarkdown(el)) return 2;
    return 0;
  };

  var filter = {
    acceptNode: function (el) {
      if (el.matches(SKIP_BASE)) {
        if (el.matches(ATTR_OK)) processAttrs(el);
        return 2; // NodeFilter.FILTER_REJECT：跳过整棵子树
      }
      if (isSkippedMarkdown(el)) return 2;
      return 1;   // NodeFilter.FILTER_ACCEPT
    }
  };
  // 遍历子树（root 自身的跳过状态由调用方判断）
  var walk = function (root) {
    processShallow(root);
    var w = document.createTreeWalker(root, 1 /* SHOW_ELEMENT */, filter);
    var el;
    while ((el = w.nextNode())) processShallow(el);
  };
  var scan = function (root) {
    root = root || document.documentElement;
    if (!root) return;
    var t0 = now();
    var s = root.nodeType === 1 ? skipState(root) : 0;
    if (s === 0) walk(root); else if (s === 1) processAttrs(root);
    stats.scans++;
    stats.lastScanMs = now() - t0;
    if (started) observer.takeRecords(); // 手动扫描时同样丢弃自己写入的记录
  };

  // ---------- 增量处理 ----------
  var observer = new MutationObserver(function (list) {
    var deep = new Set(), shallow = new Set(), attrs = new Set();
    for (var i = 0; i < list.length; i++) {
      var m = list[i], t = m.target;
      if (m.type === 'characterData') {
        // 自己写入产生的记录在回调末尾已被 takeRecords 丢弃，这里收到的都是外部（React）改写：
        // 以当前值为新原值（即使它恰好等于我们之前写入的值，例如单复数后缀被改成空串）
        written.delete(t);
        if (t.parentNode && t.parentNode.nodeType === 1) shallow.add(t.parentNode);
      } else if (m.type === 'attributes') {
        var wa = wAttr.get(t);
        if (wa) delete wa[m.attributeName];
        attrs.add(t);
      } else {
        if (t.nodeType === 1) shallow.add(t);
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 1) deep.add(n);
        }
      }
    }
    deep.forEach(function (el) {
      if (!el.isConnected) return;
      var s = skipState(el);
      if (s === 0) walk(el); else if (s === 1) processAttrs(el);
      shallow.delete(el); attrs.delete(el);
    });
    shallow.forEach(function (el) {
      if (el.isConnected && skipState(el) === 0) { processShallow(el); attrs.delete(el); }
    });
    attrs.forEach(function (el) {
      if (el.isConnected && skipState(el) !== 2) processAttrs(el);
    });
    observer.takeRecords(); // 丢弃本轮自己写入产生的记录，防止自激
  });

  var started = false;
  var start = function () {
    if (started || !document.documentElement) return;
    started = true;
    scan(document.documentElement); // 含 <head><title>，document.title 一并翻译
    observer.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS
    });
  };

  try {
    Object.defineProperty(globalThis, '__AGY_ZH__', {
      configurable: true,
      value: {
        tr: tr, scan: scan, stats: stats, start: start, misses: misses, copyMisses: copyMisses,
        translateMenuItems: translateMenuItems,
        translateNotificationOptions: translateNotificationOptions,
        installIpcHook: installIpcHook,
        stop: function () { observer.disconnect(); started = false; },
        size: { exact: exact.size, patterns: pats.length }
      }
    });
  } catch (e) { /* 忽略 */ }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
