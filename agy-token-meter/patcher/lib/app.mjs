// 定位 Antigravity 安装目录与读取包版本。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const INSTALL_DIR = process.env.AGY_INSTALL_DIR ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'antigravity');
export const RES_DIR = path.join(INSTALL_DIR, 'resources');
export const ASAR = path.join(RES_DIR, 'app.asar');
export const EXE = path.join(INSTALL_DIR, 'Antigravity.exe');
export const TEMP_ROOT = fs.existsSync('D:\\Data\\.temp') ? 'D:\\Data\\.temp' : os.tmpdir();

export function appInfo(asarPath = ASAR) {
  const buf = fs.readFileSync(asarPath);
  const m = buf.toString('latin1').match(/"productName":\s*"Antigravity",\s*"version":\s*"([^"]+)"/);
  return { version: m ? m[1] : 'unknown', asarSize: buf.length };
}
