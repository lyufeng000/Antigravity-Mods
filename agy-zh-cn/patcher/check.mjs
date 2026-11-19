// 汇报汉化补丁状态：版本、是否已打补丁、备份、词典条数与覆盖率。
// 用法：node check.mjs [--plugin-dir <目录>] [--dict <词典路径>] [--strings <strings-en.json 路径>] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { ASAR, appInfo } from './lib/app.mjs';
import { PLUGIN_DIR, defaultDictPath, isPatched, backupList, parseArgs } from './lib/common.mjs';

const args = parseArgs();
const DICT_FILE = path.resolve(args.opt('--dict', defaultDictPath()));
const STRINGS = path.resolve(args.opt('--strings', path.join(PLUGIN_DIR, 'work', 'strings-en.json')));

const r = { asar: ASAR, pluginDir: PLUGIN_DIR };
try {
  r.version = appInfo().version;
  r.patched = isPatched(ASAR);
} catch (e) { r.error = `读取 app.asar 失败：${e.message}`; }
const backups = backupList();
r.backup = backups.map((b) => ({ version: b.version, file: b.file, matches: b.version === r.version }));

let dict = null;
if (fs.existsSync(DICT_FILE)) {
  dict = JSON.parse(fs.readFileSync(DICT_FILE, 'utf8'));
  const cnt = (o) => {
    const v = Object.values(o ?? {});
    return { total: v.length, translated: v.filter((x) => typeof x === 'string' && x !== '').length, keep: v.filter((x) => x === null).length };
  };
  r.dict = { file: DICT_FILE, appVersion: dict.meta?.appVersion ?? null, exact: cnt(dict.exact), patterns: cnt(dict.patterns) };
}
if (fs.existsSync(STRINGS)) {
  const s = JSON.parse(fs.readFileSync(STRINGS, 'utf8'));
  const items = s.items ?? [];
  const look = (en) => {
    for (const src of [dict?.exact, dict?.patterns]) if (src && Object.hasOwn(src, en)) return src[en];
    return undefined;
  };
  let translated = 0, keep = 0;
  for (const it of items) {
    const v = look(it.en);
    if (typeof v === 'string' && v !== '') translated++;
    else if (v === null) keep++;
  }
  const pct = (n) => items.length ? `${((n / items.length) * 100).toFixed(1)}%` : '-';
  r.coverage = {
    strings: STRINGS, stringsVersion: s.appVersion, total: items.length, translated, keep,
    missing: items.length - translated - keep, translatedPct: pct(translated), handledPct: pct(translated + keep),
  };
}

if (args.has('--json')) {
  console.log(JSON.stringify(r, null, 2));
} else {
  const L = [];
  L.push(`插件目录：${r.pluginDir}`);
  L.push(`安装包：${r.asar}`);
  if (r.error) L.push(r.error);
  else L.push(`版本：${r.version}    补丁：${r.patched ? '已打' : '未打'}`);
  L.push(`备份：${r.backup.length ? r.backup.map((b) => `${b.version}${b.matches ? '（与当前版本一致）' : '（与当前版本不一致）'}`).join('，') : '无'}`);
  if (r.dict) {
    L.push(`词典：exact ${r.dict.exact.translated} 条已译 / ${r.dict.exact.keep} 条保留原文；patterns ${r.dict.patterns.translated} 条已译 / ${r.dict.patterns.keep} 条保留原文`);
    if (r.dict.appVersion && r.version && r.dict.appVersion !== r.version) L.push(`注意：词典对应版本 ${r.dict.appVersion}，当前安装 ${r.version}，建议重新提取并补译`);
  } else L.push(`词典：不存在（${DICT_FILE}）`);
  if (r.coverage) {
    const c = r.coverage;
    L.push(`覆盖率：已译 ${c.translated}/${c.total}（${c.translatedPct}），含保留原文 ${c.translated + c.keep}/${c.total}（${c.handledPct}），未处理 ${c.missing}`);
    if (c.stringsVersion && r.version && c.stringsVersion !== r.version) L.push(`注意：strings-en.json 提取自 ${c.stringsVersion}，与当前版本不一致`);
  } else L.push(`覆盖率：缺少 ${STRINGS}`);
  console.log(L.join('\n'));
}
