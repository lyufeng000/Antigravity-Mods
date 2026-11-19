// Antigravity 左下角多账号周额度插槽（运行在 dist/preload.js 沙箱，配合 dist/main.js 读写 accounts.json）
// 原则：0 主动网络请求、不接触任何本地 OAuth 文件；所有已记录账号常驻展示，登出账号保留上次查询额度并本地计算倒计时。
(function () {
  'use strict';

  var g = typeof window !== 'undefined' ? window : globalThis;
  if (!g || !g.document || g.__AGY_QUOTA_SLOT_BOOTED__) return;
  if (g.top && g.self && g.top !== g.self) return;
  var loc = g.location;
  if (loc && loc.protocol && loc.hostname) {
    var isLocalHub = /^https?:$/.test(loc.protocol) && (loc.hostname === '127.0.0.1' || loc.hostname === 'localhost');
    var isTestHost = loc.protocol === 'about:' || loc.hostname === 'example.com' || loc.hostname === 'jsdom.local';
    if (!isLocalHub && !isTestHost) return;
  }
  Object.defineProperty(g, '__AGY_QUOTA_SLOT_BOOTED__', { value: true });

  var BRIDGE_KEY = '__agy_quota_bridge_v1__';
  var LEGACY_CACHE_KEY = 'agy_weekly_quota_cache_v1';
  var TEST_STORE_KEY = 'agy_weekly_quota_accounts_v2';
  var SLOT_ID = 'agy-weekly-quota-slot';
  var CIRCUMFERENCE = 2 * Math.PI * 13;

  // 注入到 Main World 的只读被动旁路装饰器（内部不引用外部闭包变量）
  function installMainWorldTap(bridgeKey) {
    if (globalThis.__AGY_QUOTA_TAP_INSTALLED__) return;
    Object.defineProperty(globalThis, '__AGY_QUOTA_TAP_INSTALLED__', { value: true });

    var state = { hasUser: false, email: '', summary: null, seq: 0 };

    function publish() {
      state.seq += 1;
      try {
        if (globalThis.sessionStorage) {
          globalThis.sessionStorage.setItem(bridgeKey, JSON.stringify(state));
        }
        globalThis.dispatchEvent(new Event(bridgeKey));
      } catch (_) {}
    }

    function toResetMs(rt) {
      if (!rt) return null;
      if (typeof rt === 'string') {
        var parsed = Date.parse(rt);
        return Number.isFinite(parsed) ? parsed : null;
      }
      if (typeof rt === 'object' && rt.seconds !== undefined && rt.seconds !== null) {
        var sec = Number(rt.seconds);
        var nanos = Number(rt.nanos || 0);
        if (Number.isFinite(sec)) return sec * 1000 + Math.round(nanos / 1e6);
      }
      return null;
    }

    function isGeminiText(s) {
      return typeof s === 'string' && s.toLowerCase().indexOf('gemini') !== -1;
    }

    function extractGeminiWeekly(res) {
      var groups = res && res.response && res.response.groups;
      if (!Array.isArray(groups)) return null;
      for (var i = 0; i < groups.length; i++) {
        var grp = groups[i];
        var grpIsGemini = isGeminiText(grp && grp.displayName);
        var buckets = grp && Array.isArray(grp.buckets) ? grp.buckets : [];
        for (var j = 0; j < buckets.length; j++) {
          var b = buckets[j];
          if (!b || typeof b.window !== 'string' || b.window.trim().toLowerCase() !== 'weekly') continue;
          if (!grpIsGemini && !isGeminiText(b.displayName) && !isGeminiText(b.bucketId)) continue;
          var frac = null;
          if (b.remaining && b.remaining.case === 'remainingFraction' && typeof b.remaining.value === 'number') {
            frac = b.remaining.value;
          } else if (typeof b.remainingFraction === 'number') {
            frac = b.remainingFraction;
          }
          if (frac !== null) frac = Math.max(0, Math.min(1, frac));
          return {
            remainingFraction: frac,
            resetTimeMs: toResetMs(b.resetTime),
            disabled: Boolean(b.disabled),
            ts: Date.now(),
          };
        }
      }
      return null;
    }

    function wrapLsClient(client) {
      if (!client || typeof client !== 'object' || client.__agyQuotaWrapped) return client;
      return new Proxy(client, {
        get: function (target, prop) {
          if (prop === '__agyQuotaWrapped') return true;
          var orig = Reflect.get(target, prop, target);
          if (typeof orig !== 'function') return orig;

          if (prop === 'getUserStatus') {
            return function () {
              var p = Reflect.apply(orig, target, arguments);
              Promise.resolve(p).then(function (res) {
                var us = res && res.userStatus;
                var email = us && typeof us.email === 'string' ? us.email.trim() : '';
                state.hasUser = true;
                if (state.email !== email) {
                  state.email = email;
                  if (!email) state.summary = null;
                }
                publish();
              }, function (err) {
                var code = err && typeof err === 'object' ? err.code : undefined;
                var msg = String((err && err.message) || '');
                if (code === 16 || /unauthenticated/i.test(msg)) {
                  state.hasUser = true;
                  state.email = '';
                  state.summary = null;
                  publish();
                }
              });
              return p;
            };
          }

          if (prop === 'retrieveUserQuotaSummary') {
            return function () {
              var p = Reflect.apply(orig, target, arguments);
              Promise.resolve(p).then(function (res) {
                var weekly = extractGeminiWeekly(res);
                if (weekly) {
                  state.summary = weekly;
                  publish();
                }
              }, function () {});
              return p;
            };
          }

          if (prop === 'signOut' || prop === 'clearAuth' || prop === 'logout') {
            return function () {
              var p = Reflect.apply(orig, target, arguments);
              Promise.resolve(p).then(function () {
                state.hasUser = true;
                state.email = '';
                state.summary = null;
                publish();
              }, function () {});
              return p;
            };
          }

          return orig;
        },
      });
    }

    var prevDecorator = globalThis.__JETSKI_LS_CLIENT_DECORATOR__;
    Object.defineProperty(globalThis, '__JETSKI_LS_CLIENT_DECORATOR__', {
      configurable: true,
      enumerable: true,
      get: function () {
        return function (client) {
          var decorated = typeof prevDecorator === 'function' ? prevDecorator(client) : client;
          return wrapLsClient(decorated);
        };
      },
      set: function (nextFn) {
        prevDecorator = nextFn;
      },
    });
  }

  // 与 Antigravity 原生 aqa() 完全一致的英文倒计时格式
  function formatResetsIn(resetTimeMs, nowMs) {
    if (typeof resetTimeMs !== 'number' || !Number.isFinite(resetTimeMs)) return '';
    var diffMs = resetTimeMs - (typeof nowMs === 'number' ? nowMs : Date.now());
    if (diffMs <= 0) return 'Resets in <1m';
    var totalMins = Math.floor(diffMs / 60000);
    var days = Math.floor(totalMins / 1440);
    var hours = Math.floor((totalMins % 1440) / 60);
    var mins = totalMins % 60;
    var span = days > 0
      ? (hours > 0 ? days + 'd ' + hours + 'h' : days + 'd')
      : hours > 0
        ? (mins > 0 ? hours + 'h ' + mins + 'm' : hours + 'h')
        : mins > 0
          ? mins + 'm'
          : '<1m';
    return 'Resets in ' + span;
  }

  function normalizeAccountEntry(v) {
    if (!v || typeof v !== 'object') {
      return { remainingFraction: null, resetTimeMs: null, disabled: false };
    }
    var frac = null;
    if (typeof v.remainingFraction === 'number' && Number.isFinite(v.remainingFraction)) {
      frac = Math.max(0, Math.min(1, v.remainingFraction));
    } else if (typeof v.remainingPercent === 'number' && Number.isFinite(v.remainingPercent)) {
      frac = Math.max(0, Math.min(1, v.remainingPercent / 100));
    }
    var resetMs = null;
    if (typeof v.resetTimeMs === 'number' && Number.isFinite(v.resetTimeMs)) {
      resetMs = v.resetTimeMs;
    } else if (typeof v.resetAt === 'string' && v.resetAt) {
      var p = Date.parse(v.resetAt);
      if (Number.isFinite(p)) resetMs = p;
    }
    return {
      remainingFraction: frac,
      resetTimeMs: resetMs,
      disabled: Boolean(v.disabled),
    };
  }

  var ipc = null;
  var webFrame = null;
  try {
    if (typeof require === 'function') {
      var electronMod = require('electron');
      if (electronMod) {
        ipc = electronMod.ipcRenderer || null;
        webFrame = electronMod.webFrame || null;
      }
    }
  } catch (_) {}

  var hasMainConfigIpc = false;
  var configFilePath = '';
  var accountsMap = {};

  function setAccountsFromRaw(rawAccounts) {
    var next = {};
    if (rawAccounts && typeof rawAccounts === 'object' && !Array.isArray(rawAccounts)) {
      var keys = Object.keys(rawAccounts);
      for (var i = 0; i < keys.length; i++) {
        var em = keys[i].trim();
        if (!em) continue;
        next[em] = normalizeAccountEntry(rawAccounts[keys[i]]);
      }
    }
    accountsMap = next;
  }

  // 初始化读取 accounts.json，并清理旧版在 app_storage.json / localStorage 中留下的痕迹
  (function initAccountStore() {
    if (ipc && typeof ipc.sendSync === 'function') {
      try {
        var syncCfg = ipc.sendSync('agy-quota:get-config-sync');
        if (syncCfg && typeof syncCfg === 'object' && syncCfg.data) {
          hasMainConfigIpc = true;
          configFilePath = syncCfg.configFile || '';
          setAccountsFromRaw(syncCfg.data.accounts);
        }
      } catch (_) {}
    }

    if (!hasMainConfigIpc) {
      try {
        var rawTest = g.localStorage && g.localStorage.getItem(TEST_STORE_KEY);
        if (rawTest) {
          var parsedTest = JSON.parse(rawTest);
          setAccountsFromRaw(parsedTest && parsedTest.accounts ? parsedTest.accounts : parsedTest);
        }
      } catch (_) {}
    }

    // 迁移并彻底清除旧版缓存键（确保删除 accounts.json 条目后本地无残留账号痕迹）
    var legacyMigrate = null;
    try {
      if (g.localStorage && g.localStorage.getItem(LEGACY_CACHE_KEY) !== null) {
        try { legacyMigrate = JSON.parse(g.localStorage.getItem(LEGACY_CACHE_KEY)); } catch (_) {}
        g.localStorage.removeItem(LEGACY_CACHE_KEY);
      }
    } catch (_) {}
    if (ipc && typeof ipc.sendSync === 'function' && typeof ipc.invoke === 'function') {
      try {
        var appItems = ipc.sendSync('storage:get-items-sync');
        if (appItems && typeof appItems === 'object' && (LEGACY_CACHE_KEY in appItems)) {
          if (!legacyMigrate && typeof appItems[LEGACY_CACHE_KEY] === 'string') {
            try { legacyMigrate = JSON.parse(appItems[LEGACY_CACHE_KEY]); } catch (_) {}
          }
          var delPatch = {};
          delPatch[LEGACY_CACHE_KEY] = null;
          Promise.resolve(ipc.invoke('storage:update-items', delPatch)).catch(function () {});
        }
      } catch (_) {}
    }
    if (legacyMigrate && typeof legacyMigrate === 'object' && !Array.isArray(legacyMigrate)) {
      if (hasMainConfigIpc && ipc && typeof ipc.invoke === 'function') {
        Promise.resolve(ipc.invoke('agy-quota:upsert-account', { migrate: legacyMigrate })).then(function (cfg) {
          if (cfg && cfg.accounts) {
            setAccountsFromRaw(cfg.accounts);
            renderSlot();
          }
        }).catch(function () {});
      } else {
        var lKeys = Object.keys(legacyMigrate);
        for (var i = 0; i < lKeys.length; i++) {
          var em = lKeys[i].trim();
          if (em && !accountsMap[em]) accountsMap[em] = normalizeAccountEntry(legacyMigrate[lKeys[i]]);
        }
        persistFallbackStore();
      }
    }
  })();

  function persistFallbackStore() {
    if (hasMainConfigIpc) return;
    try {
      if (g.localStorage) {
        g.localStorage.setItem(TEST_STORE_KEY, JSON.stringify({ accounts: accountsMap }));
      }
    } catch (_) {}
  }

  function upsertAccountRecord(email, summary) {
    if (!email) return;
    if (summary) {
      accountsMap[email] = normalizeAccountEntry(summary);
    } else if (!accountsMap[email]) {
      accountsMap[email] = normalizeAccountEntry(null);
    } else {
      return;
    }

    if (hasMainConfigIpc && ipc && typeof ipc.invoke === 'function') {
      Promise.resolve(ipc.invoke('agy-quota:upsert-account', { email: email, summary: summary || null })).catch(function () {});
    } else {
      persistFallbackStore();
    }
  }

  if (ipc && typeof ipc.on === 'function') {
    try {
      ipc.on('agy-quota:config-changed', function (_ev, cfg) {
        if (!cfg || typeof cfg !== 'object') return;
        setAccountsFromRaw(cfg.accounts);
        renderSlot();
      });
    } catch (_) {}
  }

  // 在 Main World 安装只读装饰器；若处于无 Electron 的单测环境则在当前全局安装
  (function injectTap() {
    var injectedViaElectron = false;
    try {
      if (webFrame && typeof webFrame.executeJavaScript === 'function') {
        var script = '(' + installMainWorldTap.toString() + ')(' + JSON.stringify(BRIDGE_KEY) + ');';
        Promise.resolve(webFrame.executeJavaScript(script)).catch(function () {});
        injectedViaElectron = true;
      }
    } catch (_) {}
    if (!injectedViaElectron) {
      installMainWorldTap(BRIDGE_KEY);
    }
  })();

  var currentEmail = '';
  var lastReportedLoginEmail = '';
  var lastSavedTs = 0;
  var pendingSummary = null;
  var countdownTimer = null;
  var domObserver = null;

  function createSvgEl(doc, tag, attrs) {
    var el = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, String(attrs[k]));
    }
    return el;
  }

  function ensureSlotContainer() {
    var doc = g.document;
    var settingsBtn = doc.querySelector('[data-testid="settings-button"]');
    var existing = doc.getElementById(SLOT_ID);
    if (!settingsBtn) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return null;
    }

    var nav = settingsBtn.closest('[role="navigation"]');
    var mountParent = null;
    var mountBefore = null;
    if (nav) {
      var footerBlock = settingsBtn;
      while (footerBlock && footerBlock.parentElement && footerBlock.parentElement !== nav) {
        footerBlock = footerBlock.parentElement;
      }
      if (footerBlock && footerBlock.parentElement === nav) {
        mountParent = nav;
        mountBefore = footerBlock;
      }
    }
    if (!mountParent) {
      mountParent = settingsBtn.parentElement;
      mountBefore = settingsBtn;
    }
    if (!mountParent) return null;

    if (!existing) {
      existing = doc.createElement('div');
      existing.id = SLOT_ID;
      existing.setAttribute('data-agy-zh-skip', 'true');
      existing.className = nav ? 'px-2 pt-2 pb-0.5 shrink-0 flex flex-col gap-1.5' : 'mb-1 shrink-0 flex flex-col gap-1.5';
    }

    if (existing.parentElement !== mountParent || existing.nextSibling !== mountBefore) {
      mountParent.insertBefore(existing, mountBefore);
    }
    return existing;
  }

  function createAccountCard(doc, email) {
    var card = doc.createElement('div');
    card.setAttribute('data-account-email', email);

    var headerRow = doc.createElement('div');
    headerRow.className = 'col-span-2 flex items-center gap-1.5 min-w-0';
    headerRow.style.marginBottom = '3px';

    var statusDot = doc.createElement('span');
    statusDot.setAttribute('data-role', 'status-dot');
    statusDot.style.width = '6px';
    statusDot.style.height = '6px';
    statusDot.style.borderRadius = '9999px';
    statusDot.style.flexShrink = '0';

    var emailEl = doc.createElement('span');
    emailEl.setAttribute('data-role', 'email');
    emailEl.className = 'truncate text-foreground font-semibold';
    emailEl.style.fontSize = '15px';
    emailEl.style.fontWeight = '600';
    emailEl.style.lineHeight = '1.35';
    emailEl.textContent = email;

    headerRow.appendChild(statusDot);
    headerRow.appendChild(emailEl);

    var labelEl = doc.createElement('span');
    labelEl.setAttribute('data-role', 'label');
    labelEl.className = 'truncate text-foreground';
    labelEl.style.fontSize = '12.5px';
    labelEl.style.lineHeight = '1.4';
    labelEl.textContent = '每周限额';

    var rightWrap = doc.createElement('span');
    rightWrap.className = 'flex items-center justify-end gap-1.5';
    rightWrap.style.fontSize = '12.5px';
    rightWrap.style.lineHeight = '1.4';

    var pctEl = doc.createElement('span');
    pctEl.setAttribute('data-role', 'pct');
    pctEl.className = 'text-muted-foreground';

    var ringBox = doc.createElement('div');
    ringBox.setAttribute('data-role', 'ring-box');
    ringBox.className = 'relative rounded-full bg-muted/20 dark:bg-muted/10 flex items-center justify-center flex-shrink-0 w-4 h-4';

    var svg = createSvgEl(doc, 'svg', {
      'aria-hidden': 'true',
      viewBox: '0 0 32 32',
      'shape-rendering': 'geometricPrecision',
      class: 'w-full h-full transform -rotate-90',
    });
    var trackCircle = createSvgEl(doc, 'circle', {
      cx: 16,
      cy: 16,
      r: 13,
      fill: 'transparent',
      stroke: 'currentColor',
      'stroke-opacity': '0.4',
      class: 'text-muted-foreground',
      'stroke-width': 3,
    });
    var fgCircle = createSvgEl(doc, 'circle', {
      'data-role': 'ring-fg',
      cx: 16,
      cy: 16,
      r: 13,
      fill: 'transparent',
      class: 'stroke-green-500 dark:stroke-green-600',
      'stroke-width': 4,
      'stroke-dasharray': CIRCUMFERENCE,
      'stroke-dashoffset': CIRCUMFERENCE,
      'stroke-linecap': 'butt',
    });
    svg.appendChild(trackCircle);
    svg.appendChild(fgCircle);
    ringBox.appendChild(svg);

    rightWrap.appendChild(pctEl);
    rightWrap.appendChild(ringBox);

    var resetEl = doc.createElement('span');
    resetEl.setAttribute('data-role', 'reset');
    resetEl.className = 'col-span-2 truncate text-muted-foreground';
    resetEl.style.fontSize = '12px';
    resetEl.style.lineHeight = '1.35';

    card.appendChild(headerRow);
    card.appendChild(labelEl);
    card.appendChild(rightWrap);
    card.appendChild(resetEl);
    return card;
  }

  function syncCountdownTimer(hasAnyReset) {
    if (!hasAnyReset) {
      if (countdownTimer !== null) {
        g.clearInterval(countdownTimer);
        countdownTimer = null;
      }
      return;
    }
    if (countdownTimer === null) {
      countdownTimer = g.setInterval(function () {
        renderSlot();
      }, 60000);
      if (countdownTimer && typeof countdownTimer.unref === 'function') {
        countdownTimer.unref();
      }
    }
  }

  function renderSlot() {
    var doc = g.document;
    var emails = Object.keys(accountsMap);
    if (emails.length === 0) {
      var old = doc.getElementById(SLOT_ID);
      if (old) old.style.display = 'none';
      syncCountdownTimer(false);
      return;
    }

    var slot = ensureSlotContainer();
    if (!slot) return;
    slot.style.display = '';

    // 同步卡片节点列表与 accounts.json 顺序一致，移除已被删除的账号卡片
    var existingByEmail = {};
    for (var c = slot.firstElementChild; c; ) {
      var nextSib = c.nextElementSibling;
      var emAttr = c.getAttribute('data-account-email');
      if (emAttr && Object.prototype.hasOwnProperty.call(accountsMap, emAttr)) {
        existingByEmail[emAttr] = c;
      } else {
        slot.removeChild(c);
      }
      c = nextSib;
    }

    var hasAnyReset = false;
    var cfgHint = configFilePath ? ('\n配置文件：' + configFilePath) : '';

    for (var i = 0; i < emails.length; i++) {
      var email = emails[i];
      var entry = accountsMap[email] || { remainingFraction: null, resetTimeMs: null, disabled: false };
      var isActive = Boolean(currentEmail && email === currentEmail);
      var card = existingByEmail[email] || createAccountCard(doc, email);

      if (slot.children[i] !== card) {
        slot.insertBefore(card, slot.children[i] || null);
      }

      card.className = isActive
        ? 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-2.5 py-2 rounded-md select-none bg-muted/30 dark:bg-muted/20'
        : 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-2.5 py-2 rounded-md select-none bg-muted/15 dark:bg-muted/10';
      card.style.opacity = isActive ? '1' : '0.78';

      var statusDot = card.querySelector('[data-role="status-dot"]');
      var emailEl = card.querySelector('[data-role="email"]');
      var pctEl = card.querySelector('[data-role="pct"]');
      var ringBox = card.querySelector('[data-role="ring-box"]');
      var fgCircle = card.querySelector('[data-role="ring-fg"]');
      var resetEl = card.querySelector('[data-role="reset"]');

      if (statusDot) {
        if (isActive) {
          statusDot.style.backgroundColor = '#22c55e';
          statusDot.style.opacity = '1';
        } else {
          statusDot.style.backgroundColor = 'currentColor';
          statusDot.style.opacity = '0.35';
        }
      }
      if (emailEl) {
        emailEl.textContent = email;
        emailEl.title = email;
      }

      var frac = typeof entry.remainingFraction === 'number' ? entry.remainingFraction : null;
      var disabled = Boolean(entry.disabled);

      card.title = isActive
        ? (frac !== null ? '当前登录账号：' + email + cfgHint : '当前登录账号（打开「设置 → 模型与用量」后自动同步周额度）' + cfgHint)
        : ('已登出（保留上次查询额度，倒计时本地计算）：' + email + cfgHint);

      if (pctEl) {
        pctEl.textContent = frac !== null ? '剩余 ' + Math.round(frac * 100) + '%' : '--';
      }
      if (ringBox) {
        ringBox.style.display = disabled ? 'none' : '';
      }
      if (fgCircle) {
        if (frac === null || disabled) {
          fgCircle.style.display = 'none';
        } else {
          fgCircle.style.display = '';
          var colorCls = frac < 0.1
            ? 'stroke-red-500 dark:stroke-red-600'
            : frac < 0.25
              ? 'stroke-yellow-500 dark:stroke-yellow-600'
              : 'stroke-green-500 dark:stroke-green-600';
          fgCircle.setAttribute('class', colorCls);
          fgCircle.setAttribute('stroke-dashoffset', String(CIRCUMFERENCE - frac * CIRCUMFERENCE));
        }
      }

      var resetMs = typeof entry.resetTimeMs === 'number' ? entry.resetTimeMs : null;
      if (resetMs !== null && Number.isFinite(resetMs)) hasAnyReset = true;
      var resetText = formatResetsIn(resetMs);
      if (resetEl) {
        if (resetText) {
          resetEl.textContent = resetText;
          resetEl.style.display = '';
        } else {
          resetEl.textContent = '';
          resetEl.style.display = 'none';
        }
      }
    }

    syncCountdownTimer(hasAnyReset);
  }

  function handleBridgeEvent() {
    var data = null;
    try {
      var raw = g.sessionStorage && g.sessionStorage.getItem(BRIDGE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (_) {}
    if (!data || typeof data !== 'object') {
      renderSlot();
      return;
    }

    if (data.hasUser) {
      var nextEmail = typeof data.email === 'string' ? data.email.trim() : '';
      currentEmail = nextEmail;
      if (currentEmail) {
        if (pendingSummary) {
          upsertAccountRecord(currentEmail, pendingSummary);
          lastSavedTs = pendingSummary.ts || 0;
          pendingSummary = null;
          lastReportedLoginEmail = currentEmail;
        } else if (lastReportedLoginEmail !== currentEmail) {
          lastReportedLoginEmail = currentEmail;
          upsertAccountRecord(currentEmail, null);
        }
      } else {
        lastReportedLoginEmail = '';
        pendingSummary = null;
      }
    }

    if (data.summary && typeof data.summary === 'object') {
      var ts = data.summary.ts || 0;
      if (ts !== lastSavedTs) {
        if (currentEmail) {
          upsertAccountRecord(currentEmail, data.summary);
          lastSavedTs = ts;
        } else if (!data.hasUser) {
          pendingSummary = data.summary;
        }
      }
    }

    renderSlot();
    if (domObserver) domObserver.takeRecords();
  }

  function startDomObserver() {
    var doc = g.document;
    if (!doc.documentElement || typeof g.MutationObserver !== 'function') return;
    domObserver = new g.MutationObserver(function () {
      if (Object.keys(accountsMap).length === 0) return;
      var slot = doc.getElementById(SLOT_ID);
      var settingsBtn = doc.querySelector('[data-testid="settings-button"]');
      if (settingsBtn && (!slot || !slot.isConnected)) {
        renderSlot();
        domObserver.takeRecords();
      } else if (!settingsBtn && slot && slot.parentNode) {
        slot.parentNode.removeChild(slot);
        domObserver.takeRecords();
      }
    });
    domObserver.observe(doc.documentElement, { childList: true, subtree: true });
  }

  g.addEventListener(BRIDGE_KEY, handleBridgeEvent);

  if (g.document.readyState === 'loading') {
    g.document.addEventListener('DOMContentLoaded', function () {
      startDomObserver();
      handleBridgeEvent();
    }, { once: true });
  } else {
    startDomObserver();
    handleBridgeEvent();
  }
})();
