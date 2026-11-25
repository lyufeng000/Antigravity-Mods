// Antigravity 主进程（dist/main.js）等效月 API 费用统计与持久化模块
// 被动接收 Main World 旁路采集的用户档位、高精度周额度小数（remainingFraction）与模型单价，
// 并结合 ~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl 按账号与周期增量对账。
// 原则：0 主动网络请求、不读取 OAuth 凭证、Ultra 与 Pro 严格隔离、每打开 Agy 对每个邮箱最多计算 1 次、保留最近 20 次记录。
(function () {
  'use strict';

  if (globalThis.__AGY_PERIODIC_MODEL_MAIN_BOOTED__) return;
  Object.defineProperty(globalThis, '__AGY_PERIODIC_MODEL_MAIN_BOOTED__', { value: true });

  var baseRequire = typeof require === 'function'
    ? require
    : (typeof process !== 'undefined' && process && typeof process.getBuiltinModule === 'function'
      ? function (id) { return process.getBuiltinModule(id); }
      : null);
  if (!baseRequire) return;

  var fs = baseRequire('fs');
  var path = baseRequire('path');
  var os = baseRequire('os');
  var crypto = baseRequire('crypto');

  var electron = null;
  try {
    var rawElectron = baseRequire('electron');
    if (rawElectron && typeof rawElectron === 'object') {
      electron = rawElectron;
    }
  } catch (_) {}

  var STORE_FILE = '';
  try {
    STORE_FILE = __AGY_EQUIV_COST_FILE__;
  } catch (_) {
    STORE_FILE = '';
  }
  if (typeof STORE_FILE !== 'string') STORE_FILE = '';

  var CH_GET_SYNC = 'agy-pm-equiv:get-state-sync';
  var CH_REPORT_USER = 'agy-pm-equiv:report-user';
  var CH_REPORT_SIGNOUT = 'agy-pm-equiv:report-signout';
  var CH_REPORT_QUOTA = 'agy-pm-equiv:report-quota';
  var CH_REPORT_PRICING = 'agy-pm-equiv:report-pricing';
  var CH_UPDATED = 'agy-pm-equiv:state-updated';

  var MAX_RECORDS = 20;
  var MAX_TIMELINE = 200;
  var WEEK_MS = 7 * 86400 * 1000;
  var MONTH_RATIO = 30 / 7;
  var MIN_DELTA_FRAC = 0.002;
  var MIN_COST_USD = 0.05;
  var MAX_MONTHLY_USD = 50000;
  var RESET_TOLERANCE_MS = 15 * 60 * 1000;
  var PENDING_QUOTA_TTL_MS = 60 * 1000;

  var TIER_LABELS = {
    ultra: 'Ultra',
    pro: 'Pro',
    free: 'Free',
    unknown: '未知档位',
  };

  function defaultBrainDir() {
    var home = os.homedir ? os.homedir() : (process.env.USERPROFILE || process.env.HOME || '');
    return path.join(home, '.gemini', 'antigravity', 'brain');
  }

  function cloneDefaultPricing() {
    return {
      mode: 'model-aware',
      neon: {
        inputPerMillion: 2.0,
        cacheReadPerMillion: 0.2,
        outputPerMillion: 12.0,
        source: 'default',
        updatedAt: null,
        locked: false,
      },
      models: {
        'gemini-4-neon': {
          inputPerMillion: 2.0,
          cacheReadPerMillion: 0.2,
          outputPerMillion: 12.0,
          source: 'default',
          updatedAt: null,
          locked: false,
        },
        'gemini-4-carbon': {
          inputPerMillion: 2.0,
          cacheReadPerMillion: 0.2,
          outputPerMillion: 12.0,
          source: 'default',
          updatedAt: null,
          locked: false,
        },
        'gemini-4-argon': {
          inputPerMillion: 2.0,
          cacheReadPerMillion: 0.2,
          outputPerMillion: 12.0,
          source: 'default',
          updatedAt: null,
          locked: false,
        },
        'gemini-4-hydrogen': {
          inputPerMillion: 0.5,
          cacheReadPerMillion: 0.05,
          outputPerMillion: 3.0,
          source: 'default',
          updatedAt: null,
          locked: false,
        },
        'gemini-flash': {
          inputPerMillion: 0.5,
          cacheReadPerMillion: 0.05,
          outputPerMillion: 3.0,
          source: 'default',
          updatedAt: null,
          locked: false,
        },
      },
    };
  }

  function emptyStoreData() {
    return {
      version: 1,
      pricing: cloneDefaultPricing(),
      currentEmail: '',
      accountTimeline: [],
      accounts: {},
      records: [],
    };
  }

  function toFiniteNum(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  function toNonNegInt(v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
    return Math.round(v);
  }

  function normalizePriceEntry(raw, fallback) {
    var fb = fallback || { inputPerMillion: 2.0, cacheReadPerMillion: 0.2, outputPerMillion: 12.0, source: 'default', updatedAt: null, locked: false };
    if (!raw || typeof raw !== 'object') {
      return {
        inputPerMillion: fb.inputPerMillion,
        cacheReadPerMillion: fb.cacheReadPerMillion,
        outputPerMillion: fb.outputPerMillion,
        source: fb.source || 'default',
        updatedAt: fb.updatedAt || null,
        locked: Boolean(fb.locked),
      };
    }
    var inp = toFiniteNum(raw.inputPerMillion);
    var cache = toFiniteNum(raw.cacheReadPerMillion);
    var out = toFiniteNum(raw.outputPerMillion);
    return {
      inputPerMillion: inp !== null && inp > 0 ? inp : fb.inputPerMillion,
      cacheReadPerMillion: cache !== null && cache >= 0 ? cache : fb.cacheReadPerMillion,
      outputPerMillion: out !== null && out > 0 ? out : fb.outputPerMillion,
      source: typeof raw.source === 'string' && raw.source ? raw.source : (fb.source || 'default'),
      updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : null,
      locked: Boolean(raw.locked),
    };
  }

  function normalizeTierKey(v) {
    if (v === 'ultra' || v === 'pro' || v === 'free' || v === 'unknown') return v;
    return 'unknown';
  }

  function classifyAccountTier(userStatus) {
    if (!userStatus || typeof userStatus !== 'object') {
      return { tier: 'unknown', tierName: '' };
    }
    var parts = [];
    var rawName = '';
    var ut = userStatus.userTier;
    if (ut && typeof ut === 'object') {
      if (typeof ut.id === 'string' && ut.id.trim()) parts.push(ut.id.trim());
      if (typeof ut.name === 'string' && ut.name.trim()) {
        parts.push(ut.name.trim());
        rawName = ut.name.trim();
      }
      if (typeof ut.description === 'string' && ut.description.trim()) parts.push(ut.description.trim());
    }
    if (typeof userStatus.g1Tier === 'string' && userStatus.g1Tier.trim()) {
      parts.push(userStatus.g1Tier.trim());
      if (!rawName) rawName = userStatus.g1Tier.trim();
    }
    var psPlan = userStatus.planStatus && userStatus.planStatus.planInfo;
    var pi = userStatus.planInfo || psPlan;
    if (pi && typeof pi === 'object') {
      if (typeof pi.planName === 'string' && pi.planName.trim()) {
        parts.push(pi.planName.trim());
        if (!rawName) rawName = pi.planName.trim();
      }
      if (pi.teamsTier !== undefined && pi.teamsTier !== null) {
        parts.push(String(pi.teamsTier));
      }
    }
    if (psPlan && psPlan !== pi && typeof psPlan === 'object') {
      if (typeof psPlan.planName === 'string' && psPlan.planName.trim()) parts.push(psPlan.planName.trim());
      if (psPlan.teamsTier !== undefined && psPlan.teamsTier !== null) parts.push(String(psPlan.teamsTier));
    }

    var text = parts.join(' ').toLowerCase();
    if (!text) return { tier: 'unknown', tierName: '' };
    if (/ultra|g1-ultra|pro_ultimate|teams_ultimate/.test(text)) {
      return { tier: 'ultra', tierName: rawName || 'Ultra' };
    }
    if (/\bpro\b|g1-pro|teams_tier_pro|\bpro[-_ ]tier\b/.test(text)) {
      return { tier: 'pro', tierName: rawName || 'Pro' };
    }
    if (/\bfree\b|standard-tier|\bfree[-_ ]tier\b/.test(text)) {
      return { tier: 'free', tierName: rawName || 'Free' };
    }
    return { tier: 'unknown', tierName: rawName };
  }

  function isGeminiQuotaModel(modelName) {
    if (typeof modelName !== 'string') return true;
    var lower = modelName.trim().toLowerCase();
    if (!lower) return true;
    if (
      lower.indexOf('claude') !== -1
      || lower.indexOf('gpt') !== -1
      || lower.indexOf('openai') !== -1
      || lower.indexOf('deepseek') !== -1
      || lower.indexOf('kimi') !== -1
      || lower.indexOf('glm') !== -1
      || lower.indexOf('grok') !== -1
      || lower.indexOf('xai') !== -1
      || /^o[134](?:[-_]|$)/.test(lower)
    ) {
      return false;
    }
    if (
      lower.indexOf('gemini') !== -1
      || lower.indexOf('neon') !== -1
      || lower.indexOf('hydrogen') !== -1
      || lower.indexOf('carbon') !== -1
      || lower.indexOf('argon') !== -1
      || lower.indexOf('flash') !== -1
      || lower.indexOf('orchestrator') !== -1
    ) {
      return true;
    }
    return false;
  }

  function matchModelFamilyKey(modelName) {
    if (typeof modelName !== 'string') return '';
    var lower = modelName.trim().toLowerCase();
    if (!lower) return '';
    if (lower.indexOf('neon') !== -1) return 'gemini-4-neon';
    if (lower.indexOf('hydrogen') !== -1 || lower.indexOf('flash-worker') !== -1 || lower.indexOf('flash') !== -1) {
      return lower.indexOf('hydrogen') !== -1 || lower.indexOf('flash-worker') !== -1
        ? 'gemini-4-hydrogen'
        : 'gemini-flash';
    }
    if (lower.indexOf('carbon') !== -1) return 'gemini-4-carbon';
    if (lower.indexOf('argon') !== -1) return 'gemini-4-argon';
    return '';
  }

  function resolveModelPricing(modelName, pricingCfg) {
    var cfg = pricingCfg && typeof pricingCfg === 'object' ? pricingCfg : cloneDefaultPricing();
    var neon = cfg.neon || cloneDefaultPricing().neon;
    if (cfg.mode === 'neon-only') return neon;
    var family = matchModelFamilyKey(modelName);
    if (family === 'gemini-4-neon') return neon;
    if (family && cfg.models && cfg.models[family]) return cfg.models[family];
    if (family === 'gemini-flash' && cfg.models && cfg.models['gemini-4-hydrogen']) {
      return cfg.models['gemini-4-hydrogen'];
    }
    return neon;
  }

  function computeStepCostUsd(input, cacheRead, output, price) {
    if (!price) return 0;
    return (
      input * price.inputPerMillion
      + cacheRead * price.cacheReadPerMillion
      + output * price.outputPerMillion
    ) / 1e6;
  }

  function attributeEmailAt(accountTimeline, tsMs, preTimelineFallbackEmail) {
    var fallback = typeof preTimelineFallbackEmail === 'string' ? preTimelineFallbackEmail : '';
    if (!Array.isArray(accountTimeline) || !accountTimeline.length) return fallback;
    var firstTs = null;
    for (var f = 0; f < accountTimeline.length; f++) {
      if (accountTimeline[f] && typeof accountTimeline[f].ts === 'number') {
        firstTs = accountTimeline[f].ts;
        break;
      }
    }
    if (firstTs === null || tsMs < firstTs) return fallback;

    var chosen = '';
    for (var i = 0; i < accountTimeline.length; i++) {
      var item = accountTimeline[i];
      if (!item || typeof item.ts !== 'number') continue;
      if (item.ts <= tsMs) {
        chosen = typeof item.email === 'string' ? item.email : '';
      } else {
        break;
      }
    }
    return chosen;
  }

  function resolvePreTimelineOwner(data, startMs, storeFilePath) {
    if (!data || typeof data !== 'object') return '';
    var firstEmail = '';
    if (Array.isArray(data.accountTimeline)) {
      for (var i = 0; i < data.accountTimeline.length; i++) {
        var em = data.accountTimeline[i] && data.accountTimeline[i].email;
        if (em) {
          firstEmail = em;
          break;
        }
      }
    }
    if (!firstEmail && data.currentEmail) firstEmail = data.currentEmail;
    if (!firstEmail) return '';

    if (data.accounts && typeof data.accounts === 'object') {
      var keys = Object.keys(data.accounts);
      for (var k = 0; k < keys.length; k++) {
        var other = keys[k];
        if (other === firstEmail) continue;
        var acc = data.accounts[other];
        if (acc && acc.checkpoint && typeof acc.checkpoint.ts === 'number' && acc.checkpoint.ts >= startMs) {
          return '';
        }
      }
    }

    if (storeFilePath) {
      try {
        var siblingAccountsFile = path.resolve(path.dirname(storeFilePath), '..', 'agy-weekly-quota', 'accounts.json');
        if (fs.existsSync(siblingAccountsFile)) {
          var parsed = JSON.parse(fs.readFileSync(siblingAccountsFile, 'utf8'));
          var map = parsed && parsed.accounts;
          if (map && typeof map === 'object') {
            var mKeys = Object.keys(map);
            for (var m = 0; m < mKeys.length; m++) {
              var mEmail = mKeys[m].trim();
              if (!mEmail || mEmail === firstEmail) continue;
              var uAt = map[mKeys[m]] && map[mKeys[m]].updatedAt ? Date.parse(map[mKeys[m]].updatedAt) : NaN;
              if (Number.isFinite(uAt) && uAt >= startMs) {
                return '';
              }
            }
          }
        }
      } catch (_) {}
    }

    return firstEmail;
  }

  function scanAttributedGeminiCost(opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    var brainDir = o.brainDir || defaultBrainDir();
    var accountTimeline = Array.isArray(o.accountTimeline) ? o.accountTimeline : [];
    var targetEmail = typeof o.targetEmail === 'string' ? o.targetEmail.trim() : '';
    var preTimelineFallbackEmail = typeof o.preTimelineFallbackEmail === 'string' ? o.preTimelineFallbackEmail.trim() : '';
    var startMs = typeof o.startMs === 'number' ? o.startMs : 0;
    var endMs = typeof o.endMs === 'number' ? o.endMs : Date.now();
    var pricingCfg = o.pricingConfig || cloneDefaultPricing();

    var result = {
      input: 0,
      cacheRead: 0,
      output: 0,
      steps: 0,
      costUsd: 0,
    };

    if (!targetEmail || !(endMs > startMs)) return result;

    var dirents;
    try {
      if (!fs.existsSync(brainDir)) return result;
      dirents = fs.readdirSync(brainDir, { withFileTypes: true });
    } catch (_) {
      return result;
    }

    for (var i = 0; i < dirents.length; i++) {
      var d = dirents[i];
      if (!d || !d.isDirectory()) continue;
      var tf = path.join(brainDir, d.name, '.system_generated', 'logs', 'transcript.jsonl');
      var st;
      try {
        st = fs.statSync(tf);
      } catch (_) {
        continue;
      }
      if (!st || !st.isFile() || st.size === 0 || (st.mtimeMs + 60000 < startMs)) continue;

      var text;
      try {
        text = fs.readFileSync(tf, 'utf8');
      } catch (_) {
        continue;
      }
      var lines = text.split(/\r?\n/);
      for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        if (!line || line.indexOf('_tokens') === -1) continue;
        var obj;
        try {
          obj = JSON.parse(line);
        } catch (_) {
          continue;
        }
        if (!obj || typeof obj !== 'object') continue;
        var hasTokens = ('input_tokens' in obj) || ('cache_read_tokens' in obj) || ('output_tokens' in obj);
        if (!hasTokens) continue;
        var tsMs = typeof obj.created_at === 'string' ? Date.parse(obj.created_at) : NaN;
        if (!Number.isFinite(tsMs) || tsMs <= startMs || tsMs > endMs) continue;
        if (!isGeminiQuotaModel(obj.model)) continue;
        if (attributeEmailAt(accountTimeline, tsMs, preTimelineFallbackEmail) !== targetEmail) continue;

        var inp = toNonNegInt(obj.input_tokens);
        var cacheRead = toNonNegInt(obj.cache_read_tokens);
        var out = toNonNegInt(obj.output_tokens);
        if (inp === 0 && cacheRead === 0 && out === 0) continue;

        var price = resolveModelPricing(obj.model, pricingCfg);
        result.input += inp;
        result.cacheRead += cacheRead;
        result.output += out;
        result.steps += 1;
        result.costUsd += computeStepCostUsd(inp, cacheRead, out, price);
      }
    }

    result.costUsd = Math.round(result.costUsd * 1e6) / 1e6;
    return result;
  }

  function normalizeStoreData(raw) {
    var def = emptyStoreData();
    if (!raw || typeof raw !== 'object') return def;

    var pricingRaw = raw.pricing && typeof raw.pricing === 'object' ? raw.pricing : {};
    var defPricing = cloneDefaultPricing();
    var mode = pricingRaw.mode === 'neon-only' ? 'neon-only' : 'model-aware';
    var neon = normalizePriceEntry(pricingRaw.neon, defPricing.neon);
    var models = {};
    var rawModels = pricingRaw.models && typeof pricingRaw.models === 'object' ? pricingRaw.models : {};
    var defKeys = Object.keys(defPricing.models);
    for (var di = 0; di < defKeys.length; di++) {
      var dk = defKeys[di];
      models[dk] = normalizePriceEntry(rawModels[dk], defPricing.models[dk]);
    }
    var extraKeys = Object.keys(rawModels);
    for (var ei = 0; ei < extraKeys.length; ei++) {
      var ek = extraKeys[ei];
      if (!Object.prototype.hasOwnProperty.call(models, ek)) {
        models[ek] = normalizePriceEntry(rawModels[ek], defPricing.neon);
      }
    }

    var timeline = [];
    if (Array.isArray(raw.accountTimeline)) {
      for (var ti = 0; ti < raw.accountTimeline.length; ti++) {
        var tItem = raw.accountTimeline[ti];
        if (!tItem || typeof tItem.ts !== 'number' || !Number.isFinite(tItem.ts)) continue;
        timeline.push({
          ts: tItem.ts,
          email: typeof tItem.email === 'string' ? tItem.email.trim() : '',
          tier: normalizeTierKey(tItem.tier),
          tierName: typeof tItem.tierName === 'string' ? tItem.tierName.trim() : '',
        });
      }
      timeline.sort(function (a, b) { return a.ts - b.ts; });
      if (timeline.length > MAX_TIMELINE) timeline = timeline.slice(timeline.length - MAX_TIMELINE);
    }

    var accounts = {};
    if (raw.accounts && typeof raw.accounts === 'object' && !Array.isArray(raw.accounts)) {
      var aKeys = Object.keys(raw.accounts);
      for (var ai = 0; ai < aKeys.length; ai++) {
        var em = aKeys[ai].trim();
        var acc = raw.accounts[aKeys[ai]];
        if (!em || !acc || typeof acc !== 'object') continue;
        var cp = null;
        if (acc.checkpoint && typeof acc.checkpoint === 'object') {
          var cpTs = toFiniteNum(acc.checkpoint.ts);
          var cpFrac = toFiniteNum(acc.checkpoint.remainingFraction);
          var cpReset = toFiniteNum(acc.checkpoint.resetTimeMs);
          if (cpTs !== null && cpFrac !== null && cpReset !== null) {
            cp = {
              ts: cpTs,
              remainingFraction: Math.max(0, Math.min(1, cpFrac)),
              resetTimeMs: cpReset,
            };
          }
        }
        var cycleAnchor = null;
        if (acc.cycleAnchor && typeof acc.cycleAnchor === 'object') {
          var caReset = toFiniteNum(acc.cycleAnchor.resetTimeMs);
          var caTs = toFiniteNum(acc.cycleAnchor.anchorTs);
          var caFrac = toFiniteNum(acc.cycleAnchor.anchorFrac);
          if (caReset !== null && caTs !== null && caFrac !== null) {
            cycleAnchor = {
              resetTimeMs: caReset,
              anchorTs: caTs,
              anchorFrac: Math.max(0, Math.min(1, caFrac)),
            };
          }
        }
        accounts[em] = {
          tier: normalizeTierKey(acc.tier),
          tierName: typeof acc.tierName === 'string' ? acc.tierName.trim() : '',
          tierLocked: Boolean(acc.tierLocked),
          lastMonthlyEquivUsd: toFiniteNum(acc.lastMonthlyEquivUsd),
          lastWeeklyEquivUsd: toFiniteNum(acc.lastWeeklyEquivUsd),
          lastLaunchId: typeof acc.lastLaunchId === 'string' ? acc.lastLaunchId : '',
          checkpoint: cp,
          cycleAnchor: cycleAnchor,
        };
      }
    }

    var records = [];
    if (Array.isArray(raw.records)) {
      for (var ri = 0; ri < raw.records.length; ri++) {
        var rec = raw.records[ri];
        if (!rec || typeof rec !== 'object') continue;
        var mUsd = toFiniteNum(rec.monthlyEquivUsd);
        var wUsd = toFiniteNum(rec.weeklyEquivUsd);
        var cUsd = toFiniteNum(rec.costUsd);
        var df = toFiniteNum(rec.deltaFrac);
        var ts = toFiniteNum(rec.ts);
        var rEm = typeof rec.email === 'string' ? rec.email.trim() : '';
        if (!rEm || mUsd === null || mUsd <= 0 || ts === null) continue;
        records.push({
          id: typeof rec.id === 'string' && rec.id ? rec.id : (String(ts) + '-' + ri),
          ts: ts,
          at: typeof rec.at === 'string' && rec.at ? rec.at : new Date(ts).toISOString(),
          launchId: typeof rec.launchId === 'string' ? rec.launchId : '',
          email: rEm,
          tier: normalizeTierKey(rec.tier),
          tierName: typeof rec.tierName === 'string' ? rec.tierName.trim() : '',
          windowStartMs: toFiniteNum(rec.windowStartMs) || ts,
          windowEndMs: toFiniteNum(rec.windowEndMs) || ts,
          startFrac: toFiniteNum(rec.startFrac),
          endFrac: toFiniteNum(rec.endFrac),
          deltaFrac: df !== null ? df : 0,
          inputTokens: toNonNegInt(rec.inputTokens),
          cacheReadTokens: toNonNegInt(rec.cacheReadTokens),
          outputTokens: toNonNegInt(rec.outputTokens),
          steps: toNonNegInt(rec.steps),
          costUsd: cUsd !== null ? cUsd : 0,
          weeklyEquivUsd: wUsd !== null ? wUsd : Math.round((mUsd / MONTH_RATIO) * 100) / 100,
          monthlyEquivUsd: mUsd,
          pricingMode: typeof rec.pricingMode === 'string' ? rec.pricingMode : mode,
          neonInputPerMillion: toFiniteNum(rec.neonInputPerMillion) || neon.inputPerMillion,
          neonCachePerMillion: toFiniteNum(rec.neonCachePerMillion) !== null ? toFiniteNum(rec.neonCachePerMillion) : neon.cacheReadPerMillion,
          neonOutputPerMillion: toFiniteNum(rec.neonOutputPerMillion) || neon.outputPerMillion,
        });
      }
      records.sort(function (a, b) { return b.ts - a.ts; });
      if (records.length > MAX_RECORDS) records = records.slice(0, MAX_RECORDS);
    }

    return {
      version: 1,
      pricing: {
        mode: mode,
        neon: neon,
        models: models,
      },
      currentEmail: typeof raw.currentEmail === 'string' ? raw.currentEmail.trim() : '',
      accountTimeline: timeline,
      accounts: accounts,
      records: records,
    };
  }

  function computeTierSummary(data, activeEmailOverride, storeFilePath) {
    var d = data || emptyStoreData();
    var activeEmail = typeof activeEmailOverride === 'string' && activeEmailOverride.trim()
      ? activeEmailOverride.trim()
      : (d.currentEmail || '');

    if (!activeEmail && Array.isArray(d.accountTimeline)) {
      for (var ti = d.accountTimeline.length - 1; ti >= 0; ti--) {
        if (d.accountTimeline[ti] && d.accountTimeline[ti].email) {
          activeEmail = d.accountTimeline[ti].email;
          break;
        }
      }
    }

    var activeAcc = activeEmail && d.accounts ? d.accounts[activeEmail] : null;
    var activeTier = activeAcc ? normalizeTierKey(activeAcc.tier) : 'unknown';
    var activeTierLabel = (activeAcc && activeAcc.tierName)
      ? activeAcc.tierName
      : (TIER_LABELS[activeTier] || '未知档位');

    // 严格同档位过滤：Ultra 与 Pro 绝不混合；若档位尚未知则仅展示当前账号自身记录
    var matched = [];
    for (var i = 0; i < d.records.length; i++) {
      var r = d.records[i];
      if (!r || !(r.monthlyEquivUsd > 0)) continue;
      if (activeTier === 'unknown') {
        if (activeEmail && r.email === activeEmail) matched.push(r);
      } else if (r.tier === activeTier) {
        matched.push(r);
      }
    }

    var byEmail = {};
    var emailOrder = [];
    for (var j = 0; j < matched.length; j++) {
      var rec = matched[j];
      if (!Object.prototype.hasOwnProperty.call(byEmail, rec.email)) {
        byEmail[rec.email] = { sum: 0, count: 0, latestTs: 0 };
        emailOrder.push(rec.email);
      }
      byEmail[rec.email].sum += rec.monthlyEquivUsd;
      byEmail[rec.email].count += 1;
      if (rec.ts > byEmail[rec.email].latestTs) byEmail[rec.email].latestTs = rec.ts;
    }

    var breakdown = [];
    var emailMeanSum = 0;
    for (var k = 0; k < emailOrder.length; k++) {
      var em = emailOrder[k];
      var grp = byEmail[em];
      var meanVal = grp.sum / grp.count;
      emailMeanSum += meanVal;
      breakdown.push({
        email: em,
        avgMonthlyUsd: Math.round(meanVal * 100) / 100,
        sampleCount: grp.count,
        latestTs: grp.latestTs,
      });
    }

    var avgMonthlyUsd = breakdown.length > 0
      ? Math.round((emailMeanSum / breakdown.length) * 100) / 100
      : null;

    return {
      activeEmail: activeEmail,
      activeTier: activeTier,
      activeTierLabel: activeTierLabel,
      avgMonthlyUsd: avgMonthlyUsd,
      accountBreakdown: breakdown,
      totalMatchedSamples: matched.length,
      totalRecords: d.records.length,
      maxRecords: MAX_RECORDS,
      neonPricing: d.pricing && d.pricing.neon ? d.pricing.neon : cloneDefaultPricing().neon,
      storeFile: storeFilePath || '',
    };
  }

  function defaultLaunchId() {
    if (crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'launch-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  }

  function createEquivCostStore(opts) {
    var options = opts && typeof opts === 'object' ? opts : {};
    var storeFile = typeof options.storeFile === 'string' ? options.storeFile : STORE_FILE;
    var brainDir = options.brainDir || defaultBrainDir();
    var launchId = typeof options.launchId === 'string' && options.launchId ? options.launchId : defaultLaunchId();
    var nowFn = typeof options.nowFn === 'function' ? options.nowFn : function () { return Date.now(); };

    var calculatedEmailsInLaunch = new Set();
    var pendingQuota = null;
    var lastSelfWriteMtime = 0;

    function readData() {
      if (!storeFile) return emptyStoreData();
      try {
        if (!fs.existsSync(storeFile)) return emptyStoreData();
        var raw = fs.readFileSync(storeFile, 'utf8');
        if (!raw || !raw.trim()) return emptyStoreData();
        return normalizeStoreData(JSON.parse(raw));
      } catch (_) {
        return emptyStoreData();
      }
    }

    function writeData(data) {
      if (!storeFile) return;
      var dir = path.dirname(storeFile);
      var text = JSON.stringify(data, null, 2) + '\n';
      var tmp = storeFile + '.' + process.pid + '.tmp';
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(tmp, text, 'utf8');
        try {
          fs.renameSync(tmp, storeFile);
        } catch (_) {
          fs.writeFileSync(storeFile, text, 'utf8');
          try { fs.unlinkSync(tmp); } catch (_2) {}
        }
        try {
          lastSelfWriteMtime = fs.statSync(storeFile).mtimeMs;
        } catch (_3) {}
      } catch (_) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_4) {}
      }
    }

    function ensureAccount(data, email) {
      if (!data.accounts[email]) {
        data.accounts[email] = {
          tier: 'unknown',
          tierName: '',
          tierLocked: false,
          lastMonthlyEquivUsd: null,
          lastWeeklyEquivUsd: null,
          lastLaunchId: '',
          checkpoint: null,
          cycleAnchor: null,
        };
      }
      return data.accounts[email];
    }

    function appendTimeline(data, tsMs, email, tier, tierName) {
      var list = data.accountTimeline;
      var last = list.length ? list[list.length - 1] : null;
      if (last && last.email === email) {
        if (email && tier !== 'unknown' && last.tier === 'unknown') {
          last.tier = tier;
          last.tierName = tierName || last.tierName;
          return true;
        }
        return false;
      }
      var safeTs = last && tsMs <= last.ts ? last.ts + 1 : tsMs;
      list.push({
        ts: safeTs,
        email: email,
        tier: tier || 'unknown',
        tierName: tierName || '',
      });
      if (list.length > MAX_TIMELINE) {
        data.accountTimeline = list.slice(list.length - MAX_TIMELINE);
      }
      return true;
    }

    function getState() {
      var data = readData();
      return computeTierSummary(data, data.currentEmail, storeFile);
    }

    function reportUser(payload) {
      var p = payload && typeof payload === 'object' ? payload : {};
      var email = typeof p.email === 'string' ? p.email.trim() : '';
      var ts = toFiniteNum(p.ts) || nowFn();
      var tier = normalizeTierKey(p.tier);
      var tierName = typeof p.tierName === 'string' ? p.tierName.trim() : '';

      if (!email) {
        return reportSignOut({ ts: ts });
      }

      var data = readData();
      var changed = false;
      if (data.currentEmail !== email) {
        data.currentEmail = email;
        changed = true;
      }

      var acc = ensureAccount(data, email);
      if (!acc.tierLocked && tier !== 'unknown') {
        if (acc.tier !== tier || (tierName && acc.tierName !== tierName)) {
          acc.tier = tier;
          acc.tierName = tierName || TIER_LABELS[tier] || '';
          changed = true;
        }
        // 回填此前该邮箱未知档位的历史记录，便于归入正确的档位统计
        for (var ri = 0; ri < data.records.length; ri++) {
          if (data.records[ri].email === email && data.records[ri].tier === 'unknown') {
            data.records[ri].tier = tier;
            data.records[ri].tierName = acc.tierName;
            changed = true;
          }
        }
      } else if (!acc.tierLocked && tierName && !acc.tierName) {
        acc.tierName = tierName;
        changed = true;
      }

      if (appendTimeline(data, ts, email, acc.tier, acc.tierName)) {
        changed = true;
      }

      if (changed) writeData(data);

      if (pendingQuota && (nowFn() - pendingQuota.receivedAt <= PENDING_QUOTA_TTL_MS)) {
        var q = pendingQuota;
        pendingQuota = null;
        return reportQuota({
          email: email,
          remainingFraction: q.remainingFraction,
          resetTimeMs: q.resetTimeMs,
          bucketId: q.bucketId,
          disabled: q.disabled,
          ts: q.ts,
        });
      }

      return computeTierSummary(data, email, storeFile);
    }

    function reportSignOut(payload) {
      var p = payload && typeof payload === 'object' ? payload : {};
      var ts = toFiniteNum(p.ts) || nowFn();
      pendingQuota = null;
      var data = readData();
      var changed = false;
      if (data.currentEmail) {
        data.currentEmail = '';
        changed = true;
      }
      if (appendTimeline(data, ts, '', 'unknown', '')) {
        changed = true;
      }
      if (changed) writeData(data);
      return computeTierSummary(data, '', storeFile);
    }

    function reportPricing(list) {
      if (!Array.isArray(list) || !list.length) return getState();
      var data = readData();
      var changed = false;
      var nowIso = new Date(nowFn()).toISOString();

      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        if (!item || typeof item !== 'object') continue;
        var modelName = typeof item.modelName === 'string' ? item.modelName.trim() : '';
        var inp = toFiniteNum(item.inputPricePerMillionTokens);
        var out = toFiniteNum(item.outputPricePerMillionTokens);
        var cache = toFiniteNum(item.cacheReadPricePerMillionTokens);
        if (inp === null || inp <= 0 || out === null || out <= 0) continue;
        var safeCache = cache !== null && cache >= 0 ? cache : Math.round(inp * 0.1 * 1e4) / 1e4;
        var src = item.isEstimated ? 'live-estimated' : 'live';
        var familyKey = matchModelFamilyKey(modelName);

        if (familyKey === 'gemini-4-neon' && !data.pricing.neon.locked) {
          if (
            data.pricing.neon.inputPerMillion !== inp
            || data.pricing.neon.cacheReadPerMillion !== safeCache
            || data.pricing.neon.outputPerMillion !== out
            || data.pricing.neon.source !== src
          ) {
            data.pricing.neon.inputPerMillion = inp;
            data.pricing.neon.cacheReadPerMillion = safeCache;
            data.pricing.neon.outputPerMillion = out;
            data.pricing.neon.source = src;
            data.pricing.neon.updatedAt = nowIso;
            changed = true;
          }
        }
        if (familyKey && data.pricing.models[familyKey] && !data.pricing.models[familyKey].locked) {
          var target = data.pricing.models[familyKey];
          if (
            target.inputPerMillion !== inp
            || target.cacheReadPerMillion !== safeCache
            || target.outputPerMillion !== out
            || target.source !== src
          ) {
            target.inputPerMillion = inp;
            target.cacheReadPerMillion = safeCache;
            target.outputPerMillion = out;
            target.source = src;
            target.updatedAt = nowIso;
            changed = true;
          }
        }
      }

      if (changed) writeData(data);
      return computeTierSummary(data, data.currentEmail, storeFile);
    }

    function pushCalculationRecord(data, acc, email, startMs, endMs, startFrac, endFrac, deltaFrac, usage) {
      var weeklyEquivUsd = usage.costUsd / deltaFrac;
      var monthlyEquivUsd = weeklyEquivUsd * MONTH_RATIO;
      if (!Number.isFinite(monthlyEquivUsd) || monthlyEquivUsd <= 0 || monthlyEquivUsd > MAX_MONTHLY_USD) {
        return false;
      }
      var roundedMonthly = Math.round(monthlyEquivUsd * 100) / 100;
      var roundedWeekly = Math.round(weeklyEquivUsd * 100) / 100;
      var neon = data.pricing.neon;
      var rec = {
        id: launchId + ':' + email + ':' + endMs,
        ts: endMs,
        at: new Date(endMs).toISOString(),
        launchId: launchId,
        email: email,
        tier: acc.tier,
        tierName: acc.tierName || TIER_LABELS[acc.tier] || '',
        windowStartMs: startMs,
        windowEndMs: endMs,
        startFrac: startFrac,
        endFrac: endFrac,
        deltaFrac: Math.round(deltaFrac * 1e8) / 1e8,
        inputTokens: usage.input,
        cacheReadTokens: usage.cacheRead,
        outputTokens: usage.output,
        steps: usage.steps,
        costUsd: Math.round(usage.costUsd * 1e4) / 1e4,
        weeklyEquivUsd: roundedWeekly,
        monthlyEquivUsd: roundedMonthly,
        pricingMode: data.pricing.mode,
        neonInputPerMillion: neon.inputPerMillion,
        neonCachePerMillion: neon.cacheReadPerMillion,
        neonOutputPerMillion: neon.outputPerMillion,
      };
      data.records.unshift(rec);
      if (data.records.length > MAX_RECORDS) {
        data.records = data.records.slice(0, MAX_RECORDS);
      }
      acc.lastMonthlyEquivUsd = roundedMonthly;
      acc.lastWeeklyEquivUsd = roundedWeekly;
      acc.lastLaunchId = launchId;
      return true;
    }

    function reportQuota(payload) {
      var p = payload && typeof payload === 'object' ? payload : {};
      var frac = toFiniteNum(p.remainingFraction);
      var resetTimeMs = toFiniteNum(p.resetTimeMs);
      var ts = toFiniteNum(p.ts) || nowFn();
      var disabled = Boolean(p.disabled);
      if (disabled || frac === null || resetTimeMs === null) {
        return getState();
      }
      frac = Math.max(0, Math.min(1, frac));

      var data = readData();
      var email = (typeof p.email === 'string' && p.email.trim()) ? p.email.trim() : data.currentEmail;
      if (!email) {
        pendingQuota = {
          remainingFraction: frac,
          resetTimeMs: resetTimeMs,
          bucketId: typeof p.bucketId === 'string' ? p.bucketId : '',
          disabled: disabled,
          ts: ts,
          receivedAt: nowFn(),
        };
        return computeTierSummary(data, '', storeFile);
      }

      // 每打开 Antigravity 一次，每个邮箱最多执行 1 次计算
      if (calculatedEmailsInLaunch.has(email)) {
        return computeTierSummary(data, data.currentEmail || email, storeFile);
      }
      calculatedEmailsInLaunch.add(email);

      var acc = ensureAccount(data, email);
      var changed = false;
      var cycleStartMs = resetTimeMs - WEEK_MS;
      var preOwner = resolvePreTimelineOwner(data, cycleStartMs, storeFile);

      var ca = acc.cycleAnchor;
      var needInitAnchor = !ca
        || Math.abs(resetTimeMs - ca.resetTimeMs) > RESET_TOLERANCE_MS
        || frac > ca.anchorFrac + 0.02;

      if (needInitAnchor) {
        var fullCycleUsage = scanAttributedGeminiCost({
          brainDir: brainDir,
          accountTimeline: data.accountTimeline,
          targetEmail: email,
          preTimelineFallbackEmail: preOwner,
          startMs: cycleStartMs,
          endMs: ts,
          pricingConfig: data.pricing,
        });
        // 若当前周期接近满额（且当前时间距离周期起点未超过 7 天，避免 resetMs 异常偏远时漏掉），或本机已有本周期对应 Token 消耗，则锚定本周期起点 (cycleStartMs, 1.0)；
        // 否则（跨设备已用过一部分且本机无早期流水）从当前 (ts, frac) 起算避免失真
        if (frac >= 0.995 || ((1 - frac) >= MIN_DELTA_FRAC && fullCycleUsage.costUsd >= MIN_COST_USD)) {
          ca = { resetTimeMs: resetTimeMs, anchorTs: Math.min(cycleStartMs, ts), anchorFrac: 1.0 };
        } else {
          ca = { resetTimeMs: resetTimeMs, anchorTs: ts, anchorFrac: frac };
        }
        acc.cycleAnchor = ca;
        changed = true;
      } else if (ca.resetTimeMs !== resetTimeMs) {
        ca.resetTimeMs = resetTimeMs;
        if (ca.anchorFrac === 1.0) ca.anchorTs = Math.min(cycleStartMs, ts);
        changed = true;
      }

      var deltaFrac = ca.anchorFrac - frac;
      if (deltaFrac >= MIN_DELTA_FRAC) {
        var anchorPreOwner = resolvePreTimelineOwner(data, ca.anchorTs, storeFile);
        var usage = scanAttributedGeminiCost({
          brainDir: brainDir,
          accountTimeline: data.accountTimeline,
          targetEmail: email,
          preTimelineFallbackEmail: anchorPreOwner,
          startMs: ca.anchorTs,
          endMs: ts,
          pricingConfig: data.pricing,
        });
        if (usage.costUsd >= MIN_COST_USD) {
          if (pushCalculationRecord(data, acc, email, ca.anchorTs, ts, ca.anchorFrac, frac, deltaFrac, usage)) {
            changed = true;
          }
        }
      }

      if (!acc.checkpoint || acc.checkpoint.ts !== ts || acc.checkpoint.remainingFraction !== frac || acc.checkpoint.resetTimeMs !== resetTimeMs) {
        acc.checkpoint = { ts: ts, remainingFraction: frac, resetTimeMs: resetTimeMs };
        changed = true;
      }

      if (changed) writeData(data);
      return computeTierSummary(data, data.currentEmail || email, storeFile);
    }

    function getLastSelfWriteMtime() {
      return lastSelfWriteMtime;
    }

    return {
      launchId: launchId,
      storeFile: storeFile,
      brainDir: brainDir,
      getState: getState,
      reportUser: reportUser,
      reportSignOut: reportSignOut,
      reportQuota: reportQuota,
      reportPricing: reportPricing,
      getLastSelfWriteMtime: getLastSelfWriteMtime,
    };
  }

  var api = {
    CH_GET_SYNC: CH_GET_SYNC,
    CH_REPORT_USER: CH_REPORT_USER,
    CH_REPORT_SIGNOUT: CH_REPORT_SIGNOUT,
    CH_REPORT_QUOTA: CH_REPORT_QUOTA,
    CH_REPORT_PRICING: CH_REPORT_PRICING,
    CH_UPDATED: CH_UPDATED,
    MAX_RECORDS: MAX_RECORDS,
    WEEK_MS: WEEK_MS,
    MONTH_RATIO: MONTH_RATIO,
    MIN_DELTA_FRAC: MIN_DELTA_FRAC,
    MIN_COST_USD: MIN_COST_USD,
    defaultBrainDir: defaultBrainDir,
    cloneDefaultPricing: cloneDefaultPricing,
    classifyAccountTier: classifyAccountTier,
    isGeminiQuotaModel: isGeminiQuotaModel,
    resolveModelPricing: resolveModelPricing,
    attributeEmailAt: attributeEmailAt,
    scanAttributedGeminiCost: scanAttributedGeminiCost,
    computeTierSummary: computeTierSummary,
    createEquivCostStore: createEquivCostStore,
  };

  Object.defineProperty(globalThis, '__AGY_PERIODIC_MODEL_MAIN_API__', {
    value: api,
    configurable: true,
  });

  var ipcMain = electron && electron.ipcMain;
  var BrowserWindow = electron && electron.BrowserWindow;
  if (!ipcMain) {
    if (
      typeof module === 'object'
      && module
      && module.exports
      && typeof module.exports === 'object'
      && Object.keys(module.exports).length === 0
    ) {
      module.exports = api;
    }
    return;
  }

  var store = createEquivCostStore();

  function broadcastState(state) {
    try {
      var utils = null;
      try { utils = require('./utils'); } catch (_) {}
      if (utils && typeof utils.getHubWindows === 'function' && typeof utils.getHubWebContents === 'function') {
        var wins = utils.getHubWindows();
        for (var i = 0; i < wins.length; i++) {
          var wc = utils.getHubWebContents(wins[i]);
          if (wc && (!wc.isDestroyed || !wc.isDestroyed())) {
            wc.send(CH_UPDATED, state);
          }
        }
        return;
      }
      if (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function') {
        var all = BrowserWindow.getAllWindows();
        for (var j = 0; j < all.length; j++) {
          var w = all[j];
          if (w && w.webContents && (!w.webContents.isDestroyed || !w.webContents.isDestroyed())) {
            w.webContents.send(CH_UPDATED, state);
          }
        }
      }
    } catch (_) {}
  }

  if (typeof ipcMain.removeAllListeners === 'function') {
    ipcMain.removeAllListeners(CH_GET_SYNC);
  }
  ipcMain.on(CH_GET_SYNC, function (event) {
    event.returnValue = store.getState();
  });

  if (typeof ipcMain.removeHandler === 'function') {
    ipcMain.removeHandler(CH_REPORT_USER);
    ipcMain.removeHandler(CH_REPORT_SIGNOUT);
    ipcMain.removeHandler(CH_REPORT_QUOTA);
    ipcMain.removeHandler(CH_REPORT_PRICING);
  }

  ipcMain.handle(CH_REPORT_USER, async function (_event, payload) {
    var next = store.reportUser(payload);
    broadcastState(next);
    return next;
  });

  ipcMain.handle(CH_REPORT_SIGNOUT, async function (_event, payload) {
    var next = store.reportSignOut(payload);
    broadcastState(next);
    return next;
  });

  ipcMain.handle(CH_REPORT_QUOTA, async function (_event, payload) {
    var next = store.reportQuota(payload);
    broadcastState(next);
    return next;
  });

  ipcMain.handle(CH_REPORT_PRICING, async function (_event, payload) {
    var next = store.reportPricing(payload);
    broadcastState(next);
    return next;
  });

  if (STORE_FILE) {
    try {
      fs.watchFile(STORE_FILE, { persistent: false, interval: 2000 }, function (curr, prev) {
        if (curr.mtimeMs === prev.mtimeMs) return;
        var selfMtime = store.getLastSelfWriteMtime();
        if (selfMtime && Math.abs(curr.mtimeMs - selfMtime) < 50) return;
        broadcastState(store.getState());
      });
    } catch (_) {}
  }
})();
