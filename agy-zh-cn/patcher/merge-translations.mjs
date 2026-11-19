// 安全合并分片译稿、增量补译文件或手工词条到主词典（i18n/zh-CN.json），合并前强制通过 lintDict 校验。
// 用法：node merge-translations.mjs [file...] [--in a.json,b.json] [--shards <目录>] [--plugin-dir <目录>] [--dict <词典>]
//       [--glossary <术语表>] [--mark-manual] [--overwrite-manual] [--add-lint-ignore <英文键>] [--app-version <版本号>]
//       [--sync-app-version] [--no-lint] [--dry-run] [--quiet] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { appInfo } from './lib/app.mjs';
import { defaultDictPath, defaultGlossaryPath, isEntry, parseArgs } from './lib/common.mjs';
import { lintDict } from './lib/lint.mjs';

export function extractEntriesFromPayload(payload) {
  const entries = [];
  const lintIgnore = [];
  if (!payload || typeof payload !== 'object') throw new Error('输入文件必须是 JSON 对象或数组');

  const collectArray = (arr) => {
    for (const row of arr) {
      if (!row || typeof row !== 'object' || typeof row.en !== 'string') continue;
      if (row.zh === undefined) continue; // 未翻译字段跳过
      entries.push([row.en, row.zh]);
    }
  };

  if (Array.isArray(payload)) {
    collectArray(payload);
  } else if (Array.isArray(payload.items)) {
    collectArray(payload.items);
  } else if (payload.exact || payload.patterns) {
    for (const [k, v] of Object.entries(payload.exact ?? {})) entries.push([k, v]);
    for (const [k, v] of Object.entries(payload.patterns ?? {})) entries.push([k, v]);
  } else {
    for (const [k, v] of Object.entries(payload)) {
      if (k === 'meta' || k === 'lintIgnore') continue;
      entries.push([k, v]);
    }
  }

  if (Array.isArray(payload.lintIgnore)) lintIgnore.push(...payload.lintIgnore);
  if (Array.isArray(payload.meta?.lintIgnore)) lintIgnore.push(...payload.meta.lintIgnore);
  return { entries, lintIgnore };
}

export function mergeTranslations(baseDict, payloads, options = {}) {
  const next = structuredClone(baseDict ?? { meta: {}, exact: {}, patterns: {} });
  next.meta = next.meta && typeof next.meta === 'object' ? next.meta : {};
  next.exact = next.exact && typeof next.exact === 'object' ? next.exact : {};
  next.patterns = next.patterns && typeof next.patterns === 'object' ? next.patterns : {};

  const manualSet = new Set(next.meta.manualAdditions ?? []);
  const touched = [];
  const stats = { added: 0, updated: 0, unchanged: 0, skippedManual: 0 };

  for (const p of payloads) {
    const { entries, lintIgnore } = extractEntriesFromPayload(p);
    for (const [rawEn, val] of entries) {
      const en = String(rawEn);
      const bucketName = /\{\d+\}/.test(en) ? 'patterns' : 'exact';
      const otherName = bucketName === 'patterns' ? 'exact' : 'patterns';
      const target = next[bucketName];
      const other = next[otherName];

      const existing = Object.hasOwn(target, en) ? target[en] : (Object.hasOwn(other, en) ? other[en] : undefined);
      if (!options.overwriteManual && manualSet.has(en) && typeof existing === 'string' && existing !== '' && val === null) {
        stats.skippedManual++;
        continue;
      }

      if (Object.hasOwn(other, en)) delete other[en];
      if (!Object.hasOwn(target, en)) {
        target[en] = val;
        stats.added++;
        touched.push(en);
      } else if (target[en] !== val) {
        target[en] = val;
        stats.updated++;
        touched.push(en);
      } else {
        stats.unchanged++;
      }
    }
    if (lintIgnore.length) {
      next.meta.lintIgnore = [...new Set([...(next.meta.lintIgnore ?? []), ...lintIgnore])];
    }
  }

  if (options.addLintIgnore?.length) {
    next.meta.lintIgnore = [...new Set([...(next.meta.lintIgnore ?? []), ...options.addLintIgnore])];
  }
  if (options.markManual && touched.length) {
    next.meta.manualAdditions = [...new Set([...(next.meta.manualAdditions ?? []), ...touched])];
  }
  if (options.appVersion) {
    next.meta.appVersion = options.appVersion;
  }

  return { dict: next, stats, touched };
}

