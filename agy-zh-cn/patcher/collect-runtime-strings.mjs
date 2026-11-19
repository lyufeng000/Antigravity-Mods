// 采集服务器动态下发或运行时漏译收集器（Ctrl+Alt+Shift+Z）捕获的未翻译文本，并与现有词典比对去重。
// 用法：node collect-runtime-strings.mjs [--plugin-dir <目录>] [--rpc] [--clipboard] [--from <文本文件>] [--dict <词典路径>] [--out <输出json>] [--json]
//   --rpc       向已注入环境的 Antigravity LanguageServerService 发起只读查询（GetUserStatus / GetAvailableModels / GetCascadeNuxes）
//   --clipboard 读取剪贴板（适合用户在界面按 Ctrl+Alt+Shift+Z 复制漏译列表后调用）
//   --from      读取按行分隔的漏译文本文件
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defaultDictPath, isEntry, parseArgs } from './lib/common.mjs';

const ESC_RE = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function numericSlotRe(key, to, part) {
  const esc = ESC_RE(part);
  if (/^\{\d+\}\s+of\s+\{\d+\}$/.test(key)) return '(\\d+(?:[,.:]\\d+)*(?:[kKmM])?\\+?)';
  if (/^Up\s+\{\d+\}$/.test(key) && /^已运行\s*\{\d+\}$/.test(to)) return '([<>~]?\\d[^\\n.!?]{0,30})';
  if (new RegExp(`第\\s*${esc}\\s*[轮步页张次个条项行]`).test(to)) return '(\\d+(?:\\s*\\/\\s*\\d+)?\\+?)';
  if (new RegExp(`${esc}\\s*(?:个(?!人|性)|条(?!件|目)|项(?!目)|处(?!理)|张(?!贴)|次(?!数)|轮|步|份|页(?!面)|行(?!为|业|程)|天(?!气)|小时|分钟|秒|周(?!期)|月(?!份)|年(?!份)|%)`).test(to)) {
    return '([<>~]?\\d+(?:[,.:]\\d+)*(?:[kKmM])?\\+?)';
  }
  return null;
}

// 与 runtime translator.js 保持一致的模式匹配编译器，用来判断一条动态文案是否已被现有 patterns 覆盖
function compilePatterns(patternsObj = {}) {
  const compiled = [];
  for (const [pk, to] of Object.entries(patternsObj)) {
    if (typeof to !== 'string' || to === '') continue;
    const key = pk.trim();
    const litText = key.replace(/\{\d+\}/g, '');
    if (!/[A-Za-z]/.test(litText)) continue;
    const litLetters = (litText.match(/[A-Za-z]/g) || []).length;
    const shortGuard = litLetters <= 6 && !litText.includes(':');
    const maxCapWords = litLetters <= 4 ? 4 : 6;
    const parts = key.split(/(\{\d+\})/);
    let re = '^';
    const seen = {};
    let capIdx = 0;
    let hasCap = false;
    let opt = false;
    const guarded = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const ph = /^\{(\d+)\}$/.exec(part);
      if (ph) {
        if (i > 0 && /[A-Za-z]$/.test(parts[i - 1]) && !/^[A-Za-z]/.test(parts[i + 1] || '') && !to.includes(part)) {
          re += '(?:s|es|ies)?';
          opt = true;
          continue;
        }
        if (seen[ph[1]]) { re += `\\${seen[ph[1]]}`; continue; }
        seen[ph[1]] = ++capIdx;
        hasCap = true;
        const nre = numericSlotRe(key, to, part);
        if (nre) {
          re += nre;
        } else {
          re += '([\\s\\S]+?)';
          if (shortGuard) guarded.push(capIdx);
        }
      } else {
        re += ESC_RE(part);
      }
    }
    if (hasCap || opt) {
      const regex = new RegExp(`${re}$`);
      compiled.push({
        re: regex,
        guarded,
        maxCapWords,
        test(s) {
          const m = regex.exec(s);
          if (!m) return false;
          if (guarded.length) {
            let words = 0;
            for (const gi of guarded) {
              const cap = m[gi].trim();
              if (!cap) continue;
              if (/\n|[.!?…](?:\s|$)|[,;]\s/.test(cap)) return false;
              words += cap.split(/\s+/).length;
              if (words > maxCapWords) return false;
            }
          }
          return true;
        },
      });
    }
  }
  return compiled;
}

