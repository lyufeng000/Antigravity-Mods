// Antigravity 输入框下方实时 Tokens 速度与用量状态栏模块（运行在 dist/preload.js 沙箱）
// 双引擎融合：Main World 旁路 Language Server 实时流（输出速度 tok/s、上下文 %、费用）+ 主进程 transcript.jsonl（今日/本周全量）。
(function () {
  'use strict';

  var g = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
  if (!g || !g.document || g.__AGY_TOKEN_METER_BOOTED__) return;
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

  Object.defineProperty(g, '__AGY_TOKEN_METER_BOOTED__', { value: true });

  var CH_GET_SYNC = 'agy-token-meter:get-stats-sync';
  var CH_GET_ASYNC = 'agy-token-meter:get-stats';
  var CH_UPDATED = 'agy-token-meter:stats-updated';

  var LIVE_BRIDGE_KEY = '__agy_token_meter_live_v1__';
  var CASCADE_ATTR = 'data-agy-cascade-id';
  var CASCADE_EVENT = 'agy-token-meter:cascade-changed';
  var BAR_ATTR = 'data-agy-token-meter';
  var STYLE_ID = 'agy-token-meter-style';
  var POPOVER_ID = 'agy-token-meter-popover';
  var MODE_STORAGE_KEY = 'agy_token_meter_bar_mode_v2';

  var MODES = ['full', 'compact'];

  // 注入到 Main World 的双路只读探针（不引用任何外层闭包变量）
  function installMainWorldTelemetry(liveKey, cascadeAttr, cascadeEventName) {
    var w = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
    if (!w || w.__AGY_TOKEN_METER_MAIN_PROBE__) return;
    Object.defineProperty(w, '__AGY_TOKEN_METER_MAIN_PROBE__', { value: true });

    var liveByConv = {}; // cascadeId -> state
    var publishTimer = null;

    function toNum(v) {
      if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
      if (typeof v === 'bigint') return Number(v);
      if (typeof v === 'string' && v.trim()) {
        var n = Number(v);
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    }

    function durationToMs(dur) {
      if (!dur || typeof dur !== 'object') return 0;
      var sec = toNum(dur.seconds);
      var nanos = toNum(dur.nanos);
      var ms = sec * 1000 + nanos / 1e6;
      return Number.isFinite(ms) && ms > 0 ? ms : 0;
    }

    function estimateTokens(text) {
      if (typeof text !== 'string' || !text) return 0;
      var cjk = 0;
      var ascii = 0;
      for (var i = 0; i < text.length; i++) {
        var code = text.charCodeAt(i);
        if (code >= 0x4e00 && code <= 0x9fff) cjk++;
        else ascii++;
      }
      return Math.round(cjk / 1.45 + ascii / 3.8);
    }

    function ensureConv(cid) {
      if (!liveByConv[cid]) {
        liveByConv[cid] = {
          turns: 0,
          steps: 0,
          input: 0,
          cacheRead: 0,
          output: 0,
          thinking: 0,
          response: 0,
          costUsd: 0,
          subagentCostUsd: 0,
          contextUsed: 0,
          contextMax: 0,
          tokPerSec: 0,
          isStreaming: false,
          ttftMs: 0,
          lastGenMs: 0,
          lastGenOutput: 0,
          _stepStreams: {}, // stepIdx -> { startMs, lastEst, lastSpeed }
          _turnMap: {},     // stepIdx -> 1
        };
      }
      return liveByConv[cid];
    }

    function buildSerializableState() {
      var out = {};
      var keys = Object.keys(liveByConv);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var s = liveByConv[k];
        out[k] = {
          turns: s.turns,
          steps: s.steps,
          input: s.input,
          cacheRead: s.cacheRead,
          output: s.output,
          thinking: s.thinking,
          response: s.response,
          costUsd: s.costUsd,
          subagentCostUsd: s.subagentCostUsd,
          contextUsed: s.contextUsed,
          contextMax: s.contextMax,
          tokPerSec: s.tokPerSec,
          isStreaming: s.isStreaming,
          ttftMs: s.ttftMs,
          lastGenMs: s.lastGenMs,
          lastGenOutput: s.lastGenOutput,
        };
      }
      return out;
    }

    function flushPublish() {
      publishTimer = null;
      try {
        var payload = JSON.stringify({ ts: Date.now(), conversations: buildSerializableState() });
        if (w.sessionStorage) w.sessionStorage.setItem(liveKey, payload);
        w.dispatchEvent(new w.Event(liveKey));
      } catch (_) {}
    }

    function schedulePublish(immediate) {
      if (immediate) {
        if (publishTimer !== null) {
          w.clearTimeout(publishTimer);
          publishTimer = null;
        }
        flushPublish();
        return;
      }
      if (publishTimer !== null) return;
      publishTimer = w.setTimeout(flushPublish, 90);
    }

    function extractStepContentChars(stepObj) {
      if (!stepObj || typeof stepObj !== 'object') return '';
      var sc = stepObj.step;
      if (!sc || sc.case !== 'plannerResponse' || !sc.value) return '';
      var v = sc.value;
      var text = '';
      if (typeof v.thinking === 'string') text += v.thinking;
      if (typeof v.rawThinking === 'string') text += v.rawThinking;
      if (typeof v.response === 'string') text += v.response;
      if (Array.isArray(v.toolCalls) && v.toolCalls.length > 0) {
        for (var i = 0; i < v.toolCalls.length; i++) {
          var tc = v.toolCalls[i];
          if (tc && typeof tc.argumentsJson === 'string') text += tc.argumentsJson;
          if (tc && typeof tc.name === 'string') text += tc.name;
        }
      }
      return text;
    }

    function ingestGeneratorMeta(st, gm, nowMs) {
      if (!gm || typeof gm !== 'object' || !gm.chatModel) return false;
      var cm = gm.chatModel;
      var usage = cm.usage;
      if (!usage || typeof usage !== 'object') return false;

      var outTok = toNum(usage.outputTokens);
      var durMs = durationToMs(cm.streamingDuration);
      var ttftMs = durationToMs(cm.timeToFirstToken);

      if (durMs <= 0 && Array.isArray(gm.stepIndices) && gm.stepIndices.length > 0) {
        var firstIdx = gm.stepIndices[0];
        var tracker = st._stepStreams[firstIdx];
        if (tracker && tracker.startMs > 0) {
          durMs = Math.max(120, nowMs - tracker.startMs);
        }
      }

      if (outTok > 0 && durMs >= 50) {
        st.tokPerSec = Math.round((outTok / (durMs / 1000)) * 10) / 10;
        st.lastGenMs = Math.round(durMs);
        st.lastGenOutput = outTok;
        if (ttftMs > 0) st.ttftMs = Math.round(ttftMs);
        st.isStreaming = false;
        return true;
      }
      return false;
    }

    function isoDiffMs(startIso, endIso) {
      if (typeof startIso !== 'string' || typeof endIso !== 'string' || !startIso || !endIso) return 0;
      var a = Date.parse(startIso);
      var b = Date.parse(endIso);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
      return b - a;
    }

    function ingestSteps(st, steps, indices, nowMs) {
      if (!Array.isArray(steps) || steps.length === 0) return false;
      var changed = false;
      var hasActiveStream = false;

      for (var i = 0; i < steps.length; i++) {
        var stepObj = steps[i];
        if (!stepObj || typeof stepObj !== 'object') continue;
        var idx = Array.isArray(indices) && typeof indices[i] === 'number' ? indices[i] : i;
        if (stepObj.step && stepObj.step.case === 'userInput') {
          if (!st._turnMap[idx]) {
            st._turnMap[idx] = 1;
            st.turns += 1;
            changed = true;
          }
        }
        if (stepObj.step && stepObj.step.case === 'plannerResponse') {
          var statusVal = stepObj.status;
          var isCompleted = Boolean(stepObj.metadata && stepObj.metadata.completedAt) || statusVal === 3 || statusVal === 'CORTEX_STEP_STATUS_DONE';
          var text = extractStepContentChars(stepObj);
          var est = estimateTokens(text);
          var tr = st._stepStreams[idx];
          if (!tr && text.length > 0 && !isCompleted) {
            tr = { startMs: nowMs, baseEst: est, lastEst: est, lastAtMs: nowMs };
            st._stepStreams[idx] = tr;
            hasActiveStream = true;
          } else if (tr) {
            if (est > tr.lastEst) {
              tr.lastEst = est;
              tr.lastAtMs = nowMs;
            }
            if (!isCompleted) {
              hasActiveStream = true;
              var elapsedMs = nowMs - tr.startMs;
              var deltaEst = Math.max(0, tr.lastEst - tr.baseEst);
              if (elapsedMs >= 250 && (deltaEst >= 3 || tr.lastEst >= 5)) {
                var tokUsed = deltaEst >= 3 ? deltaEst : tr.lastEst;
                st.tokPerSec = Math.round((tokUsed / (elapsedMs / 1000)) * 10) / 10;
                st.isStreaming = true;
                changed = true;
              }
            } else if (!tr.finalized && tr.lastEst > 0) {
              tr.finalized = true;
              var finMs = Math.max(150, (tr.lastAtMs || nowMs) - tr.startMs);
              var finTok = Math.max(tr.lastEst - tr.baseEst, tr.lastEst);
              if (st.tokPerSec <= 0 && finTok > 0) {
                st.tokPerSec = Math.round((finTok / (finMs / 1000)) * 10) / 10;
                st.lastGenMs = Math.round(finMs);
                st.lastGenOutput = finTok;
                changed = true;
              }
            }
          } else if (isCompleted && st.tokPerSec <= 0 && est >= 8 && stepObj.metadata) {
            // 历史步骤兜底：若未下发 streamingDuration，利用 step metadata 起止时间估算
            var stepMs = isoDiffMs(stepObj.metadata.createdAt, stepObj.metadata.completedAt);
            if (stepMs >= 200 && stepMs <= 120000) {
              st.tokPerSec = Math.round((est / (stepMs / 1000)) * 10) / 10;
              st.lastGenMs = Math.round(stepMs);
              st.lastGenOutput = est;
              changed = true;
            }
          }
        }
      }

      if (!hasActiveStream && st.isStreaming) {
        st.isStreaming = false;
        changed = true;
      }
      return changed;
    }

    function ingestAgentStateUpdate(convId, update) {
      if (!convId || !update || typeof update !== 'object') return;
      var st = ensureConv(convId);
      var nowMs = Date.now();
      var changed = false;

      if (update.costSummary && update.costSummary.total) {
        var ct = update.costSummary.total.cumulativeTotal;
        if (ct && typeof ct === 'object') {
          var nextIn = ct.input ? toNum(ct.input.tokens) : st.input;
          var nextCache = ct.cacheRead ? toNum(ct.cacheRead.tokens) : st.cacheRead;
          var nextOut = ct.output ? toNum(ct.output.tokens) : st.output;
          var nextThink = ct.thinking ? toNum(ct.thinking.tokens) : st.thinking;
          var nextResp = ct.response ? toNum(ct.response.tokens) : st.response;
          var nextUsd = typeof ct.estimatedCostUsd === 'number' ? ct.estimatedCostUsd : st.costUsd;
          if (
            nextIn !== st.input || nextCache !== st.cacheRead || nextOut !== st.output ||
            nextThink !== st.thinking || nextResp !== st.response || nextUsd !== st.costUsd
          ) {
            st.input = nextIn;
            st.cacheRead = nextCache;
            st.output = nextOut;
            st.thinking = nextThink;
            st.response = nextResp;
            st.costUsd = nextUsd;
            changed = true;
          }
        }
        var sub = update.costSummary.total.subagent;
        if (sub && typeof sub.estimatedCostUsd === 'number' && sub.estimatedCostUsd !== st.subagentCostUsd) {
          st.subagentCostUsd = sub.estimatedCostUsd;
          changed = true;
        }
      }

      if (update.contextWindowUsage && typeof update.contextWindowUsage === 'object') {
        var used = toNum(update.contextWindowUsage.estimatedTokensUsed);
        var maxTok = toNum(update.contextWindowUsage.maxContextTokens);
        if (used !== st.contextUsed || maxTok !== st.contextMax) {
          st.contextUsed = used;
          st.contextMax = maxTok;
          changed = true;
        }
      }

      var mtu = update.mainTrajectoryUpdate;
      if (mtu && typeof mtu === 'object') {
        if (mtu.stepsUpdate) {
          var su = mtu.stepsUpdate;
          if (typeof su.totalLength === 'number' && su.totalLength !== st.steps) {
            st.steps = su.totalLength;
            changed = true;
          }
          if (ingestSteps(st, su.steps, su.indices, nowMs)) changed = true;
        }
        if (mtu.generatorMetadatasUpdate && Array.isArray(mtu.generatorMetadatasUpdate.generatorMetadatas)) {
          var gms = mtu.generatorMetadatasUpdate.generatorMetadatas;
          for (var gIdx = 0; gIdx < gms.length; gIdx++) {
            if (ingestGeneratorMeta(st, gms[gIdx], nowMs)) changed = true;
          }
        }
      }

      // CascadeRunStatus: RUNNING = 2
      var loopStatus = update.executorLoopStatus !== undefined ? update.executorLoopStatus : update.status;
      if (loopStatus === 1 || loopStatus === 'CASCADE_RUN_STATUS_IDLE') {
        if (st.isStreaming) {
          st.isStreaming = false;
          changed = true;
        }
      }

      if (changed) schedulePublish(false);
    }

    function ingestFullTrajectory(convId, traj) {
      if (!convId || !traj || typeof traj !== 'object') return;
      var st = ensureConv(convId);
      var changed = false;
      if (Array.isArray(traj.steps)) {
        if (traj.steps.length !== st.steps) {
          st.steps = traj.steps.length;
          changed = true;
        }
        var turnsCount = 0;
        for (var i = 0; i < traj.steps.length; i++) {
          var s = traj.steps[i];
          if (s && s.step && s.step.case === 'userInput') {
            st._turnMap[i] = 1;
            turnsCount++;
          }
        }
        if (turnsCount !== st.turns) {
          st.turns = turnsCount;
          changed = true;
        }
      }
      if (Array.isArray(traj.generatorMetadata)) {
        for (var j = 0; j < traj.generatorMetadata.length; j++) {
          if (ingestGeneratorMeta(st, traj.generatorMetadata[j], Date.now())) changed = true;
        }
      }
      if (changed) schedulePublish(true);
    }

    function wrapAsyncStream(convId, iterable) {
      if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') return iterable;
      var origIter = iterable[Symbol.asyncIterator]();
      var wrapped = {};
      wrapped[Symbol.asyncIterator] = function () { return wrapped; };
      wrapped.next = function (arg) {
        return Promise.resolve(origIter.next(arg)).then(function (res) {
          try {
            if (res && !res.done && res.value) {
              var payload = (res.value && res.value.update && typeof res.value.update === 'object')
                ? res.value.update
                : res.value;
              ingestAgentStateUpdate(convId, payload);
            } else if (res && res.done && convId && liveByConv[convId] && liveByConv[convId].isStreaming) {
              liveByConv[convId].isStreaming = false;
              schedulePublish(true);
            }
          } catch (_) {}
          return res;
        });
      };
      if (typeof origIter.return === 'function') {
        wrapped.return = function (val) {
          try {
            if (convId && liveByConv[convId] && liveByConv[convId].isStreaming) {
              liveByConv[convId].isStreaming = false;
              schedulePublish(true);
            }
          } catch (_) {}
          return origIter.return(val);
        };
      }
      if (typeof origIter.throw === 'function') {
        wrapped.throw = function (err) {
          return origIter.throw(err);
        };
      }
      return wrapped;
    }

    function wrapLsClient(client) {
      if (!client || typeof client !== 'object' || client.__agyTokenMeterWrapped) return client;
      return new Proxy(client, {
        get: function (target, prop) {
          if (prop === '__agyTokenMeterWrapped') return true;
          var orig = Reflect.get(target, prop, target);
          if (typeof orig !== 'function') return orig;

          if (prop === 'streamAgentStateUpdates') {
            return function (req) {
              var cid = req && typeof req.conversationId === 'string' ? req.conversationId : '';
              var stream = Reflect.apply(orig, target, arguments);
              return wrapAsyncStream(cid, stream);
            };
          }

          if (prop === 'getCascadeTrajectory') {
            return function (req) {
              var cid = req && typeof req.cascadeId === 'string' ? req.cascadeId : '';
              var p = Reflect.apply(orig, target, arguments);
              Promise.resolve(p).then(function (res) {
                try {
                  if (res && res.trajectory) ingestFullTrajectory(cid, res.trajectory);
                } catch (_) {}
              }, function () {});
              return p;
            };
          }

          return orig;
        },
      });
    }

    var prevDecorator = w.__JETSKI_LS_CLIENT_DECORATOR__;
    Object.defineProperty(w, '__JETSKI_LS_CLIENT_DECORATOR__', {
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

    // React Fiber 探针：为每个 [data-testid="agent-input-box"] 标出所属 cascadeId
    function getFiber(el) {
      if (!el || (typeof el !== 'object' && typeof el !== 'function')) return null;
      var keys;
      try { keys = Object.keys(el); } catch (_) { keys = []; }
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) {
          return el[keys[i]] || null;
        }
      }
      var names;
      try { names = Object.getOwnPropertyNames(el); } catch (_) { names = []; }
      for (var j = 0; j < names.length; j++) {
        if (names[j].indexOf('__reactFiber$') === 0 || names[j].indexOf('__reactInternalInstance$') === 0) {
          return el[names[j]] || null;
        }
      }
      return null;
    }

    function readCascadeIdFromInputBox(box) {
      var f = getFiber(box);
      var step = 0;
      while (f && step < 22) {
        var p = f.memoizedProps || f.pendingProps;
        if (p && typeof p === 'object') {
          var raw = typeof p.cascadeId === 'string' && p.cascadeId.trim()
            ? p.cascadeId.trim()
            : (typeof p.conversationId === 'string' && p.conversationId.trim() ? p.conversationId.trim() : '');
          if (raw) return raw;
        }
        f = f['return'];
        step++;
      }
      return '';
    }

    function scanInputBoxes() {
      var doc = w.document;
      if (!doc || !doc.querySelectorAll) return;
      var boxes = doc.querySelectorAll('[data-testid="agent-input-box"]');
      var changed = false;
      for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        var cid = readCascadeIdFromInputBox(box);
        var prev = box.getAttribute(cascadeAttr) || '';
        if (cid !== prev) {
          if (cid) box.setAttribute(cascadeAttr, cid);
          else box.removeAttribute(cascadeAttr);
          changed = true;
        }
      }
      if (changed) {
        try { w.dispatchEvent(new w.CustomEvent(cascadeEventName)); } catch (_) {}
      }
    }

    var scanQueued = false;
    function scheduleScan() {
      if (scanQueued) return;
      scanQueued = true;
      var run = function () {
        scanQueued = false;
        scanInputBoxes();
      };
      if (typeof w.requestAnimationFrame === 'function') w.requestAnimationFrame(run);
      else w.setTimeout(run, 50);
    }

    scanInputBoxes();
    if (w.document && w.document.documentElement && typeof w.MutationObserver === 'function') {
      var obs = new w.MutationObserver(scheduleScan);
      obs.observe(w.document.documentElement, { childList: true, subtree: true });
    }
    var scanTimer = w.setInterval(scanInputBoxes, 1500);
    if (scanTimer && typeof scanTimer.unref === 'function') scanTimer.unref();
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

  (function injectMainWorld() {
    var injected = false;
    try {
      if (webFrame && typeof webFrame.executeJavaScript === 'function') {
        var script = '(' + installMainWorldTelemetry.toString() + ')('
          + JSON.stringify(LIVE_BRIDGE_KEY) + ','
          + JSON.stringify(CASCADE_ATTR) + ','
          + JSON.stringify(CASCADE_EVENT) + ');';
        Promise.resolve(webFrame.executeJavaScript(script)).catch(function () {});
        injected = true;
      }
    } catch (_) {}
    if (!injected) {
      installMainWorldTelemetry(LIVE_BRIDGE_KEY, CASCADE_ATTR, CASCADE_EVENT);
    }
  })();

  function formatExact(n) {
    var num = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    try {
      return num.toLocaleString('en-US');
    } catch (_) {
      return String(num);
    }
  }

  function formatCompact(n) {
    var num = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    if (num < 1000) return String(num);
    if (num < 1000000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    if (num < 1000000000) return (num / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    return (num / 1000000000).toFixed(2).replace(/\.?0+$/, '') + 'B';
  }

  function formatSpeed(v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return '-- tok/s';
    if (v >= 100) return Math.round(v) + ' tok/s';
    return v.toFixed(1).replace(/\.0$/, '') + ' tok/s';
  }

  function formatCost(usd) {
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return '';
    if (usd >= 1) return '$' + usd.toFixed(2);
    if (usd >= 0.01) return '$' + usd.toFixed(3);
    return '$' + usd.toFixed(4);
  }

  function readSavedMode() {
    try {
      var v = g.localStorage && g.localStorage.getItem(MODE_STORAGE_KEY);
      if (v && MODES.indexOf(v) !== -1) return v;
    } catch (_) {}
    return MODES[0];
  }

  function writeSavedMode(mode) {
    try {
      if (g.localStorage) g.localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch (_) {}
  }

  var displayMode = readSavedMode();
  var diskStats = null;
  var liveConversations = {};
  var activeAnchorBar = null;
  var hidePopoverTimer = null;
  var copiedUntil = 0;

  function readLiveBridge() {
    try {
      var raw = g.sessionStorage && g.sessionStorage.getItem(LIVE_BRIDGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.conversations && typeof parsed.conversations === 'object') {
        liveConversations = parsed.conversations;
      }
    } catch (_) {}
  }

  function mergeConversationView(cascadeId) {
    var diskSess = (diskStats && diskStats.sessions && cascadeId && Object.prototype.hasOwnProperty.call(diskStats.sessions, cascadeId))
      ? diskStats.sessions[cascadeId]
      : null;
    var liveSess = (cascadeId && Object.prototype.hasOwnProperty.call(liveConversations, cascadeId))
      ? liveConversations[cascadeId]
      : null;

    if (!diskSess && !liveSess) return null;

    var dIn = diskSess ? (diskSess.input || 0) : 0;
    var dCache = diskSess ? (diskSess.cacheRead || 0) : 0;
    var dOut = diskSess ? (diskSess.output || 0) : 0;
    var dSteps = diskSess ? (diskSess.steps || 0) : 0;
    var dTurns = diskSess ? (diskSess.turns || 0) : 0;
    var dCtx = diskSess ? (diskSess.lastContext || 0) : 0;

    var lIn = liveSess ? (liveSess.input || 0) : 0;
    var lCache = liveSess ? (liveSess.cacheRead || 0) : 0;
    var lOut = liveSess ? (liveSess.output || 0) : 0;
    var lSteps = liveSess ? (liveSess.steps || 0) : 0;
    var lTurns = liveSess ? (liveSess.turns || 0) : 0;

    var input = Math.max(dIn, lIn);
    var cacheRead = Math.max(dCache, lCache);
    var output = Math.max(dOut, lOut);
    var totalInput = input + cacheRead;
    var cacheRate = totalInput > 0 ? Math.round((cacheRead / totalInput) * 100) : 0;

    var contextUsed = liveSess && liveSess.contextUsed > 0 ? liveSess.contextUsed : dCtx;
    var contextMax = liveSess && liveSess.contextMax > 0 ? liveSess.contextMax : (contextUsed > 0 ? 1000000 : 0);
    var contextPct = contextMax > 0 ? Math.min(100, Math.round((contextUsed / contextMax) * 100)) : 0;

    return {
      turns: Math.max(dTurns, lTurns),
      steps: Math.max(dSteps, lSteps),
      input: input,
      cacheRead: cacheRead,
      totalInput: totalInput,
      output: output,
      thinking: liveSess ? (liveSess.thinking || 0) : 0,
      response: liveSess ? (liveSess.response || 0) : 0,
      costUsd: liveSess ? (liveSess.costUsd || 0) : 0,
      cacheRate: cacheRate,
      contextUsed: contextUsed,
      contextMax: contextMax,
      contextPct: contextPct,
      tokPerSec: liveSess ? (liveSess.tokPerSec || 0) : 0,
      isStreaming: Boolean(liveSess && liveSess.isStreaming),
      ttftMs: liveSess ? (liveSess.ttftMs || 0) : 0,
      lastGenMs: liveSess ? (liveSess.lastGenMs || 0) : 0,
      lastGenOutput: liveSess ? (liveSess.lastGenOutput || 0) : 0,
    };
  }

  function createSvgEl(doc, tag, attrs) {
    var el = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    var keys = Object.keys(attrs);
    for (var i = 0; i < keys.length; i++) {
      el.setAttribute(keys[i], String(attrs[keys[i]]));
    }
    return el;
  }

  function ensureStyles() {
    var doc = g.document;
    if (!doc || !doc.head || doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '.agy-tm-bar{',
      '  display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;',
      '  gap:6px 14px;padding:9px 14px 0;margin-bottom:-4px;min-height:24px;',
      '  color:var(--muted-foreground,#8c919b);',
      '  font-size:11.5px;line-height:1.35;font-weight:400;',
      '  font-variant-numeric:tabular-nums;user-select:none;cursor:pointer;',
      '}',
      '.agy-tm-group{display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px 14px;min-width:0;}',
      '.agy-tm-group-r{display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px 14px;margin-left:auto;}',
      '.agy-tm-bar:hover,.agy-tm-bar[data-open="1"]{color:var(--secondary-foreground,inherit);}',
      '.agy-tm-item{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;}',
      '.agy-tm-dot{width:6px;height:6px;border-radius:9999px;background:#22c55e;flex-shrink:0;}',
      '.agy-tm-dot[data-live="1"]{animation:agyTmPulse 1s ease-in-out infinite;}',
      '@keyframes agyTmPulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:0.45;transform:scale(1.3);}}',
      '.agy-tm-strong{color:var(--foreground,inherit);font-weight:600;}',
      '.agy-tm-green{color:#22c55e;font-weight:600;}',
      '.agy-tm-warn{color:#eab308;font-weight:600;}',
      '.agy-tm-danger{color:#ef4444;font-weight:600;}',
      '.agy-tm-ring{width:13px;height:13px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}',
      '#' + POPOVER_ID + '{',
      '  position:fixed;z-index:2147483000;width:320px;',
      '  border-radius:10px;padding:10px 12px;',
      '  background:var(--popover,var(--background,#1e1e22));',
      '  color:var(--popover-foreground,var(--foreground,#e4e4e7));',
      '  border:1px solid var(--border,rgba(128,128,128,0.28));',
      '  box-shadow:0 10px 30px rgba(0,0,0,0.3);',
      '  font-size:12px;line-height:1.45;font-variant-numeric:tabular-nums;',
      '  user-select:none;',
      '}',
      '.agy-tm-pop-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border,rgba(128,128,128,0.18));}',
      '.agy-tm-pop-title{font-weight:600;font-size:12.5px;}',
      '.agy-tm-pop-actions{display:flex;align-items:center;gap:4px;}',
      '.agy-tm-btn{border:1px solid var(--border,rgba(128,128,128,0.25));background:transparent;color:inherit;border-radius:5px;padding:2px 6px;font-size:11px;cursor:pointer;opacity:0.85;}',
      '.agy-tm-btn:hover{opacity:1;background:color-mix(in srgb,currentColor 10%,transparent);}',
      '.agy-tm-sec{margin-bottom:8px;}',
      '.agy-tm-sec:last-of-type{margin-bottom:6px;}',
      '.agy-tm-sec-hd{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:3px;}',
      '.agy-tm-sec-name{font-weight:600;font-size:12px;}',
      '.agy-tm-sec-total{font-weight:700;font-size:12px;}',
      '.agy-tm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;}',
      '.agy-tm-cell{padding:4px 6px;border-radius:6px;background:color-mix(in srgb,currentColor 6%,transparent);}',
      '.agy-tm-cell-k{font-size:10.5px;opacity:0.68;}',
      '.agy-tm-cell-v{font-size:11.5px;font-weight:600;margin-top:1px;}',
      '.agy-tm-meta{font-size:11px;opacity:0.76;margin-top:3px;display:flex;justify-content:space-between;gap:8px;}',
      '.agy-tm-foot{font-size:10.5px;opacity:0.58;padding-top:6px;border-top:1px solid var(--border,rgba(128,128,128,0.18));display:flex;justify-content:space-between;}',
    ].join('\n');
    doc.head.appendChild(st);
  }

  function addTextItem(doc, bar, text, extraClass) {
    var span = doc.createElement('span');
    span.className = 'agy-tm-item' + (extraClass ? ' ' + extraClass : '');
    span.textContent = text;
    bar.appendChild(span);
    return span;
  }

  function buildBarNodes(bar, view, cascadeId) {
    var doc = g.document;
    var today = (diskStats && diskStats.today) || { input: 0, cacheRead: 0, output: 0, total: 0 };
    var speedStr = view && view.tokPerSec > 0
      ? ((view.isStreaming ? '~' : '') + formatSpeed(view.tokPerSec))
      : '-- tok/s';
    var turns = view ? view.turns : 0;
    var steps = view ? view.steps : 0;
    var totalIn = view ? view.totalInput : 0;
    var totalOut = view ? view.output : 0;
    var costStr = view ? formatCost(view.costUsd) : '';
    var cacheRate = view ? view.cacheRate : 0;
    var ctxPct = view ? view.contextPct : 0;

    var sig = [
      displayMode, cascadeId, turns, steps, speedStr,
      view && view.isStreaming ? 1 : 0, totalIn, totalOut,
      costStr, cacheRate, ctxPct, today.total,
    ].join('|');

    if (bar.getAttribute('data-render-sig') === sig) return;
    bar.setAttribute('data-render-sig', sig);

    while (bar.firstChild) bar.removeChild(bar.firstChild);

    var leftGrp = doc.createElement('div');
    leftGrp.className = 'agy-tm-group';
    var rightGrp = doc.createElement('div');
    rightGrp.className = 'agy-tm-group-r';

    if (displayMode === 'compact') {
      var speedItemC = doc.createElement('span');
      speedItemC.className = 'agy-tm-item';
      if (view && view.isStreaming) {
        var dotC = doc.createElement('span');
        dotC.className = 'agy-tm-dot';
        dotC.setAttribute('data-live', '1');
        speedItemC.appendChild(dotC);
      }
      var spdTxtC = doc.createElement('span');
      spdTxtC.className = (view && view.isStreaming) ? 'agy-tm-green' : (view && view.tokPerSec > 0 ? 'agy-tm-strong' : '');
      spdTxtC.textContent = speedStr;
      speedItemC.appendChild(spdTxtC);
      leftGrp.appendChild(speedItemC);

      addTextItem(doc, rightGrp, '今日 ' + formatCompact(today.total));
    } else {
      addTextItem(doc, leftGrp, turns + ' 轮 ' + steps + ' 步');

      var speedItem = doc.createElement('span');
      speedItem.className = 'agy-tm-item';
      if (view && view.isStreaming) {
        var dot = doc.createElement('span');
        dot.className = 'agy-tm-dot';
        dot.setAttribute('data-live', '1');
        speedItem.appendChild(dot);
      }
      var spdTxt = doc.createElement('span');
      spdTxt.className = (view && view.isStreaming) ? 'agy-tm-green' : (view && view.tokPerSec > 0 ? 'agy-tm-strong' : '');
      spdTxt.textContent = speedStr;
      speedItem.appendChild(spdTxt);
      leftGrp.appendChild(speedItem);

      addTextItem(doc, leftGrp, '↑ ' + formatExact(totalIn) + ' tok');
      addTextItem(doc, leftGrp, '↓ ' + formatExact(totalOut) + ' tok');

      if (costStr) {
        addTextItem(doc, rightGrp, costStr);
      }

      var cacheItem = doc.createElement('span');
      cacheItem.className = 'agy-tm-item';
      var cacheLbl = doc.createElement('span');
      cacheLbl.textContent = '缓存命中 ';
      var cacheVal = doc.createElement('span');
      cacheVal.className = totalIn > 0 ? 'agy-tm-green' : '';
      cacheVal.textContent = cacheRate + '%';
      cacheItem.appendChild(cacheLbl);
      cacheItem.appendChild(cacheVal);
      rightGrp.appendChild(cacheItem);
    }

    // 右侧上下文进度环形图 + %
    var ctxItem = doc.createElement('span');
    ctxItem.className = 'agy-tm-item';
    var ringWrap = doc.createElement('span');
    ringWrap.className = 'agy-tm-ring';
    var r = 5;
    var circ = 2 * Math.PI * r;
    var strokeColor = ctxPct >= 85 ? '#ef4444' : (ctxPct >= 60 ? '#eab308' : '#22c55e');
    var svg = createSvgEl(doc, 'svg', { viewBox: '0 0 14 14', width: 13, height: 13 });
    svg.appendChild(createSvgEl(doc, 'circle', {
      cx: 7, cy: 7, r: r, fill: 'none', stroke: 'currentColor', 'stroke-opacity': '0.28', 'stroke-width': 2,
    }));
    svg.appendChild(createSvgEl(doc, 'circle', {
      cx: 7, cy: 7, r: r, fill: 'none', stroke: strokeColor, 'stroke-width': 2,
      'stroke-dasharray': circ.toFixed(2),
      'stroke-dashoffset': (circ * (1 - ctxPct / 100)).toFixed(2),
      transform: 'rotate(-90 7 7)',
    }));
    ringWrap.appendChild(svg);
    var pctSpan = doc.createElement('span');
    pctSpan.className = ctxPct >= 85 ? 'agy-tm-danger' : (ctxPct >= 60 ? 'agy-tm-warn' : 'agy-tm-green');
    pctSpan.textContent = ctxPct + '%';
    ctxItem.appendChild(ringWrap);
    ctxItem.appendChild(pctSpan);
    rightGrp.appendChild(ctxItem);

    bar.appendChild(leftGrp);
    bar.appendChild(rightGrp);
  }

  function createSummaryText(view, cascadeId) {
    var today = (diskStats && diskStats.today) || { input: 0, cacheRead: 0, output: 0, total: 0, conversations: 0 };
    var week = (diskStats && diskStats.week) || { input: 0, cacheRead: 0, output: 0, total: 0, conversations: 0 };
    var lines = [];
    if (view) {
      lines.push(
        (cascadeId ? '当前对话 (' + cascadeId.slice(0, 8) + ')' : '当前对话')
        + ': ' + view.turns + ' 轮 ' + view.steps + ' 步, '
        + (view.tokPerSec > 0 ? formatSpeed(view.tokPerSec) : '-- tok/s')
        + ', 输入 ' + formatExact(view.totalInput)
        + ' (新增 ' + formatExact(view.input) + ' + 缓存 ' + formatExact(view.cacheRead) + ', 命中 ' + view.cacheRate + '%)'
        + ', 输出 ' + formatExact(view.output)
        + ', 上下文 ' + view.contextPct + '%'
      );
    }
    lines.push('今日全量: ' + formatExact(today.total) + ' (输入 ' + formatExact(today.input) + ', 缓存 ' + formatExact(today.cacheRead) + ', 输出 ' + formatExact(today.output) + ', ' + today.conversations + ' 个对话)');
    lines.push('本周全量: ' + formatExact(week.total) + ' (输入 ' + formatExact(week.input) + ', 缓存 ' + formatExact(week.cacheRead) + ', 输出 ' + formatExact(week.output) + ', ' + week.conversations + ' 个对话)');
    return lines.join('\n');
  }

  function makeBucketSection(doc, title, totalVal, c1, c2, c3, extraLeft, extraRight) {
    var sec = doc.createElement('div');
    sec.className = 'agy-tm-sec';

    var hd = doc.createElement('div');
    hd.className = 'agy-tm-sec-hd';
    var nameEl = doc.createElement('span');
    nameEl.className = 'agy-tm-sec-name';
    nameEl.textContent = title;
    var totalEl = doc.createElement('span');
    totalEl.className = 'agy-tm-sec-total';
    totalEl.textContent = totalVal;
    hd.appendChild(nameEl);
    hd.appendChild(totalEl);
    sec.appendChild(hd);

    var grid = doc.createElement('div');
    grid.className = 'agy-tm-grid';
    var cells = [c1, c2, c3];
    for (var i = 0; i < cells.length; i++) {
      var cell = doc.createElement('div');
      cell.className = 'agy-tm-cell';
      if (cells[i][2]) cell.title = cells[i][2];
      var k = doc.createElement('div');
      k.className = 'agy-tm-cell-k';
      k.textContent = cells[i][0];
      var v = doc.createElement('div');
      v.className = 'agy-tm-cell-v';
      v.textContent = cells[i][1];
      cell.appendChild(k);
      cell.appendChild(v);
      grid.appendChild(cell);
    }
    sec.appendChild(grid);

    if (extraLeft || extraRight) {
      var meta = doc.createElement('div');
      meta.className = 'agy-tm-meta';
      var lEl = doc.createElement('span');
      lEl.textContent = extraLeft || '';
      var rEl = doc.createElement('span');
      rEl.textContent = extraRight || '';
      meta.appendChild(lEl);
      meta.appendChild(rEl);
      sec.appendChild(meta);
    }
    return sec;
  }

  function clearHideTimer() {
    if (hidePopoverTimer !== null) {
      g.clearTimeout(hidePopoverTimer);
      hidePopoverTimer = null;
    }
  }

  function closePopover() {
    var doc = g.document;
    var pop = doc.getElementById(POPOVER_ID);
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
    if (activeAnchorBar) {
      try { activeAnchorBar.removeAttribute('data-open'); } catch (_) {}
      activeAnchorBar = null;
    }
  }

  function scheduleHidePopover() {
    clearHideTimer();
    hidePopoverTimer = g.setTimeout(function () {
      hidePopoverTimer = null;
      closePopover();
    }, 150);
  }

  function positionPopoverAbove(pop, bar) {
    var rect = bar.getBoundingClientRect ? bar.getBoundingClientRect() : { left: 200, top: 700, width: 400 };
    var vw = g.innerWidth || 1280;
    var width = 320;
    var centerLeft = (rect.left || 200) + ((rect.width || 400) - width) / 2;
    var left = Math.max(8, Math.min(centerLeft, vw - width - 8));
    var popHeight = pop.offsetHeight || 260;
    var top = Math.max(8, (rect.top || 700) - popHeight - 8);
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }

  function renderPopover(bar) {
    var doc = g.document;
    if (!doc.body) return;
    clearHideTimer();
    if (activeAnchorBar && activeAnchorBar !== bar) {
      try { activeAnchorBar.removeAttribute('data-open'); } catch (_) {}
    }
    activeAnchorBar = bar;
    bar.setAttribute('data-open', '1');

    var pop = doc.getElementById(POPOVER_ID);
    if (!pop) {
      pop = doc.createElement('div');
      pop.id = POPOVER_ID;
      pop.setAttribute('data-agy-zh-skip', '1');
      pop.addEventListener('click', function (ev) {
        ev.stopPropagation();
      });
      doc.body.appendChild(pop);
    }
    while (pop.firstChild) pop.removeChild(pop.firstChild);

    var box = bar._agyInputBox;
    var cascadeId = (box && box.getAttribute(CASCADE_ATTR)) || '';
    var view = mergeConversationView(cascadeId);
    var today = diskStats && diskStats.today;
    var week = diskStats && diskStats.week;

    var hd = doc.createElement('div');
    hd.className = 'agy-tm-pop-hd';
    var titleEl = doc.createElement('span');
    titleEl.className = 'agy-tm-pop-title';
    titleEl.textContent = '实时速度与 Tokens 统计';
    var acts = doc.createElement('div');
    acts.className = 'agy-tm-pop-actions';

    var refreshBtn = doc.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'agy-tm-btn';
    refreshBtn.textContent = '刷新';
    refreshBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      requestRefresh(cascadeId);
    });

    var copyBtn = doc.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'agy-tm-btn';
    copyBtn.textContent = Date.now() < copiedUntil ? '已复制' : '复制';
    copyBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var summary = createSummaryText(view, cascadeId);
      try {
        if (clipboard && typeof clipboard.writeText === 'function') {
          clipboard.writeText(summary);
        } else if (g.navigator && g.navigator.clipboard && typeof g.navigator.clipboard.writeText === 'function') {
          g.navigator.clipboard.writeText(summary);
        }
      } catch (_) {}
      copiedUntil = Date.now() + 1500;
      copyBtn.textContent = '已复制';
      g.setTimeout(function () {
        if (activeAnchorBar === bar) renderPopover(bar);
      }, 1550);
    });

    acts.appendChild(refreshBtn);
    acts.appendChild(copyBtn);
    hd.appendChild(titleEl);
    hd.appendChild(acts);
    pop.appendChild(hd);

    var speedLabel = view && view.tokPerSec > 0 ? formatSpeed(view.tokPerSec) : '-- tok/s';
    var ttftText = view && view.ttftMs > 0 ? ('首字 ' + (view.ttftMs / 1000).toFixed(2) + 's') : '';
    var genText = view && view.lastGenMs > 0 ? ('最近一步 ' + (view.lastGenMs / 1000).toFixed(2) + 's · ' + formatExact(view.lastGenOutput) + ' tok') : '';
    var ctxText = view && view.contextMax > 0
      ? ('上下文 ' + formatCompact(view.contextUsed) + ' / ' + formatCompact(view.contextMax) + ' (' + view.contextPct + '%)')
      : '';

    pop.appendChild(makeBucketSection(
      doc,
      cascadeId ? '当前对话' : '当前对话（新对话尚未发送）',
      speedLabel,
      ['新增输入', view ? formatCompact(view.input) : '--', view ? formatExact(view.input) : ''],
      ['缓存命中', view ? (formatCompact(view.cacheRead) + ' (' + view.cacheRate + '%)') : '--', view ? formatExact(view.cacheRead) : ''],
      ['模型输出', view ? formatCompact(view.output) : '--', view ? formatExact(view.output) : ''],
      ttftText || ctxText,
      genText || (view ? (view.turns + ' 轮 ' + view.steps + ' 步') : '')
    ));

    if (ttftText && ctxText) {
      var ctxRow = doc.createElement('div');
      ctxRow.className = 'agy-tm-meta';
      ctxRow.style.marginTop = '-4px';
      ctxRow.style.marginBottom = '8px';
      var c1 = doc.createElement('span');
      c1.textContent = ctxText;
      var c2 = doc.createElement('span');
      c2.textContent = view.costUsd > 0 ? ('累计估算 ' + formatCost(view.costUsd)) : '';
      ctxRow.appendChild(c1);
      ctxRow.appendChild(c2);
      pop.appendChild(ctxRow);
    }

    pop.appendChild(makeBucketSection(
      doc,
      '今日全量（含子代理）',
      today ? formatExact(today.total) : '--',
      ['新增输入', today ? formatCompact(today.input) : '--', today ? formatExact(today.input) : ''],
      ['缓存命中', today ? formatCompact(today.cacheRead) : '--', today ? formatExact(today.cacheRead) : ''],
      ['模型输出', today ? formatCompact(today.output) : '--', today ? formatExact(today.output) : ''],
      today ? ('涉及 ' + today.conversations + ' 个对话') : '',
      today ? ('共 ' + today.steps + ' 步') : ''
    ));

    pop.appendChild(makeBucketSection(
      doc,
      '本周全量（含子代理）',
      week ? formatExact(week.total) : '--',
      ['新增输入', week ? formatCompact(week.input) : '--', week ? formatExact(week.input) : ''],
      ['缓存命中', week ? formatCompact(week.cacheRead) : '--', week ? formatExact(week.cacheRead) : ''],
      ['模型输出', week ? formatCompact(week.output) : '--', week ? formatExact(week.output) : ''],
      week ? ('涉及 ' + week.conversations + ' 个对话') : '',
      week ? ('共 ' + week.steps + ' 步') : ''
    ));

    var foot = doc.createElement('div');
    foot.className = 'agy-tm-foot';
    var fLeft = doc.createElement('span');
    fLeft.textContent = '单击开关详情 · 双击切换视图';
    var fRight = doc.createElement('span');
    fRight.textContent = 'LS 流式 + 步级精确校验';
    foot.appendChild(fLeft);
    foot.appendChild(fRight);
    pop.appendChild(foot);

    positionPopoverAbove(pop, bar);
  }

  var singleClickTimer = null;

  function createBar(inputBox) {
    var doc = g.document;
    var bar = doc.createElement('div');
    bar.className = 'agy-tm-bar';
    bar.setAttribute(BAR_ATTR, '1');
    bar.setAttribute('data-agy-zh-skip', '1');
    bar.setAttribute('role', 'button');
    bar.setAttribute('tabindex', '0');
    bar.setAttribute('aria-label', '实时输出速度与 Tokens 用量（单击查看详情，双击切换视图）');
    bar._agyInputBox = inputBox;

    bar.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (singleClickTimer !== null) {
        g.clearTimeout(singleClickTimer);
        singleClickTimer = null;
      }
      singleClickTimer = g.setTimeout(function () {
        singleClickTimer = null;
        if (activeAnchorBar === bar) closePopover();
        else renderPopover(bar);
      }, 190);
    });
    bar.addEventListener('dblclick', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (singleClickTimer !== null) {
        g.clearTimeout(singleClickTimer);
        singleClickTimer = null;
      }
      var idx = MODES.indexOf(displayMode);
      displayMode = MODES[(idx + 1) % MODES.length];
      writeSavedMode(displayMode);
      renderAll();
      if (activeAnchorBar === bar) renderPopover(bar);
    });
    return bar;
  }

  g.document.addEventListener('click', function (ev) {
    if (!activeAnchorBar) return;
    var t = ev && ev.target;
    var pop = g.document.getElementById(POPOVER_ID);
    if (pop && t && pop.contains && pop.contains(t)) return;
    if (t && activeAnchorBar.contains && activeAnchorBar.contains(t)) return;
    closePopover();
  });

  g.document.addEventListener('keydown', function (ev) {
    if (ev && ev.key === 'Escape' && activeAnchorBar) {
      closePopover();
    }
  });

  function mountAndRender() {
    var doc = g.document;
    if (!doc || !doc.querySelectorAll) return;
    ensureStyles();

    var boxes = doc.querySelectorAll('[data-testid="agent-input-box"]');
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var existing = box.querySelector('[' + BAR_ATTR + '="1"]');
      var bar = existing || createBar(box);
      bar._agyInputBox = box;

      // 始终位于输入框容器最底部，自然把输入框卡片上抬一行
      if (bar.parentElement !== box || bar.nextElementSibling !== null) {
        box.appendChild(bar);
      }

      var cid = box.getAttribute(CASCADE_ATTR) || '';
      var view = mergeConversationView(cid);
      buildBarNodes(bar, view, cid);
    }

    if (activeAnchorBar) {
      if (!activeAnchorBar.isConnected) {
        closePopover();
      } else {
        renderPopover(activeAnchorBar);
      }
    }
  }

  var renderQueued = false;
  function renderAll() {
    if (renderQueued) return;
    renderQueued = true;
    var run = function () {
      renderQueued = false;
      mountAndRender();
      if (domObserver) domObserver.takeRecords();
    };
    if (typeof g.requestAnimationFrame === 'function') g.requestAnimationFrame(run);
    else g.setTimeout(run, 16);
  }

  function requestRefresh(cascadeId) {
    if (!ipc || typeof ipc.invoke !== 'function') return;
    ipc.invoke(CH_GET_ASYNC, { cascadeId: cascadeId || '' }).then(function (snap) {
      if (snap && typeof snap === 'object') {
        diskStats = snap;
        renderAll();
      }
    }).catch(function () {});
  }

  function loadInitialStats() {
    readLiveBridge();
    if (ipc && typeof ipc.sendSync === 'function') {
      try {
        var syncSnap = ipc.sendSync(CH_GET_SYNC, { cascadeId: '' });
        if (syncSnap && typeof syncSnap === 'object') diskStats = syncSnap;
      } catch (_) {}
    }
    requestRefresh('');
  }

  if (ipc && typeof ipc.on === 'function') {
    ipc.on(CH_UPDATED, function (_event, snap) {
      if (snap && typeof snap === 'object') {
        diskStats = snap;
        renderAll();
      }
    });
  }

  var domObserver = null;
  function startObserver() {
    var doc = g.document;
    if (!doc.documentElement || typeof g.MutationObserver !== 'function') return;
    domObserver = new g.MutationObserver(function () {
      renderAll();
    });
    domObserver.observe(doc.documentElement, { childList: true, subtree: true });
  }

  g.addEventListener(LIVE_BRIDGE_KEY, function () {
    readLiveBridge();
    renderAll();
  });
  g.addEventListener(CASCADE_EVENT, renderAll);

  var api = {
    BAR_ATTR: BAR_ATTR,
    CASCADE_ATTR: CASCADE_ATTR,
    POPOVER_ID: POPOVER_ID,
    LIVE_BRIDGE_KEY: LIVE_BRIDGE_KEY,
    MODES: MODES,
    formatCompact: formatCompact,
    formatExact: formatExact,
    formatSpeed: formatSpeed,
    installMainWorldTelemetry: installMainWorldTelemetry,
    mountAndRender: mountAndRender,
    setDiskStats: function (snap) {
      diskStats = snap;
      mountAndRender();
    },
    getMode: function () { return displayMode; },
    setMode: function (m) {
      if (MODES.indexOf(m) !== -1) {
        displayMode = m;
        writeSavedMode(m);
        mountAndRender();
      }
    },
  };

  Object.defineProperty(g, '__AGY_TOKEN_METER_PRELOAD_API__', {
    value: api,
    configurable: true,
  });

  if (
    typeof module === 'object' &&
    module &&
    module.exports &&
    typeof module.exports === 'object' &&
    Object.keys(module.exports).length === 0
  ) {
    module.exports = api;
  }

  loadInitialStats();
  if (g.document.readyState === 'loading') {
    g.document.addEventListener('DOMContentLoaded', function () {
      startObserver();
      mountAndRender();
    }, { once: true });
  } else {
    startObserver();
    mountAndRender();
  }
})();