function collectInputFiles(args) {
  const files = [];
  for (const val of args.optAll('--in')) {
    for (const seg of val.split(',').map((s) => s.trim()).filter(Boolean)) files.push(path.resolve(seg));
  }
  for (const dir of args.optAll('--shards')) {
    const abs = path.resolve(dir);
    const list = fs.readdirSync(abs)
      .filter((f) => f.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((f) => path.join(abs, f));
    files.push(...list);
  }
  const valueFlags = ['--in', '--shards', '--plugin-dir', '--dict', '--glossary', '--add-lint-ignore', '--app-version'];
  for (const p of args.positional(valueFlags)) files.push(path.resolve(p));
  return [...new Set(files)];
}

function main() {
  const args = parseArgs();
  const dictPath = path.resolve(args.opt('--dict', defaultDictPath()));
  const glossaryPath = path.resolve(args.opt('--glossary', defaultGlossaryPath()));
  const files = collectInputFiles(args);

  if (!files.length) {
    console.error('请通过位置参数、--in 或 --shards 提供至少一个译稿 JSON 文件');
    process.exit(2);
  }

  const baseDict = fs.existsSync(dictPath)
    ? JSON.parse(fs.readFileSync(dictPath, 'utf8'))
    : { meta: { appVersion: '', glossaryVersion: 2 }, exact: {}, patterns: {} };
  const payloads = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));

  let appVersion = args.opt('--app-version', null);
  if (!appVersion && args.has('--sync-app-version')) appVersion = appInfo().version;

  const { dict: merged, stats } = mergeTranslations(baseDict, payloads, {
    markManual: args.has('--mark-manual'),
    overwriteManual: args.has('--overwrite-manual'),
    addLintIgnore: args.optAll('--add-lint-ignore'),
    appVersion,
  });

  let lintResult = { errors: 0, warnings: 0, issues: [] };
  if (!args.has('--no-lint')) {
    const gloss = fs.existsSync(glossaryPath) ? fs.readFileSync(glossaryPath, 'utf8') : null;
    lintResult = lintDict(merged, gloss);
    if (lintResult.errors > 0) {
      if (args.has('--json')) {
        console.log(JSON.stringify({ ok: false, stats, lint: lintResult }, null, 2));
      } else {
        for (const i of lintResult.issues.filter((x) => x.level === 'error').slice(0, 50)) {
          console.error(`ERROR [${i.kind}] ${JSON.stringify(i.en)} → ${JSON.stringify(i.zh)}：${i.msg}`);
        }
        console.error(`merge-translations：校验发现 ${lintResult.errors} 个错误，拒绝写入 ${dictPath}`);
      }
      process.exit(1);
    }
  }

  if (!args.has('--dry-run')) {
    fs.mkdirSync(path.dirname(dictPath), { recursive: true });
    fs.writeFileSync(dictPath, JSON.stringify(merged, null, 2));
  }

  const out = {
    ok: true,
    dryRun: args.has('--dry-run'),
    dict: dictPath,
    inputs: files.length,
    stats,
    lint: { errors: lintResult.errors, warnings: lintResult.warnings },
  };
  if (args.has('--json')) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    const tag = args.has('--dry-run') ? '（dry-run 未落盘）' : '';
    console.log(`merge-translations：读取 ${files.length} 个文件，新增 ${stats.added}，更新 ${stats.updated}，未变 ${stats.unchanged}，保护手工 ${stats.skippedManual}，lint 错误 ${lintResult.errors} / 警告 ${lintResult.warnings}${tag}`);
  }
}

if (isEntry(import.meta.url)) main();
