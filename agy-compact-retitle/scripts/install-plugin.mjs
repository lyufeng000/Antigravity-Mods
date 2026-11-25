import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(HERE, '..');
const DEFAULT_DEST = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'agy-compact-retitle');

const RUNTIME_FILES = [
  'plugin.json',
  'hooks.json',
  'package.json',
  'README.md',
  'scripts/compact-retitle.mjs',
  'scripts/set-title.mjs',
];

function removeExistingTarget(destDir) {
  let stat;
  try {
    stat = fs.lstatSync(destDir);
  } catch (err) {
    if (err?.code === 'ENOENT') return;
    throw err;
  }

  // Windows Junction / 符号链接必须只解除链接本身，绝不可递归删除，以免波及源码目录。
  if (stat.isSymbolicLink()) {
    try {
      fs.rmdirSync(destDir);
    } catch {
      fs.unlinkSync(destDir);
    }
    return;
  }

  if (stat.isDirectory()) {
    const resolvedDest = fs.realpathSync(destDir).toLowerCase();
    const resolvedSrc = fs.realpathSync(SRC_ROOT).toLowerCase();
    if (resolvedDest === resolvedSrc) {
      throw new Error(`目标目录与源码目录指向同一路径，拒绝清理: ${destDir}`);
    }
    fs.rmSync(destDir, { recursive: true, force: true });
    return;
  }

  fs.unlinkSync(destDir);
}

/**
 * 将插件运行时文件同步复制到全局插件目录（真实目录，不使用 Windows 目录联接）。
 */
export function installPlugin(destDir = DEFAULT_DEST) {
  removeExistingTarget(destDir);
  fs.mkdirSync(destDir, { recursive: true });

  for (const rel of RUNTIME_FILES) {
    const src = path.join(SRC_ROOT, rel);
    const dst = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  return { src: SRC_ROOT, dest: destDir, files: [...RUNTIME_FILES] };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

if (isMainModule()) {
  const customDest = process.argv[2];
  const res = installPlugin(customDest || DEFAULT_DEST);
  console.log(`Installed ${res.files.length} files to ${res.dest}`);
}
