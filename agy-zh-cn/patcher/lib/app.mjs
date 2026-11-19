// 公共工具：定位 Antigravity 安装、读取版本、读取 language_server.exe 内嵌前端 ZIP 中的文件。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

export const INSTALL_DIR = process.env.AGY_INSTALL_DIR ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'antigravity');
export const RES_DIR = path.join(INSTALL_DIR, 'resources');
export const ASAR = path.join(RES_DIR, 'app.asar');
export const LS_EXE = path.join(RES_DIR, 'bin', 'language_server.exe');
export const EXE = path.join(INSTALL_DIR, 'Antigravity.exe');
export const TEMP_ROOT = fs.existsSync('D:\\Data\\.temp') ? 'D:\\Data\\.temp' : os.tmpdir();

export function appInfo() {
  // 版本号存放在 asar 的 package.json，这里用文本搜索避免依赖 asar 解包
  const buf = fs.readFileSync(ASAR);
  const m = buf.toString('latin1').match(/"productName":\s*"Antigravity",\s*"version":\s*"([^"]+)"/);
  return { version: m ? m[1] : 'unknown', asarSize: buf.length };
}

let zipCache;
function webZip() {
  if (zipCache) return zipCache;
  const b = fs.readFileSync(LS_EXE);
  const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  let i = -1, best = null;
  while ((i = b.indexOf(EOCD, i + 1)) !== -1) {
    const cdSize = b.readUInt32LE(i + 12), cdOff = b.readUInt32LE(i + 16), entries = b.readUInt16LE(i + 10);
    const cdStart = i - cdSize, zipStart = cdStart - cdOff;
    if (zipStart < 0 || b.readUInt32LE(cdStart) !== 0x02014b50) continue;
    // 前端包的特征：包含 main.js 和 compiled_tailwind.css
    const cd = b.subarray(cdStart, i).toString('latin1');
    if (cd.includes('main.js') && cd.includes('compiled_tailwind.css')) { best = { b, zipStart, cdStart, entries }; break; }
  }
  if (!best) throw new Error('未在 language_server.exe 中找到前端资源包');
  const files = new Map();
  let p = best.cdStart;
  for (let k = 0; k < best.entries; k++) {
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20);
    const nlen = b.readUInt16LE(p + 28), xlen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32);
    const lho = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString('utf8');
    files.set(name, { method, csize, lho: best.zipStart + lho });
    p += 46 + nlen + xlen + clen;
  }
  return (zipCache = { b, files });
}

export function listWebAssets() { return [...webZip().files.keys()]; }

export function readWebAsset(name) {
  const { b, files } = webZip();
  const f = files.get(name);
  if (!f) throw new Error(`前端资源包中没有 ${name}`);
  const nlen = b.readUInt16LE(f.lho + 26), xlen = b.readUInt16LE(f.lho + 28);
  const data = b.subarray(f.lho + 30 + nlen + xlen, f.lho + 30 + nlen + xlen + f.csize);
  return f.method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
}
