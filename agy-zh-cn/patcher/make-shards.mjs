// 把 strings-en.json 或增量提取列表切分成翻译分片。
// 用法：node make-shards.mjs [份数=6] [--plugin-dir <目录>] [--in <strings.json>] [--out-dir <shards 目录>]
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_DIR, parseArgs } from './lib/common.mjs';

const args = parseArgs();
const pos = args.positional(['--plugin-dir', '--in', '--out-dir']);
const N = Math.max(1, Number(pos[0] || 6));
const inFile = path.resolve(args.opt('--in', path.join(PLUGIN_DIR, 'work', 'strings-en.json')));
const dir = path.resolve(args.opt('--out-dir', path.join(PLUGIN_DIR, 'work', 'shards')));

const src = JSON.parse(fs.readFileSync(inFile, 'utf8'));
fs.mkdirSync(dir, { recursive: true });
const items = (src.items ?? []).map((x, i) => ({
  id: i,
  en: x.en,
  kind: Array.isArray(x.kinds) ? x.kinds.join(',') : (x.kind || ''),
  ctx: (Array.isArray(x.ctx) ? x.ctx[0] : (x.ctx || '')).slice(0, 260),
}));
const per = Math.ceil(items.length / N) || 1;
for (let k = 0; k < N; k++) {
  const part = items.slice(k * per, (k + 1) * per);
  fs.writeFileSync(path.join(dir, `shard-${k + 1}.json`), JSON.stringify({ shard: k + 1, count: part.length, items: part }, null, 1));
  console.log(`shard-${k + 1}: ${part.length} (${part[0]?.en.slice(0, 20) ?? '-'} … ${part.at(-1)?.en.slice(0, 20) ?? '-'})`);
}
