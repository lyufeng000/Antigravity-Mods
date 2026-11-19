// 从 language_server.exe 内嵌的前端 ZIP 中提取界面文字候选。
// 用法：node extract-strings.mjs [--plugin-dir <目录>] [--out ../work/strings-en.json] [--diff ../i18n/zh-CN.json]
import fs from 'node:fs';
import path from 'node:path';
import { readWebAsset, appInfo } from './lib/app.mjs';
import { loadDep } from './lib/deps.mjs';
import { SCRIPT_DIR, PLUGIN_DIR, defaultDictPath, parseArgs } from './lib/common.mjs';

const acorn = loadDep('acorn');
const walk = loadDep('acorn-walk');

const args = parseArgs();
const resolveMaybe = (raw) => (fs.existsSync(path.resolve(raw)) ? path.resolve(raw) : path.resolve(SCRIPT_DIR, raw));
const OUT = args.opt('--out', null)
  ? path.resolve(args.opt('--out', ''))
  : path.join(PLUGIN_DIR, 'work', 'strings-en.json');
const diffRaw = args.opt('--diff', args.has('--diff') ? defaultDictPath() : null);
const DIFF = diffRaw ? resolveMaybe(diffRaw) : null;

// 承载界面文字的属性名
const UI_PROPS = new Set([
  'title', 'label', 'description', 'placeholder', 'aria-label', 'ariaLabel', 'tooltip', 'tooltipText',
  'message', 'text', 'heading', 'subtitle', 'subTitle', 'header', 'helperText', 'helpText', 'hint',
  'emptyText', 'emptyMessage', 'emptyState', 'emptyTitle', 'emptyDescription', 'confirmText', 'confirmLabel',
  'cancelText', 'cancelLabel', 'buttonText', 'buttonLabel', 'actionLabel', 'submitLabel', 'caption',
  'content', 'body', 'summary', 'name', 'displayName', 'badge', 'loadingText', 'errorText', 'errorMessage',
  'successMessage', 'warning', 'details', 'prompt', 'alt', 'okText', 'primaryText', 'secondaryText',
  'primaryLabel', 'secondaryLabel', 'titleSuffix', 'tagline', 'note', 'status', 'statusText', 'reason',
]);
// 只在 createElement 的 props 上才算界面属性、在普通对象上噪声太大的键
const WEAK_KEYS = new Set(['name', 'content', 'body', 'status', 'text', 'summary', 'details', 'prompt', 'reason', 'message']);

