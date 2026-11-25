// Antigravity Gemini 4 元素周期表模型选择器模块（运行在 dist/preload.js 沙箱）
// 原地替换原生 [data-testid="model-selector-panel"] 下拉面板（不另弹新模态窗）：
// 1. 保留原生 Popover 定位、毛玻璃外壳、外部点击/Esc 关闭及底部「查看用量」；
// 2. 复刻 Google AI Studio「THE PERIODIC TABLE OF Gemini 4」18×6 周期表，自动点亮可用元素，未支持元素严格禁选；
// 3. 在同一面板内通过顶部分类胶囊（二级菜单）与搜索框完整兼顾所有非表内模型与推理档位；
// 4. 随时可一键切回原版列表，Best of N 多选模式自动透传原版。
(function () {
  'use strict';

  var g = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
  if (!g || !g.document || g.__AGY_PERIODIC_MODEL_BOOTED__) return;
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

  Object.defineProperty(g, '__AGY_PERIODIC_MODEL_BOOTED__', { value: true });

  var EQUIV_UP_KEY = '__agy_pm_equiv_up_v1__';
  var EQUIV_DOWN_KEY = '__agy_pm_equiv_down_v1__';

  // 注入到 Main World 的原地周期表选择器（自包含，不依赖外层闭包）
  function installPeriodicModelSelector(equivUpKey, equivDownKey) {
    var w = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
    if (!w || !w.document || w.__AGY_PERIODIC_MODEL_MAIN_BOOTED__) return;
    Object.defineProperty(w, '__AGY_PERIODIC_MODEL_MAIN_BOOTED__', { value: true });

    var UP_KEY = equivUpKey || '__agy_pm_equiv_up_v1__';
    var DOWN_KEY = equivDownKey || '__agy_pm_equiv_down_v1__';

    var STYLE_ID = 'agy-periodic-model-style';
    var INLINE_ATTR = 'data-agy-pm-inline';
    var HIDDEN_ATTR = 'data-agy-pm-hidden';
    var POPOVER_ATTR = 'data-agy-pm-popover';
    var NATIVE_BAR_ATTR = 'data-agy-pm-native-bar';
    var EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
    var EFFORT_LABELS = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' };
    var EFFORT_RE = /^(.*?)\s*\((low|medium|high|xhigh|max)(?:\s+thinking)?\)\s*$/i;
    var GEMINI4_RE = /^Gemini\s+4(?:\.\d+)?\s+([A-Za-z]+)(?:\b.*)?$/i;
    var ORCH_RE = /^Orchestrator\s*\(([A-Za-z]+)\)\s*$/i;

    // 标准化学元素周期表前 6 周期（1~86 号，含 57-71 镧系占位）
    var ELEMENTS = [
      // Row 1
      [1, 'H', 'Hydrogen', '氢', 1, 1, 'nonmetal'],
      [2, 'He', 'Helium', '氦', 1, 18, 'noble'],
      // Row 2
      [3, 'Li', 'Lithium', '锂', 2, 1, 'alkali'],
      [4, 'Be', 'Beryllium', '铍', 2, 2, 'alkaline'],
      [5, 'B', 'Boron', '硼', 2, 13, 'metalloid'],
      [6, 'C', 'Carbon', '碳', 2, 14, 'nonmetal'],
      [7, 'N', 'Nitrogen', '氮', 2, 15, 'nonmetal'],
      [8, 'O', 'Oxygen', '氧', 2, 16, 'nonmetal'],
      [9, 'F', 'Fluorine', '氟', 2, 17, 'halogen'],
      [10, 'Ne', 'Neon', '氖', 2, 18, 'noble'],
      // Row 3
      [11, 'Na', 'Sodium', '钠', 3, 1, 'alkali'],
      [12, 'Mg', 'Magnesium', '镁', 3, 2, 'alkaline'],
      [13, 'Al', 'Aluminum', '铝', 3, 13, 'post'],
      [14, 'Si', 'Silicon', '硅', 3, 14, 'metalloid'],
      [15, 'P', 'Phosphorus', '磷', 3, 15, 'nonmetal'],
      [16, 'S', 'Sulfur', '硫', 3, 16, 'nonmetal'],
      [17, 'Cl', 'Chlorine', '氯', 3, 17, 'halogen'],
      [18, 'Ar', 'Argon', '氩', 3, 18, 'noble'],
      // Row 4
      [19, 'K', 'Potassium', '钾', 4, 1, 'alkali'],
      [20, 'Ca', 'Calcium', '钙', 4, 2, 'alkaline'],
      [21, 'Sc', 'Scandium', '钪', 4, 3, 'transition'],
      [22, 'Ti', 'Titanium', '钛', 4, 4, 'transition'],
      [23, 'V', 'Vanadium', '钒', 4, 5, 'transition'],
      [24, 'Cr', 'Chromium', '铬', 4, 6, 'transition'],
      [25, 'Mn', 'Manganese', '锰', 4, 7, 'transition'],
      [26, 'Fe', 'Iron', '铁', 4, 8, 'transition'],
      [27, 'Co', 'Cobalt', '钴', 4, 9, 'transition'],
      [28, 'Ni', 'Nickel', '镍', 4, 10, 'transition'],
      [29, 'Cu', 'Copper', '铜', 4, 11, 'transition'],
      [30, 'Zn', 'Zinc', '锌', 4, 12, 'transition'],
      [31, 'Ga', 'Gallium', '镓', 4, 13, 'post'],
      [32, 'Ge', 'Germanium', '锗', 4, 14, 'metalloid'],
      [33, 'As', 'Arsenic', '砷', 4, 15, 'metalloid'],
      [34, 'Se', 'Selenium', '硒', 4, 16, 'nonmetal'],
      [35, 'Br', 'Bromine', '溴', 4, 17, 'halogen'],
      [36, 'Kr', 'Krypton', '氪', 4, 18, 'noble'],
      // Row 5
      [37, 'Rb', 'Rubidium', '铷', 5, 1, 'alkali'],
      [38, 'Sr', 'Strontium', '锶', 5, 2, 'alkaline'],
      [39, 'Y', 'Yttrium', '钇', 5, 3, 'transition'],
      [40, 'Zr', 'Zirconium', '锆', 5, 4, 'transition'],
      [41, 'Nb', 'Niobium', '铌', 5, 5, 'transition'],
      [42, 'Mo', 'Molybdenum', '钼', 5, 6, 'transition'],
      [43, 'Tc', 'Technetium', '锝', 5, 7, 'transition'],
      [44, 'Ru', 'Ruthenium', '钌', 5, 8, 'transition'],
      [45, 'Rh', 'Rhodium', '铑', 5, 9, 'transition'],
      [46, 'Pd', 'Palladium', '钯', 5, 10, 'transition'],
      [47, 'Ag', 'Silver', '银', 5, 11, 'transition'],
      [48, 'Cd', 'Cadmium', '镉', 5, 12, 'transition'],
      [49, 'In', 'Indium', '铟', 5, 13, 'post'],
      [50, 'Sn', 'Tin', '锡', 5, 14, 'post'],
      [51, 'Sb', 'Antimony', '锑', 5, 15, 'metalloid'],
      [52, 'Te', 'Tellurium', '碲', 5, 16, 'metalloid'],
      [53, 'I', 'Iodine', '碘', 5, 17, 'halogen'],
      [54, 'Xe', 'Xenon', '氙', 5, 18, 'noble'],
      // Row 6
      [55, 'Cs', 'Cesium', '铯', 6, 1, 'alkali'],
      [56, 'Ba', 'Barium', '钡', 6, 2, 'alkaline'],
      ['57-71', '57-71', 'Lanthanides', '镧系元素', 6, 3, 'placeholder'],
      [72, 'Hf', 'Hafnium', '铪', 6, 4, 'transition'],
      [73, 'Ta', 'Tantalum', '钽', 6, 5, 'transition'],
      [74, 'W', 'Tungsten', '钨', 6, 6, 'transition'],
      [75, 'Re', 'Rhenium', '铼', 6, 7, 'transition'],
      [76, 'Os', 'Osmium', '锇', 6, 8, 'transition'],
      [77, 'Ir', 'Iridium', '铱', 6, 9, 'transition'],
      [78, 'Pt', 'Platinum', '铂', 6, 10, 'transition'],
      [79, 'Au', 'Gold', '金', 6, 11, 'transition'],
      [80, 'Hg', 'Mercury', '汞', 6, 12, 'transition'],
      [81, 'Tl', 'Thallium', '铊', 6, 13, 'post'],
      [82, 'Pb', 'Lead', '铅', 6, 14, 'post'],
      [83, 'Bi', 'Bismuth', '铋', 6, 15, 'post'],
      [84, 'Po', 'Polonium', '钋', 6, 16, 'metalloid'],
      [85, 'At', 'Astatine', '砹', 6, 17, 'halogen'],
      [86, 'Rn', 'Radon', '氡', 6, 18, 'noble'],
    ];

    var ELEMENT_BY_NAME = {};
    var ELEMENT_BY_SYMBOL = {};
    for (var ei = 0; ei < ELEMENTS.length; ei++) {
      var row = ELEMENTS[ei];
      if (row[6] === 'placeholder') continue;
      var item = {
        number: row[0],
        symbol: row[1],
        name: row[2],
        zhName: row[3],
        row: row[4],
        col: row[5],
        family: row[6],
      };
      ELEMENT_BY_NAME[item.name.toLowerCase()] = item;
      ELEMENT_BY_SYMBOL[item.symbol.toLowerCase()] = item;
    }
    ELEMENT_BY_NAME.aluminium = ELEMENT_BY_NAME.aluminum;
    ELEMENT_BY_NAME.caesium = ELEMENT_BY_NAME.cesium;
    ELEMENT_BY_NAME.sulphur = ELEMENT_BY_NAME.sulfur;

    var ELEMENT_TONE_BY_SYMBOL = {
      H: 'tone-h',
      C: 'tone-c',
      Ne: 'tone-ne',
      Ar: 'tone-ar',
    };

    var FAMILY_TONE = {
      nonmetal: 'tone-blue',
      noble: 'tone-green',
      alkali: 'tone-amber',
      alkaline: 'tone-orange',
      metalloid: 'tone-purple',
      halogen: 'tone-cyan',
      post: 'tone-indigo',
      transition: 'tone-rose',
    };

    function getToneClass(symbol, family) {
      return ELEMENT_TONE_BY_SYMBOL[symbol] || FAMILY_TONE[family] || 'tone-blue';
    }

    function parseModelLabel(label, isCustom) {
      var raw = typeof label === 'string' ? label.trim() : '';
      if (!raw) return { base: '', effort: null };
      if (!isCustom) {
        var m = EFFORT_RE.exec(raw);
        if (m) return { base: m[1].trim(), effort: m[2].toLowerCase() };
      }
      return { base: raw, effort: null };
    }

    function matchGemini4Element(baseName) {
      if (!baseName) return null;
      var m = GEMINI4_RE.exec(baseName.trim());
      if (!m) return null;
      var key = m[1].toLowerCase();
      return ELEMENT_BY_NAME[key] || ELEMENT_BY_SYMBOL[key] || null;
    }

    function matchOrchestratorElement(baseName) {
      if (!baseName) return null;
      var m = ORCH_RE.exec(baseName.trim());
      if (!m) return null;
      var key = m[1].toLowerCase();
      return ELEMENT_BY_NAME[key] || ELEMENT_BY_SYMBOL[key] || null;
    }

    function classifyOtherCategory(baseName, isCustom) {
      if (isCustom) return { id: 'custom', label: 'Custom' };
      var lower = (baseName || '').toLowerCase();
      if (lower.indexOf('orchestrator') === 0) return { id: 'orchestrator', label: 'Orchestrator' };
      if (/^gemini\s*[23]\b/i.test(baseName) || /^gemini\b/i.test(baseName)) return { id: 'gemini-legacy', label: 'Gemini' };
      if (lower.indexOf('claude') !== -1) return { id: 'claude', label: 'Claude' };
      if (lower.indexOf('gpt') !== -1 || lower.indexOf('openai') !== -1) return { id: 'gpt', label: 'GPT' };
      return { id: 'misc', label: 'Other' };
    }

    function readBucketFraction(b) {
      if (!b || typeof b !== 'object') return null;
      var frac = null;
      if (typeof b.remainingFraction === 'number' && Number.isFinite(b.remainingFraction)) {
        frac = b.remainingFraction;
      } else if (b.remaining && b.remaining.case === 'remainingFraction' && typeof b.remaining.value === 'number' && Number.isFinite(b.remaining.value)) {
        frac = b.remaining.value;
      }
      if (frac === null) return null;
      return Math.max(0, Math.min(1, frac));
    }

    function readResetMs(rt) {
      if (!rt) return null;
      if (typeof rt === 'string') {
        var p = Date.parse(rt);
        return Number.isFinite(p) ? p : null;
      }
      if (typeof rt === 'object' && rt.seconds !== undefined && rt.seconds !== null) {
        var sec = Number(rt.seconds);
        var nanos = Number(rt.nanos || 0);
        if (Number.isFinite(sec)) return sec * 1000 + Math.round(nanos / 1e6);
      }
      return null;
    }

    function formatResetCountdown(resetMs) {
      if (typeof resetMs !== 'number' || !Number.isFinite(resetMs)) return '';
      var diff = resetMs - Date.now();
      if (diff <= 0) return '即将重置';
      var mins = Math.floor(diff / 60000);
      var days = Math.floor(mins / 1440);
      var hours = Math.floor((mins % 1440) / 60);
      var remMins = mins % 60;
      if (days > 0) return (hours > 0 ? (days + '天 ' + hours + '小时') : (days + '天')) + '后重置';
      if (hours > 0) return (remMins > 0 ? (hours + '小时 ' + remMins + '分') : (hours + '小时')) + '后重置';
      return (remMins > 0 ? (remMins + '分钟') : '不足 1 分钟') + '后重置';
    }

    // 旁路只读采集各模型分组额度：周额度用于模型标签，全部分组桶用于顶部 4 饼图概览
    var weeklyQuotaStore = {
      byModelBase: {}, // lower(modelBase) -> { percent, resetTimeMs, description, groupName }
      byFamily: {},    // 'gemini' | '3p' -> { percent, resetTimeMs, description, groupName }
      allBuckets: [],  // 全部可用窗口额度，用于顶部 4 饼图展示
      geminiWeeklyRaw: null, // { remainingFraction, resetTimeMs, bucketId, disabled, ts }
      version: 0,
    };

    var equivCostStore = {
      raw: '',
      state: null,
      version: 0,
    };

    function readEquivCostFromBridge() {
      try {
        if (!w.sessionStorage) return;
        var raw = w.sessionStorage.getItem(DOWN_KEY);
        if (!raw) return;
        if (equivCostStore.raw === raw) return;
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          equivCostStore.raw = raw;
          equivCostStore.state = parsed;
          equivCostStore.version += 1;
        }
      } catch (_) {}
    }

    var equivUpState = {
      userSeq: 0,
      user: null,
      signOutSeq: 0,
      signOutAt: 0,
      quotaSeq: 0,
      quota: null,
      pricingSeq: 0,
      pricing: [],
    };
    var seenPricingKeys = {};

    function publishEquivUp() {
      try {
        if (w.sessionStorage) {
          w.sessionStorage.setItem(UP_KEY, JSON.stringify(equivUpState));
        }
        w.dispatchEvent(new w.Event(UP_KEY));
      } catch (_) {}
    }

    function classifyTierFromUserStatus(us) {
      if (!us || typeof us !== 'object') return { tier: 'unknown', tierName: '' };
      var parts = [];
      var rawName = '';
      var ut = us.userTier;
      if (ut && typeof ut === 'object') {
        if (typeof ut.id === 'string' && ut.id.trim()) parts.push(ut.id.trim());
        if (typeof ut.name === 'string' && ut.name.trim()) {
          parts.push(ut.name.trim());
          rawName = ut.name.trim();
        }
        if (typeof ut.description === 'string' && ut.description.trim()) parts.push(ut.description.trim());
      }
      if (typeof us.g1Tier === 'string' && us.g1Tier.trim()) {
        parts.push(us.g1Tier.trim());
        if (!rawName) rawName = us.g1Tier.trim();
      }
      var psPlan = us.planStatus && us.planStatus.planInfo;
      var pi = us.planInfo || psPlan;
      if (pi && typeof pi === 'object') {
        if (typeof pi.planName === 'string' && pi.planName.trim()) {
          parts.push(pi.planName.trim());
          if (!rawName) rawName = pi.planName.trim();
        }
        if (pi.teamsTier !== undefined && pi.teamsTier !== null) parts.push(String(pi.teamsTier));
      }
      if (psPlan && psPlan !== pi && typeof psPlan === 'object') {
        if (typeof psPlan.planName === 'string' && psPlan.planName.trim()) parts.push(psPlan.planName.trim());
        if (psPlan.teamsTier !== undefined && psPlan.teamsTier !== null) parts.push(String(psPlan.teamsTier));
      }
      var text = parts.join(' ').toLowerCase();
      if (!text) return { tier: 'unknown', tierName: '' };
      if (/ultra|g1-ultra|pro_ultimate|teams_ultimate/.test(text)) return { tier: 'ultra', tierName: rawName || 'Ultra' };
      if (/\bpro\b|g1-pro|teams_tier_pro|\bpro[-_ ]tier\b/.test(text)) return { tier: 'pro', tierName: rawName || 'Pro' };
      if (/\bfree\b|standard-tier|\bfree[-_ ]tier\b/.test(text)) return { tier: 'free', tierName: rawName || 'Free' };
      return { tier: 'unknown', tierName: rawName };
    }

    function collectPricingInfosFromUpdate(update) {
      if (!update || typeof update !== 'object' || !update.costSummary) return;
      var cs = update.costSummary;
      var candidates = [cs.pricing];
      if (cs.total && typeof cs.total === 'object') {
        if (cs.total.cumulativeTotal) candidates.push(cs.total.cumulativeTotal.pricing);
        if (cs.total.turn) candidates.push(cs.total.turn.pricing);
      }
      var added = [];
      for (var i = 0; i < candidates.length; i++) {
        var p = candidates[i];
        if (!p || typeof p !== 'object') continue;
        var modelName = typeof p.modelName === 'string' ? p.modelName.trim() : '';
        var inp = typeof p.inputPricePerMillionTokens === 'number' ? p.inputPricePerMillionTokens : 0;
        var out = typeof p.outputPricePerMillionTokens === 'number' ? p.outputPricePerMillionTokens : 0;
        var cache = typeof p.cacheReadPricePerMillionTokens === 'number' ? p.cacheReadPricePerMillionTokens : 0;
        if (!modelName || !(inp > 0) || !(out > 0)) continue;
        var sig = modelName + ':' + inp + ':' + cache + ':' + out + ':' + (p.isEstimated ? '1' : '0');
        if (seenPricingKeys[sig]) continue;
        seenPricingKeys[sig] = true;
        added.push({
          modelName: modelName,
          inputPricePerMillionTokens: inp,
          cacheReadPricePerMillionTokens: cache,
          outputPricePerMillionTokens: out,
          isEstimated: Boolean(p.isEstimated),
        });
      }
      if (added.length) {
        equivUpState.pricing = added;
        equivUpState.pricingSeq += 1;
        publishEquivUp();
      }
    }

    function wrapReadOnlyAgentStream(iterable) {
      if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') return iterable;
      var origIter = iterable[Symbol.asyncIterator]();
      var wrapped = {};
      wrapped[Symbol.asyncIterator] = function () { return wrapped; };
      wrapped.next = function () {
        var p = origIter.next.apply(origIter, arguments);
        Promise.resolve(p).then(function (step) {
          if (step && !step.done && step.value) {
            try {
              var payload = (step.value.update && typeof step.value.update === 'object') ? step.value.update : step.value;
              collectPricingInfosFromUpdate(payload);
            } catch (_) {}
          }
        }, function () {});
        return p;
      };
      if (typeof origIter['return'] === 'function') {
        wrapped['return'] = function () { return origIter['return'].apply(origIter, arguments); };
      }
      if (typeof origIter['throw'] === 'function') {
        wrapped['throw'] = function () { return origIter['throw'].apply(origIter, arguments); };
      }
      return wrapped;
    }

    function formatQuotaBucketLabels(grp, b) {
      var gName = (grp && typeof grp.displayName === 'string' ? grp.displayName : '').trim();
      var gLower = gName.toLowerCase();
      var win = (b && typeof b.window === 'string' ? b.window : '').trim().toLowerCase();
      var bid = (b && typeof b.bucketId === 'string' ? b.bucketId : '').trim().toLowerCase();
      var family = 'other';
      if (gLower.indexOf('gemini') !== -1 || bid.indexOf('gemini') !== -1) {
        family = 'gemini';
      } else if (gLower.indexOf('claude') !== -1 || gLower.indexOf('gpt') !== -1 || bid.indexOf('3p') !== -1) {
        family = '3p';
      }
      var groupLabel = family === 'gemini' ? 'Gemini' : (family === '3p' ? 'Claude / GPT' : (gName || '额度'));
      var windowLabel = '';
      if (win === 'weekly' || bid.indexOf('weekly') !== -1) {
        windowLabel = '周额度';
      } else if (win === 'daily' || bid.indexOf('daily') !== -1) {
        windowLabel = '日额度';
      } else if (/^\d+[smhd]$/.test(win)) {
        windowLabel = win + ' 额度';
      } else {
        var bDisp = (b && typeof b.displayName === 'string' ? b.displayName : '').trim();
        windowLabel = bDisp || (b && b.bucketId ? String(b.bucketId) : '额度');
      }
      return {
        family: family,
        groupLabel: groupLabel,
        windowLabel: windowLabel,
        title: groupLabel + ' · ' + windowLabel,
      };
    }

    function ingestWeeklyQuotaSummary(res) {
      var groups = (res && res.response && Array.isArray(res.response.groups))
        ? res.response.groups
        : (res && Array.isArray(res.groups) ? res.groups : null);
      if (!groups || !groups.length) return false;

      var nextByBase = {};
      var nextByFamily = {};
      var nextAllBuckets = [];
      var nextGeminiWeeklyRaw = null;
      var foundAny = false;

      for (var i = 0; i < groups.length; i++) {
        var grp = groups[i];
        if (!grp || !Array.isArray(grp.buckets)) continue;
        var weeklyBucket = null;
        for (var j = 0; j < grp.buckets.length; j++) {
          var b = grp.buckets[j];
          if (!b || b.disabled) continue;
          var bFrac = readBucketFraction(b);
          if (bFrac !== null) {
            var labels = formatQuotaBucketLabels(grp, b);
            nextAllBuckets.push({
              id: b.bucketId || (i + '-' + j),
              groupIndex: i,
              family: labels.family,
              groupLabel: labels.groupLabel,
              windowLabel: labels.windowLabel,
              title: labels.title,
              percent: Math.max(0, Math.min(100, Math.round(bFrac * 100))),
              fraction: bFrac,
              resetTimeMs: readResetMs(b.resetTime),
              description: typeof b.description === 'string' ? b.description : '',
            });
            foundAny = true;
          }
          var win = typeof b.window === 'string' ? b.window.trim().toLowerCase() : '';
          var bid = typeof b.bucketId === 'string' ? b.bucketId.trim().toLowerCase() : '';
          if (!weeklyBucket && (win === 'weekly' || bid.indexOf('weekly') !== -1)) {
            weeklyBucket = b;
          }
        }
        if (!weeklyBucket) continue;
        var frac = readBucketFraction(weeklyBucket);
        if (frac === null) continue;

        var info = {
          percent: Math.max(0, Math.min(100, Math.round(frac * 100))),
          resetTimeMs: readResetMs(weeklyBucket.resetTime),
          description: typeof weeklyBucket.description === 'string' ? weeklyBucket.description : '',
          groupName: typeof grp.displayName === 'string' ? grp.displayName : '',
        };
        foundAny = true;

        var gName = (grp.displayName || '').toLowerCase();
        var bId = (weeklyBucket.bucketId || '').toLowerCase();
        if (gName.indexOf('gemini') !== -1 || bId.indexOf('gemini') !== -1) {
          nextByFamily.gemini = info;
          if (!nextGeminiWeeklyRaw) {
            nextGeminiWeeklyRaw = {
              remainingFraction: frac,
              resetTimeMs: info.resetTimeMs,
              bucketId: typeof weeklyBucket.bucketId === 'string' ? weeklyBucket.bucketId : '',
              disabled: Boolean(weeklyBucket.disabled),
              ts: Date.now(),
            };
          }
        }
        if (gName.indexOf('claude') !== -1 || gName.indexOf('gpt') !== -1 || bId.indexOf('3p') !== -1) {
          nextByFamily['3p'] = info;
        }

        // 解析 description 中的 "Models within this group: A, B, C" 精确绑定到模型基础名
        if (typeof grp.description === 'string') {
          var m = /models\s+within\s+this\s+group\s*:\s*([^\n.]+)/i.exec(grp.description);
          if (m && m[1]) {
            var names = m[1].split(',');
            for (var ni = 0; ni < names.length; ni++) {
              var nm = names[ni].trim().toLowerCase();
              if (nm) nextByBase[nm] = info;
            }
          }
        }
      }

      if (!foundAny) return false;
      weeklyQuotaStore.byModelBase = nextByBase;
      weeklyQuotaStore.byFamily = nextByFamily;
      weeklyQuotaStore.allBuckets = nextAllBuckets;
      weeklyQuotaStore.geminiWeeklyRaw = nextGeminiWeeklyRaw;
      weeklyQuotaStore.version += 1;
      if (nextGeminiWeeklyRaw) {
        equivUpState.quota = nextGeminiWeeklyRaw;
        equivUpState.quotaSeq += 1;
        publishEquivUp();
      }
      return true;
    }

    function readBridgeGeminiWeeklyFallback() {
      try {
        if (!w.sessionStorage) return null;
        var raw = w.sessionStorage.getItem('__agy_quota_bridge_v1__');
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        var s = parsed && parsed.summary;
        if (!s || typeof s.remainingFraction !== 'number' || !Number.isFinite(s.remainingFraction)) return null;
        return {
          percent: Math.max(0, Math.min(100, Math.round(Math.max(0, Math.min(1, s.remainingFraction)) * 100))),
          resetTimeMs: typeof s.resetTimeMs === 'number' && Number.isFinite(s.resetTimeMs) ? s.resetTimeMs : null,
          description: '',
          groupName: 'Gemini Models',
        };
      } catch (_) {
        return null;
      }
    }

    function lookupWeeklyQuota(baseName, isCustom) {
      if (isCustom || !baseName) return null;
      var lower = baseName.trim().toLowerCase();
      if (weeklyQuotaStore.byModelBase[lower]) return weeklyQuotaStore.byModelBase[lower];
      if (lower.indexOf('gemini') !== -1 || lower.indexOf('orchestrator') === 0) {
        return weeklyQuotaStore.byFamily.gemini || readBridgeGeminiWeeklyFallback();
      }
      if (lower.indexOf('claude') !== -1 || lower.indexOf('gpt') !== -1 || lower.indexOf('openai') !== -1) {
        return weeklyQuotaStore.byFamily['3p'] || null;
      }
      return null;
    }

    // 链式挂接 __JETSKI_LS_CLIENT_DECORATOR__（与 agy-weekly-quota / agy-token-meter 无冲突共存，0 主动请求）
    function installWeeklyQuotaTap() {
      if (w.__AGY_PERIODIC_QUOTA_TAP__) return;
      Object.defineProperty(w, '__AGY_PERIODIC_QUOTA_TAP__', { value: true });

      function wrapClient(client) {
        if (!client || typeof client !== 'object' || client.__agyPeriodicQuotaWrapped) return client;
        return new Proxy(client, {
          get: function (target, prop) {
            if (prop === '__agyPeriodicQuotaWrapped') return true;
            var orig = Reflect.get(target, prop, target);
            if (typeof orig !== 'function') return orig;
            if (prop === 'getUserStatus') {
              return function () {
                var p = Reflect.apply(orig, target, arguments);
                Promise.resolve(p).then(function (res) {
                  var us = res && res.userStatus;
                  var email = us && typeof us.email === 'string' ? us.email.trim() : '';
                  var tierInfo = classifyTierFromUserStatus(us);
                  equivUpState.user = {
                    email: email,
                    tier: tierInfo.tier,
                    tierName: tierInfo.tierName,
                    ts: Date.now(),
                  };
                  equivUpState.userSeq += 1;
                  publishEquivUp();
                }, function (err) {
                  var code = err && typeof err === 'object' ? err.code : undefined;
                  var msg = String((err && err.message) || '');
                  if (code === 16 || /unauthenticated/i.test(msg)) {
                    equivUpState.signOutAt = Date.now();
                    equivUpState.signOutSeq += 1;
                    publishEquivUp();
                  }
                });
                return p;
              };
            }
            if (prop === 'retrieveUserQuotaSummary') {
              return function () {
                var p = Reflect.apply(orig, target, arguments);
                Promise.resolve(p).then(function (res) {
                  if (ingestWeeklyQuotaSummary(res)) {
                    scheduleScan();
                  }
                }, function () {});
                return p;
              };
            }
            if (prop === 'streamAgentStateUpdates') {
              return function () {
                var res = Reflect.apply(orig, target, arguments);
                return wrapReadOnlyAgentStream(res);
              };
            }
            if (prop === 'signOut' || prop === 'clearAuth' || prop === 'logout') {
              return function () {
                var p = Reflect.apply(orig, target, arguments);
                Promise.resolve(p).then(function () {
                  weeklyQuotaStore.byModelBase = {};
                  weeklyQuotaStore.byFamily = {};
                  weeklyQuotaStore.allBuckets = [];
                  weeklyQuotaStore.geminiWeeklyRaw = null;
                  weeklyQuotaStore.version += 1;
                  equivUpState.signOutAt = Date.now();
                  equivUpState.signOutSeq += 1;
                  publishEquivUp();
                  scheduleScan();
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
            return wrapClient(decorated);
          };
        },
        set: function (nextFn) {
          prevDecorator = nextFn;
        },
      });
    }

    installWeeklyQuotaTap();

    function isOrchestratorModelOption(opt) {
      if (!opt || opt.isCustom) return false;
      var mid = typeof opt.modelId === 'string' ? opt.modelId : '';
      if (mid) {
        return mid === 'gemini-pro-coordinator'
          || mid === 'gemini-pro-orchestrator'
          || mid.indexOf('gemini-pro-orchestrator-') === 0;
      }
      var lbl = typeof opt.label === 'string' ? opt.label.trim() : '';
      return /^Orchestrator(?:\s*\([^)]+\))?$/i.test(lbl);
    }

    function normalizePlannerText(text) {
      return String(text || '')
        .toLowerCase()
        .replace(/\bextra\s+high\b/g, 'xhigh')
        .replace(/\bextra\b/g, 'xhigh')
        .replace(/[()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function readNativeOrchestratorPlannerHint(panel) {
      if (!panel || typeof panel.querySelector !== 'function') return '';
      var node = panel.querySelector('[data-testid="model-selector-orchestrator-model"]');
      if (!node) return '';
      return (node.textContent || '').trim();
    }

    function isEntrySelected(entry, selectedLabel, activeOrchPlannerVal, isOrchSelected) {
      if (!entry) return false;
      if (entry.isOrchestratorPlannerEntry) {
        if (!isOrchSelected || !activeOrchPlannerVal) return false;
        if (entry.defaultOption && entry.defaultOption.value === activeOrchPlannerVal) return true;
        if (entry.efforts && entry.efforts.length) {
          for (var oi = 0; oi < entry.efforts.length; oi++) {
            if (entry.efforts[oi].option.value === activeOrchPlannerVal) return true;
          }
        }
        return false;
      }
      if (!selectedLabel) return false;
      if (entry.defaultOption && entry.defaultOption.label === selectedLabel) return true;
      if (entry.efforts && entry.efforts.length) {
        for (var i = 0; i < entry.efforts.length; i++) {
          if (entry.efforts[i].option.label === selectedLabel) return true;
        }
      }
      return false;
    }

    function pickOptionByEffort(options, preferredEffort, fallbackMode) {
      if (!Array.isArray(options) || !options.length) return null;
      if (preferredEffort) {
        for (var i = 0; i < options.length; i++) {
          if (parseModelLabel(options[i].label, false).effort === preferredEffort) {
            return options[i];
          }
        }
        var targetRank = EFFORT_ORDER.indexOf(preferredEffort);
        if (targetRank >= 0) {
          var bestLower = null;
          var bestLowerRank = -1;
          var bestHigher = null;
          var bestHigherRank = Infinity;
          for (var j = 0; j < options.length; j++) {
            var rank = EFFORT_ORDER.indexOf(parseModelLabel(options[j].label, false).effort);
            if (rank < 0) continue;
            if (rank < targetRank && rank > bestLowerRank) {
              bestLower = options[j];
              bestLowerRank = rank;
            } else if (rank > targetRank && rank < bestHigherRank) {
              bestHigher = options[j];
              bestHigherRank = rank;
            }
          }
          if (bestLower) return bestLower;
          if (bestHigher) return bestHigher;
        }
      }
      if (fallbackMode === 'highest') {
        var best = options[0];
        var bestRank = EFFORT_ORDER.indexOf(parseModelLabel(best.label, false).effort);
        for (var m = 1; m < options.length; m++) {
          var r = EFFORT_ORDER.indexOf(parseModelLabel(options[m].label, false).effort);
          if (r > bestRank) {
            best = options[m];
            bestRank = r;
          }
        }
        return best;
      }
      for (var k = 0; k < options.length; k++) {
        if (parseModelLabel(options[k].label, false).effort === 'medium') return options[k];
      }
      return options[0];
    }

    function getCurrentEffort(cat) {
      if (cat && cat.isOrchestratorSelected && cat.activeOrchestratorPlanner && cat.activeOrchestratorPlanner.label) {
        return parseModelLabel(cat.activeOrchestratorPlanner.label, false).effort;
      }
      if (cat && cat.selectedLabel) {
        return parseModelLabel(cat.selectedLabel, false).effort;
      }
      return null;
    }

    function pickOrchestratorPlannerOption(plannerOptions, currentSelectedLabel, activePlannerOption, isOrchestratorSelected) {
      if (!Array.isArray(plannerOptions) || !plannerOptions.length) return null;
      if (isOrchestratorSelected && activePlannerOption) {
        for (var i = 0; i < plannerOptions.length; i++) {
          if (plannerOptions[i].value === activePlannerOption.value) return plannerOptions[i];
        }
      }
      var preferredEffort = null;
      if (isOrchestratorSelected && activePlannerOption && activePlannerOption.label) {
        preferredEffort = parseModelLabel(activePlannerOption.label, false).effort;
      } else if (currentSelectedLabel) {
        preferredEffort = parseModelLabel(currentSelectedLabel, false).effort;
      }
      return pickOptionByEffort(plannerOptions, preferredEffort, 'highest');
    }

    function pickDefaultOption(entry, selectedLabel, preferredEffortOverride) {
      if (!entry) return null;
      if (entry.efforts && entry.efforts.length) {
        if (selectedLabel) {
          for (var i = 0; i < entry.efforts.length; i++) {
            if (entry.efforts[i].option.label === selectedLabel) return entry.efforts[i].option;
          }
        }
        // 切换新元素时优先沿用当前思考等级（无精确匹配则就近降一档，如 XHigh -> High，再兜底 Medium）
        var preferredEffort = preferredEffortOverride || (selectedLabel ? parseModelLabel(selectedLabel, false).effort : null);
        var effortOpts = [];
        for (var j = 0; j < entry.efforts.length; j++) {
          effortOpts.push(entry.efforts[j].option);
        }
        return pickOptionByEffort(effortOpts, preferredEffort, 'medium');
      }
      return entry.defaultOption || null;
    }

    function resolveActiveOrchestratorPlanner(planners, ctrl, plannerOverrideValue, panel) {
      if (!Array.isArray(planners) || !planners.length) return null;
      var overrideVal = typeof plannerOverrideValue === 'number' && plannerOverrideValue > 0 ? plannerOverrideValue : 0;
      if (overrideVal) {
        for (var i = 0; i < planners.length; i++) {
          if (planners[i].value === overrideVal) return planners[i];
        }
      }
      var ctrlVal = ctrl && ctrl.orchestratorPick && typeof ctrl.orchestratorPick.model === 'number'
        ? ctrl.orchestratorPick.model
        : 0;
      if (ctrlVal > 0) {
        for (var j = 0; j < planners.length; j++) {
          if (planners[j].value === ctrlVal) return planners[j];
        }
      }
      // 当 orchestratorPick.model === 0 (UNSPECIFIED) 时，优先读取原生 DOM 显示的默认 planner（含用户全局设置）
      var domHint = normalizePlannerText(readNativeOrchestratorPlannerHint(panel));
      if (domHint) {
        for (var k = 0; k < planners.length; k++) {
          if (normalizePlannerText(planners[k].label) === domHint) return planners[k];
        }
      }
      var defPlanner = ctrl && ctrl.orchestratorDefaultPlanner;
      if (defPlanner && typeof defPlanner.value === 'number') {
        for (var m = 0; m < planners.length; m++) {
          if (planners[m].value === defPlanner.value) return planners[m];
        }
      }
      return defPlanner || planners[0];
    }

    function buildCatalog(ctrl, selectedLabelOverride, orchestratorPlannerOverride, panel) {
      var modelOptions = Array.isArray(ctrl && ctrl.modelOptions) ? ctrl.modelOptions : [];
      var customModels = Array.isArray(ctrl && ctrl.customModels) ? ctrl.customModels : [];
      var selectedModel = (ctrl && ctrl.selectedModel) || null;
      var selectedLabel = selectedLabelOverride || (selectedModel && selectedModel.label ? selectedModel.label : '');

      var orderedRaw = [];
      var seenLabels = {};
      var sorts = Array.isArray(ctrl && ctrl.modelSorts) ? ctrl.modelSorts : [];
      var recSort = null;
      for (var si = 0; si < sorts.length; si++) {
        if (sorts[si] && typeof sorts[si].name === 'string' && sorts[si].name.toLowerCase() === 'recommended') {
          recSort = sorts[si];
          break;
        }
      }
      if (recSort && Array.isArray(recSort.groups)) {
        for (var gi = 0; gi < recSort.groups.length; gi++) {
          var grpOpts = (recSort.groups[gi] && recSort.groups[gi].options) || [];
          for (var oi = 0; oi < grpOpts.length; oi++) {
            var o = grpOpts[oi];
            if (o && o.label && !seenLabels[o.label]) {
              seenLabels[o.label] = true;
              orderedRaw.push(o);
            }
          }
        }
      }
      for (var mi = 0; mi < modelOptions.length; mi++) {
        var mo = modelOptions[mi];
        if (mo && mo.label && !seenLabels[mo.label]) {
          seenLabels[mo.label] = true;
          orderedRaw.push(mo);
        }
      }
      for (var ci = 0; ci < customModels.length; ci++) {
        var cm = customModels[ci];
        if (cm && cm.label && !seenLabels[cm.label]) {
          seenLabels[cm.label] = true;
          orderedRaw.push(cm);
        }
      }

      var primaryOrchestratorOption = null;
      var legacyOrchOptBySymbol = {};
      var selectedRawOpt = null;
      for (var oi2 = 0; oi2 < orderedRaw.length; oi2++) {
        var ro = orderedRaw[oi2];
        if (!ro || !ro.label) continue;
        if (ro.label === selectedLabel) selectedRawOpt = ro;
        if (ro.disabled) continue;
        if (isOrchestratorModelOption(ro)) {
          if (!primaryOrchestratorOption) primaryOrchestratorOption = ro;
          var legacyEl = matchOrchestratorElement(ro.label);
          if (legacyEl && !legacyOrchOptBySymbol[legacyEl.symbol]) {
            legacyOrchOptBySymbol[legacyEl.symbol] = ro;
          }
        }
      }

      var hasOrchPick = !!(ctrl && ctrl.orchestratorPick && typeof ctrl.orchestratorPick.select === 'function');
      var explicitPlanners = Array.isArray(ctrl && ctrl.orchestratorPlanners)
        ? ctrl.orchestratorPlanners.filter(function (o) { return !!(o && !o.disabled && o.label); })
        : null;
      var rawPlanners = explicitPlanners;
      // 兜底：若仅拿到了外层 J7c 的 orchestratorPick 而未拿到内层 Provider 的 orchestratorPlanners，则按已开放的 Orchestrator(元素) 推断
      if (rawPlanners === null && hasOrchPick && primaryOrchestratorOption) {
        var inferredPlanners = [];
        for (var ip = 0; ip < orderedRaw.length; ip++) {
          var candOpt = orderedRaw[ip];
          if (!candOpt || candOpt.disabled || candOpt.isCustom || isOrchestratorModelOption(candOpt)) continue;
          var candEl = matchGemini4Element(parseModelLabel(candOpt.label, false).base);
          if (candEl && legacyOrchOptBySymbol[candEl.symbol]) {
            inferredPlanners.push(candOpt);
          }
        }
        if (inferredPlanners.length) rawPlanners = inferredPlanners;
      }

      var unifiedOrchestratorMode = !!(
        hasOrchPick
        && primaryOrchestratorOption
        && Array.isArray(rawPlanners)
        && rawPlanners.length > 0
      );
      var isOrchestratorSelected = selectedRawOpt
        ? isOrchestratorModelOption(selectedRawOpt)
        : (selectedLabel ? /^Orchestrator(?:\s*\([^)]+\))?$/i.test(selectedLabel.trim()) : false);
      var activeOrchestratorPlanner = unifiedOrchestratorMode
        ? resolveActiveOrchestratorPlanner(rawPlanners, ctrl, orchestratorPlannerOverride, panel)
        : null;
      var activeOrchPlannerVal = activeOrchestratorPlanner ? activeOrchestratorPlanner.value : 0;

      var groupMap = {};
      var groupOrder = [];
      for (var i = 0; i < orderedRaw.length; i++) {
        var opt = orderedRaw[i];
        if (!opt || !opt.label || opt.disabled) continue;
        // 统一 Planner 模式下，原生 Orchestrator (Neon/Carbon/Argon) 只是模式入口，由下方 planner 分组替代展示
        if (unifiedOrchestratorMode && isOrchestratorModelOption(opt)) continue;
        var parsed = parseModelLabel(opt.label, !!opt.isCustom);
        var key = (opt.isCustom ? 'custom::' : 'std::') + parsed.base;
        var entry = groupMap[key];
        if (!entry) {
          entry = {
            key: key,
            base: parsed.base,
            isCustom: !!opt.isCustom,
            efforts: [],
            effortMap: {},
            defaultOption: opt,
            tagTitle: opt.tagTitle || '',
            tagDescription: opt.tagDescription || '',
            weeklyQuota: lookupWeeklyQuota(parsed.base, !!opt.isCustom),
            element: null,
            orchestratorOption: null,
            orchestratorPlanners: null,
            isOrchestratorPlannerEntry: false,
            orchestratorBaseOption: null,
            category: null,
          };
          groupMap[key] = entry;
          groupOrder.push(entry);
        }
        if (!entry.tagTitle && opt.tagTitle) entry.tagTitle = opt.tagTitle;
        if (!entry.tagDescription && opt.tagDescription) entry.tagDescription = opt.tagDescription;
        if (!entry.weeklyQuota) entry.weeklyQuota = lookupWeeklyQuota(parsed.base, !!opt.isCustom);

        if (parsed.effort) {
          if (!entry.effortMap[parsed.effort]) {
            var efItem = {
              effort: parsed.effort,
              label: EFFORT_LABELS[parsed.effort] || parsed.effort,
              option: opt,
            };
            entry.effortMap[parsed.effort] = efItem;
            entry.efforts.push(efItem);
          }
        } else {
          entry.defaultOption = opt;
        }
      }

      for (var k = 0; k < groupOrder.length; k++) {
        var ent = groupOrder[k];
        if (ent.efforts.length) {
          ent.efforts.sort(function (a, b) {
            return EFFORT_ORDER.indexOf(a.effort) - EFFORT_ORDER.indexOf(b.effort);
          });
          ent.defaultOption = pickDefaultOption(ent, selectedLabel);
        }
      }

      var periodicBySymbol = {};
      var periodicEntries = [];
      var otherEntries = [];
      var orchestratorBySymbol = {};

      for (var p = 0; p < groupOrder.length; p++) {
        var item = groupOrder[p];
        var elem = !item.isCustom ? matchGemini4Element(item.base) : null;
        if (elem) {
          item.element = elem;
          item.category = { id: 'periodic', label: 'Gemini 4' };
          if (!periodicBySymbol[elem.symbol]) {
            periodicBySymbol[elem.symbol] = item;
            periodicEntries.push(item);
          }
        } else {
          item.category = classifyOtherCategory(item.base, item.isCustom);
          otherEntries.push(item);
          var orchElem = !item.isCustom ? matchOrchestratorElement(item.base) : null;
          if (orchElem && !orchestratorBySymbol[orchElem.symbol]) {
            orchestratorBySymbol[orchElem.symbol] = item;
          }
        }
      }

      if (unifiedOrchestratorMode) {
        // 将 orchestratorPlanners 按基础模型分组，既挂到周期表对应元素的 Orchestrator 按钮，也生成 Orchestrator 分类条目
        var plannerGroupMap = {};
        var plannerGroupOrder = [];
        var plannersBySymbol = {};
        for (var pi = 0; pi < rawPlanners.length; pi++) {
          var popt = rawPlanners[pi];
          var pparsed = parseModelLabel(popt.label, false);
          var pkey = 'orch::' + pparsed.base;
          var pElem = matchGemini4Element(pparsed.base);
          var baseOrchOpt = (pElem && legacyOrchOptBySymbol[pElem.symbol]) || primaryOrchestratorOption;
          var pEntry = plannerGroupMap[pkey];
          if (!pEntry) {
            pEntry = {
              key: pkey,
              base: 'Orchestrator · ' + pparsed.base,
              plannerBase: pparsed.base,
              isCustom: false,
              isOrchestratorPlannerEntry: true,
              orchestratorBaseOption: baseOrchOpt,
              plannerElement: pElem,
              efforts: [],
              effortMap: {},
              plannerOptions: [],
              defaultOption: popt,
              tagTitle: 'New',
              tagDescription: (baseOrchOpt && baseOrchOpt.tagDescription) || 'Offloads routine steps to a faster executor. Same quality, fewer tokens used.',
              weeklyQuota: lookupWeeklyQuota(pparsed.base, false),
              element: null,
              orchestratorOption: null,
              orchestratorPlanners: null,
              category: { id: 'orchestrator', label: 'Orchestrator' },
            };
            plannerGroupMap[pkey] = pEntry;
            plannerGroupOrder.push(pEntry);
          }
          pEntry.plannerOptions.push(popt);
          if (pparsed.effort) {
            if (!pEntry.effortMap[pparsed.effort]) {
              var pef = {
                effort: pparsed.effort,
                label: EFFORT_LABELS[pparsed.effort] || pparsed.effort,
                option: popt,
              };
              pEntry.effortMap[pparsed.effort] = pef;
              pEntry.efforts.push(pef);
            }
          } else {
            pEntry.defaultOption = popt;
          }
          if (pElem) {
            if (!plannersBySymbol[pElem.symbol]) plannersBySymbol[pElem.symbol] = [];
            plannersBySymbol[pElem.symbol].push(popt);
          }
        }

        for (var pg = 0; pg < plannerGroupOrder.length; pg++) {
          var pent = plannerGroupOrder[pg];
          if (pent.efforts.length) {
            pent.efforts.sort(function (a, b) {
              return EFFORT_ORDER.indexOf(a.effort) - EFFORT_ORDER.indexOf(b.effort);
            });
            pent.defaultOption = pickOrchestratorPlannerOption(pent.plannerOptions, selectedLabel, activeOrchestratorPlanner, isOrchestratorSelected);
          }
          otherEntries.push(pent);
          groupOrder.push(pent);
        }

        for (var q1 = 0; q1 < periodicEntries.length; q1++) {
          var pe1 = periodicEntries[q1];
          var sym1 = pe1.element && pe1.element.symbol;
          var symPlanners = sym1 ? plannersBySymbol[sym1] : null;
          if (symPlanners && symPlanners.length) {
            symPlanners.sort(function (a, b) {
              return EFFORT_ORDER.indexOf(parseModelLabel(a.label, false).effort)
                - EFFORT_ORDER.indexOf(parseModelLabel(b.label, false).effort);
            });
            pe1.orchestratorPlanners = symPlanners;
            pe1.orchestratorOption = legacyOrchOptBySymbol[sym1] || primaryOrchestratorOption;
          }
        }
      } else {
        for (var q = 0; q < periodicEntries.length; q++) {
          var pe = periodicEntries[q];
          if (pe.element && orchestratorBySymbol[pe.element.symbol]) {
            pe.orchestratorOption = orchestratorBySymbol[pe.element.symbol].defaultOption;
          }
        }
      }

      var catPriority = ['orchestrator', 'gemini-legacy', 'claude', 'gpt', 'misc', 'custom'];
      var catMap = {};
      for (var r = 0; r < otherEntries.length; r++) {
        var oe = otherEntries[r];
        var cid = oe.category.id;
        if (!catMap[cid]) {
          catMap[cid] = {
            id: cid,
            label: oe.category.label,
            entries: [],
            hasSelected: false,
          };
        }
        catMap[cid].entries.push(oe);
        if (isEntrySelected(oe, selectedLabel, activeOrchPlannerVal, isOrchestratorSelected)) {
          catMap[cid].hasSelected = true;
        }
      }
      var otherCategories = [];
      for (var cp = 0; cp < catPriority.length; cp++) {
        if (catMap[catPriority[cp]]) otherCategories.push(catMap[catPriority[cp]]);
      }

      var selectedPeriodic = null;
      var selectedOther = null;
      for (var s1 = 0; s1 < periodicEntries.length; s1++) {
        if (isEntrySelected(periodicEntries[s1], selectedLabel, activeOrchPlannerVal, isOrchestratorSelected)) {
          selectedPeriodic = periodicEntries[s1];
          break;
        }
      }
      if (!selectedPeriodic) {
        for (var s2 = 0; s2 < otherEntries.length; s2++) {
          if (isEntrySelected(otherEntries[s2], selectedLabel, activeOrchPlannerVal, isOrchestratorSelected)) {
            selectedOther = otherEntries[s2];
            break;
          }
        }
      }

      var activeOrchestratorElement = null;
      if (isOrchestratorSelected) {
        if (unifiedOrchestratorMode && activeOrchestratorPlanner) {
          activeOrchestratorElement = matchGemini4Element(parseModelLabel(activeOrchestratorPlanner.label, false).base);
        } else {
          activeOrchestratorElement = matchOrchestratorElement(selectedLabel);
        }
      }
      var selectedDisplayLabel = (unifiedOrchestratorMode && isOrchestratorSelected && activeOrchestratorPlanner)
        ? ('Orchestrator · ' + activeOrchestratorPlanner.label)
        : selectedLabel;

      return {
        allEntries: groupOrder,
        periodicEntries: periodicEntries,
        periodicBySymbol: periodicBySymbol,
        otherEntries: otherEntries,
        otherCategories: otherCategories,
        selectedLabel: selectedLabel,
        selectedDisplayLabel: selectedDisplayLabel,
        selectedPeriodic: selectedPeriodic,
        selectedOther: selectedOther,
        releasedCount: periodicEntries.length,
        unifiedOrchestratorMode: unifiedOrchestratorMode,
        isOrchestratorSelected: isOrchestratorSelected,
        activeOrchestratorPlanner: activeOrchestratorPlanner,
        activeOrchestratorElement: activeOrchestratorElement,
      };
    }

    function getFiberFromElement(elNode) {
      if (!elNode || typeof elNode !== 'object') return null;
      var keys = Object.keys(elNode);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) {
          return elNode[keys[i]];
        }
      }
      return null;
    }

    function isControllerProps(p) {
      return !!(
        p
        && typeof p === 'object'
        && typeof p.setSelectedModel === 'function'
        && Array.isArray(p.modelOptions)
      );
    }

    function findControllerFromElement(elNode) {
      var fiber = getFiberFromElement(elNode);
      var bestOuter = null;
      var bestAny = null;
      var providerVal = null;
      var step = 0;
      while (fiber && step < 300) {
        var props = fiber.memoizedProps || fiber.pendingProps;
        if (isControllerProps(props)) {
          bestAny = props;
          // 最外层 J7c 同时持有 setIsOpen 和 placement，它的 setSelectedModel 是原始版本，不会在选中后强制关闭菜单
          if (typeof props.setIsOpen === 'function') {
            bestOuter = props;
          }
          if (!providerVal && Array.isArray(props.orchestratorPlanners)) {
            providerVal = props;
          }
        } else if (props && props.value && isControllerProps(props.value)) {
          if (!bestAny) bestAny = props.value;
          // 内层 ModelSelectorProvider (v7c.Provider) 持有完整的 orchestratorPlanners 与 orchestratorDefaultPlanner
          if (!providerVal && (Array.isArray(props.value.orchestratorPlanners) || props.value.orchestratorPick)) {
            providerVal = props.value;
          }
        }
        fiber = fiber['return'];
        step++;
      }
      var baseCtrl = bestOuter || bestAny;
      if (!baseCtrl) return null;
      if (providerVal && providerVal !== baseCtrl) {
        return Object.assign({}, baseCtrl, {
          orchestratorPlanners: Array.isArray(providerVal.orchestratorPlanners)
            ? providerVal.orchestratorPlanners
            : baseCtrl.orchestratorPlanners,
          orchestratorDefaultPlanner: providerVal.orchestratorDefaultPlanner !== undefined
            ? providerVal.orchestratorDefaultPlanner
            : baseCtrl.orchestratorDefaultPlanner,
          orchestratorPick: baseCtrl.orchestratorPick || providerVal.orchestratorPick,
        });
      }
      return baseCtrl;
    }

    function computeCatalogSignature(ctrl, selectedLabelOverride, orchestratorPlannerOverride, panel) {
      var sel = selectedLabelOverride || (ctrl && ctrl.selectedModel && ctrl.selectedModel.label) || '';
      var ctxSel = (ctrl && ctrl.contextWindow && ctrl.contextWindow.selected) || '';
      var opts = Array.isArray(ctrl && ctrl.modelOptions) ? ctrl.modelOptions : [];
      var customs = Array.isArray(ctrl && ctrl.customModels) ? ctrl.customModels : [];
      var orchPlanners = Array.isArray(ctrl && ctrl.orchestratorPlanners) ? ctrl.orchestratorPlanners : [];
      var orchPickVal = (typeof orchestratorPlannerOverride === 'number' && orchestratorPlannerOverride > 0)
        ? orchestratorPlannerOverride
        : ((ctrl && ctrl.orchestratorPick && typeof ctrl.orchestratorPick.model === 'number') ? ctrl.orchestratorPick.model : 0);
      var orchDefVal = (ctrl && ctrl.orchestratorDefaultPlanner && typeof ctrl.orchestratorDefaultPlanner.value === 'number')
        ? ctrl.orchestratorDefaultPlanner.value
        : 0;
      var domHint = readNativeOrchestratorPlannerHint(panel);
      var fbGem = readBridgeGeminiWeeklyFallback();
      var parts = [
        sel,
        ctxSel,
        String(opts.length),
        String(customs.length),
        'op:' + String(orchPickVal) + ':' + String(orchDefVal) + ':' + String(orchPlanners.length) + ':' + domHint,
        'wq:' + String(weeklyQuotaStore.version) + ':' + (fbGem ? String(fbGem.percent) : ''),
        'eq:' + String(equivCostStore.version),
      ];
      for (var i = 0; i < opts.length; i++) {
        var o = opts[i];
        if (!o) continue;
        parts.push((o.label || '') + ':' + (o.disabled ? '1' : '0'));
      }
      for (var j = 0; j < customs.length; j++) {
        var c = customs[j];
        if (!c) continue;
        parts.push('C:' + (c.label || '') + ':' + (c.disabled ? '1' : '0'));
      }
      return parts.join('|');
    }

    function resolveControllerForPanel(panel) {
      var ctrl = findControllerFromElement(panel);
      if (ctrl) return ctrl;
      var innerTargets = panel.querySelectorAll
        ? panel.querySelectorAll('[data-testid="model-selector-header"], [data-testid="model-selector-effort-group"], [data-testid="model-selector-item"], button')
        : [];
      for (var i = 0; i < innerTargets.length && i < 6; i++) {
        ctrl = findControllerFromElement(innerTargets[i]);
        if (ctrl) return ctrl;
      }
      var triggers = w.document.querySelectorAll ? w.document.querySelectorAll('[data-testid="model-selector-trigger"]') : [];
      var fallback = null;
      for (var t = 0; t < triggers.length; t++) {
        var c = findControllerFromElement(triggers[t]);
        if (!c) continue;
        if (c.open || triggers[t].getAttribute('aria-expanded') === 'true' || triggers[t].getAttribute('data-popup-open') !== null) {
          return c;
        }
        if (!fallback) fallback = c;
      }
      return fallback;
    }

    function detectDarkTheme(refEl) {
      var doc = w.document;
      var html = doc.documentElement;
      var body = doc.body;
      if (html) {
        if (html.classList && html.classList.contains('dark')) return true;
        var dt = html.getAttribute('data-theme') || html.getAttribute('data-color-scheme') || '';
        if (/dark/i.test(dt)) return true;
        if (/light/i.test(dt)) return false;
      }
      if (body && body.classList && body.classList.contains('dark')) return true;
      try {
        var target = refEl || body || html;
        var bg = w.getComputedStyle(target).backgroundColor || '';
        var m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (m) {
          var lum = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]);
          return lum < 135;
        }
      } catch (_) {}
      return true;
    }

    function ensureStyles() {
      var doc = w.document;
      if (doc.getElementById(STYLE_ID)) return;
      var style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = [
        /* 原地扩展 Antigravity 原生 Popover 外壳尺寸（切回原版列表时移除属性即恢复原状） */
        '[' + POPOVER_ATTR + '="1"] {',
        '  width: min(748px, calc(100vw - 24px)) !important;',
        '  max-width: min(748px, calc(100vw - 24px)) !important;',
        '  min-width: 0 !important;',
        '  padding: 8px !important;',
        '}',
        '[' + HIDDEN_ATTR + '="1"] { display: none !important; }',
        /* 原地周期表主体（透明贴合在原生 bg-card / surface-glass 内） */
        '[' + INLINE_ATTR + '="1"] {',
        '  display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; flex: 1 1 auto;',
        '  overflow-y: auto; overflow-x: hidden; padding: 2px 2px 4px 2px; outline: none;',
        '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Roboto, sans-serif;',
        '  --pm-surface: rgba(15, 23, 42, 0.035);',
        '  --pm-surface-hover: rgba(15, 23, 42, 0.07);',
        '  --pm-panel-bg: rgba(15, 23, 42, 0.03);',
        '  --pm-border: rgba(15, 23, 42, 0.1);',
        '  --pm-border-strong: rgba(15, 23, 42, 0.18);',
        '  --pm-text: #111827;',
        '  --pm-text-muted: #6b7280;',
        '  --pm-text-faint: #9ca3af;',
        '  --pm-pill-active-bg: #ffffff;',
        '  --pm-pill-active-border: #2563eb;',
        '  --pm-cell-bg: rgba(15, 23, 42, 0.055);',
        '  --pm-cell-border: rgba(15, 23, 42, 0.08);',
        '  --pm-cell-text: #7b818c;',
        '  --pm-cell-num: #9aa0aa;',
        '  --pm-fade-to: #f6f7f9;',
        '  --pm-badge-bg: #111827;',
        '  --pm-badge-text: #ffffff;',
        '  --pm-chip-bg: rgba(15, 23, 42, 0.06);',
        '  --pm-accent: #2563eb;',
        '  --pm-accent-soft: rgba(37, 99, 235, 0.12);',
        '}',
        '[' + INLINE_ATTR + '="1"][data-theme="dark"] {',
        '  --pm-surface: rgba(255, 255, 255, 0.04);',
        '  --pm-surface-hover: rgba(255, 255, 255, 0.08);',
        '  --pm-panel-bg: rgba(255, 255, 255, 0.025);',
        '  --pm-border: rgba(255, 255, 255, 0.09);',
        '  --pm-border-strong: rgba(255, 255, 255, 0.18);',
        '  --pm-text: #f3f4f6;',
        '  --pm-text-muted: #9ca3af;',
        '  --pm-text-faint: #6b7280;',
        '  --pm-pill-active-bg: rgba(96, 165, 250, 0.16);',
        '  --pm-pill-active-border: #60a5fa;',
        '  --pm-cell-bg: rgba(255, 255, 255, 0.045);',
        '  --pm-cell-border: rgba(255, 255, 255, 0.07);',
        '  --pm-cell-text: #747d8c;',
        '  --pm-cell-num: #586070;',
        '  --pm-fade-to: #181a1f;',
        '  --pm-badge-bg: #f3f4f6;',
        '  --pm-badge-text: #111827;',
        '  --pm-chip-bg: rgba(255, 255, 255, 0.08);',
        '  --pm-accent: #60a5fa;',
        '  --pm-accent-soft: rgba(96, 165, 250, 0.18);',
        '}',
        '[' + INLINE_ATTR + '="1"] * { box-sizing: border-box; }',
        /* 顶部工具条：左侧（分类胶囊 + 搜索工具），右侧（4 项额度饼状图） */
        '.agy-pm-topbar { position: relative; z-index: 10; display: flex; align-items: stretch; justify-content: space-between; gap: 10px; }',
        '.agy-pm-topbar-left { display: flex; flex-direction: column; gap: 6px; flex: 1 1 auto; min-width: 0; }',
        '.agy-pm-quota-pies-slot { display: flex; align-items: stretch; flex-shrink: 0; }',
        '.agy-pm-quota-pies {',
        '  display: flex; align-items: center; gap: 7px; padding: 5px 9px;',
        '  border-radius: 9px; border: 1px solid var(--pm-border); background: var(--pm-panel-bg);',
        '}',
        '.agy-pm-quota-pie {',
        '  position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center;',
        '  gap: 2px; min-width: 30px; padding: 2px 3px; border-radius: 6px; cursor: default; outline: none;',
        '  transition: background 110ms ease;',
        '}',
        '.agy-pm-quota-pie:hover, .agy-pm-quota-pie:focus-visible { background: var(--pm-surface-hover); }',
        '.agy-pm-quota-pie-svg { width: 26px; height: 26px; display: block; }',
        '.agy-pm-quota-pie-pct { font-size: 10px; line-height: 1; font-weight: 600; color: var(--pm-text-muted); font-variant-numeric: tabular-nums; }',
        '.agy-pm-quota-pie-sep { width: 1px; height: 28px; background: var(--pm-border); flex-shrink: 0; }',
        '.agy-pm-quota-tip {',
        '  position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; pointer-events: none;',
        '  opacity: 0; visibility: hidden; transform: translateY(-2px);',
        '  transition: opacity 100ms ease, transform 100ms ease;',
        '  min-width: 148px; padding: 6px 8px; border-radius: 7px;',
        '  border: 1px solid var(--pm-border-strong); background: #ffffff; color: var(--pm-text);',
        '  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22); white-space: nowrap;',
        '}',
        '[' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-quota-tip { background: #1f232b; }',
        '.agy-pm-quota-pie:hover .agy-pm-quota-tip, .agy-pm-quota-pie:focus-visible .agy-pm-quota-tip {',
        '  opacity: 1; visibility: visible; transform: translateY(0);',
        '}',
        '.agy-pm-quota-tip-title { font-size: 11.5px; font-weight: 600; color: var(--pm-text); }',
        '.agy-pm-quota-tip-meta { font-size: 10.5px; color: var(--pm-text-muted); margin-top: 2px; }',
        '.agy-pm-tabs { display: flex; align-items: center; gap: 5px; overflow-x: auto; scrollbar-width: none; flex: 1 1 auto; min-width: 0; }',
        '.agy-pm-tabs::-webkit-scrollbar { display: none; }',
        '.agy-pm-tab {',
        '  display: inline-flex; align-items: center; gap: 5px; height: 27px; padding: 0 10px;',
        '  border-radius: 999px; border: 1px solid var(--pm-border); background: transparent;',
        '  color: var(--pm-text); font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap;',
        '  transition: all 110ms ease;',
        '}',
        '.agy-pm-tab:hover { background: var(--pm-surface-hover); }',
        '.agy-pm-tab.is-active { background: var(--pm-pill-active-bg); border-color: var(--pm-pill-active-border); box-shadow: 0 0 0 1px var(--pm-pill-active-border) inset; }',
        '.agy-pm-tab-4 { padding: 0 8px; }',
        '.agy-pm-tab-4-badge {',
        '  display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px;',
        '  border-radius: 4px; background: var(--pm-badge-bg); color: var(--pm-badge-text); font-size: 11px; font-weight: 700; line-height: 1;',
        '}',
        '.agy-pm-tab-count { font-size: 10.5px; color: var(--pm-text-muted); background: var(--pm-chip-bg); padding: 0 5px; border-radius: 999px; }',
        '.agy-pm-tools { display: flex; align-items: center; gap: 5px; flex: 1 1 auto; min-width: 0; }',
        '.agy-pm-search-box {',
        '  display: flex; align-items: center; gap: 5px; height: 27px; width: 146px; padding: 0 8px; flex-shrink: 0;',
        '  border-radius: 7px; border: 1px solid var(--pm-border); background: var(--pm-surface);',
        '  transition: border-color 110ms ease, width 140ms ease;',
        '}',
        '.agy-pm-search-box:focus-within { border-color: var(--pm-accent); width: 170px; }',
        '.agy-pm-search-icon { color: var(--pm-text-faint); font-size: 12px; line-height: 1; }',
        '.agy-pm-search-input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--pm-text); font-size: 12px; }',
        '.agy-pm-search-input::placeholder { color: var(--pm-text-faint); }',
        '.agy-pm-search-clear { border: none; background: transparent; color: var(--pm-text-muted); cursor: pointer; font-size: 13px; padding: 0 2px; display: none; }',
        '.agy-pm-search-clear.visible { display: inline-flex; }',
        '.agy-pm-tool-btn {',
        '  height: 27px; padding: 0 8px; border-radius: 7px; border: 1px solid var(--pm-border);',
        '  background: transparent; color: var(--pm-text-muted); font-size: 11.5px; cursor: pointer;',
        '  transition: all 110ms ease; white-space: nowrap; flex-shrink: 0;',
        '}',
        '.agy-pm-tool-btn:hover { background: var(--pm-surface-hover); color: var(--pm-text); border-color: var(--pm-border-strong); }',
        '.agy-pm-equiv-cost-slot { display: flex; align-items: center; flex: 1 1 auto; min-width: 0; }',
        '.agy-pm-equiv-cost {',
        '  position: relative; display: flex; align-items: center; justify-content: flex-start;',
        '  flex: 1 1 auto; min-width: 0; height: 27px; padding: 0 9px; border-radius: 7px;',
        '  border: 1px solid var(--pm-border); background: var(--pm-panel-bg);',
        '  color: var(--pm-text-muted); font-size: 11.5px; line-height: 25px; cursor: default; outline: none;',
        '  transition: border-color 110ms ease, background 110ms ease;',
        '}',
        '.agy-pm-equiv-cost:hover, .agy-pm-equiv-cost:focus-visible { border-color: var(--pm-border-strong); background: var(--pm-surface-hover); }',
        '.agy-pm-equiv-cost-text { display: block; width: 100%; height: 25px; line-height: 25px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }',
        '.agy-pm-equiv-cost-val { color: var(--pm-text); font-weight: 600; }',
        '.agy-pm-equiv-tip {',
        '  position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; pointer-events: none;',
        '  opacity: 0; visibility: hidden; transform: translateY(-2px);',
        '  transition: opacity 100ms ease, transform 100ms ease;',
        '  min-width: 240px; max-width: 340px; padding: 7px 9px; border-radius: 7px;',
        '  border: 1px solid var(--pm-border-strong); background: #ffffff; color: var(--pm-text);',
        '  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22); white-space: normal; line-height: 1.45;',
        '}',
        '[' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-equiv-tip { background: #1f232b; }',
        '.agy-pm-equiv-cost:hover .agy-pm-equiv-tip, .agy-pm-equiv-cost:focus-visible .agy-pm-equiv-tip {',
        '  opacity: 1; visibility: visible; transform: translateY(0);',
        '}',
        '.agy-pm-equiv-tip-title { font-size: 11.5px; font-weight: 600; color: var(--pm-text); margin-bottom: 3px; }',
        '.agy-pm-equiv-tip-line { font-size: 10.5px; color: var(--pm-text-muted); margin-top: 2px; word-break: break-word; }',
        /* 原版视图顶部切回周期表的小条 */
        '[' + NATIVE_BAR_ATTR + '="1"] {',
        '  display: flex; align-items: center; justify-content: flex-end; padding: 2px 4px 4px 4px;',
        '}',
        '.agy-pm-back-pill {',
        '  display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px;',
        '  border-radius: 999px; border: 1px solid rgba(128, 128, 128, 0.25); background: transparent;',
        '  color: inherit; opacity: 0.78; font-size: 11px; cursor: pointer;',
        '}',
        '.agy-pm-back-pill:hover { opacity: 1; background: rgba(128, 128, 128, 0.14); }',
        /* 周期表卡片容器（紧凑 18×6 布局适配原位 Popover） */
        '.agy-pm-table-card {',
        '  position: relative; background: var(--pm-panel-bg); border: 1px solid var(--pm-border);',
        '  border-radius: 10px; padding: 10px 10px 8px 10px; overflow-x: auto;',
        '}',
        '.agy-pm-grid {',
        '  position: relative; display: grid; grid-template-columns: repeat(18, minmax(31px, 1fr));',
        '  grid-template-rows: repeat(6, 35px); gap: 4px; min-width: 630px;',
        '}',
        '.agy-pm-grid-fade {',
        '  pointer-events: none; position: absolute; left: 0; right: 0; bottom: 0; height: 40px;',
        '  background: linear-gradient(to bottom, transparent 0%, var(--pm-fade-to) 94%); z-index: 2;',
        '}',
        '.agy-pm-hero {',
        '  grid-column: 3 / 13; grid-row: 1 / 4; z-index: 1;',
        '  display: flex; flex-direction: column; justify-content: center; padding: 2px 10px 2px 14px;',
        '  pointer-events: none; user-select: none;',
        '}',
        '.agy-pm-hero-kicker { font-size: 9.5px; font-weight: 600; letter-spacing: 0.11em; text-transform: uppercase; color: var(--pm-text-muted); }',
        '.agy-pm-hero-title { font-size: 29px; font-weight: 700; line-height: 1.06; letter-spacing: -0.03em; color: var(--pm-text); margin-top: 1px; }',
        '.agy-pm-hero-meta { display: inline-flex; align-items: center; gap: 6px; margin-top: 5px; font-size: 11px; color: var(--pm-text-muted); }',
        '.agy-pm-hero-count {',
        '  display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 4px;',
        '  border-radius: 4px; background: var(--pm-chip-bg); color: var(--pm-text); font-weight: 700; font-size: 11px;',
        '}',
        '.agy-pm-cell {',
        '  position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center;',
        '  width: 100%; height: 100%; padding: 0; border-radius: 6px;',
        '  border: 1px solid var(--pm-cell-border); background: var(--pm-cell-bg); color: var(--pm-cell-text);',
        '  transition: transform 100ms ease, box-shadow 100ms ease, border-color 100ms ease;',
        '  user-select: none; outline: none;',
        '}',
        '.agy-pm-cell[data-supported="false"] { cursor: default; opacity: 0.72; pointer-events: none; }',
        '.agy-pm-cell[data-supported="true"] { cursor: pointer; z-index: 3; }',
        '.agy-pm-cell[data-supported="true"]:hover { transform: translateY(-1.5px) scale(1.05); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); }',
        '.agy-pm-cell.is-selected { box-shadow: 0 0 0 2px var(--pm-accent), 0 2px 10px rgba(37, 99, 235, 0.3); z-index: 4; }',
        '.agy-pm-cell.is-placeholder { cursor: default; opacity: 0.42; }',
        '.agy-pm-cell-num { position: absolute; top: 2px; left: 3.5px; font-size: 7.5px; line-height: 1; color: var(--pm-cell-num); font-weight: 500; }',
        '.agy-pm-cell-sym { font-size: 12.5px; font-weight: 600; line-height: 1; margin-top: 4px; letter-spacing: -0.01em; }',
        '.agy-pm-cell.is-placeholder .agy-pm-cell-sym { font-size: 8.5px; font-weight: 500; margin-top: 0; }',
        '.agy-pm-cell-dot { position: absolute; top: 3.5px; right: 3.5px; width: 4px; height: 4px; border-radius: 50%; background: currentColor; }',
        /* Google AI Studio 还原色板 */
        '.agy-pm-cell.tone-h, .agy-pm-preview-tile.tone-h { background: #dce8fc; border-color: #3b82f6; color: #1d4ed8; }',
        '.agy-pm-cell.tone-h .agy-pm-cell-num, .agy-pm-preview-tile.tone-h .agy-pm-cell-num { color: #2563eb; }',
        '.agy-pm-cell.tone-c, .agy-pm-preview-tile.tone-c { background: #eadcfb; border-color: #d3b5f7; color: #6b21a8; }',
        '.agy-pm-cell.tone-c .agy-pm-cell-num, .agy-pm-preview-tile.tone-c .agy-pm-cell-num { color: #7e22ce; }',
        '.agy-pm-cell.tone-ne, .agy-pm-preview-tile.tone-ne { background: #d95b38; border-color: #c84c2a; color: #ffffff; }',
        '.agy-pm-cell.tone-ne .agy-pm-cell-num, .agy-pm-preview-tile.tone-ne .agy-pm-cell-num { color: rgba(255,255,255,0.88); }',
        '.agy-pm-cell.tone-ne .agy-pm-cell-dot { background: #ffffff; }',
        '.agy-pm-cell.tone-ar, .agy-pm-preview-tile.tone-ar { background: #cde9d5; border-color: #9dd5ad; color: #15803d; }',
        '.agy-pm-cell.tone-ar .agy-pm-cell-num, .agy-pm-preview-tile.tone-ar .agy-pm-cell-num { color: #166534; }',
        '.agy-pm-cell.tone-blue, .agy-pm-preview-tile.tone-blue { background: #dbeafe; border-color: #93c5fd; color: #1e40af; }',
        '.agy-pm-cell.tone-green, .agy-pm-preview-tile.tone-green { background: #d1fae5; border-color: #6ee7b7; color: #065f46; }',
        '.agy-pm-cell.tone-purple, .agy-pm-preview-tile.tone-purple { background: #ede9fe; border-color: #c4b5fd; color: #5b21b6; }',
        '.agy-pm-cell.tone-amber, .agy-pm-preview-tile.tone-amber { background: #fef3c7; border-color: #fcd34d; color: #92400e; }',
        '.agy-pm-cell.tone-orange, .agy-pm-preview-tile.tone-orange { background: #ffedd5; border-color: #fdba74; color: #9a3412; }',
        '.agy-pm-cell.tone-cyan, .agy-pm-preview-tile.tone-cyan { background: #cffafe; border-color: #67e8f9; color: #155e75; }',
        '.agy-pm-cell.tone-indigo, .agy-pm-preview-tile.tone-indigo { background: #e0e7ff; border-color: #a5b4fc; color: #3730a3; }',
        '.agy-pm-cell.tone-rose, .agy-pm-preview-tile.tone-rose { background: #ffe4e6; border-color: #fda4af; color: #9f1239; }',
        /* 深色主题微调 */
        '[' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-cell.tone-h, [' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-preview-tile.tone-h { background: #1d3659; border-color: #60a5fa; color: #bfdbfe; }',
        '[' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-cell.tone-h .agy-pm-cell-num, [' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-preview-tile.tone-h .agy-pm-cell-num { color: #93c5fd; }',
        '[' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-cell.tone-c, [' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-preview-tile.tone-c { background: #3b2458; border-color: #a855f7; color: #e9d5ff; }',
        '[' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-cell.tone-c .agy-pm-cell-num, [' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-preview-tile.tone-c .agy-pm-cell-num { color: #d8b4fe; }',
        '[' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-cell.tone-ne, [' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-preview-tile.tone-ne { background: #df613e; border-color: #f97316; color: #ffffff; }',
        '[' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-cell.tone-ar, [' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-preview-tile.tone-ar { background: #1c422c; border-color: #4ade80; color: #bbf7d0; }',
        '[' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-cell.tone-ar .agy-pm-cell-num, [' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-preview-tile.tone-ar .agy-pm-cell-num { color: #86efac; }',
        /* 底部详情预览与档位快选卡 */
        '.agy-pm-detail-card {',
        '  min-height: 58px; padding: 9px 11px; border-radius: 10px;',
        '  background: var(--pm-panel-bg); border: 1px solid var(--pm-border);',
        '  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;',
        '}',
        '.agy-pm-detail-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }',
        '.agy-pm-preview-tile {',
        '  position: relative; width: 36px; height: 36px; flex-shrink: 0; border-radius: 7px;',
        '  border: 1px solid var(--pm-cell-border); background: var(--pm-cell-bg); color: var(--pm-cell-text);',
        '  display: flex; align-items: center; justify-content: center; font-weight: 600;',
        '}',
        '.agy-pm-detail-info { min-width: 0; flex: 1; }',
        '.agy-pm-detail-name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
        '.agy-pm-detail-name { font-size: 13px; font-weight: 600; color: var(--pm-text); }',
        '.agy-pm-detail-sub { font-size: 11.5px; color: var(--pm-text-muted); margin-top: 1px; line-height: 1.3; }',
        '.agy-pm-tag {',
        '  display: inline-flex; align-items: center; padding: 1px 5px; border-radius: 4px;',
        '  font-size: 10px; font-weight: 600; background: var(--pm-chip-bg); color: var(--pm-text-muted);',
        '}',
        '.agy-pm-tag.is-new { background: var(--pm-accent-soft); color: var(--pm-accent); }',
        '.agy-pm-tag.is-warn { background: rgba(245, 158, 11, 0.16); color: #b45309; }',
        '[' + INLINE_ATTR + '="1"][data-theme="dark"] .agy-pm-tag.is-warn { color: #fbbf24; }',
        '.agy-pm-detail-right { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }',
        '.agy-pm-effort-btn {',
        '  height: 25px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--pm-border);',
        '  background: var(--pm-surface); color: var(--pm-text); font-size: 11.5px; font-weight: 500;',
        '  cursor: pointer; transition: all 100ms ease;',
        '}',
        '.agy-pm-effort-btn:hover { border-color: var(--pm-accent); color: var(--pm-accent); background: var(--pm-accent-soft); }',
        '.agy-pm-effort-btn.is-active { background: var(--pm-accent); border-color: var(--pm-accent); color: #ffffff; }',
        '.agy-pm-effort-btn.is-orch { border-style: dashed; }',
        '.agy-pm-detail-sep { width: 1px; height: 16px; background: var(--pm-border); margin: 0 2px; flex-shrink: 0; }',
        '.agy-pm-orch-toggle {',
        '  display: inline-flex; align-items: center; gap: 6px; height: 25px; padding: 0 8px;',
        '  border-radius: 999px; border: 1px solid var(--pm-border);',
        '  background: var(--pm-surface); color: var(--pm-text); font-size: 11.5px; font-weight: 500;',
        '  cursor: pointer; transition: all 100ms ease;',
        '}',
        '.agy-pm-orch-toggle:hover { border-color: var(--pm-accent); color: var(--pm-accent); background: var(--pm-accent-soft); }',
        '.agy-pm-orch-toggle.is-active { background: var(--pm-accent-soft); border-color: var(--pm-accent); color: var(--pm-accent); }',
        '.agy-pm-switch-track {',
        '  position: relative; width: 24px; height: 14px; border-radius: 999px;',
        '  background: var(--pm-border-strong); transition: background 120ms ease; flex-shrink: 0;',
        '}',
        '.agy-pm-switch-thumb {',
        '  position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%;',
        '  background: #ffffff; transition: transform 120ms ease; box-shadow: 0 1px 2px rgba(0,0,0,0.25);',
        '}',
        '.agy-pm-orch-toggle.is-active .agy-pm-switch-track { background: var(--pm-accent); }',
        '.agy-pm-orch-toggle.is-active .agy-pm-switch-thumb { transform: translateX(10px); }',
        '.agy-pm-footer-hint {',
        '  display: flex; align-items: center; justify-content: space-between; gap: 8px;',
        '  font-size: 11px; color: var(--pm-text-muted); padding: 0 2px; flex-wrap: wrap;',
        '}',
        '.agy-pm-quick-bar { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }',
        '.agy-pm-quick-chip {',
        '  height: 20px; padding: 0 6px; border-radius: 4px; border: 1px solid var(--pm-border);',
        '  background: var(--pm-surface); color: var(--pm-text); font-size: 10.5px; font-weight: 600; cursor: pointer;',
        '}',
        '.agy-pm-quick-chip:hover { border-color: var(--pm-accent); color: var(--pm-accent); }',
        '.agy-pm-quick-chip.is-locked { background: var(--pm-accent-soft); border-color: var(--pm-accent); color: var(--pm-accent); }',
        '.agy-pm-link-btn { border: none; background: transparent; color: var(--pm-accent); font-size: 11px; font-weight: 500; cursor: pointer; padding: 1px 3px; }',
        '.agy-pm-link-btn:hover { text-decoration: underline; }',
        /* 二级列表 & 搜索列表 */
        '.agy-pm-list-wrap { max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 2px; }',
        '.agy-pm-list-heading { font-size: 11px; font-weight: 600; color: var(--pm-text-muted); letter-spacing: 0.05em; padding: 2px 2px 5px 2px; }',
        '.agy-pm-list-grid { display: flex; flex-direction: column; gap: 5px; }',
        '.agy-pm-model-row {',
        '  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;',
        '  padding: 8px 10px; border-radius: 8px; border: 1px solid var(--pm-border);',
        '  background: var(--pm-surface); cursor: pointer; transition: border-color 100ms ease, background 100ms ease;',
        '}',
        '.agy-pm-model-row:hover { border-color: var(--pm-accent); background: var(--pm-surface-hover); }',
        '.agy-pm-model-row.is-selected { border-color: var(--pm-accent); box-shadow: 0 0 0 1px var(--pm-accent) inset; }',
        '.agy-pm-model-row-main { display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1; }',
        '.agy-pm-mini-tile {',
        '  width: 26px; height: 26px; border-radius: 6px; flex-shrink: 0;',
        '  display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700;',
        '  border: 1px solid var(--pm-border); background: var(--pm-chip-bg); color: var(--pm-text-muted);',
        '}',
        '.agy-pm-empty { text-align: center; padding: 28px 12px; color: var(--pm-text-muted); font-size: 12.5px; }',
      ].join('\n');
      (doc.head || doc.documentElement).appendChild(style);
    }

    function el(tag, attrs, children) {
      var node = w.document.createElement(tag);
      if (attrs) {
        var keys = Object.keys(attrs);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          var v = attrs[k];
          if (v === undefined || v === null || v === false) continue;
          if (k === 'className') node.className = v;
          else if (k === 'text') node.textContent = String(v);
          else if (k === 'style' && typeof v === 'object') {
            var sk = Object.keys(v);
            for (var j = 0; j < sk.length; j++) node.style[sk[j]] = v[sk[j]];
          } else if (k.indexOf('on') === 0 && typeof v === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), v);
          } else if (v === true) {
            node.setAttribute(k, '');
          } else {
            node.setAttribute(k, String(v));
          }
        }
      }
      if (Array.isArray(children)) {
        for (var c = 0; c < children.length; c++) {
          var ch = children[c];
          if (ch === null || ch === undefined || ch === false) continue;
          if (typeof ch === 'string' || typeof ch === 'number') {
            node.appendChild(w.document.createTextNode(String(ch)));
          } else {
            node.appendChild(ch);
          }
        }
      }
      return node;
    }

    function svgEl(tag, attrs, children) {
      var node = w.document.createElementNS('http://www.w3.org/2000/svg', tag);
      if (attrs) {
        var keys = Object.keys(attrs);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          var v = attrs[k];
          if (v === undefined || v === null || v === false) continue;
          node.setAttribute(k === 'className' ? 'class' : k, String(v));
        }
      }
      if (Array.isArray(children)) {
        for (var c = 0; c < children.length; c++) {
          if (children[c]) node.appendChild(children[c]);
        }
      }
      return node;
    }

    function findNativeFooterNodesToHide(panel) {
      var result = [];
      if (!panel || !panel.children) return result;
      var nativeList = findNativeListNode(panel);
      var children = panel.children;
      for (var i = 0; i < children.length; i++) {
        var ch = children[i];
        if (!ch || ch.nodeType !== 1 || ch === nativeList) continue;
        if (ch.getAttribute(INLINE_ATTR) === '1' || ch.getAttribute(NATIVE_BAR_ATTR) === '1') continue;
        if (
          ch.querySelector
          && (ch.querySelector('[data-testid="model-selector-header"]')
            || ch.querySelector('[data-testid="model-selector-item"]'))
        ) {
          continue;
        }
        var tid = ch.getAttribute('data-testid') || '';
        var txt = (ch.textContent || '').trim();
        var isUsage = tid === 'native-usage-footer' || /查看用量|View\s+Usage/i.test(txt);
        if (!isUsage) continue;

        // 若容器内除了「查看用量」还混有升级提示或外部 footerExtra，仅隐藏用量行本身
        var subEls = [];
        for (var j = 0; j < ch.children.length; j++) {
          if (ch.children[j] && ch.children[j].nodeType === 1) subEls.push(ch.children[j]);
        }
        var nonUsageSub = false;
        var usageSubNodes = [];
        for (var k = 0; k < subEls.length; k++) {
          var st = (subEls[k].textContent || '').trim();
          if (/查看用量|View\s+Usage/i.test(st)) usageSubNodes.push(subEls[k]);
          else if (st) nonUsageSub = true;
        }

        if (subEls.length > 1 && nonUsageSub && usageSubNodes.length) {
          for (var u = 0; u < usageSubNodes.length; u++) result.push(usageSubNodes[u]);
        } else {
          // 同时隐藏紧邻其上方的原生细分割线（DW）
          for (var prevIdx = i - 1; prevIdx >= 0; prevIdx--) {
            var prev = children[prevIdx];
            if (!prev || prev.nodeType !== 1) continue;
            if (prev.getAttribute(INLINE_ATTR) === '1' || prev.getAttribute(NATIVE_BAR_ATTR) === '1') continue;
            var prevCls = typeof prev.className === 'string' ? prev.className : '';
            var prevRole = prev.getAttribute('role') || '';
            var prevTxt = (prev.textContent || '').trim();
            if (prev !== nativeList && (prevRole === 'separator' || (prevCls.indexOf('h-px') !== -1 && !prevTxt))) {
              result.push(prev);
            }
            break;
          }
          result.push(ch);
        }
      }
      return result;
    }

    // 每个原生 panel 对应的原地挂载实例（使用 WeakMap 随 React 卸载自动释放）
    var panelStates = typeof WeakMap === 'function' ? new WeakMap() : null;
    var activeInstance = null;

    function findNativeListNode(panel) {
      var children = panel.children || [];
      for (var i = 0; i < children.length; i++) {
        var ch = children[i];
        if (!ch || ch.nodeType !== 1) continue;
        if (ch.getAttribute(INLINE_ATTR) === '1' || ch.getAttribute(NATIVE_BAR_ATTR) === '1') continue;
        if (
          ch.querySelector('[data-testid="model-selector-header"]')
          || ch.querySelector('[data-testid="model-selector-loading"]')
          || ch.querySelector('[data-testid="model-selector-empty"]')
          || ch.querySelector('[data-testid="model-selector-item"]')
          || ch.querySelector('[data-testid="model-selector-effort-group"]')
        ) {
          return ch;
        }
      }
      return null;
    }

    function findPopoverContainer(panel) {
      if (!panel) return null;
      if (typeof panel.closest === 'function') {
        var overlay = panel.closest('.agy-overlay');
        if (overlay) return overlay;
      }
      return panel.parentElement || null;
    }

    function nudgePopoverWithinViewport(popover) {
      if (!popover || typeof popover.getBoundingClientRect !== 'function') return;
      try {
        // 先让 Floating UI / Base UI 感知尺寸变化重算定位
        w.dispatchEvent(new w.Event('resize'));
      } catch (_) {}
      var check = function () {
        if (!popover || !popover.isConnected) return;
        try {
          var rect = popover.getBoundingClientRect();
          var vw = w.innerWidth || 0;
          if (vw > 0 && rect.width > 0) {
            if (rect.right > vw - 10) {
              var shift = Math.ceil(rect.right - (vw - 10));
              popover.style.marginLeft = '-' + shift + 'px';
            } else if (rect.left < 10) {
              popover.style.marginLeft = Math.ceil(10 - rect.left) + 'px';
            }
          }
        } catch (_) {}
      };
      if (typeof w.requestAnimationFrame === 'function') w.requestAnimationFrame(check);
      else w.setTimeout(check, 16);
    }

    // 防止 setSelectedModel 内部调用 editor.focus() 触发原生菜单 focusout 自动关闭
    var suppressFocusOutUntil = 0;
    if (w.document && typeof w.document.addEventListener === 'function') {
      w.document.addEventListener('focusout', function (ev) {
        if (Date.now() < suppressFocusOutUntil) {
          ev.stopImmediatePropagation();
        }
      }, true);
    }

    function selectModelOption(inst, opt, ctxWindow, orchestratorPlannerOpt) {
      if (!inst || !opt || !inst.ctrl || typeof inst.ctrl.setSelectedModel !== 'function') return false;
      // 重新从 panel 取最新外层控制器（避免闭包过期，确保拿到不关闭菜单的原始 setSelectedModel）
      var freshCtrl = inst.panel ? resolveControllerForPanel(inst.panel) : null;
      if (freshCtrl) inst.ctrl = freshCtrl;

      var prevPlannerVal = (inst.ctrl.orchestratorPick && typeof inst.ctrl.orchestratorPick.model === 'number')
        ? inst.ctrl.orchestratorPick.model
        : 0;

      suppressFocusOutUntil = Date.now() + 220;
      try {
        // 统一 Orchestrator Planner 模式：必须先通过 orchestratorPick.select(plannerValue) 指定规划器模型，再切到 Orchestrator 模式
        if (
          orchestratorPlannerOpt
          && typeof orchestratorPlannerOpt.value === 'number'
          && inst.ctrl.orchestratorPick
          && typeof inst.ctrl.orchestratorPick.select === 'function'
        ) {
          inst.ctrl.orchestratorPick.select(orchestratorPlannerOpt.value);
        }
        if (ctxWindow !== undefined) inst.ctrl.setSelectedModel(opt, ctxWindow);
        else inst.ctrl.setSelectedModel(opt);
      } catch (err) {
        try { console.error('[agy-periodic-model] setSelectedModel failed:', err); } catch (_) {}
        return false;
      }

      // 将焦点留在当前菜单面板内，避免被外部输入框抢走导致弹窗意外收起
      if (inst.inlineRoot && typeof inst.inlineRoot.focus === 'function') {
        try { inst.inlineRoot.focus({ preventScroll: true }); } catch (_) {}
      }

      // 保持菜单打开，立即乐观更新高亮状态，方便连续选择模型 + 思考等级
      inst.selectedOverride = opt.label;
      if (orchestratorPlannerOpt && typeof orchestratorPlannerOpt.value === 'number' && orchestratorPlannerOpt.value > 0) {
        inst.prevOrchPlannerValue = prevPlannerVal;
        inst.selectedOrchestratorPlannerValue = orchestratorPlannerOpt.value;
      } else {
        inst.prevOrchPlannerValue = 0;
        inst.selectedOrchestratorPlannerValue = 0;
      }
      inst.catalog = buildCatalog(inst.ctrl, inst.selectedOverride, inst.selectedOrchestratorPlannerValue, inst.panel);
      inst.sig = computeCatalogSignature(inst.ctrl, inst.selectedOverride, inst.selectedOrchestratorPlannerValue, inst.panel);
      var parsed = parseModelLabel(orchestratorPlannerOpt ? orchestratorPlannerOpt.label : opt.label, !!opt.isCustom);
      var elem = !opt.isCustom ? matchGemini4Element(parsed.base) : null;
      if (elem && inst.catalog.periodicBySymbol[elem.symbol]) {
        inst.lockedSymbol = elem.symbol;
        inst.hoveredEl = null;
      }
      renderInlineContent(inst);
      return true;
    }

    function getActivePreviewTarget(inst) {
      var cat = inst.catalog;
      if (!cat) return null;
      if (inst.hoveredEl) {
        var matched = cat.periodicBySymbol[inst.hoveredEl.symbol] || null;
        return { element: inst.hoveredEl, entry: matched };
      }
      if (inst.lockedSymbol && cat.periodicBySymbol[inst.lockedSymbol]) {
        var locked = cat.periodicBySymbol[inst.lockedSymbol];
        return { element: locked.element, entry: locked };
      }
      if (cat.selectedPeriodic) {
        return { element: cat.selectedPeriodic.element, entry: cat.selectedPeriodic };
      }
      if (cat.activeOrchestratorElement && cat.periodicBySymbol[cat.activeOrchestratorElement.symbol]) {
        var activeOrchEntry = cat.periodicBySymbol[cat.activeOrchestratorElement.symbol];
        return { element: activeOrchEntry.element, entry: activeOrchEntry };
      }
      if (cat.periodicEntries.length) {
        return { element: cat.periodicEntries[0].element, entry: cat.periodicEntries[0] };
      }
      return null;
    }

    function renderDetailCard(inst) {
      var cat = inst.catalog;
      var target = getActivePreviewTarget(inst);
      if (!target) {
        return el('div', { className: 'agy-pm-detail-card', 'data-testid': 'agy-pm-detail-card' }, [
          el('div', { className: 'agy-pm-detail-sub', text: '当前账号暂无 Gemini 4 周期表元素模型，请切换到上方「其他模型」或「All」。' }),
        ]);
      }

      var elem = target.element;
      var entry = target.entry;
      var tone = entry ? getToneClass(elem.symbol, elem.family) : '';

      var tile = el('div', { className: 'agy-pm-preview-tile' + (tone ? ' ' + tone : '') }, [
        el('span', { className: 'agy-pm-cell-num', text: elem.number }),
        el('span', { className: 'agy-pm-cell-sym', text: elem.symbol }),
      ]);

      if (!entry) {
        return el('div', { className: 'agy-pm-detail-card', 'data-testid': 'agy-pm-detail-card', 'data-supported': 'false' }, [
          el('div', { className: 'agy-pm-detail-left' }, [
            tile,
            el('div', { className: 'agy-pm-detail-info' }, [
              el('div', { className: 'agy-pm-detail-name-row' }, [
                el('span', { className: 'agy-pm-detail-name', text: elem.name + ' · ' + elem.zhName }),
                el('span', { className: 'agy-pm-tag', text: '暂未支持 · 不可选' }),
              ]),
              el('div', { className: 'agy-pm-detail-sub', text: '该元素对应的 Gemini 4 模型尚未在当前账号开放。' }),
            ]),
          ]),
        ]);
      }

      var nameChildren = [
        el('span', { className: 'agy-pm-detail-name', text: entry.base }),
        el('span', { className: 'agy-pm-tag', text: elem.zhName }),
      ];
      if (entry.tagTitle) {
        nameChildren.push(el('span', {
          className: 'agy-pm-tag ' + (entry.tagTitle.toLowerCase() === 'notice' ? 'is-warn' : 'is-new'),
          text: entry.tagTitle,
        }));
      }
      if (entry.weeklyQuota) {
        var resetHint = formatResetCountdown(entry.weeklyQuota.resetTimeMs);
        nameChildren.push(el('span', {
          className: 'agy-pm-tag',
          'data-testid': 'agy-pm-weekly-quota',
          title: '周额度剩余 ' + entry.weeklyQuota.percent + '%' + (resetHint ? (' · ' + resetHint) : ''),
          text: '周额度 ' + entry.weeklyQuota.percent + '%',
        }));
      }

      var symPlanners = entry.orchestratorPlanners;
      var isUnifiedOrch = !!(entry.orchestratorOption && cat.unifiedOrchestratorMode && Array.isArray(symPlanners) && symPlanners.length);
      var isCurOrch = false;
      var activePlannerMatch = null;
      if (entry.orchestratorOption) {
        if (isUnifiedOrch) {
          if (cat.isOrchestratorSelected && cat.activeOrchestratorPlanner) {
            for (var opi = 0; opi < symPlanners.length; opi++) {
              if (symPlanners[opi].value === cat.activeOrchestratorPlanner.value) {
                isCurOrch = true;
                activePlannerMatch = symPlanners[opi];
                break;
              }
            }
          }
        } else {
          isCurOrch = entry.orchestratorOption.label === cat.selectedLabel;
        }
      }

      var rightBtns = [];
      if (entry.efforts && entry.efforts.length) {
        for (var i = 0; i < entry.efforts.length; i++) {
          (function (ef) {
            var isCur = isCurOrch && activePlannerMatch
              ? (ef.option.value === activePlannerMatch.value || ef.option.label === activePlannerMatch.label)
              : (ef.option.label === cat.selectedLabel);
            rightBtns.push(el('button', {
              type: 'button',
              className: 'agy-pm-effort-btn' + (isCur ? ' is-active' : ''),
              'data-testid': 'agy-pm-detail-effort',
              'data-effort': ef.effort,
              text: ef.label,
              onClick: function (ev) {
                ev.stopPropagation();
                if (isCurOrch && isUnifiedOrch) {
                  var matchedPlanner = null;
                  for (var pi = 0; pi < symPlanners.length; pi++) {
                    var sp = symPlanners[pi];
                    if (sp.value === ef.option.value || parseModelLabel(sp.label, false).effort === ef.effort) {
                      matchedPlanner = sp;
                      break;
                    }
                  }
                  if (matchedPlanner) {
                    selectModelOption(inst, entry.orchestratorOption, undefined, matchedPlanner);
                    return;
                  }
                }
                selectModelOption(inst, ef.option);
              },
            }));
          })(entry.efforts[i]);
        }
      } else if (entry.defaultOption) {
        var isCurSingle = entry.defaultOption.label === cat.selectedLabel;
        rightBtns.push(el('button', {
          type: 'button',
          className: 'agy-pm-effort-btn' + (isCurSingle ? ' is-active' : ''),
          text: isCurSingle ? '当前' : '选择',
          onClick: function (ev) {
            ev.stopPropagation();
            selectModelOption(inst, entry.defaultOption);
          },
        }));
      }

      if (entry.orchestratorOption) {
        (function (orchOpt) {
          if (rightBtns.length > 0) {
            rightBtns.push(el('span', { className: 'agy-pm-detail-sep', 'aria-hidden': 'true' }));
          }
          var targetPlanner = isUnifiedOrch
            ? pickOrchestratorPlannerOption(symPlanners, cat.selectedLabel, cat.activeOrchestratorPlanner, cat.isOrchestratorSelected)
            : null;
          var orchTitle = isCurOrch
            ? '关闭 Orchestrator（保留当前思考等级）'
            : (isUnifiedOrch && targetPlanner
              ? ('开启 Orchestrator（规划器：' + targetPlanner.label + '）')
              : (orchOpt.tagDescription || orchOpt.label));
          rightBtns.push(el('button', {
            type: 'button',
            className: 'agy-pm-orch-toggle' + (isCurOrch ? ' is-active' : ''),
            role: 'switch',
            'aria-checked': isCurOrch ? 'true' : 'false',
            'data-testid': 'agy-pm-detail-orchestrator',
            title: orchTitle,
            onClick: function (ev) {
              ev.stopPropagation();
              if (isCurOrch) {
                var normalOpt = null;
                if (activePlannerMatch) {
                  if (entry.efforts && entry.efforts.length) {
                    for (var ni = 0; ni < entry.efforts.length; ni++) {
                      var neo = entry.efforts[ni].option;
                      if (neo.value === activePlannerMatch.value || neo.label === activePlannerMatch.label) {
                        normalOpt = neo;
                        break;
                      }
                    }
                  }
                  if (!normalOpt) normalOpt = pickDefaultOption(entry, activePlannerMatch.label);
                  if (!normalOpt) normalOpt = activePlannerMatch;
                } else {
                  normalOpt = pickDefaultOption(entry, cat.selectedLabel);
                }
                if (normalOpt) selectModelOption(inst, normalOpt);
                return;
              }
              if (isUnifiedOrch && targetPlanner) {
                selectModelOption(inst, orchOpt, undefined, targetPlanner);
              } else {
                selectModelOption(inst, orchOpt);
              }
            },
          }, [
            el('span', { text: 'Orchestrator' }),
            el('span', { className: 'agy-pm-switch-track' }, [
              el('span', { className: 'agy-pm-switch-thumb' }),
            ]),
          ]));
        })(entry.orchestratorOption);
      }

      var ctxCtrl = inst.ctrl && inst.ctrl.contextWindow;
      var activeOptForCtx = pickDefaultOption(entry, cat.selectedLabel, getCurrentEffort(cat));
      var ctxOpts = activeOptForCtx && Array.isArray(activeOptForCtx.contextWindowOptions) ? activeOptForCtx.contextWindowOptions : null;
      if (ctxCtrl && ctxOpts && ctxOpts.length) {
        for (var cIdx = 0; cIdx < ctxOpts.length; cIdx++) {
          (function (co) {
            var isCtxCur = ctxCtrl.selected === co.name && isEntrySelected(entry, cat.selectedLabel);
            rightBtns.push(el('button', {
              type: 'button',
              className: 'agy-pm-effort-btn' + (isCtxCur ? ' is-active' : ''),
              title: co.description || co.name,
              text: co.name,
              onClick: function (ev) {
                ev.stopPropagation();
                selectModelOption(inst, activeOptForCtx, co.name);
              },
            }));
          })(ctxOpts[cIdx]);
        }
      }

      return el('div', { className: 'agy-pm-detail-card', 'data-testid': 'agy-pm-detail-card', 'data-supported': 'true' }, [
        el('div', { className: 'agy-pm-detail-left' }, [
          tile,
          el('div', { className: 'agy-pm-detail-info' }, [
            el('div', { className: 'agy-pm-detail-name-row' }, nameChildren),
            entry.tagDescription ? el('div', { className: 'agy-pm-detail-sub', text: entry.tagDescription }) : null,
          ]),
        ]),
        el('div', { className: 'agy-pm-detail-right' }, rightBtns),
      ]);
    }

    function updateDetailCardOnly(inst) {
      if (!inst || !inst.inlineRoot) return;
      var oldCard = inst.inlineRoot.querySelector('[data-testid="agy-pm-detail-card"]');
      if (!oldCard || !oldCard.parentNode) return;
      oldCard.parentNode.replaceChild(renderDetailCard(inst), oldCard);
    }

    function renderPeriodicView(inst) {
      var cat = inst.catalog;
      var gridChildren = [];

      gridChildren.push(el('div', { className: 'agy-pm-hero' }, [
        el('div', { className: 'agy-pm-hero-kicker', text: 'THE PERIODIC TABLE OF' }),
        el('div', { className: 'agy-pm-hero-title', text: 'Gemini 4' }),
        el('div', { className: 'agy-pm-hero-meta' }, [
          el('span', { className: 'agy-pm-hero-count', text: String(cat.releasedCount) }),
          el('span', { text: 'released' }),
        ]),
      ]));

      for (var i = 0; i < ELEMENTS.length; i++) {
        (function (rawEl) {
          var isPlaceholder = rawEl[6] === 'placeholder';
          var elemObj = {
            number: rawEl[0],
            symbol: rawEl[1],
            name: rawEl[2],
            zhName: rawEl[3],
            row: rawEl[4],
            col: rawEl[5],
            family: rawEl[6],
          };
          var entry = !isPlaceholder ? (cat.periodicBySymbol[elemObj.symbol] || null) : null;
          var supported = !!entry;
          var isSelected = supported && (
            isEntrySelected(entry, cat.selectedLabel)
            || !!(cat.isOrchestratorSelected && cat.activeOrchestratorElement && cat.activeOrchestratorElement.symbol === elemObj.symbol)
          );
          var tone = supported ? getToneClass(elemObj.symbol, elemObj.family) : '';

          var cls = 'agy-pm-cell'
            + (isPlaceholder ? ' is-placeholder' : '')
            + (tone ? ' ' + tone : '')
            + (isSelected ? ' is-selected' : '');

          var cellChildren = [];
          if (!isPlaceholder) {
            cellChildren.push(el('span', { className: 'agy-pm-cell-num', text: elemObj.number }));
          }
          cellChildren.push(el('span', { className: 'agy-pm-cell-sym', text: elemObj.symbol }));
          if (supported && elemObj.symbol === 'Ne') {
            cellChildren.push(el('span', { className: 'agy-pm-cell-dot' }));
          }

          var btn = el('button', {
            type: 'button',
            className: cls,
            disabled: (!supported || isPlaceholder) ? true : false,
            tabindex: (!supported || isPlaceholder) ? '-1' : undefined,
            'data-testid': 'agy-pm-element-' + elemObj.symbol,
            'data-symbol': elemObj.symbol,
            'data-supported': supported ? 'true' : 'false',
            'aria-disabled': supported ? 'false' : 'true',
            'aria-label': supported
              ? (entry.base + ' (' + elemObj.symbol + ')')
              : (elemObj.name + ' (' + elemObj.symbol + ', 暂未支持)'),
            title: supported ? (entry.base + ' · 左键切换，右键锁定挑档位') : undefined,
            style: { gridRow: String(elemObj.row), gridColumn: String(elemObj.col) },
            onMouseEnter: function () {
              if (!supported || isPlaceholder) return;
              inst.hoveredEl = elemObj;
              updateDetailCardOnly(inst);
            },
            onFocus: function () {
              if (!supported || isPlaceholder) return;
              inst.hoveredEl = elemObj;
              updateDetailCardOnly(inst);
            },
            onContextMenu: function (ev) {
              ev.preventDefault();
              ev.stopPropagation();
              if (!supported) return;
              inst.lockedSymbol = elemObj.symbol;
              inst.hoveredEl = null;
              renderInlineBody(inst);
            },
            onClick: function (ev) {
              ev.preventDefault();
              ev.stopPropagation();
              if (!supported || isPlaceholder) return;
              inst.lockedSymbol = elemObj.symbol;
              inst.hoveredEl = null;
              if (ev.shiftKey) {
                renderInlineBody(inst);
                return;
              }
              var curEffort = getCurrentEffort(cat);
              if (
                cat.unifiedOrchestratorMode
                && cat.isOrchestratorSelected
                && entry.orchestratorOption
                && entry.orchestratorPlanners
                && entry.orchestratorPlanners.length
              ) {
                var nextPlanner = pickOptionByEffort(entry.orchestratorPlanners, curEffort, 'highest');
                if (nextPlanner) {
                  selectModelOption(inst, entry.orchestratorOption, undefined, nextPlanner);
                  return;
                }
              }
              var opt = pickDefaultOption(entry, cat.selectedLabel, curEffort);
              if (opt) selectModelOption(inst, opt);
            },
          }, cellChildren);

          gridChildren.push(btn);
        })(ELEMENTS[i]);
      }

      var grid = el('div', {
        className: 'agy-pm-grid',
        onMouseLeave: function () {
          if (inst.hoveredEl) {
            inst.hoveredEl = null;
            updateDetailCardOnly(inst);
          }
        },
      }, gridChildren);

      var tableCard = el('div', { className: 'agy-pm-table-card' }, [
        grid,
        el('div', { className: 'agy-pm-grid-fade' }),
      ]);

      var quickChildren = [];
      if (cat.periodicEntries.length) {
        quickChildren.push(el('span', { text: '调档位：' }));
        var activeSym = inst.lockedSymbol
          || (cat.selectedPeriodic ? cat.selectedPeriodic.element.symbol : null)
          || (cat.activeOrchestratorElement ? cat.activeOrchestratorElement.symbol : null);
        for (var qi = 0; qi < cat.periodicEntries.length; qi++) {
          (function (pe) {
            var sym = pe.element.symbol;
            quickChildren.push(el('button', {
              type: 'button',
              className: 'agy-pm-quick-chip' + (activeSym === sym ? ' is-locked' : ''),
              'data-testid': 'agy-pm-quick-' + sym,
              text: pe.element.number + ' ' + sym,
              title: '锁定 ' + pe.base + ' 并选择推理档位',
              onClick: function (ev) {
                ev.stopPropagation();
                inst.lockedSymbol = sym;
                inst.hoveredEl = null;
                renderInlineBody(inst);
              },
            }));
          })(cat.periodicEntries[qi]);
        }
      }

      var footerRightChildren = [];
      if (cat.selectedOther) {
        footerRightChildren.push(el('span', { text: '当前表外：' + (cat.selectedDisplayLabel || cat.selectedLabel) + ' · ' }));
      }
      if (cat.otherEntries.length) {
        footerRightChildren.push(el('button', {
          type: 'button',
          className: 'agy-pm-link-btn',
          'data-testid': 'agy-pm-goto-other',
          text: '不在表里的其他 ' + cat.otherEntries.length + ' 个模型 →',
          onClick: function (ev) {
            ev.stopPropagation();
            inst.activeTab = 'other';
            renderInlineContent(inst);
          },
        }));
      }

      return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
        tableCard,
        renderDetailCard(inst),
        el('div', { className: 'agy-pm-footer-hint' }, [
          el('div', { className: 'agy-pm-quick-bar' }, quickChildren),
          el('div', {}, footerRightChildren),
        ]),
      ]);
    }

    function matchesQuery(entry, q) {
      if (!q) return true;
      var s = q.toLowerCase();
      if (entry.base.toLowerCase().indexOf(s) !== -1) return true;
      if (entry.tagDescription && entry.tagDescription.toLowerCase().indexOf(s) !== -1) return true;
      if (entry.category && entry.category.label.toLowerCase().indexOf(s) !== -1) return true;
      var elemForSearch = entry.element || entry.plannerElement;
      if (elemForSearch) {
        if (elemForSearch.symbol.toLowerCase().indexOf(s) !== -1) return true;
        if (elemForSearch.name.toLowerCase().indexOf(s) !== -1) return true;
        if (elemForSearch.zhName.indexOf(q) !== -1) return true;
        if (String(elemForSearch.number) === s) return true;
      }
      if (entry.efforts) {
        for (var i = 0; i < entry.efforts.length; i++) {
          if (entry.efforts[i].option.label.toLowerCase().indexOf(s) !== -1) return true;
        }
      }
      return false;
    }

    function renderModelRow(inst, entry) {
      var cat = inst.catalog;
      var activeOrchPlannerVal = cat.activeOrchestratorPlanner ? cat.activeOrchestratorPlanner.value : 0;
      var isSel = isEntrySelected(entry, cat.selectedLabel, activeOrchPlannerVal, cat.isOrchestratorSelected);
      var miniTile;
      if (entry.element) {
        miniTile = el('div', {
          className: 'agy-pm-mini-tile ' + getToneClass(entry.element.symbol, entry.element.family),
          text: entry.element.symbol,
        });
      } else {
        var abbr = entry.category && entry.category.id === 'orchestrator'
          ? 'OR'
          : (entry.category && entry.category.id === 'claude'
            ? 'CL'
            : (entry.category && entry.category.id === 'gpt'
              ? 'GP'
              : (entry.category && entry.category.id === 'gemini-legacy' ? 'G3' : 'AI')));
        miniTile = el('div', { className: 'agy-pm-mini-tile', text: abbr });
      }

      var titleRow = [el('span', { className: 'agy-pm-detail-name', text: entry.base })];
      if (entry.tagTitle) {
        titleRow.push(el('span', {
          className: 'agy-pm-tag ' + (entry.tagTitle.toLowerCase() === 'notice' ? 'is-warn' : 'is-new'),
          text: entry.tagTitle,
        }));
      }
      if (entry.weeklyQuota) {
        var rowResetHint = formatResetCountdown(entry.weeklyQuota.resetTimeMs);
        titleRow.push(el('span', {
          className: 'agy-pm-tag',
          'data-testid': 'agy-pm-weekly-quota',
          title: '周额度剩余 ' + entry.weeklyQuota.percent + '%' + (rowResetHint ? (' · ' + rowResetHint) : ''),
          text: '周额度 ' + entry.weeklyQuota.percent + '%',
        }));
      }

      var rightBtns = [];
      if (entry.efforts && entry.efforts.length) {
        for (var i = 0; i < entry.efforts.length; i++) {
          (function (ef) {
            var active = entry.isOrchestratorPlannerEntry
              ? !!(cat.isOrchestratorSelected && activeOrchPlannerVal && ef.option.value === activeOrchPlannerVal)
              : (ef.option.label === cat.selectedLabel);
            rightBtns.push(el('button', {
              type: 'button',
              className: 'agy-pm-effort-btn' + (active ? ' is-active' : ''),
              'data-testid': 'agy-pm-list-effort',
              'data-model-label': ef.option.label,
              text: ef.label,
              onClick: function (ev) {
                ev.stopPropagation();
                if (entry.isOrchestratorPlannerEntry && entry.orchestratorBaseOption) {
                  selectModelOption(inst, entry.orchestratorBaseOption, undefined, ef.option);
                } else {
                  selectModelOption(inst, ef.option);
                }
              },
            }));
          })(entry.efforts[i]);
        }
      } else if (entry.defaultOption) {
        var activeSingle = entry.isOrchestratorPlannerEntry
          ? !!(cat.isOrchestratorSelected && activeOrchPlannerVal && entry.defaultOption.value === activeOrchPlannerVal)
          : (entry.defaultOption.label === cat.selectedLabel);
        rightBtns.push(el('button', {
          type: 'button',
          className: 'agy-pm-effort-btn' + (activeSingle ? ' is-active' : ''),
          text: activeSingle ? '当前' : '选择',
          onClick: function (ev) {
            ev.stopPropagation();
            if (entry.isOrchestratorPlannerEntry && entry.orchestratorBaseOption) {
              selectModelOption(inst, entry.orchestratorBaseOption, undefined, entry.defaultOption);
            } else {
              selectModelOption(inst, entry.defaultOption);
            }
          },
        }));
      }

      return el('div', {
        className: 'agy-pm-model-row' + (isSel ? ' is-selected' : ''),
        'data-testid': 'agy-pm-list-row',
        'data-model-base': entry.base,
        onClick: function (ev) {
          ev.stopPropagation();
          if (entry.isOrchestratorPlannerEntry && entry.orchestratorBaseOption) {
            var plannerOpt = pickOrchestratorPlannerOption(entry.plannerOptions, cat.selectedLabel, cat.activeOrchestratorPlanner, cat.isOrchestratorSelected) || entry.defaultOption;
            if (plannerOpt) selectModelOption(inst, entry.orchestratorBaseOption, undefined, plannerOpt);
            return;
          }
          var opt = pickDefaultOption(entry, cat.selectedLabel, getCurrentEffort(cat));
          if (opt) selectModelOption(inst, opt);
        },
      }, [
        el('div', { className: 'agy-pm-model-row-main' }, [
          miniTile,
          el('div', { className: 'agy-pm-detail-info' }, [
            el('div', { className: 'agy-pm-detail-name-row' }, titleRow),
            entry.tagDescription ? el('div', { className: 'agy-pm-detail-sub', text: entry.tagDescription }) : null,
          ]),
        ]),
        el('div', { className: 'agy-pm-detail-right' }, rightBtns),
      ]);
    }

    function renderListView(inst) {
      var cat = inst.catalog;
      var q = inst.query.trim();
      var sections = [];

      if (q) {
        var matched = [];
        for (var i = 0; i < cat.allEntries.length; i++) {
          if (matchesQuery(cat.allEntries[i], q)) matched.push(cat.allEntries[i]);
        }
        if (!matched.length) {
          return el('div', { className: 'agy-pm-empty', text: '没有找到匹配 “' + q + '” 的可用模型' });
        }
        sections.push({ title: '搜索结果 (' + matched.length + ')', entries: matched });
      } else if (inst.activeTab === 'all') {
        if (cat.periodicEntries.length) {
          sections.push({ title: 'Gemini 4 周期表模型 (' + cat.periodicEntries.length + ')', entries: cat.periodicEntries });
        }
        for (var c1 = 0; c1 < cat.otherCategories.length; c1++) {
          var oc1 = cat.otherCategories[c1];
          sections.push({ title: oc1.label + ' (' + oc1.entries.length + ')', entries: oc1.entries });
        }
      } else if (inst.activeTab === 'other') {
        for (var c2 = 0; c2 < cat.otherCategories.length; c2++) {
          var oc2 = cat.otherCategories[c2];
          sections.push({ title: oc2.label + ' (' + oc2.entries.length + ')', entries: oc2.entries });
        }
      } else {
        for (var c3 = 0; c3 < cat.otherCategories.length; c3++) {
          var oc3 = cat.otherCategories[c3];
          if (oc3.id === inst.activeTab) {
            sections.push({ title: oc3.label + ' (' + oc3.entries.length + ')', entries: oc3.entries });
            break;
          }
        }
      }

      if (!sections.length) return el('div', { className: 'agy-pm-empty', text: '该分类下暂无可用模型' });

      var secNodes = [];
      for (var s = 0; s < sections.length; s++) {
        var sec = sections[s];
        var rows = [];
        for (var r = 0; r < sec.entries.length; r++) rows.push(renderModelRow(inst, sec.entries[r]));
        secNodes.push(el('div', {}, [
          el('div', { className: 'agy-pm-list-heading', text: sec.title }),
          el('div', { className: 'agy-pm-list-grid' }, rows),
        ]));
      }
      return el('div', { className: 'agy-pm-list-wrap' }, secNodes);
    }

    function getQuotaPieColor(bucket) {
      if (!bucket || bucket.placeholder || bucket.percent === null) return 'var(--pm-border-strong)';
      if (bucket.percent < 10) return '#ef4444';
      if (bucket.percent < 25) return '#f59e0b';
      if (bucket.family === '3p') return '#10b981';
      return '#3b82f6';
    }

    function renderQuotaPies() {
      var items;
      if (weeklyQuotaStore.allBuckets.length) {
        items = weeklyQuotaStore.allBuckets;
      } else {
        var bridgeGem = readBridgeGeminiWeeklyFallback();
        items = [
          bridgeGem
            ? {
              id: 'gemini-weekly-fallback',
              groupIndex: 0,
              family: 'gemini',
              groupLabel: 'Gemini',
              windowLabel: '周额度',
              title: 'Gemini · 周额度',
              percent: bridgeGem.percent,
              fraction: bridgeGem.percent / 100,
              resetTimeMs: bridgeGem.resetTimeMs,
              placeholder: false,
            }
            : { id: 'gemini-weekly-ph', groupIndex: 0, family: 'gemini', title: 'Gemini · 周额度', percent: null, fraction: 0, resetTimeMs: null, placeholder: true },
          { id: 'gemini-5h-ph', groupIndex: 0, family: 'gemini', title: 'Gemini · 5h 额度', percent: null, fraction: 0, resetTimeMs: null, placeholder: true },
          { id: '3p-weekly-ph', groupIndex: 1, family: '3p', title: 'Claude / GPT · 周额度', percent: null, fraction: 0, resetTimeMs: null, placeholder: true },
          { id: '3p-5h-ph', groupIndex: 1, family: '3p', title: 'Claude / GPT · 5h 额度', percent: null, fraction: 0, resetTimeMs: null, placeholder: true },
        ];
      }

      var circ = 2 * Math.PI * 7.5;
      var children = [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (i > 0 && item.groupIndex !== items[i - 1].groupIndex) {
          children.push(el('span', { className: 'agy-pm-quota-pie-sep', 'aria-hidden': 'true' }));
        }
        var color = getQuotaPieColor(item);
        var svgChildren = [
          svgEl('circle', {
            cx: '18',
            cy: '18',
            r: '15.5',
            fill: 'var(--pm-chip-bg)',
            stroke: 'var(--pm-border)',
            'stroke-width': '1',
          }),
        ];
        if (!item.placeholder && item.fraction > 0) {
          var filled = Math.max(0, Math.min(1, item.fraction)) * circ;
          svgChildren.push(svgEl('circle', {
            cx: '18',
            cy: '18',
            r: '7.5',
            fill: 'transparent',
            stroke: color,
            'stroke-width': '15',
            'stroke-dasharray': filled.toFixed(2) + ' ' + circ.toFixed(2),
            transform: 'rotate(-90 18 18)',
          }));
        }
        var resetHint = item.resetTimeMs ? formatResetCountdown(item.resetTimeMs) : '';
        var metaText = item.placeholder
          ? '等待同步额度数据'
          : ('剩余 ' + item.percent + '%' + (resetHint ? (' · ' + resetHint) : ''));

        children.push(el('div', {
          className: 'agy-pm-quota-pie' + (item.placeholder ? ' is-placeholder' : ''),
          'data-testid': 'agy-pm-quota-pie',
          'data-quota-title': item.title,
          tabindex: '0',
          'aria-label': item.title + ' ' + metaText,
        }, [
          svgEl('svg', {
            className: 'agy-pm-quota-pie-svg',
            viewBox: '0 0 36 36',
            'aria-hidden': 'true',
          }, svgChildren),
          el('span', {
            className: 'agy-pm-quota-pie-pct',
            text: item.placeholder ? '--' : (item.percent + '%'),
          }),
          el('div', { className: 'agy-pm-quota-tip', role: 'tooltip' }, [
            el('div', { className: 'agy-pm-quota-tip-title', text: item.title }),
            el('div', { className: 'agy-pm-quota-tip-meta', text: metaText }),
          ]),
        ]));
      }

      return el('div', { className: 'agy-pm-quota-pies', 'data-testid': 'agy-pm-quota-pies' }, children);
    }

    function formatEquivUsd(val) {
      if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) return '--';
      if (val >= 10) return '$' + Math.round(val);
      return '$' + val.toFixed(1);
    }

    function renderEquivCostBadge() {
      var st = equivCostStore.state;
      var valText = st ? formatEquivUsd(st.avgMonthlyUsd) : '--';
      var tierLabel = (st && st.activeTierLabel) ? st.activeTierLabel : '未知档位';
      var activeEmail = (st && st.activeEmail) ? st.activeEmail : '未登录';
      var totalRecs = st && typeof st.totalRecords === 'number' ? st.totalRecords : 0;
      var maxRecs = st && typeof st.maxRecords === 'number' ? st.maxRecords : 20;
      var breakdown = st && Array.isArray(st.accountBreakdown) ? st.accountBreakdown : [];
      var neon = st && st.neonPricing ? st.neonPricing : { inputPerMillion: 2, cacheReadPerMillion: 0.2, outputPerMillion: 12, source: 'default' };

      var tipLines = [
        el('div', { className: 'agy-pm-equiv-tip-title', text: '等效月 API 费用（' + tierLabel + ' · Ultra/Pro 不混合）' }),
        el('div', { className: 'agy-pm-equiv-tip-line', text: '当前账号：' + activeEmail }),
      ];
      if (breakdown.length > 0) {
        for (var i = 0; i < breakdown.length; i++) {
          var item = breakdown[i];
          tipLines.push(el('div', {
            className: 'agy-pm-equiv-tip-line',
            text: item.email + '：' + formatEquivUsd(item.avgMonthlyUsd) + '/月（' + item.sampleCount + ' 次采样均值）',
          }));
        }
      } else {
        tipLines.push(el('div', {
          className: 'agy-pm-equiv-tip-line',
          text: '暂无 ' + tierLabel + ' 有效样本：每打开 Agy 自动对账 1 次（需周期内额度有变动）',
        }));
      }
      var srcText = neon.source === 'live' ? '实时' : (neon.source === 'live-estimated' ? '服务端估值' : (neon.locked ? '手动锁定' : '默认参考'));
      tipLines.push(el('div', {
        className: 'agy-pm-equiv-tip-line',
        text: 'Neon 单价（' + srcText + '）：输入 $' + neon.inputPerMillion + ' / 缓存 $' + neon.cacheReadPerMillion + ' / 输出 $' + neon.outputPerMillion + ' / 1M',
      }));
      tipLines.push(el('div', {
        className: 'agy-pm-equiv-tip-line',
        text: '留档记录：最近 ' + totalRecs + '/' + maxRecs + ' 次 · equiv-api-cost.json',
      }));

      return el('div', {
        className: 'agy-pm-equiv-cost',
        'data-testid': 'agy-pm-equiv-cost',
        tabindex: '0',
        'aria-label': '平均等效月API费用：' + valText + '（按Neon计算）',
      }, [
        el('span', { className: 'agy-pm-equiv-cost-text' }, [
          el('span', { text: '平均等效月API费用：' }),
          el('span', { className: 'agy-pm-equiv-cost-val', 'data-testid': 'agy-pm-equiv-cost-val', text: valText }),
          el('span', { text: '（按Neon计算）' }),
        ]),
        el('div', { className: 'agy-pm-equiv-tip', role: 'tooltip' }, tipLines),
      ]);
    }

    function renderTabs(inst) {
      var cat = inst.catalog;
      var q = inst.query.trim();
      var tabs = [];

      tabs.push(el('button', {
        type: 'button',
        className: 'agy-pm-tab agy-pm-tab-4' + (!q && inst.activeTab === 'periodic' ? ' is-active' : ''),
        'data-testid': 'agy-pm-tab-periodic',
        title: 'Gemini 4 元素周期表',
        onClick: function (ev) {
          ev.stopPropagation();
          inst.query = '';
          inst.activeTab = 'periodic';
          renderInlineContent(inst);
        },
      }, [
        el('span', { className: 'agy-pm-tab-4-badge', text: '4' }),
      ]));

      tabs.push(el('button', {
        type: 'button',
        className: 'agy-pm-tab' + (!q && inst.activeTab === 'all' ? ' is-active' : ''),
        'data-testid': 'agy-pm-tab-all',
        onClick: function (ev) {
          ev.stopPropagation();
          inst.query = '';
          inst.activeTab = 'all';
          renderInlineContent(inst);
        },
      }, [
        el('span', { text: 'All' }),
        el('span', { className: 'agy-pm-tab-count', text: String(cat.allEntries.length) }),
      ]));

      if (cat.otherEntries.length) {
        tabs.push(el('button', {
          type: 'button',
          className: 'agy-pm-tab' + (!q && inst.activeTab === 'other' ? ' is-active' : ''),
          'data-testid': 'agy-pm-tab-other',
          onClick: function (ev) {
            ev.stopPropagation();
            inst.query = '';
            inst.activeTab = 'other';
            renderInlineContent(inst);
          },
        }, [
          el('span', { text: '其他模型' }),
          el('span', { className: 'agy-pm-tab-count', text: String(cat.otherEntries.length) }),
        ]));
      }

      for (var i = 0; i < cat.otherCategories.length; i++) {
        (function (oc) {
          tabs.push(el('button', {
            type: 'button',
            className: 'agy-pm-tab' + (!q && inst.activeTab === oc.id ? ' is-active' : ''),
            'data-testid': 'agy-pm-tab-' + oc.id,
            onClick: function (ev) {
              ev.stopPropagation();
              inst.query = '';
              inst.activeTab = oc.id;
              renderInlineContent(inst);
            },
          }, [
            el('span', { text: oc.label }),
          ]));
        })(cat.otherCategories[i]);
      }

      return el('div', { className: 'agy-pm-tabs', 'data-testid': 'agy-pm-tabs' }, tabs);
    }

    function renderInlineBody(inst) {
      if (!inst || !inst.bodySlot) return;
      inst.bodySlot.innerHTML = '';
      var q = inst.query.trim();
      if (!q && inst.activeTab === 'periodic') {
        inst.bodySlot.appendChild(renderPeriodicView(inst));
      } else {
        inst.bodySlot.appendChild(renderListView(inst));
      }
    }

    function renderInlineContent(inst) {
      if (!inst || !inst.inlineRoot) return;
      if (inst.tabsSlot) {
        inst.tabsSlot.innerHTML = '';
        inst.tabsSlot.appendChild(renderTabs(inst));
      }
      if (inst.quotaPiesSlot) {
        inst.quotaPiesSlot.innerHTML = '';
        inst.quotaPiesSlot.appendChild(renderQuotaPies());
      }
      if (inst.equivCostSlot) {
        inst.equivCostSlot.innerHTML = '';
        inst.equivCostSlot.appendChild(renderEquivCostBadge());
      }
      if (inst.searchInput && inst.searchInput.value !== inst.query) {
        inst.searchInput.value = inst.query;
      }
      if (inst.searchClear) {
        if (inst.query) inst.searchClear.classList.add('visible');
        else inst.searchClear.classList.remove('visible');
      }
      renderInlineBody(inst);
    }

    function setNativeMode(inst, useNative) {
      if (!inst || !inst.panel) return;
      inst.useNative = !!useNative;
      var nativeList = findNativeListNode(inst.panel);

      if (inst.useNative) {
        if (inst.popover) {
          inst.popover.removeAttribute(POPOVER_ATTR);
          inst.popover.style.removeProperty('width');
          inst.popover.style.removeProperty('max-width');
          inst.popover.style.removeProperty('min-width');
          inst.popover.style.marginLeft = '';
        }
        if (nativeList) nativeList.removeAttribute(HIDDEN_ATTR);
        var hiddenNodes = inst.panel.querySelectorAll ? inst.panel.querySelectorAll('[' + HIDDEN_ATTR + '="1"]') : [];
        for (var hi = 0; hi < hiddenNodes.length; hi++) {
          hiddenNodes[hi].removeAttribute(HIDDEN_ATTR);
        }
        if (inst.inlineRoot) inst.inlineRoot.style.display = 'none';
        if (inst.nativeBar) inst.nativeBar.style.display = '';
      } else {
        if (inst.popover) {
          inst.popover.setAttribute(POPOVER_ATTR, '1');
          inst.popover.style.setProperty('width', 'min(748px, calc(100vw - 24px))', 'important');
          inst.popover.style.setProperty('max-width', 'min(748px, calc(100vw - 24px))', 'important');
          inst.popover.style.setProperty('min-width', '0', 'important');
        }
        if (nativeList) nativeList.setAttribute(HIDDEN_ATTR, '1');
        var footerNodes = findNativeFooterNodesToHide(inst.panel);
        for (var fi = 0; fi < footerNodes.length; fi++) {
          footerNodes[fi].setAttribute(HIDDEN_ATTR, '1');
        }
        if (inst.inlineRoot) inst.inlineRoot.style.display = '';
        if (inst.nativeBar) inst.nativeBar.style.display = 'none';
        nudgePopoverWithinViewport(inst.popover);
      }
    }

    function enhancePanel(panel) {
      if (!panel || panel.nodeType !== 1) return false;
      ensureStyles();

      var ctrl = resolveControllerForPanel(panel);
      if (!ctrl) return false;

      // Best of N 多选模式自动放行原版列表
      if (ctrl.bestOfNConfig && ctrl.bestOfNConfig.isBestOfNEnabled) {
        return false;
      }
      // 加载中先不强行替换，等模型加载完自动再次触发
      if (ctrl.isModelListLoading && (!ctrl.modelOptions || !ctrl.modelOptions.length)) {
        return false;
      }

      var existing = panelStates ? panelStates.get(panel) : null;
      if (existing && existing.inlineRoot && existing.inlineRoot.isConnected) {
        existing.ctrl = ctrl;
        var realSel = (ctrl.selectedModel && ctrl.selectedModel.label) || '';
        var realOrchPlanner = (ctrl.orchestratorPick && typeof ctrl.orchestratorPick.model === 'number')
          ? ctrl.orchestratorPick.model
          : 0;
        // 一旦 React 状态已经同步到我们刚选中的模型，清掉本地乐观覆盖值
        if (existing.selectedOverride && realSel === existing.selectedOverride) {
          existing.selectedOverride = '';
        }
        if (existing.selectedOrchestratorPlannerValue) {
          if (
            realOrchPlanner === existing.selectedOrchestratorPlannerValue
            || realOrchPlanner !== existing.prevOrchPlannerValue
            || (!existing.selectedOverride && !isOrchestratorModelOption(ctrl.selectedModel))
          ) {
            existing.selectedOrchestratorPlannerValue = 0;
            existing.prevOrchPlannerValue = 0;
          }
        }
        var nextSig = computeCatalogSignature(ctrl, existing.selectedOverride, existing.selectedOrchestratorPlannerValue, panel);
        if (!existing.useNative) {
          var nl = findNativeListNode(panel);
          if (nl && nl.getAttribute(HIDDEN_ATTR) !== '1') nl.setAttribute(HIDDEN_ATTR, '1');
          var fns = findNativeFooterNodesToHide(panel);
          for (var fni = 0; fni < fns.length; fni++) {
            if (fns[fni].getAttribute(HIDDEN_ATTR) !== '1') fns[fni].setAttribute(HIDDEN_ATTR, '1');
          }
        }
        // 数据未变化时不碰 DOM，彻底避免定时扫描触发按钮 hover 跳变或滚动条重置
        if (nextSig !== existing.sig) {
          existing.sig = nextSig;
          existing.catalog = buildCatalog(ctrl, existing.selectedOverride, existing.selectedOrchestratorPlannerValue, panel);
          if (!existing.useNative) renderInlineContent(existing);
        }
        return true;
      }

      var popover = findPopoverContainer(panel);
      var dark = detectDarkTheme(popover || panel);
      var catalog = buildCatalog(ctrl, '', 0, panel);
      var initialSig = computeCatalogSignature(ctrl, '', 0, panel);

      var inst = {
        panel: panel,
        popover: popover,
        ctrl: ctrl,
        catalog: catalog,
        sig: initialSig,
        selectedOverride: '',
        selectedOrchestratorPlannerValue: 0,
        prevOrchPlannerValue: 0,
        activeTab: 'periodic',
        query: '',
        lockedSymbol: catalog.selectedPeriodic
          ? catalog.selectedPeriodic.element.symbol
          : (catalog.activeOrchestratorElement ? catalog.activeOrchestratorElement.symbol : null),
        hoveredEl: null,
        useNative: false,
        inlineRoot: null,
        nativeBar: null,
        tabsSlot: null,
        quotaPiesSlot: null,
        equivCostSlot: null,
        bodySlot: null,
        searchInput: null,
        searchClear: null,
      };

      var searchInput = el('input', {
        type: 'text',
        className: 'agy-pm-search-input',
        'data-testid': 'agy-pm-search',
        placeholder: '搜索模型 / 元素…',
        onClick: function (ev) { ev.stopPropagation(); },
        onMouseDown: function (ev) { ev.stopPropagation(); },
        onPointerDown: function (ev) { ev.stopPropagation(); },
        onKeyDown: function (ev) {
          // 阻止原生菜单的键盘首字母跳转拦截搜索框输入
          ev.stopPropagation();
          if (ev.key === 'Escape') {
            if (inst.query) {
              inst.query = '';
              renderInlineContent(inst);
            } else if (typeof inst.ctrl.setIsOpen === 'function') {
              inst.ctrl.setIsOpen(false);
            }
            return;
          }
          if (ev.key === 'Enter' && inst.query.trim() && inst.catalog) {
            var q = inst.query.trim();
            for (var si = 0; si < inst.catalog.allEntries.length; si++) {
              var cand = inst.catalog.allEntries[si];
              if (matchesQuery(cand, q)) {
                ev.preventDefault();
                if (cand.isOrchestratorPlannerEntry && cand.orchestratorBaseOption) {
                  var pOpt = pickOrchestratorPlannerOption(cand.plannerOptions, inst.catalog.selectedLabel, inst.catalog.activeOrchestratorPlanner, inst.catalog.isOrchestratorSelected) || cand.defaultOption;
                  if (pOpt) selectModelOption(inst, cand.orchestratorBaseOption, undefined, pOpt);
                } else {
                  var opt = pickDefaultOption(cand, inst.catalog.selectedLabel, getCurrentEffort(inst.catalog));
                  if (opt) selectModelOption(inst, opt);
                }
                return;
              }
            }
          }
        },
        onInput: function (ev) {
          inst.query = ev.target.value || '';
          renderInlineContent(inst);
        },
      });

      var searchClear = el('button', {
        type: 'button',
        className: 'agy-pm-search-clear',
        text: '×',
        title: '清空',
        onClick: function (ev) {
          ev.stopPropagation();
          inst.query = '';
          renderInlineContent(inst);
          searchInput.focus();
        },
      });

      var refreshBtn = null;
      if (typeof ctrl.refreshModels === 'function') {
        refreshBtn = el('button', {
          type: 'button',
          className: 'agy-pm-tool-btn',
          'data-testid': 'agy-pm-refresh',
          text: '刷新',
          title: '刷新模型与额度',
          onClick: function (ev) {
            ev.stopPropagation();
            refreshBtn.disabled = true;
            refreshBtn.textContent = '…';
            Promise.resolve(ctrl.refreshModels()).finally(function () {
              refreshBtn.disabled = false;
              refreshBtn.textContent = '刷新';
              if (panel.isConnected) {
                var fresh = resolveControllerForPanel(panel);
                if (fresh) inst.ctrl = fresh;
                inst.catalog = buildCatalog(inst.ctrl, inst.selectedOverride, inst.selectedOrchestratorPlannerValue, inst.panel);
                inst.sig = computeCatalogSignature(inst.ctrl, inst.selectedOverride, inst.selectedOrchestratorPlannerValue, inst.panel);
                renderInlineContent(inst);
              }
            });
          },
        });
      }

      var nativeToggleBtn = el('button', {
        type: 'button',
        className: 'agy-pm-tool-btn',
        'data-testid': 'agy-pm-native-btn',
        text: '原版',
        title: '切换回原版竖向列表',
        onClick: function (ev) {
          ev.stopPropagation();
          setNativeMode(inst, true);
        },
      });

      var tabsSlot = el('div', { style: { display: 'flex', minWidth: '0' } });
      var quotaPiesSlot = el('div', { className: 'agy-pm-quota-pies-slot' });
      var equivCostSlot = el('div', { className: 'agy-pm-equiv-cost-slot' });
      var bodySlot = el('div', {});

      var topbar = el('div', { className: 'agy-pm-topbar' }, [
        el('div', { className: 'agy-pm-topbar-left' }, [
          tabsSlot,
          el('div', { className: 'agy-pm-tools' }, [
            el('div', { className: 'agy-pm-search-box' }, [
              el('span', { className: 'agy-pm-search-icon', text: '⌕' }),
              searchInput,
              searchClear,
            ]),
            refreshBtn,
            nativeToggleBtn,
            equivCostSlot,
          ]),
        ]),
        quotaPiesSlot,
      ]);

      var inlineRoot = el('div', {
        'data-testid': 'agy-periodic-model-inline',
        'data-theme': dark ? 'dark' : 'light',
        'data-agy-zh-skip': '1',
        tabindex: '-1',
      }, [topbar, bodySlot]);
      inlineRoot.setAttribute(INLINE_ATTR, '1');

      var nativeBar = el('div', { 'data-agy-zh-skip': '1', style: { display: 'none' } }, [
        el('button', {
          type: 'button',
          className: 'agy-pm-back-pill',
          'data-testid': 'agy-pm-back-periodic',
          text: '切回周期表',
          onClick: function (ev) {
            ev.stopPropagation();
            setNativeMode(inst, false);
          },
        }),
      ]);
      nativeBar.setAttribute(NATIVE_BAR_ATTR, '1');

      inst.inlineRoot = inlineRoot;
      inst.nativeBar = nativeBar;
      inst.tabsSlot = tabsSlot;
      inst.quotaPiesSlot = quotaPiesSlot;
      inst.equivCostSlot = equivCostSlot;
      inst.bodySlot = bodySlot;
      inst.searchInput = searchInput;
      inst.searchClear = searchClear;

      // 将周期表面板和原版切回栏插入到 panel 最前面；周期表模式下自动隐藏底部原生「查看用量」
      panel.insertBefore(nativeBar, panel.firstChild);
      panel.insertBefore(inlineRoot, nativeBar);

      if (panelStates) panelStates.set(panel, inst);
      activeInstance = inst;

      renderInlineContent(inst);
      setNativeMode(inst, false);
      return true;
    }

    function scanPanels() {
      readEquivCostFromBridge();
      if (!w.document || !w.document.querySelectorAll) return;
      var panels = w.document.querySelectorAll('[data-testid="model-selector-panel"]');
      for (var i = 0; i < panels.length; i++) {
        enhancePanel(panels[i]);
      }
    }

    var scanQueued = false;
    function scheduleScan() {
      if (scanQueued) return;
      scanQueued = true;
      var run = function () {
        scanQueued = false;
        scanPanels();
      };
      if (typeof w.requestAnimationFrame === 'function') w.requestAnimationFrame(run);
      else w.setTimeout(run, 16);
    }

    // 延迟等待 document.documentElement 就绪再挂 MutationObserver，并在文档重建时自动重挂
    var observedRoot = null;
    var activeObserver = null;
    function ensureObserver() {
      if (!w.document || !w.document.documentElement || typeof w.MutationObserver !== 'function') return;
      if (observedRoot === w.document.documentElement && activeObserver) return;
      if (activeObserver) {
        try { activeObserver.disconnect(); } catch (_) {}
      }
      observedRoot = w.document.documentElement;
      activeObserver = new w.MutationObserver(function (mutations) {
        if (scanQueued) return;
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          var target = m.target;
          if (target && target.nodeType === 1 && target.closest && target.closest('[' + INLINE_ATTR + '="1"]')) {
            continue;
          }
          var added = m.addedNodes;
          if (!added || !added.length) continue;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (!n || n.nodeType !== 1) continue;
            if (
              (n.getAttribute && n.getAttribute('data-testid') === 'model-selector-panel')
              || (n.querySelector && n.querySelector('[data-testid="model-selector-panel"]'))
              || (n.closest && n.closest('[data-testid="model-selector-panel"]'))
            ) {
              scheduleScan();
              return;
            }
          }
        }
      });
      activeObserver.observe(observedRoot, { childList: true, subtree: true });
    }

    function bootAndScan() {
      ensureObserver();
      scanPanels();
    }

    // 点击底部模型按钮后主动多帧补扫，保证弹出瞬间立刻无缝替换
    function onTriggerInteract(ev) {
      var target = ev && ev.target;
      if (!target || typeof target.closest !== 'function') return;
      if (!target.closest('[data-testid="model-selector-trigger"]')) return;
      ensureObserver();
      scheduleScan();
      w.setTimeout(scanPanels, 32);
      w.setTimeout(scanPanels, 120);
    }

    if (w.document && typeof w.document.addEventListener === 'function') {
      w.document.addEventListener('pointerdown', onTriggerInteract, true);
      w.document.addEventListener('click', onTriggerInteract, true);
      w.document.addEventListener('DOMContentLoaded', bootAndScan);
      w.document.addEventListener('readystatechange', bootAndScan);
    }
    function syncQuotaFromSiblingBridge() {
      if (equivUpState.quotaSeq > 0) return;
      try {
        if (!w.sessionStorage) return;
        var raw = w.sessionStorage.getItem('__agy_quota_bridge_v1__');
        if (!raw) return;
        var parsed = JSON.parse(raw);
        var s = parsed && parsed.summary;
        if (!s || typeof s.remainingFraction !== 'number' || !Number.isFinite(s.remainingFraction)) return;
        if (typeof s.resetTimeMs !== 'number' || !Number.isFinite(s.resetTimeMs)) return;
        equivUpState.quota = {
          remainingFraction: Math.max(0, Math.min(1, s.remainingFraction)),
          resetTimeMs: s.resetTimeMs,
          bucketId: 'sibling-bridge',
          disabled: Boolean(s.disabled),
          ts: typeof s.ts === 'number' && Number.isFinite(s.ts) ? s.ts : Date.now(),
        };
        equivUpState.quotaSeq += 1;
        publishEquivUp();
      } catch (_) {}
    }

    function onSiblingQuotaBridge() {
      syncQuotaFromSiblingBridge();
      scheduleScan();
    }

    function onEquivDownUpdate() {
      readEquivCostFromBridge();
      scheduleScan();
    }

    if (typeof w.addEventListener === 'function') {
      w.addEventListener('load', bootAndScan);
      w.addEventListener('__agy_quota_bridge_v1__', onSiblingQuotaBridge);
      w.addEventListener(DOWN_KEY, onEquivDownUpdate);
    }

    readEquivCostFromBridge();
    syncQuotaFromSiblingBridge();
    bootAndScan();
    var fallbackTimer = w.setInterval(bootAndScan, 350);
    if (fallbackTimer && typeof fallbackTimer.unref === 'function') fallbackTimer.unref();

    w.__AGY_PERIODIC_MODEL_API__ = {
      ELEMENTS: ELEMENTS,
      buildCatalog: buildCatalog,
      matchGemini4Element: matchGemini4Element,
      ingestWeeklyQuotaSummary: ingestWeeklyQuotaSummary,
      lookupWeeklyQuota: lookupWeeklyQuota,
      setEquivCostState: function (nextState) {
        if (nextState && typeof nextState === 'object') {
          equivCostStore.state = nextState;
          equivCostStore.version += 1;
          try {
            var rawNext = JSON.stringify(nextState);
            equivCostStore.raw = rawNext;
            if (w.sessionStorage) w.sessionStorage.setItem(DOWN_KEY, rawNext);
          } catch (_) {}
          scanPanels();
        }
      },
      getEquivCostState: function () { return equivCostStore.state; },
      enhancePanel: enhancePanel,
      scanPanels: scanPanels,
      getActiveInstance: function () { return activeInstance; },
    };
  }

  var CH_GET_SYNC = 'agy-pm-equiv:get-state-sync';
  var CH_REPORT_USER = 'agy-pm-equiv:report-user';
  var CH_REPORT_SIGNOUT = 'agy-pm-equiv:report-signout';
  var CH_REPORT_QUOTA = 'agy-pm-equiv:report-quota';
  var CH_REPORT_PRICING = 'agy-pm-equiv:report-pricing';
  var CH_UPDATED = 'agy-pm-equiv:state-updated';

  var webFrame = null;
  var ipc = null;
  try {
    var reqFn = typeof require === 'function' ? require : (typeof g.require === 'function' ? g.require : null);
    if (reqFn) {
      var electronMod = reqFn('electron');
      if (electronMod) {
        webFrame = electronMod.webFrame || null;
        ipc = electronMod.ipcRenderer || null;
      }
    }
  } catch (_) {}

  var lastEquivDownState = null;
  function publishEquivDownState(state) {
    if (!state || typeof state !== 'object') return;
    lastEquivDownState = state;
    try {
      if (g.sessionStorage) g.sessionStorage.setItem(EQUIV_DOWN_KEY, JSON.stringify(state));
      if (typeof g.dispatchEvent === 'function' && typeof g.Event === 'function') {
        g.dispatchEvent(new g.Event(EQUIV_DOWN_KEY));
      }
    } catch (_) {}
  }

  var lastForwarded = { userSeq: 0, signOutSeq: 0, quotaSeq: 0, pricingSeq: 0 };
  function handleEquivUpEvent() {
    if (!ipc || typeof ipc.invoke !== 'function') return;
    var data = null;
    try {
      var raw = g.sessionStorage && g.sessionStorage.getItem(EQUIV_UP_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (_) {}
    if (!data || typeof data !== 'object') return;

    if (typeof data.userSeq === 'number' && data.userSeq > lastForwarded.userSeq && data.user) {
      lastForwarded.userSeq = data.userSeq;
      Promise.resolve(ipc.invoke(CH_REPORT_USER, data.user)).then(publishEquivDownState).catch(function () {});
    }
    if (typeof data.signOutSeq === 'number' && data.signOutSeq > lastForwarded.signOutSeq) {
      lastForwarded.signOutSeq = data.signOutSeq;
      Promise.resolve(ipc.invoke(CH_REPORT_SIGNOUT, { ts: data.signOutAt || Date.now() })).then(publishEquivDownState).catch(function () {});
    }
    if (typeof data.pricingSeq === 'number' && data.pricingSeq > lastForwarded.pricingSeq && Array.isArray(data.pricing) && data.pricing.length) {
      lastForwarded.pricingSeq = data.pricingSeq;
      Promise.resolve(ipc.invoke(CH_REPORT_PRICING, data.pricing)).then(publishEquivDownState).catch(function () {});
    }
    if (typeof data.quotaSeq === 'number' && data.quotaSeq > lastForwarded.quotaSeq && data.quota) {
      lastForwarded.quotaSeq = data.quotaSeq;
      Promise.resolve(ipc.invoke(CH_REPORT_QUOTA, data.quota)).then(publishEquivDownState).catch(function () {});
    }
  }

  if (typeof g.addEventListener === 'function') {
    g.addEventListener(EQUIV_UP_KEY, handleEquivUpEvent);
  }

  if (ipc && typeof ipc.on === 'function') {
    try {
      ipc.on(CH_UPDATED, function (_ev, nextState) {
        publishEquivDownState(nextState);
      });
    } catch (_) {}
  }

  if (ipc && typeof ipc.sendSync === 'function') {
    try {
      var initState = ipc.sendSync(CH_GET_SYNC);
      publishEquivDownState(initState);
    } catch (_) {}
  }

  function injectMainWorld() {
    var injected = false;
    try {
      if (webFrame && typeof webFrame.executeJavaScript === 'function') {
        var script = '(' + installPeriodicModelSelector.toString() + ')('
          + JSON.stringify(EQUIV_UP_KEY) + ', '
          + JSON.stringify(EQUIV_DOWN_KEY) + ');';
        Promise.resolve(webFrame.executeJavaScript(script)).then(function () {
          if (lastEquivDownState) publishEquivDownState(lastEquivDownState);
        }).catch(function () {});
        injected = true;
      }
    } catch (_) {}
    if (!injected) {
      installPeriodicModelSelector(EQUIV_UP_KEY, EQUIV_DOWN_KEY);
      if (lastEquivDownState) publishEquivDownState(lastEquivDownState);
    }
  }

  injectMainWorld();
  handleEquivUpEvent();
  if (g.document && typeof g.document.addEventListener === 'function') {
    g.document.addEventListener('DOMContentLoaded', function () {
      injectMainWorld();
      if (lastEquivDownState) publishEquivDownState(lastEquivDownState);
    }, { once: true });
  }
  if (typeof g.addEventListener === 'function') {
    g.addEventListener('load', function () {
      injectMainWorld();
      if (lastEquivDownState) publishEquivDownState(lastEquivDownState);
    }, { once: true });
  }
})();
