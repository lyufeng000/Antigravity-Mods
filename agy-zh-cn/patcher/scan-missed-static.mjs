// 扫描 main.js 中位于 JSX createElement 之外的深层静态界面文案（switch/case 返回、状态枚举对象、混淆后的单参提示函数）。
// 用法：node scan-missed-static.mjs [--plugin-dir <目录>] [--dict <词典路径>] [--strings <strings-en.json>] [--no-strings] [--input <js文件>] [--out <输出路径>] [--json] [--limit <条数>]
import fs from 'node:fs';
import path from 'node:path';
import { readWebAsset, appInfo } from './lib/app.mjs';
import { loadDep } from './lib/deps.mjs';
import { PLUGIN_DIR, defaultDictPath, isEntry, parseArgs } from './lib/common.mjs';

const acorn = loadDep('acorn');
const walk = loadDep('acorn-walk');

const STANDARD_CALLEES = new Set([
  'createElement', 'createElementNS', 'querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName',
  'addEventListener', 'removeEventListener', 'getAttribute', 'setAttribute', 'hasAttribute', 'removeAttribute',
  'closest', 'matches', 'contains', 'dispatchEvent', 'match', 'matchAll', 'replace', 'replaceAll', 'split', 'join',
  'slice', 'substring', 'indexOf', 'lastIndexOf', 'includes', 'startsWith', 'endsWith', 'test', 'exec', 'search',
  'get', 'set', 'has', 'delete', 'add', 'push', 'pop', 'shift', 'unshift', 'filter', 'map', 'reduce', 'find', 'some',
  'every', 'forEach', 'log', 'warn', 'error', 'debug', 'info', 'trace', 'assert', 'require', 'resolve', 'join',
  'parse', 'stringify', 'from', 'of', 'keys', 'values', 'entries', 'assign', 'create', 'defineProperty', 'format',
  'toLowerCase', 'toUpperCase', 'trim', 'padStart', 'padEnd', 'repeat', 'charCodeAt', 'codePointAt',
  'emit', 'on', 'off', 'once', 'fetch', 'encodeURIComponent', 'decodeURIComponent', 'btoa', 'atob', 'Error',
  'TypeError', 'RangeError', 'SyntaxError', 'RegExp', 'Date', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'getComputedStyle',
]);

const NON_UI_WORDS = new Set([
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE',
  'DIV', 'SPAN', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE',
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'Object', 'Array',
  'Function', 'String', 'Number', 'Boolean', 'Promise', 'Symbol', 'BigInt', 'Undefined',
  'Null', 'True', 'False', 'NaN', 'Infinity', 'Date', 'RegExp', 'Map', 'Set',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
]);

const tplToPattern = (node) => {
  let out = '';
  let n = 0;
  node.quasis.forEach((q, i) => {
    out += q.value.cooked ?? q.value.raw;
    if (i < node.expressions.length) out += `{${n++}}`;
  });
  return out;
};

const extractStrings = (node, depth = 0) => {
  if (!node || depth > 4) return [];
  switch (node.type) {
    case 'Literal': return typeof node.value === 'string' ? [node.value] : [];
    case 'TemplateLiteral': return [node.expressions.length ? tplToPattern(node) : (node.quasis[0].value.cooked ?? node.quasis[0].value.raw)];
    case 'ConditionalExpression': return [...extractStrings(node.consequent, depth + 1), ...extractStrings(node.alternate, depth + 1)];
    case 'LogicalExpression': return [...extractStrings(node.left, depth + 1), ...extractStrings(node.right, depth + 1)];
    default: return [];
  }
};

