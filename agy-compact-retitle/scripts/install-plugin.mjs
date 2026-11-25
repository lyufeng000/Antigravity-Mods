import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(HERE, '..');
export const DEFAULT_DEST = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'agy-compact-retitle');

export const RUNTIME_FILES = [
  'plugin.json',
  'hooks.json',
  'package.json',
  'README.md',
  'scripts/compact-retitle.mjs',
  'scripts/set-title.mjs',
];

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

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
 * 检测全局插件目录当前安装状态（区分未安装 / Windows 目录联接 / 已过期待同步 / 已安装）。
 */
export function inspectPlugin(destDir = DEFAULT_DEST) {
  let stat;
  try {
    stat = fs.lstatSync(destDir);
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return {
        status: 'not_installed',
        installed: false,
        dest: destDir,
        missingFiles: [...RUNTIME_FILES],
        outdatedFiles: [],
      };
    }
    throw err;
  }

  if (stat.isSymbolicLink()) {
    return {
      status: 'junction',
      installed: false,
      dest: destDir,
      missingFiles: [],
      outdatedFiles: [],
    };
  }

  if (!stat.isDirectory()) {
    return {
      status: 'outdated',
      installed: false,
      dest: destDir,
      missingFiles: [...RUNTIME_FILES],
      outdatedFiles: [],
    };
  }

  const missingFiles = [];
  const outdatedFiles = [];
  for (const rel of RUNTIME_FILES) {
    const src = path.join(SRC_ROOT, rel);
    const dst = path.join(destDir, rel);
    if (!fs.existsSync(dst)) {
      missingFiles.push(rel);
      continue;
    }
    if (sha256File(src) !== sha256File(dst)) {
      outdatedFiles.push(rel);
    }
  }

  const upToDate = missingFiles.length === 0 && outdatedFiles.length === 0;
  return {
    status: upToDate ? 'installed' : 'outdated',
    installed: upToDate,
    dest: destDir,
    missingFiles,
    outdatedFiles,
  };
}

/**
 * 安全卸载全局插件目录（对目录联接仅解除链接，不误删源码目录）。
 */
export function uninstallPlugin(destDir = DEFAULT_DEST) {
  try {
    fs.lstatSync(destDir);
  } catch (err) {
    if (err?.code === 'ENOENT') return { removed: false, dest: destDir };
    throw err;
  }
  removeExistingTarget(destDir);
  return { removed: true, dest: destDir };
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