export function isCoveredByDict(raw, dict, compiledPatterns = compilePatterns(dict?.patterns)) {
  const t = raw.trim();
  if (!t) return true;
  if (dict?.exact && Object.hasOwn(dict.exact, t)) return true;
  if (dict?.patterns && Object.hasOwn(dict.patterns, t)) return true;
  return compiledPatterns.some((p) => p.test(t));
}

export function suggestPatternsForText(raw) {
  const s = raw.trim();
  const out = [];
  // 针对刷新时间文案，拆出外层 refresh in {0} 与内层时长模板
  const refreshMatch = s.match(/^(.*?\brefresh in )(\d+\s+(?:days?|hours?|minutes?|seconds?)(?:,\s*\d+\s+(?:days?|hours?|minutes?|seconds?))*)(\.?)$/i);
  if (refreshMatch) {
    out.push(`${refreshMatch[1]}{0}${refreshMatch[3]}`);
    const dur = suggestPatternsForText(refreshMatch[2])[0];
    if (dur) out.push(dur);
    return [...new Set(out)];
  }
  let n = 0;
  const generic = s.replace(/(?<![A-Za-z0-9.\-/])\d+(?![A-Za-z0-9.\-/]|-hour\b)/g, () => `{${n++}}`);
  if (n > 0 && generic !== s) out.push(generic);
  return out;
}

export function parseRuntimeLines(text) {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('[agy-zh]'))
    .filter((line) => /[A-Za-z]{2,}/.test(line));
}

function looksHumanText(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 2 || t.length > 400 || !/[A-Za-z]{2,}/.test(t)) return false;
  if (/^[A-Z0-9_]{3,}$/.test(t)) return false;
  if (/^(https?:|icon:\/\/|mailto:|[\w.-]+@[\w.-]+)/i.test(t)) return false;
  return true;
}

export function extractRpcStrings({ userStatus, availableModels, cascadeNuxes } = {}) {
  const entries = [];
  const add = (text, source) => {
    if (!looksHumanText(text)) return;
    entries.push({ en: text.trim(), source });
  };

  const cfgs = userStatus?.userStatus?.cascadeModelConfigData?.clientModelConfigs ?? [];
  for (const c of cfgs) {
    add(c.tagTitle, 'rpc:GetUserStatus.tagTitle');
    add(c.tagDescription, 'rpc:GetUserStatus.tagDescription');
  }
  const sorts = userStatus?.userStatus?.cascadeModelConfigData?.clientModelSorts ?? [];
  for (const s of sorts) {
    add(s.name, 'rpc:GetUserStatus.sortName');
    for (const g of s.groups ?? []) add(g.groupName, 'rpc:GetUserStatus.groupName');
  }

  const models = availableModels?.response?.models ?? {};
  for (const m of Object.values(models)) {
    add(m.tagTitle, 'rpc:GetAvailableModels.tagTitle');
    add(m.tagDescription, 'rpc:GetAvailableModels.tagDescription');
  }

  const nuxes = cascadeNuxes?.nuxes ?? [];
  for (const n of nuxes) {
    add(n.title, 'rpc:GetCascadeNuxes.title');
    if (looksHumanText(n.body)) {
      const cleaned = n.body.replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/[ \t]+/g, ' ');
      for (const para of cleaned.split(/\n{2,}/)) {
        const p = para.trim();
        if (looksHumanText(p)) add(p, 'rpc:GetCascadeNuxes.body');
      }
    }
  }
  return entries;
}

