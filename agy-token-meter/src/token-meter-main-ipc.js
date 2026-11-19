// Antigravity 主进程（dist/main.js）实时 Tokens 统计与增量监听模块
// 被动只读监听 ~/.gemini/antigravity/brain/**/.system_generated/logs/transcript.jsonl，零网络请求。
(function () {
  'use strict';

  if (globalThis.__AGY_TOKEN_METER_MAIN_BOOTED__) return;
  Object.defineProperty(globalThis, '__AGY_TOKEN_METER_MAIN_BOOTED__', { value: true });

  var baseRequire = typeof require === 'function'
    ? require
    : (typeof process !== 'undefined' && process && typeof process.getBuiltinModule === 'function'
      ? function (id) { return process.getBuiltinModule(id); }
      : null);
  if (!baseRequire) return;

  var fs = baseRequire('fs');
  var path = baseRequire('path');
  var os = baseRequire('os');
  var BufferCtor = typeof Buffer === 'function' ? Buffer : baseRequire('buffer').Buffer;

  var electron = null;
  try {
    var rawElectron = baseRequire('electron');
    if (rawElectron && typeof rawElectron === 'object') {
      electron = rawElectron;
    }
  } catch (_) {}

  var CH_GET_SYNC = 'agy-token-meter:get-stats-sync';
  var CH_GET_ASYNC = 'agy-token-meter:get-stats';
  var CH_UPDATED = 'agy-token-meter:stats-updated';

  function defaultBrainDir() {
    var home = os.homedir ? os.homedir() : (process.env.USERPROFILE || process.env.HOME || '');
    return path.join(home, '.gemini', 'antigravity', 'brain');
  }

  function formatDayKey(ms) {
    var d = new Date(ms);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function getTodayStartMs(nowMs) {
    var d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function getWeekStartMs(nowMs) {
    var d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    var offset = (d.getDay() + 6) % 7; // 周一为每周第一天
    d.setDate(d.getDate() - offset);
    return d.getTime();
  }

  function createEmptyBucket() {
    return {
      input: 0,
      cacheRead: 0,
      output: 0,
      total: 0,
      steps: 0,
      conversations: 0,
    };
  }

  function toNonNegInt(v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
    return Math.round(v);
  }

  function parseTranscriptLine(line, fallbackTsMs) {
    if (!line || !line.trim()) return null;
    var obj;
    try {
      obj = JSON.parse(line);
    } catch (_) {
      return null;
    }
    if (!obj || typeof obj !== 'object') return null;

    var parsedTs = typeof obj.created_at === 'string' ? Date.parse(obj.created_at) : NaN;
    var tsMs = Number.isFinite(parsedTs) ? parsedTs : fallbackTsMs;
    var isUserTurn = obj.type === 'USER_INPUT';
    var hasTokens = ('input_tokens' in obj) || ('cache_read_tokens' in obj) || ('output_tokens' in obj);
    if (!hasTokens && !isUserTurn) return null;

    var input = toNonNegInt(obj.input_tokens);
    var cacheRead = toNonNegInt(obj.cache_read_tokens);
    var output = toNonNegInt(obj.output_tokens);

    return {
      tsMs: tsMs,
      isUserTurn: isUserTurn,
      hasTokens: hasTokens,
      input: input,
      cacheRead: cacheRead,
      output: output,
      total: input + cacheRead + output,
    };
  }

  function createTokenTracker(opts) {
    var options = opts && typeof opts === 'object' ? opts : {};
    var brainDir = options.brainDir || defaultBrainDir();
    var nowFn = typeof options.nowFn === 'function' ? options.nowFn : function () { return Date.now(); };
    var cache = new Map(); // conversationId -> { filePath, size, mtimeMs, offset, remainder, entries }

    function resetEntry(filePath) {
      return {
        filePath: filePath,
        size: 0,
        mtimeMs: 0,
        offset: 0,
        remainder: '',
        entries: [],
      };
    }

    function syncSingleFile(convId, filePath) {
      var st;
      try {
        st = fs.statSync(filePath);
      } catch (_) {
        if (cache.has(convId)) {
          cache.delete(convId);
          return true;
        }
        return false;
      }

      if (!st || !st.isFile()) return false;
      var entry = cache.get(convId);
      if (entry && entry.size === st.size && entry.mtimeMs === st.mtimeMs) {
        return false;
      }

      if (!entry || st.size < entry.offset) {
        entry = resetEntry(filePath);
        cache.set(convId, entry);
      }

      var bytesToRead = st.size - entry.offset;
      if (bytesToRead > 0) {
        var fd = null;
        try {
          fd = fs.openSync(filePath, 'r');
          var buf = BufferCtor.allocUnsafe(bytesToRead);
          var totalRead = 0;
          while (totalRead < bytesToRead) {
            var n = fs.readSync(fd, buf, totalRead, bytesToRead - totalRead, entry.offset + totalRead);
            if (n <= 0) break;
            totalRead += n;
          }
          entry.offset += totalRead;
          var chunk = entry.remainder + buf.subarray(0, totalRead).toString('utf8');
          var lines = chunk.split(/\r?\n/);
          entry.remainder = lines.pop() || '';
          for (var i = 0; i < lines.length; i++) {
            var parsed = parseTranscriptLine(lines[i], st.mtimeMs);
            if (parsed) entry.entries.push(parsed);
          }
        } catch (_) {
          // 读取冲突或瞬时锁定时保留现有状态等待下次刷新
          return false;
        } finally {
          if (fd !== null) {
            try { fs.closeSync(fd); } catch (_2) {}
          }
        }
      }

      entry.size = st.size;
      entry.mtimeMs = st.mtimeMs;
      return true;
    }

    function scanAll() {
      var changed = false;
      var seen = new Set();
      var dirents;
      try {
        if (!fs.existsSync(brainDir)) {
          if (cache.size > 0) {
            cache.clear();
            return true;
          }
          return false;
        }
        dirents = fs.readdirSync(brainDir, { withFileTypes: true });
      } catch (_) {
        return false;
      }

      for (var i = 0; i < dirents.length; i++) {
        var d = dirents[i];
        if (!d || !d.isDirectory()) continue;
        var convId = d.name;
        var tf = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
        seen.add(convId);
        if (syncSingleFile(convId, tf)) changed = true;
      }

      cache.forEach(function (_val, key) {
        if (!seen.has(key)) {
          cache.delete(key);
          changed = true;
        }
      });

      return changed;
    }

    function scanConversation(convId) {
      if (!convId || typeof convId !== 'string') return scanAll();
      var tf = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
      return syncSingleFile(convId, tf);
    }

    function getSnapshot(targetConvId) {
      var nowMs = nowFn();
      var todayStartMs = getTodayStartMs(nowMs);
      var weekStartMs = getWeekStartMs(nowMs);
      var today = createEmptyBucket();
      var week = createEmptyBucket();
      var sessions = {};

      cache.forEach(function (entry, convId) {
        var sInput = 0;
        var sCacheRead = 0;
        var sOutput = 0;
        var sTotal = 0;
        var sSteps = 0;
        var sTurns = 0;
        var lastContext = 0;
        var lastStepAtMs = 0;
        var hasToday = false;
        var hasWeek = false;
        var todayInput = 0;
        var todayCacheRead = 0;
        var todayOutput = 0;
        var todayTotal = 0;

        for (var i = 0; i < entry.entries.length; i++) {
          var item = entry.entries[i];
          if (item.isUserTurn) {
            sTurns += 1;
            continue;
          }
          if (!item.hasTokens) continue;
          sInput += item.input;
          sCacheRead += item.cacheRead;
          sOutput += item.output;
          sTotal += item.total;
          sSteps += 1;
          lastContext = item.total;
          if (item.tsMs > lastStepAtMs) lastStepAtMs = item.tsMs;

          if (item.tsMs >= weekStartMs) {
            hasWeek = true;
            week.input += item.input;
            week.cacheRead += item.cacheRead;
            week.output += item.output;
            week.total += item.total;
            week.steps += 1;
          }
          if (item.tsMs >= todayStartMs) {
            hasToday = true;
            today.input += item.input;
            today.cacheRead += item.cacheRead;
            today.output += item.output;
            today.total += item.total;
            today.steps += 1;
            todayInput += item.input;
            todayCacheRead += item.cacheRead;
            todayOutput += item.output;
            todayTotal += item.total;
          }
        }

        if (hasToday) today.conversations += 1;
        if (hasWeek) week.conversations += 1;

        sessions[convId] = {
          input: sInput,
          cacheRead: sCacheRead,
          output: sOutput,
          total: sTotal,
          steps: sSteps,
          turns: sTurns,
          lastContext: lastContext,
          lastStepAtMs: lastStepAtMs,
          todayInput: todayInput,
          todayCacheRead: todayCacheRead,
          todayOutput: todayOutput,
          todayTotal: todayTotal,
        };
      });

      var activeId = typeof targetConvId === 'string' ? targetConvId.trim() : '';
      return {
        updatedAtMs: nowMs,
        dayKey: formatDayKey(nowMs),
        brainDir: brainDir,
        today: today,
        week: week,
        session: activeId && Object.prototype.hasOwnProperty.call(sessions, activeId) ? sessions[activeId] : null,
        sessions: sessions,
      };
    }

    return {
      brainDir: brainDir,
      scanAll: scanAll,
      scanConversation: scanConversation,
      getSnapshot: getSnapshot,
    };
  }

  function extractConvIdFromWatchPath(relPath) {
    if (typeof relPath !== 'string' || !relPath) return '';
    var normalized = relPath.replace(/\\/g, '/');
    var first = normalized.split('/')[0];
    if (!first || first === '.' || first === '..') return '';
    if (normalized.indexOf('transcript.jsonl') === -1 && normalized.indexOf('.system_generated') === -1) return '';
    return first;
  }

  var api = {
    CH_GET_SYNC: CH_GET_SYNC,
    CH_GET_ASYNC: CH_GET_ASYNC,
    CH_UPDATED: CH_UPDATED,
    defaultBrainDir: defaultBrainDir,
    parseTranscriptLine: parseTranscriptLine,
    createTokenTracker: createTokenTracker,
    extractConvIdFromWatchPath: extractConvIdFromWatchPath,
  };

  Object.defineProperty(globalThis, '__AGY_TOKEN_METER_MAIN_API__', {
    value: api,
    configurable: true,
  });

  var ipcMain = electron && electron.ipcMain;
  var BrowserWindow = electron && electron.BrowserWindow;
  if (!ipcMain) {
    if (
      typeof module === 'object' &&
      module &&
      module.exports &&
      typeof module.exports === 'object' &&
      Object.keys(module.exports).length === 0
    ) {
      module.exports = api;
    }
    return;
  }

  var tracker = createTokenTracker();
  tracker.scanAll();
  var lastDayKey = formatDayKey(Date.now());

  function broadcastSnapshot(snapshot) {
    try {
      var utils = null;
      try { utils = require('./utils'); } catch (_) {}
      if (utils && typeof utils.getHubWindows === 'function' && typeof utils.getHubWebContents === 'function') {
        var wins = utils.getHubWindows();
        for (var i = 0; i < wins.length; i++) {
          var wc = utils.getHubWebContents(wins[i]);
          if (wc && (!wc.isDestroyed || !wc.isDestroyed())) {
            wc.send(CH_UPDATED, snapshot);
          }
        }
        return;
      }
      if (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function') {
        var all = BrowserWindow.getAllWindows();
        for (var j = 0; j < all.length; j++) {
          var w = all[j];
          if (w && w.webContents && (!w.webContents.isDestroyed || !w.webContents.isDestroyed())) {
            w.webContents.send(CH_UPDATED, snapshot);
          }
        }
      }
    } catch (_) {}
  }

  if (typeof ipcMain.removeAllListeners === 'function') {
    ipcMain.removeAllListeners(CH_GET_SYNC);
  }
  ipcMain.on(CH_GET_SYNC, function (event, payload) {
    var convId = payload && typeof payload.cascadeId === 'string' ? payload.cascadeId : '';
    tracker.scanAll();
    var snap = tracker.getSnapshot(convId);
    lastDayKey = snap.dayKey;
    event.returnValue = snap;
  });

  if (typeof ipcMain.removeHandler === 'function') {
    ipcMain.removeHandler(CH_GET_ASYNC);
  }
  ipcMain.handle(CH_GET_ASYNC, async function (_event, payload) {
    var convId = payload && typeof payload.cascadeId === 'string' ? payload.cascadeId : '';
    tracker.scanAll();
    var snap = tracker.getSnapshot(convId);
    lastDayKey = snap.dayKey;
    return snap;
  });

  var pendingConvs = new Set();
  var needFullScan = false;
  var flushTimer = null;

  function flushWatchQueue() {
    flushTimer = null;
    var changed = false;
    if (needFullScan) {
      needFullScan = false;
      pendingConvs.clear();
      changed = tracker.scanAll();
    } else if (pendingConvs.size > 0) {
      pendingConvs.forEach(function (cid) {
        if (tracker.scanConversation(cid)) changed = true;
      });
      pendingConvs.clear();
    }
    var curDayKey = formatDayKey(Date.now());
    if (curDayKey !== lastDayKey) {
      lastDayKey = curDayKey;
      changed = true;
    }
    if (changed) {
      broadcastSnapshot(tracker.getSnapshot(''));
    }
  }

  function scheduleFlush(convId) {
    if (convId) pendingConvs.add(convId);
    else needFullScan = true;
    if (flushTimer !== null) return;
    flushTimer = setTimeout(flushWatchQueue, 120);
    if (flushTimer && typeof flushTimer.unref === 'function') flushTimer.unref();
  }

  var watcher = null;
  function ensureWatcher() {
    if (watcher) return;
    try {
      if (!fs.existsSync(tracker.brainDir)) return;
      watcher = fs.watch(tracker.brainDir, { recursive: true, persistent: false }, function (_eventType, filename) {
        if (typeof filename === 'string' && filename.indexOf('transcript.jsonl') !== -1) {
          scheduleFlush(extractConvIdFromWatchPath(filename));
        }
      });
      if (watcher && typeof watcher.on === 'function') {
        watcher.on('error', function () {
          try { watcher.close(); } catch (_) {}
          watcher = null;
        });
      }
    } catch (_) {
      watcher = null;
    }
  }

  ensureWatcher();
  var pollTimer = setInterval(function () {
    ensureWatcher();
    var changed = tracker.scanAll();
    var curDayKey = formatDayKey(Date.now());
    if (curDayKey !== lastDayKey) {
      lastDayKey = curDayKey;
      changed = true;
    }
    if (changed) broadcastSnapshot(tracker.getSnapshot(''));
  }, 4000);
  if (pollTimer && typeof pollTimer.unref === 'function') pollTimer.unref();
})();
