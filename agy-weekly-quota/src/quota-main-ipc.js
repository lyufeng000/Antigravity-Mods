// Antigravity 主进程（dist/main.js）周额度多账号配置文件桥接模块
// 仅负责本地 JSON 配置文件（accounts.json）的读写与文件变更监听，0 网络请求、不读取任何 OAuth 凭证。
(function () {
  'use strict';

  if (globalThis.__AGY_QUOTA_MAIN_BOOTED__) return;
  Object.defineProperty(globalThis, '__AGY_QUOTA_MAIN_BOOTED__', { value: true });

  var fs = require('fs');
  var path = require('path');
  var electron = null;
  try { electron = require('electron'); } catch (_) {}
  var ipcMain = electron && electron.ipcMain;
  var BrowserWindow = electron && electron.BrowserWindow;
  if (!ipcMain) return;

  var CONFIG_FILE = __AGY_QUOTA_CONFIG_FILE__;

  function emptyConfig() {
    return { accounts: {} };
  }

  function normalizeEntry(v) {
    if (!v || typeof v !== 'object') {
      return {
        remainingPercent: null,
        remainingFraction: null,
        resetAt: null,
        resetTimeMs: null,
        disabled: false,
        updatedAt: new Date().toISOString(),
      };
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
      var parsedMs = Date.parse(v.resetAt);
      if (Number.isFinite(parsedMs)) resetMs = parsedMs;
    }
    var updatedAt = typeof v.updatedAt === 'string' && v.updatedAt
      ? v.updatedAt
      : (typeof v.ts === 'number' && Number.isFinite(v.ts) ? new Date(v.ts).toISOString() : new Date().toISOString());

    return {
      remainingPercent: frac !== null ? Math.round(frac * 100) : null,
      remainingFraction: frac,
      resetAt: resetMs !== null ? new Date(resetMs).toISOString() : null,
      resetTimeMs: resetMs,
      disabled: Boolean(v.disabled),
      updatedAt: updatedAt,
    };
  }

  function readConfigSync() {
    try {
      if (!fs.existsSync(CONFIG_FILE)) return emptyConfig();
      var raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      if (!raw || !raw.trim()) return emptyConfig();
      var parsed = JSON.parse(raw);
      var src = parsed && typeof parsed === 'object' && parsed.accounts && typeof parsed.accounts === 'object' && !Array.isArray(parsed.accounts)
        ? parsed.accounts
        : {};
      var out = {};
      var keys = Object.keys(src);
      for (var i = 0; i < keys.length; i++) {
        var email = keys[i].trim();
        if (!email) continue;
        out[email] = normalizeEntry(src[keys[i]]);
      }
      return { accounts: out };
    } catch (_) {
      return emptyConfig();
    }
  }

  var lastSelfWriteMtime = 0;

  function writeConfigSync(cfg) {
    var text = JSON.stringify(cfg, null, 2) + '\n';
    var dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var tmp = CONFIG_FILE + '.' + process.pid + '.tmp';
    try {
      fs.writeFileSync(tmp, text, 'utf8');
      try {
        fs.renameSync(tmp, CONFIG_FILE);
      } catch (_) {
        fs.writeFileSync(CONFIG_FILE, text, 'utf8');
        try { fs.unlinkSync(tmp); } catch (_2) {}
      }
      try {
        lastSelfWriteMtime = fs.statSync(CONFIG_FILE).mtimeMs;
      } catch (_) {}
    } catch (_) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_3) {}
    }
  }

  function broadcastConfig(cfg) {
    try {
      var utils = null;
      try { utils = require('./utils'); } catch (_) {}
      if (utils && typeof utils.getHubWindows === 'function' && typeof utils.getHubWebContents === 'function') {
        var wins = utils.getHubWindows();
        for (var i = 0; i < wins.length; i++) {
          var wc = utils.getHubWebContents(wins[i]);
          if (wc && (!wc.isDestroyed || !wc.isDestroyed())) {
            wc.send('agy-quota:config-changed', cfg);
          }
        }
        return;
      }
      if (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function') {
        var all = BrowserWindow.getAllWindows();
        for (var j = 0; j < all.length; j++) {
          var w = all[j];
          if (w && w.webContents && (!w.webContents.isDestroyed || !w.webContents.isDestroyed())) {
            w.webContents.send('agy-quota:config-changed', cfg);
          }
        }
      }
    } catch (_) {}
  }

  if (typeof ipcMain.removeAllListeners === 'function') {
    ipcMain.removeAllListeners('agy-quota:get-config-sync');
  }
  ipcMain.on('agy-quota:get-config-sync', function (event) {
    event.returnValue = { configFile: CONFIG_FILE, data: readConfigSync() };
  });

  if (typeof ipcMain.removeHandler === 'function') {
    ipcMain.removeHandler('agy-quota:upsert-account');
  }
  ipcMain.handle('agy-quota:upsert-account', async function (_event, payload) {
    var cfg = readConfigSync();
    if (!payload || typeof payload !== 'object') return cfg;

    var changed = false;
    // 支持一次性导入迁移条目（仅在目标邮箱尚不存在时填入）
    if (payload.migrate && typeof payload.migrate === 'object') {
      var mKeys = Object.keys(payload.migrate);
      for (var i = 0; i < mKeys.length; i++) {
        var mEmail = mKeys[i].trim();
        if (mEmail && !cfg.accounts[mEmail]) {
          cfg.accounts[mEmail] = normalizeEntry(payload.migrate[mKeys[i]]);
          changed = true;
        }
      }
    }

    var email = typeof payload.email === 'string' ? payload.email.trim() : '';
    if (email) {
      var nextSummary = payload.summary && typeof payload.summary === 'object' ? payload.summary : null;
      if (nextSummary) {
        cfg.accounts[email] = normalizeEntry(nextSummary);
        changed = true;
      } else if (!cfg.accounts[email]) {
        cfg.accounts[email] = normalizeEntry(null);
        changed = true;
      }
    }

    if (changed) {
      writeConfigSync(cfg);
      broadcastConfig(cfg);
    }
    return cfg;
  });

  // 监听用户手动修改或清理 accounts.json，保存后立即刷新侧边栏显示
  try {
    fs.watchFile(CONFIG_FILE, { persistent: false, interval: 1500 }, function (curr, prev) {
      if (curr.mtimeMs === prev.mtimeMs) return;
      if (lastSelfWriteMtime && Math.abs(curr.mtimeMs - lastSelfWriteMtime) < 50) return;
      broadcastConfig(readConfigSync());
    });
  } catch (_) {}
})();