const looksLikeUi = (s) => {
  const t = s.trim();
  if (t.length < 2 || t.length > 400) return false;
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  if (/^(https?:|file:|data:|mailto:|\/|\.\/|#[0-9a-f]{3,8}$)/i.test(t)) return false;
  if (/^[a-z0-9_$.\-/:[\]()%#!]+$/.test(t)) return false;          // 标识符、类名、路径
  if (/^[A-Z0-9_]+$/.test(t) && t.length > 3) return false;         // 常量
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(t)) return false;            // camelCase
  if (/(^|\s)(flex|grid|px-|py-|text-|bg-|w-|h-|rounded|border|items-|justify-|gap-)/.test(t) && !/[.!?]$/.test(t)) return false;
  if (/[{};]\s*$/.test(t) || /=>|function\s*\(/.test(t)) return false;
  if (/^[\w.-]+\.(js|ts|tsx|json|md|png|svg|css|html|py|go)$/i.test(t)) return false;
  return true;
};

const items = new Map(); // en -> item
const add = (en, kind, ctx, src) => {
  if (!looksLikeUi(en.replace(/\{\d+\}/g, 'X'))) return;
  const key = en.trim();
  const it = items.get(key) ?? { en: key, kinds: new Set(), count: 0, ctx: [], src: new Set() };
  it.kinds.add(kind); it.count++; it.src.add(src);
  if (it.ctx.length < 2 && ctx) it.ctx.push(ctx);
  items.set(key, it);
};

// 模板字符串 -> "{0} files changed"
const tplToPattern = (node) => {
  let out = '', n = 0;
  node.quasis.forEach((q, i) => { out += q.value.cooked ?? q.value.raw; if (i < node.expressions.length) out += `{${n++}}`; });
  return out;
};

// 收集表达式里可能显示出来的字符串（含三元、逻辑或分支）
const strings = (node, depth = 0) => {
  if (!node || depth > 4) return [];
  switch (node.type) {
    case 'Literal': return typeof node.value === 'string' ? [node.value] : [];
    case 'TemplateLiteral': return [node.expressions.length ? tplToPattern(node) : node.quasis[0].value.cooked];
    case 'ConditionalExpression': return [...strings(node.consequent, depth + 1), ...strings(node.alternate, depth + 1)];
    case 'LogicalExpression': return [...strings(node.left, depth + 1), ...strings(node.right, depth + 1)];
    default: return [];
  }
};

const isCreateElement = (n) => n.type === 'CallExpression' && n.callee.type === 'MemberExpression' &&
  !n.callee.computed && n.callee.property.name === 'createElement' && n.arguments.length >= 1;
const propKey = (p) => p.type === 'Property' ? (p.key.type === 'Identifier' ? p.key.name : p.key.value) : null;

function scan(file, code) {
  const ctxOf = (node) => code.slice(Math.max(0, node.start - 70), Math.min(code.length, node.end + 70)).replace(/\s+/g, ' ');
  let ast;
  try { ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); }
  catch { ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }); }
  const propNodes = new WeakSet();
  walk.full(ast, (node) => {
    if (isCreateElement(node)) {
      const [, props, ...children] = node.arguments;
      // 多段子节点（文字与变量混排）合成一个分组模式，供运行时整体匹配
      const seq = children.map((c) => (c.type === 'Literal' && typeof c.value === 'string') ? { s: c.value } : { e: true });
      if (seq.length > 1 && seq.some((x) => x.s?.trim()) && seq.some((x) => x.e) && seq.length <= 8) {
        let n = 0; const pat = seq.map((x) => (x.e ? `{${n++}}` : x.s)).join('');
        if (/[A-Za-z]{2,}/.test(pat.replace(/\{\d+\}/g, ''))) add(pat, 'group', ctxOf(node), file);
      }
      for (const c of children) for (const s of strings(c)) add(s, 'text', ctxOf(c), file);
      if (props?.type === 'ObjectExpression') {
        propNodes.add(props);
        for (const p of props.properties) {
          const k = propKey(p);
          if (k && UI_PROPS.has(k)) for (const s of strings(p.value)) add(s, `prop:${k}`, ctxOf(p), file);
        }
      }
    } else if (node.type === 'ObjectExpression' && !propNodes.has(node)) {
      for (const p of node.properties) {
        const k = propKey(p);
        if (k && UI_PROPS.has(k) && !WEAK_KEYS.has(k)) for (const s of strings(p.value)) add(s, `obj:${k}`, ctxOf(p), file);
      }
    } else if (node.type === 'CallExpression') {
      // toast("...") / showToast / confirm / alert 一类的直接调用
      const name = node.callee.type === 'Identifier' ? node.callee.name : node.callee.property?.name;
      if (name && /^(toast|showToast|notify|alert|confirm|showError|showMessage|setError|setStatus)$/i.test(name))
        for (const a of node.arguments) for (const s of strings(a)) add(s, `call:${name}`, ctxOf(a), file);
    }
  });
}

const info = appInfo();
for (const f of ['main.js']) scan(f, readWebAsset(f).toString('utf8'));

let list = [...items.values()].map((it) => ({
  en: it.en, kinds: [...it.kinds], count: it.count, src: [...it.src], ctx: it.ctx,
  pattern: /\{\d+\}/.test(it.en),
})).sort((a, b) => a.en.localeCompare(b.en));

if (DIFF) {
  const dict = JSON.parse(fs.readFileSync(DIFF, 'utf8'));
  const have = new Set([...Object.keys(dict.exact ?? {}), ...Object.keys(dict.patterns ?? {})]);
  list = list.filter((x) => !have.has(x.en));
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ appVersion: info.version, total: list.length, items: list }, null, 1));
console.log(`app ${info.version}: ${list.length} strings -> ${OUT}`);