function looksLikeBaseUi(raw) {
  const s = raw.replace(/\{\d+\}/g, 'X').trim();
  if (s.length < 3 || s.length > 320) return false;
  if (!/[A-Za-z]{2,}/.test(s)) return false;
  if (/^(https?:|file:|data:|mailto:|ws:|wss:|icon:|\/|\.\/|\.\.\/|#[0-9a-f]{3,8}$)/i.test(s)) return false;
  if (/^[a-z0-9_$.\-/:[\]()%#!@+=~]+$/.test(s)) return false;
  if (/^[A-Z0-9_]{2,}$/.test(s)) return false;
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(s)) return false;
  if (/^[a-z]+(?:[-_.:/][a-z0-9]+)+$/i.test(s)) return false;
  if (/(^|\s)(flex|grid|px-|py-|pt-|pb-|pl-|pr-|mx-|my-|mt-|mb-|text-|bg-|w-|h-|min-w-|max-w-|rounded|border|items-|justify-|gap-|overflow-|cursor-|shadow-|transition-|duration-)/.test(s) && !/[.!?…]$/.test(s)) return false;
  if (/\b(?:var\(--|cubic-bezier\(|calc\(|rgba?\(|hsla?\()|\b\d+(?:px|rem|vh|vw|ms)\b|^X\s+\w+\(/.test(s) && !/[.!?…]$/.test(s)) return false;
  if (/[{};=]\s*$/.test(s) || /=>|function\s*\(|\breturn\b|\bimport\b|\bexport\b/.test(s)) return false;
  if (/^[\w.-]+\.(js|mjs|cjs|ts|tsx|jsx|json|md|png|jpg|jpeg|svg|gif|webp|css|html|py|go|rs|wasm)$/i.test(s)) return false;
  if (/^(application|text|image|audio|video|font)\//i.test(s)) return false;
  if (/^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(s)) return false;
  if (/^(Content-Type|Authorization|Accept|User-Agent|Cache-Control|X-[A-Z])/i.test(s)) return false;
  if (/^[MMLCQZHVSA\d\s.,-]+$/i.test(s)) return false; // SVG path data
  if (/^[A-Za-z]+Error:\s/.test(s)) return false;
  return true;
}

function looksLikeUiSentence(raw) {
  if (!looksLikeBaseUi(raw)) return false;
  const s = raw.trim();
  if (!/\s/.test(s)) return false;
  if (!/^([A-Z]|\{\d+\})/.test(s)) return false;
  if (!/[a-z]{2,}/.test(s)) return false;
  // 排除逗号分隔列表、CSS font-family 或调试键值串
  if (/^["']?[\w-]+["']?(\s*,\s*["']?[\w-]+["']?){2,}$/.test(s)) return false;
  if (/:\s*\{?\d+\}?$/.test(s) && s.split(/\s+/).length <= 3 && !/[A-Z][a-z]+/.test(s)) return false;
  if (/^\[[a-z0-9_-]+\]/i.test(s)) return false;
  if (/[<>]/.test(s) && !/\{\d+\}/.test(s)) return false;
  return true;
}

function looksLikeEnumOrCaseLabel(raw) {
  if (!looksLikeBaseUi(raw)) return false;
  const s = raw.trim();
  if (NON_UI_WORDS.has(s)) return false;
  if (looksLikeUiSentence(s)) return true;
  return /^[A-Z][a-z]{2,22}$/.test(s);
}

function parseCode(code) {
  try { return acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); }
  catch { return acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }); }
}

export function scanMissedStaticFromCode(code, { knownSet = new Set(), file = 'main.js' } = {}) {
  const ast = parseCode(code);
  const found = new Map();
  const ctxOf = (node) => code.slice(Math.max(0, node.start - 60), Math.min(code.length, node.end + 60)).replace(/\s+/g, ' ');

  const addCandidate = (raw, kind, node) => {
    const en = raw.trim();
    if (!en || knownSet.has(en)) return;
    const prev = found.get(en) ?? { en, kinds: new Set(), count: 0, pattern: /\{\d+\}/.test(en), src: [file], ctx: [] };
    prev.kinds.add(kind);
    prev.count++;
    if (prev.ctx.length < 2) prev.ctx.push(ctxOf(node));
    found.set(en, prev);
  };

  walk.simple(ast, {
    SwitchCase(node) {
      for (const st of node.consequent) {
        let expr = null;
        if (st.type === 'ReturnStatement') expr = st.argument;
        else if (st.type === 'ExpressionStatement') {
          expr = st.expression.type === 'AssignmentExpression' ? st.expression.right : st.expression;
        }
        if (!expr) continue;
        for (const s of extractStrings(expr)) {
          if (looksLikeEnumOrCaseLabel(s)) addCandidate(s, 'switch-case', st);
        }
      }
    },
    CallExpression(node) {
      if (node.arguments.length < 1 || node.arguments.length > 2) return;
      const calleeName = node.callee.type === 'Identifier'
        ? node.callee.name
        : (node.callee.type === 'MemberExpression' && !node.callee.computed ? node.callee.property?.name : null);
      if (calleeName && STANDARD_CALLEES.has(calleeName)) return;
      if (node.callee.type === 'Identifier' && /^[a-z]{4,}$/.test(calleeName)) {
        // 完整英文小写函数名保留，过滤已知工具函数名（已通过 STANDARD_CALLEES 过滤绝大多数）
      }
      for (const s of extractStrings(node.arguments[0])) {
        if (looksLikeUiSentence(s)) addCandidate(s, calleeName ? `helper:${calleeName}` : 'helper-call', node);
      }
    },
    ObjectExpression(node) {
      if (node.properties.length < 2 || node.properties.length > 80) return;
      const strProps = [];
      let totalLiteralProps = 0;
      for (const p of node.properties) {
        if (p.type !== 'Property' || p.computed) continue;
        const vals = extractStrings(p.value);
        if (!vals.length) continue;
        totalLiteralProps += vals.length;
        for (const s of vals) {
          if (looksLikeEnumOrCaseLabel(s)) strProps.push({ s, p });
        }
      }
      if (strProps.length >= 2 && strProps.length / Math.max(totalLiteralProps, 1) >= 0.7) {
        for (const { s, p } of strProps) addCandidate(s, 'enum-map', p);
      }
    },
  });

  return [...found.values()]
    .map((x) => ({ en: x.en, kinds: [...x.kinds], count: x.count, pattern: x.pattern, src: x.src, ctx: x.ctx }))
    .sort((a, b) => a.en.localeCompare(b.en));
}

export function loadKnownSet(dictPath, stringsPath) {
  const known = new Set();
  if (dictPath && fs.existsSync(dictPath)) {
    const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
    for (const k of Object.keys(dict.exact ?? {})) known.add(k.trim());
    for (const k of Object.keys(dict.patterns ?? {})) known.add(k.trim());
  }
  if (stringsPath && fs.existsSync(stringsPath)) {
    const s = JSON.parse(fs.readFileSync(stringsPath, 'utf8'));
    for (const it of s.items ?? []) if (it?.en) known.add(String(it.en).trim());
  }
  return known;
}

function main() {
  const args = parseArgs();
  const dictPath = path.resolve(args.opt('--dict', defaultDictPath()));
  const stringsPath = args.has('--no-strings') ? null : path.resolve(args.opt('--strings', path.join(PLUGIN_DIR, 'work', 'strings-en.json')));
  const inputPath = args.opt('--input', null);
  const outPath = args.opt('--out', null);
  const limit = Number(args.opt('--limit', 40));

  const knownSet = loadKnownSet(dictPath, stringsPath);
  let code;
  let version = 'custom';
  if (inputPath) {
    code = fs.readFileSync(path.resolve(inputPath), 'utf8');
  } else {
    version = appInfo().version;
    code = readWebAsset('main.js').toString('utf8');
  }

  const items = scanMissedStaticFromCode(code, { knownSet, file: inputPath ? path.basename(inputPath) : 'main.js' });
  const payload = { appVersion: version, total: items.length, items };

  if (outPath) {
    const absOut = path.resolve(outPath);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, JSON.stringify(payload, null, 2));
  }

  if (args.has('--json')) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`scan-missed-static：版本 ${version}，排除已知词条 ${knownSet.size} 条，发现 ${items.length} 条遗漏候选${outPath ? ` -> ${path.resolve(outPath)}` : ''}`);
    for (const it of items.slice(0, limit)) {
      console.log(`  [${it.kinds.join(',')}] ${JSON.stringify(it.en)}`);
    }
    if (items.length > limit) console.log(`  …另有 ${items.length - limit} 条（可用 --out 保存完整列表或 --limit 调整显示）`);
  }
}

if (isEntry(import.meta.url)) main();
