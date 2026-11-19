// 词典校验核心逻辑（lint-dict.mjs 的实现，单独成模块便于测试）。
const CJK = '\\u3400-\\u9fff\\uf900-\\ufaff';
const reCJK = new RegExp(`[${CJK}]`);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 必须原样保留的品牌名与技术缩写（大小写敏感）
export const HARD_WORDS = ['Antigravity', 'Gemini', 'Claude', 'Google', 'GitHub', 'Chrome', 'Cloudtop', 'CitC',
  'MCP', 'CLI', 'SDK', 'API', 'URL', 'URI', 'JSON', 'CEL', 'SSH', 'OAuth', 'HTTP', 'HTTPS', 'Markdown'];
// 术语表规定保留原文的词，残留英文检查时忽略
const KEEP_WORDS = ['Agent', 'Agents', 'Swarm', 'Token', 'Tokens', 'Sidecar', 'Sidecars'];
const KEY_NAMES = 'Enter|Esc|Escape|Tab|Space|Backspace|Delete|Del|Home|End|PageUp|PageDown|Up|Down|Left|Right|Insert|F\\d{1,2}|[A-Za-z0-9]|[`\\-=\\[\\];\',./\\\\]';
const reShortcut = new RegExp(`(?:\\b(?:Ctrl|Control|Cmd|Command|Alt|Option|Opt|Shift|Meta|Win|Super)\\s*\\+\\s*)+(?:${KEY_NAMES})(?![A-Za-z])`, 'g');
const reMacShortcut = /[⌘⇧⌥⌃]+(?:[A-Za-z0-9]|Enter|Esc|Tab|↵|⏎|⌫)?/g;
const rePressKey = /\b(?:[Pp]ress|[Hh]it|[Tt]ype)\s+(Enter|Esc|Escape|Tab|Space|Backspace|Return)\b/g;
const reSlash = /(?:^|[\s(“"'「])(\/[a-z][\w-]*)/g;
const reTick = /`([^`]+)`/g;
const rePh = /\{(\d+)\}/g;

// ---------- 术语表 ----------
// 解析“二、核心术语”表格：English 列可能含 " / " 并列和（括号）限定，中文列按相同方式拆分
export function parseGlossary(md) {
  const lines = md.split(/\r?\n/);
  let sec = 0;
  const rows = [];
  for (const line of lines) {
    if (/^##\s/.test(line)) { sec++; continue; }
    if (sec !== 2 || !/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((s) => s.trim());
    if (cells.length < 2 || /^:?-+:?$/.test(cells[0]) || cells[0] === 'English') continue;
    rows.push({ en: cells[0], zh: cells[1], note: cells[2] ?? '' });
  }
  const splitCell = (s) => s.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
  const unq = (s) => s.replace(/\*\*/g, '').replace(/[“”"]/g, '').trim();
  const quoted = (s) => [...s.matchAll(/“([^”]+)”/g)].map((m) => m[1]);
  const terms = [];
  for (const r of rows) {
    const ens = splitCell(r.en), zhs = splitCell(unq(r.zh));
    // 备注里“译‘X’”给出的是可接受的替代译法，“不用‘X’”给出的是禁用译法
    const alts = [], forbid = [];
    for (const seg of r.note.split(/[；;，,。]/)) {
      if (/不用|不译|不混用|禁用/.test(seg)) forbid.push(...quoted(seg));
      else if (/译/.test(seg)) alts.push(...quoted(seg).filter((q) => reCJK.test(q)));
    }
    // “动词、名词均保留”不算多义；备注含“多义”“视语境”“仅指”或“动词 xxx 译…”才算
    const noteAmb = /多义|视语境|仅指/.test(r.note) || /动词\s*[A-Za-z]+\s*译/.test(r.note) || /”\s*译为\s*“/.test(r.note);
    ens.forEach((raw, i) => {
      const qual = /[（(].*[)）]/.test(raw);
      const en = raw.replace(/[（(].*?[)）]/g, '').trim();
      if (!en || /(^|\s)X(\s|$)/.test(en)) return; // "Toggle X"、"New X" 这类带变量的写法不做校验
      const zh = zhs.length === ens.length ? [zhs[i]] : zhs.length === 1 ? [zhs[0]] : zhs;
      terms.push({ en, zh: zh.map((z) => z.replace(/X$/, '').trim()).filter(Boolean), alts, forbid, amb: noteAmb || qual || (zhs.length !== ens.length && zhs.length > 1) });
    });
  }
  // 同一个英文词出现在多行且译法不同，视为多义
  const byEn = new Map();
  for (const t of terms) {
    const k = t.en.toLowerCase();
    if (!byEn.has(k)) byEn.set(k, []);
    byEn.get(k).push(t);
  }
  const out = [];
  for (const [, list] of byEn) {
    const zh = [...new Set(list.flatMap((t) => t.zh))];
    const en = list[0].en;
    // 译法就是英文本身：保留原文，要求首字母大写的单数形式
    const keep = zh.length === 1 && zh[0].toLowerCase() === en.toLowerCase() && /^[A-Za-z]/.test(en);
    const kw = keep ? en[0].toUpperCase() + en.slice(1) : null;
    out.push({
      en, zh, alts: [...new Set(list.flatMap((t) => t.alts))], forbid: [...new Set(list.flatMap((t) => t.forbid))],
      amb: list.some((t) => t.amb) || (list.length > 1 && zh.length > 1),
      keep: kw,
      keepRe: kw ? new RegExp(`(?<![A-Za-z])${esc(kw)}(?![A-Za-z])`) : null,
      pluralRe: kw ? new RegExp(`(?<![A-Za-z])${esc(kw)}(?:s|es)(?![A-Za-z])`, 'i') : null,
      re: new RegExp(`(?<![A-Za-z])${esc(en).replace(/\s+/g, '\\s+')}(?:s|es)?(?![A-Za-z])`, 'gi'),
    });
  }
  // 长词条优先，用于覆盖判断（"Aux pane" 覆盖 "Pane"）
  return out.sort((a, b) => b.en.length - a.en.length);
}

// ---------- 单条检查 ----------
const collect = (re, s, g = 0) => [...s.matchAll(re)].map((m) => m[g]);
const phList = (s) => collect(rePh, s, 0);

export function hardIds(en) {
  const ids = new Set();
  for (const w of HARD_WORDS) if (new RegExp(`(?<![A-Za-z0-9])${w}s?(?![A-Za-z0-9])`).test(en)) ids.add(w);
  for (const t of collect(reTick, en, 1)) ids.add(t);
  for (const t of collect(reSlash, en, 1)) ids.add(t);
  for (const t of collect(reShortcut, en)) ids.add(t.trim());
  for (const t of collect(reMacShortcut, en)) ids.add(t);
  for (const t of collect(rePressKey, en, 1)) ids.add(t);
  return [...ids];
}

function checkTerms(en, zh, terms, push, ignored) {
  // 先剥掉反引号内容和占位符，避免把代码里的词当术语
  // 占位符换成非空白符号，避免 "Show {0} more" 被当成 "Show more"
  const plain = en.replace(reTick, ' ').replace(rePh, ' ¤ ');
  const long = (plain.match(/[A-Za-z][A-Za-z'-]*/g) || []).length > 6;
  const covered = [];
  const zhLow = zh.toLowerCase();
  for (const t of terms) {
    const spans = [...plain.matchAll(t.re)].map((m) => [m.index, m.index + m[0].length]);
    const free = spans.filter(([a, b]) => !covered.some(([x, y]) => a >= x && b <= y));
    if (!spans.length) continue;
    covered.push(...spans);
    if (!free.length) continue;
    const hitForbid = t.forbid.filter((f) => zh.includes(f));
    for (const f of hitForbid) push(ignored ? 'warn' : 'error', `术语“${t.en}”不应译为“${f}”`);
    if (hitForbid.length) continue;
    if (t.keep) {
      const lvl = t.amb || ignored ? 'warn' : 'error';
      if (t.pluralRe.test(zh)) push(lvl, `保留原文的“${t.keep}”在译文中用单数，不加 -s`);
      else if (t.keepRe.test(zh)) continue;
      else if (t.alts.some((z) => zh.includes(z))) continue;
      else push(lvl, `术语“${t.en}”应保留原文，写作“${t.keep}”`);
      continue;
    }
    // 状态词允许去掉“已”“正在”“中”后的词干出现（“Running {0} tasks”→“正在运行 {0} 个任务”）
    const core = (z) => { const c = z.replace(/^(已|正在)/, '').replace(/中$/, ''); return c.length >= 2 ? c : z; };
    const ok = [...t.zh, ...t.alts].some((z) => zhLow.includes(z.toLowerCase()) || zh.includes(core(z)));
    if (ok) continue;
    const want = t.zh.join('”或“');
    const word = plain.slice(free[0][0], free[0][1]);
    // 原词以英文原样保留在译文里，多半是专有名词的一部分（“Model Context Protocol”）
    if (new RegExp(`(?<![A-Za-z])${esc(word)}(?![A-Za-z])`).test(zh)) { push('warn', `术语“${t.en}”在译文中保留了英文“${word}”，如非专有名词请译为“${want}”`); continue; }
    if (t.amb) push('warn', `术语“${t.en}”通常译为“${want}”（多义词条，请人工确认）`);
    // 长句里的普通词义更依赖语境，只给警告；界面标签类短文本（≤ 6 个词）强校验
    else if (long) push('warn', `术语“${t.en}”通常译为“${want}”（长句，请人工确认）`);
    else push(ignored ? 'warn' : 'error', `术语“${t.en}”应译为“${want}”`);
  }
}

// ignored：命中 meta.lintIgnore 时，空格类错误降级为警告（例如 {n} 自带首尾空格、不能再加空格的情况）
function checkStyle(zh, push, ignored = false) {
  const sp = ignored ? 'warn' : 'error';
  const s = zh.trim();
  if (s.includes('...')) push('error', '省略号应写成“…”而不是“...”');
  if (/。。。|\.\.\.|……{2,}/.test(s) && !s.includes('...')) push('warn', '省略号写法不规范，统一用“…”');
  const L = 'A-Za-z0-9';
  if (new RegExp(`[${CJK}][${L}{]`).test(s) || new RegExp(`[${L}}][${CJK}]`).test(s)) {
    const m = s.match(new RegExp(`[${CJK}][${L}{]|[${L}}][${CJK}]`));
    push(sp, `中英文、数字或占位符之间缺少半角空格（“${m[0]}”）`);
  }
  const FW = '，。：；？！、（）「」『』【】《》“”‘’';
  if (new RegExp(`[ \\t][${FW}]|[${FW}][ \\t]`).test(s)) push(sp, '全角标点两侧不应有空格');
  if (new RegExp(`[${CJK}][ \\t]+[${CJK}]`).test(s)) push(sp, '中文与中文之间不应有空格');
  if (zh !== s) push('warn', '译文首尾有空白（运行时会自动保留原文的首尾空白）');
  if (new RegExp(`[${CJK}][,;:?!]|[,;:?!][${CJK}]`).test(s)) push('warn', '中文旁边用了半角标点，应改为全角');
}

function residual(en, zh, push, keepWords = []) {
  let s = zh.replace(reTick, ' ').replace(rePh, ' ').replace(/https?:\/\/\S+/g, ' ').replace(reShortcut, ' ').replace(reMacShortcut, ' ').replace(reSlash, ' ');
  for (const w of [...HARD_WORDS, ...KEEP_WORDS, ...keepWords]) s = s.replace(new RegExp(`(?<![A-Za-z])${w}s?(?![A-Za-z])`, 'g'), ' ');
  const m = s.match(/[A-Za-z][A-Za-z'-]*(?:[ \t]+[A-Za-z][A-Za-z'-]*){2,}/);
  if (m) push('warn', `译文残留大段英文：“${m[0]}”`);
  else if (zh.trim() === en.trim() && /[a-z]{3,}/.test(s)) push('warn', '译文与原文相同；不需要翻译的条目请标 null');
}

export function lintDict(dict, glossaryMd) {
  const terms = glossaryMd ? parseGlossary(glossaryMd) : [];
  const ignore = new Set(dict?.meta?.lintIgnore ?? []);
  const keepWords = terms.filter((t) => t.keep).map((t) => t.keep);
  const issues = [];
  let entries = 0;
  for (const kind of ['exact', 'patterns']) {
    const src = dict?.[kind] ?? {};
    if (typeof src !== 'object' || Array.isArray(src)) { issues.push({ level: 'error', kind, en: '', zh: '', msg: `${kind} 必须是对象` }); continue; }
    for (const [en, zh] of Object.entries(src)) {
      entries++;
      const push = (level, msg) => issues.push({ level, kind, en, zh, msg });
      if (zh === null) continue;
      if (typeof zh !== 'string' || zh === '') { push('error', '译文必须是非空字符串或 null'); continue; }
      if (en !== en.trim()) push('warn', '英文键首尾有空白（运行时按 trim 后匹配）');
      const hasPh = /\{\d+\}/.test(en);
      if (kind === 'patterns' && !hasPh) push('warn', 'patterns 里的条目没有 {n} 占位符，应放进 exact');
      if (kind === 'patterns' && /\{\d+\}\{\d+\}/.test(en)) push('warn', '相邻占位符无法可靠拆分');
      // 占位符（紧贴单词末尾、译文未使用的 {n} 视为英文单复数后缀，中文省略，放行）
      const suffix = new Set([...en.matchAll(/[A-Za-z]\{(\d+)\}(?![A-Za-z])/g)].map((m) => `{${m[1]}}`).filter((p) => !zh.includes(p)));
      const pe = phList(en).filter((p) => !suffix.has(p)), pz = phList(zh);
      const se = [...new Set(pe)].sort().join(','), sz = [...new Set(pz)].sort().join(',');
      if (se !== sz) push('error', `占位符不一致：原文 [${se}]，译文 [${sz}]`);
      else if (pe.length !== pz.length) push('warn', `占位符次数不同：原文 ${pe.length} 次，译文 ${pz.length} 次`);
      // 硬标识
      for (const id of hardIds(en)) if (!zh.includes(id)) push('error', `硬标识“${id}”必须原样保留`);
      // 术语
      if (terms.length) checkTerms(en, zh, terms, push, ignore.has(en));
      checkStyle(zh, push, ignore.has(en));
      residual(en, zh, push, keepWords);
    }
  }
  return {
    entries, issues,
    errors: issues.filter((i) => i.level === 'error').length,
    warnings: issues.filter((i) => i.level === 'warn').length,
    terms: terms.length,
  };
}