export async function queryLanguageServerRpc({ address, csrfToken } = {}) {
  const addr = address || process.env.ANTIGRAVITY_LS_ADDRESS;
  const csrf = csrfToken || process.env.ANTIGRAVITY_CSRF_TOKEN;
  if (!addr || !csrf) {
    return { skipped: true, reason: '未检测到 ANTIGRAVITY_LS_ADDRESS 或 ANTIGRAVITY_CSRF_TOKEN 环境变量' };
  }
  const base = /^https?:\/\//i.test(addr) ? addr : `http://${addr}`;
  const call = async (method) => {
    const res = await fetch(`${base}/exa.language_server_pb.LanguageServerService/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': csrf,
      },
      body: '{}',
    });
    if (!res.ok) throw new Error(`${method} 返回 HTTP ${res.status}`);
    return res.json();
  };
  const [userStatus, availableModels, cascadeNuxes] = await Promise.all([
    call('GetUserStatus'),
    call('GetAvailableModels'),
    call('GetCascadeNuxes'),
  ]);
  return { skipped: false, payload: { userStatus, availableModels, cascadeNuxes } };
}

export function classifyRuntimeRecords(records, dict = { exact: {}, patterns: {} }) {
  const compiled = compilePatterns(dict.patterns);
  const byText = new Map();
  let covered = 0;

  for (const rec of records) {
    const en = (typeof rec === 'string' ? rec : rec.en || '').trim();
    const src = typeof rec === 'string' ? 'manual' : (rec.source || 'manual');
    if (!en || /[\u3400-\u9fff]/.test(en)) continue;
    if (isCoveredByDict(en, dict, compiled)) { covered++; continue; }
    const existing = byText.get(en);
    if (existing) {
      if (!existing.sources.includes(src)) existing.sources.push(src);
      continue;
    }
    const suggested = suggestPatternsForText(en);
    byText.set(en, {
      en,
      sources: [src],
      suggestedPatterns: suggested.length ? suggested : undefined,
    });
  }

  return {
    totalCollected: records.length,
    alreadyCovered: covered,
    missing: [...byText.values()].sort((a, b) => a.en.localeCompare(b.en)),
  };
}

function readClipboardText() {
  if (process.platform !== 'win32') throw new Error('--clipboard 仅支持 Windows；其余平台请改用 --from <文本文件>');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });
}

async function main() {
  const args = parseArgs();
  const dictPath = path.resolve(args.opt('--dict', defaultDictPath()));
  const dict = fs.existsSync(dictPath) ? JSON.parse(fs.readFileSync(dictPath, 'utf8')) : { exact: {}, patterns: {} };
  const fromFiles = args.optAll('--from');
  const explicitSource = args.has('--rpc') || args.has('--clipboard') || fromFiles.length > 0;
  const useRpc = args.has('--rpc') || !explicitSource;
  const useClipboard = args.has('--clipboard');
  const records = [];
  const notes = [];

  if (useRpc) {
    try {
      const r = await queryLanguageServerRpc({ address: args.opt('--address', null), csrfToken: args.opt('--csrf', null) });
      if (r.skipped) notes.push(`跳过 RPC：${r.reason}`);
      else records.push(...extractRpcStrings(r.payload));
    } catch (e) {
      notes.push(`RPC 查询失败：${e.message}`);
    }
  }
  if (useClipboard) {
    const clip = readClipboardText();
    for (const line of parseRuntimeLines(clip)) records.push({ en: line, source: 'clipboard' });
  }
  for (const f of fromFiles) {
    const txt = fs.readFileSync(path.resolve(f), 'utf8');
    for (const line of parseRuntimeLines(txt)) records.push({ en: line, source: `file:${path.basename(f)}` });
  }

  const result = classifyRuntimeRecords(records, dict);
  const outPayload = {
    dict: dictPath,
    notes,
    totalCollected: result.totalCollected,
    alreadyCovered: result.alreadyCovered,
    missingCount: result.missing.length,
    items: result.missing,
  };

  const outPath = args.opt('--out', null);
  if (outPath) {
    const abs = path.resolve(outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(outPayload, null, 2));
  }

  if (args.has('--json')) {
    console.log(JSON.stringify(outPayload, null, 2));
  } else {
    console.log(`collect-runtime-strings：采集 ${result.totalCollected} 条，已覆盖 ${result.alreadyCovered} 条，待处理 ${result.missing.length} 条${outPath ? ` -> ${path.resolve(outPath)}` : ''}`);
    for (const n of notes) console.log(`  注意：${n}`);
    for (const it of result.missing) {
      const hint = it.suggestedPatterns ? `  [建议模式: ${it.suggestedPatterns.join(' | ')}]` : '';
      console.log(`  [${it.sources.join(',')}] ${JSON.stringify(it.en)}${hint}`);
    }
  }
}

if (isEntry(import.meta.url)) {
  main().catch((e) => { console.error(`失败：${e.message}`); process.exit(1); });
}
