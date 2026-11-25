// Antigravity 主进程（dist/main.js）Windows 系统通知点击跳转修复模块
// 1. 启动同步绑定 AppUserModelId（electron.app.Antigravity），匹配开始菜单快捷方式与系统通知注册表；
// 2. 全局 Set 保活 Notification 实例，避免点击前被 V8 GC 回收导致 click 监听失效；
// 3. 修复 BaseWindow 缺少 win.webContents 导致的 notification:clicked 派发异常，优先定位触发通知的窗口；
// 4. 在 Windows 下使用短暂 screen-saver 置顶 + app.focus({ steal: true }) + 延迟补焦突破前台焦点保护；
// 5. 监听非 --ssh-host= 的 second-instance（如 -ToastActivated），确保通知唤醒稳妥前置。
(function () {
  'use strict';

  var MAX_NOTIFICATION_TITLE = 200;
  var MAX_NOTIFICATION_BODY = 1000;
  var defaultPendingTopResetByWin = new WeakMap();

  function truncate(text, max) {
    var s = typeof text === 'string' ? text : '';
    return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
  }

  function resolveAumid(app) {
    var rawName = '';
    try {
      rawName = app && typeof app.getName === 'function' ? String(app.getName() || '') : '';
    } catch (_) {}
    var name = rawName.trim() || 'Antigravity';
    if (name.toLowerCase() === 'antigravity') {
      return 'electron.app.Antigravity';
    }
    return 'electron.app.' + name;
  }

  function isAlive(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (typeof obj.isDestroyed === 'function') {
      try {
        return !obj.isDestroyed();
      } catch (_) {
        return false;
      }
    }
    return true;
  }

  function safeRequire(requireFn, id) {
    if (typeof requireFn !== 'function') return null;
    try {
      return requireFn(id);
    } catch (_) {
      return null;
    }
  }

  function bringWindowToFront(win, targetContents, options) {
    if (!isAlive(win)) return;
    var opts = options || {};
    var map = opts.pendingTopResetByWin || defaultPendingTopResetByWin;
    var effPlatform = opts.platform || (typeof process !== 'undefined' ? process.platform : '');
    var effApp = opts.app;
    var setFn = opts.setTimeout || setTimeout;
    var clearFn = opts.clearTimeout || clearTimeout;
    var delay = typeof opts.refocusDelayMs === 'number' ? opts.refocusDelayMs : 140;

    var entry = map.get(win);
    if (entry && entry.timer) {
      try {
        clearFn(entry.timer);
      } catch (_) {}
      entry.timer = null;
    }
    if (!entry) {
      var wasAlwaysOnTop = false;
      try {
        if (typeof win.isAlwaysOnTop === 'function') {
          wasAlwaysOnTop = Boolean(win.isAlwaysOnTop());
        }
      } catch (_) {}
      entry = { timer: null, wasAlwaysOnTop: wasAlwaysOnTop };
      map.set(win, entry);
    }

    try {
      if (typeof win.flashFrame === 'function') win.flashFrame(false);
    } catch (_) {}
    try {
      if (typeof win.isMinimized === 'function' && win.isMinimized() && typeof win.restore === 'function') {
        win.restore();
      }
    } catch (_) {}
    try {
      if (typeof win.show === 'function') win.show();
    } catch (_) {}

    if (effPlatform === 'win32' && !entry.wasAlwaysOnTop && typeof win.setAlwaysOnTop === 'function') {
      try {
        win.setAlwaysOnTop(true, 'screen-saver');
      } catch (_) {
        try {
          win.setAlwaysOnTop(true);
        } catch (_2) {}
      }
    }

    try {
      if (typeof win.moveTop === 'function') win.moveTop();
    } catch (_) {}
    try {
      if (effApp && typeof effApp.focus === 'function') effApp.focus({ steal: true });
    } catch (_) {}
    try {
      if (typeof win.focus === 'function') win.focus();
    } catch (_) {}
    try {
      if (isAlive(targetContents) && typeof targetContents.focus === 'function') {
        targetContents.focus();
      }
    } catch (_) {}

    if (effPlatform === 'win32') {
      var timer = setFn(function () {
        if (map.get(win) === entry) {
          map.delete(win);
        }
        if (!isAlive(win)) return;
        if (!entry.wasAlwaysOnTop && typeof win.setAlwaysOnTop === 'function') {
          try {
            win.setAlwaysOnTop(false);
          } catch (_) {}
        }
        try {
          if (typeof win.moveTop === 'function') win.moveTop();
        } catch (_) {}
        try {
          if (typeof win.focus === 'function') win.focus();
        } catch (_) {}
        try {
          if (isAlive(targetContents) && typeof targetContents.focus === 'function') {
            targetContents.focus();
          }
        } catch (_) {}
      }, delay);
      if (timer && typeof timer.unref === 'function') {
        try {
          timer.unref();
        } catch (_) {}
      }
      entry.timer = timer;
    } else {
      map.delete(win);
    }
  }

  function installWinNotifyFix(deps) {
    var d = deps || {};
    var baseRequire = typeof d.requireFn === 'function'
      ? d.requireFn
      : (typeof require === 'function'
        ? require
        : (typeof process !== 'undefined' && process && typeof process.getBuiltinModule === 'function'
          ? function (id) { return process.getBuiltinModule(id); }
          : null));

    var electron = d.electron !== undefined ? d.electron : safeRequire(baseRequire, 'electron');
    var utils = d.utils !== undefined ? d.utils : safeRequire(baseRequire, './utils');
    var remoteWindowSecurity = d.remoteWindowSecurity !== undefined
      ? d.remoteWindowSecurity
      : safeRequire(baseRequire, './remote/remoteWindowSecurity');
    var windowBackends = d.windowBackends !== undefined
      ? d.windowBackends
      : safeRequire(baseRequire, './remote/windowBackends');

    var platform = d.platform || (typeof process !== 'undefined' ? process.platform : '');
    var env = d.env || (typeof process !== 'undefined' && process.env ? process.env : {});
    var setTimer = d.setTimeout || setTimeout;
    var clearTimer = d.clearTimeout || clearTimeout;
    var refocusDelayMs = typeof d.refocusDelayMs === 'number' ? d.refocusDelayMs : 140;
    var secondInstanceDelayMs = typeof d.secondInstanceDelayMs === 'number' ? d.secondInstanceDelayMs : 30;
    var expireTimeoutMs = typeof d.expireTimeoutMs === 'number' ? d.expireTimeoutMs : 30 * 60 * 1000;

    var app = electron && electron.app;
    var ipcMain = electron && electron.ipcMain;
    var NotificationCtor = electron && electron.Notification;
    var BaseWindowCtor = electron && electron.BaseWindow;
    var BrowserWindowCtor = electron && electron.BrowserWindow;

    var pendingTopResetByWin = new WeakMap();
    var activeNotifications = new Set();
    var aumid = null;

    if (platform === 'win32' && app && typeof app.setAppUserModelId === 'function') {
      aumid = resolveAumid(app);
      try {
        app.setAppUserModelId(aumid);
      } catch (_) {}
    }

    function resolveWindowForSender(sender) {
      if (!isAlive(sender)) return undefined;
      var win;
      if (utils && typeof utils.resolveHubWindowFromWebContents === 'function') {
        try {
          win = utils.resolveHubWindowFromWebContents(sender);
        } catch (_) {
          win = undefined;
        }
      }
      if (!isAlive(win) && BrowserWindowCtor && typeof BrowserWindowCtor.fromWebContents === 'function') {
        try {
          win = BrowserWindowCtor.fromWebContents(sender);
        } catch (_) {
          win = undefined;
        }
      }
      return isAlive(win) ? win : undefined;
    }

    function resolveHubContents(win) {
      if (!isAlive(win)) return undefined;
      var contents;
      if (utils && typeof utils.getHubWebContents === 'function') {
        try {
          contents = utils.getHubWebContents(win);
        } catch (_) {
          contents = undefined;
        }
      }
      if (!isAlive(contents)) {
        try {
          contents = win.webContents;
        } catch (_) {
          contents = undefined;
        }
      }
      return isAlive(contents) ? contents : undefined;
    }

    function listLocalHubWindows() {
      if (!utils || typeof utils.getLocalHubWindows !== 'function') return [];
      try {
        var list = utils.getLocalHubWindows();
        return Array.isArray(list) ? list.filter(isAlive) : [];
      } catch (_) {
        return [];
      }
    }

    function listFallbackWindows() {
      var out = [];
      var seen = new Set();
      var collect = function (arr) {
        if (!Array.isArray(arr)) return;
        for (var i = 0; i < arr.length; i++) {
          var w = arr[i];
          if (!seen.has(w) && isAlive(w)) {
            seen.add(w);
            out.push(w);
          }
        }
      };
      try {
        if (BaseWindowCtor && typeof BaseWindowCtor.getAllWindows === 'function') {
          collect(BaseWindowCtor.getAllWindows());
        }
      } catch (_) {}
      try {
        if (BrowserWindowCtor && typeof BrowserWindowCtor.getAllWindows === 'function') {
          collect(BrowserWindowCtor.getAllWindows());
        }
      } catch (_) {}
      return out;
    }

    function pickTargetWindow(remote, senderContents, senderWin) {
      var candidate = resolveWindowForSender(senderContents) || (isAlive(senderWin) ? senderWin : undefined);
      if (remote) {
        return isAlive(candidate) ? candidate : undefined;
      }

      var localWins = listLocalHubWindows();
      if (isAlive(candidate) && (localWins.length === 0 || localWins.indexOf(candidate) !== -1)) {
        return candidate;
      }

      if (utils && typeof utils.getLastFocusedLocalHubWindow === 'function') {
        try {
          var lastFocused = utils.getLastFocusedLocalHubWindow();
          if (isAlive(lastFocused) && (localWins.length === 0 || localWins.indexOf(lastFocused) !== -1)) {
            return lastFocused;
          }
        } catch (_) {}
      }

      if (localWins.length > 0 && isAlive(localWins[0])) {
        return localWins[0];
      }

      var fallback = listFallbackWindows();
      return fallback.length > 0 ? fallback[0] : undefined;
    }

    function focusWindow(win, targetContents) {
      bringWindowToFront(win, targetContents, {
        app: app,
        platform: platform,
        setTimeout: setTimer,
        clearTimeout: clearTimer,
        refocusDelayMs: refocusDelayMs,
        pendingTopResetByWin: pendingTopResetByWin,
      });
    }

    function handleNotificationSend(event, options) {
      if (typeof NotificationCtor !== 'function') return;
      var senderContents = event && event.sender;
      var senderWin = resolveWindowForSender(senderContents);

      var remote = false;
      if (remoteWindowSecurity && typeof remoteWindowSecurity.isRemoteContents === 'function') {
        try {
          remote = Boolean(remoteWindowSecurity.isRemoteContents(senderContents));
        } catch (_) {
          remote = false;
        }
      }

      var label = 'SSH';
      if (windowBackends && typeof windowBackends.remoteBackendOf === 'function') {
        try {
          var backend = windowBackends.remoteBackendOf(senderContents);
          if (backend && backend.label) label = String(backend.label);
        } catch (_) {}
      }

      var opts = options && typeof options === 'object' ? options : {};
      var remoteTitle = truncate(opts.title, MAX_NOTIFICATION_TITLE);
      var notification = new NotificationCtor({
        title: remote
          ? truncate(remoteTitle ? label + ': ' + remoteTitle : label, MAX_NOTIFICATION_TITLE)
          : opts.title,
        body: remote
          ? truncate(opts.body, MAX_NOTIFICATION_BODY)
          : opts.body,
        silent: opts.silent != null ? opts.silent : false,
      });

      activeNotifications.add(notification);
      var released = false;
      var expireTimer = setTimer(function () {
        release();
      }, expireTimeoutMs);
      if (expireTimer && typeof expireTimer.unref === 'function') {
        try {
          expireTimer.unref();
        } catch (_) {}
      }

      function release() {
        if (released) return;
        released = true;
        activeNotifications.delete(notification);
        if (expireTimer) {
          try {
            clearTimer(expireTimer);
          } catch (_) {}
          expireTimer = null;
        }
      }

      if (typeof notification.on === 'function') {
        notification.on('click', function () {
          release();
          var win = pickTargetWindow(remote, senderContents, senderWin);
          if (!isAlive(win)) return;
          var targetContents = resolveHubContents(win);
          focusWindow(win, targetContents);
          if (opts.payload && isAlive(targetContents) && typeof targetContents.send === 'function') {
            try {
              targetContents.send('notification:clicked', opts.payload);
            } catch (_) {}
          }
        });
        notification.on('close', release);
        notification.on('failed', release);
      }

      if (typeof notification.show === 'function') {
        notification.show();
      }
    }

    if (ipcMain && typeof ipcMain.handle === 'function' && !ipcMain.__AGY_WIN_NOTIFY_WRAPPED__) {
      var origHandle = ipcMain.handle;
      var wrappedHandle = function (channel, listener) {
        if (channel === 'notification:send') {
          return origHandle.call(ipcMain, channel, handleNotificationSend);
        }
        return origHandle.call(ipcMain, channel, listener);
      };
      try {
        Object.defineProperty(ipcMain, 'handle', {
          value: wrappedHandle,
          configurable: true,
          writable: true,
        });
      } catch (_) {
        ipcMain.handle = wrappedHandle;
      }
      try {
        Object.defineProperty(ipcMain, '__AGY_WIN_NOTIFY_WRAPPED__', {
          value: true,
          configurable: true,
        });
      } catch (_) {}
    }

    var isHeadless = String(env.ELECTRON_OZONE_PLATFORM_HINT || '') === 'headless';
    if (platform === 'win32' && !isHeadless && app && typeof app.on === 'function') {
      app.on('second-instance', function (_event, commandLine) {
        var args = Array.isArray(commandLine) ? commandLine : [];
        var hasSshHost = args.some(function (arg) {
          return (
            typeof arg === 'string' &&
            arg.indexOf('--ssh-host=') === 0 &&
            arg.slice('--ssh-host='.length).trim().length > 0
          );
        });
        if (hasSshHost) return;
        var timer = setTimer(function () {
          var win = pickTargetWindow(false, undefined, undefined);
          if (!isAlive(win)) return;
          var targetContents = resolveHubContents(win);
          focusWindow(win, targetContents);
        }, secondInstanceDelayMs);
        if (timer && typeof timer.unref === 'function') {
          try {
            timer.unref();
          } catch (_) {}
        }
      });
    }

    return {
      aumid: aumid,
      activeNotifications: activeNotifications,
      handleNotificationSend: handleNotificationSend,
      bringWindowToFront: focusWindow,
      pickTargetWindow: pickTargetWindow,
      resolveWindowForSender: resolveWindowForSender,
      resolveHubContents: resolveHubContents,
    };
  }

  if (typeof globalThis.__AGY_WIN_NOTIFY_TEST_HOOK__ === 'function') {
    globalThis.__AGY_WIN_NOTIFY_TEST_HOOK__({
      installWinNotifyFix: installWinNotifyFix,
      resolveAumid: resolveAumid,
      bringWindowToFront: bringWindowToFront,
      truncate: truncate,
    });
    return;
  }

  if (globalThis.__AGY_WIN_NOTIFY_MAIN_BOOTED__) return;
  Object.defineProperty(globalThis, '__AGY_WIN_NOTIFY_MAIN_BOOTED__', { value: true });

  installWinNotifyFix();
})();
