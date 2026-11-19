// 词典校验：占位符、硬标识、术语一致性、中英文空格与标点、省略号、残留英文。
// 用法：node lint-dict.mjs [--plugin-dir <目录>] [--dict <zh-CN.json>] [--glossary <glossary.md>] [--quiet] [--max <每级最多显示条数>] [--json]
// 有错误时退出码为 1。词典 meta.lintIgnore（英文键数组）里的条目，术语类与空格类错误降级为警告。
import fs from 'node:fs';
import path from 'node:path';
import { defaultDictPath, defaultGlossaryPath, parseArgs } from './lib/common.mjs';
import { lintDict } from './lib/lint.mjs';

const args = parseArgs();
const DICT = path.resolve(args.opt('--dict', defaultDictPath()));
const GLOSS = path.resolve(args.opt('--glossary', defaultGlossaryPath()));
const MAX = Number(args.opt('--max', 300));

if (!fs.existsSync(DICT)) { console.error(`找不到词典：${DICT}`); process.exit(2); }
let dict;
try { dict = JSON.parse(fs.readFileSync(DICT, 'utf8')); }
catch (e) { console.error(`词典不是合法 JSON：${e.message}`); process.exit(1); }
const gloss = fs.existsSync(GLOSS) ? fs.readFileSync(GLOSS, 'utf8') : null;
if (!gloss) console.warn(`警告：找不到术语表 ${GLOSS}，跳过术语一致性检查`);

const r = lintDict(dict, gloss);
if (args.has('--json')) {
  console.log(JSON.stringify(r, null, 1));
} else {
  const show = (level, tag) => {
    const list = r.issues.filter((i) => i.level === level);
    for (const i of list.slice(0, MAX)) console.log(`${tag} [${i.kind}] ${JSON.stringify(i.en)} → ${JSON.stringify(i.zh)}：${i.msg}`);
    if (list.length > MAX) console.log(`${tag} …另有 ${list.length - MAX} 条未显示（--max 调整）`);
  };
  show('error', 'ERROR');
  if (!args.has('--quiet')) show('warn', 'WARN ');
  console.log(`lint-dict：${r.entries} 条词条，术语 ${r.terms} 个，错误 ${r.errors}，警告 ${r.warnings}`);
}
process.exit(r.errors ? 1 : 0);
