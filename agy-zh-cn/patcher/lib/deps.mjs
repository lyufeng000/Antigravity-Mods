// 动态解析外部依赖（@electron/asar、acorn、acorn-walk）。
// 既支持插件 patcher/ 目录直接加载本地 node_modules，也支持从全局 Skill 目录运行时自动回退定位依赖。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = path.resolve(here, '..');

function argPluginDir() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--plugin-dir');
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return process.env.AGY_I18N_PLUGIN_DIR || null;
}

function candidatePackageJsons() {
  const out = [];
  const p = argPluginDir();
  if (p) out.push(path.resolve(p, 'patcher', 'package.json'));
  out.push(path.join(SCRIPT_DIR, 'package.json'));
  out.push(path.resolve(SCRIPT_DIR, '..', '..', 'package.json'));
  out.push(path.resolve(process.cwd(), 'package.json'));
  out.push(path.join(os.homedir(), '.gemini', 'config', 'plugins', 'agy-zh-cn', 'patcher', 'package.json'));
  return [...new Set(out)];
}

export function loadDep(name) {
  for (const pkgJson of candidatePackageJsons()) {
    if (!fs.existsSync(pkgJson)) continue;
    try {
      return createRequire(pkgJson)(name);
    } catch { /* 继续尝试下一个候选路径 */ }
  }
  try {
    return createRequire(import.meta.url)(name);
  } catch {
    throw new Error(
      `找不到依赖 "${name}"。请在目标插件的 patcher 目录运行 npm.cmd install（或通过 --plugin-dir 指定已安装依赖的插件目录）。`
    );
  }
}

export function loadDeps(names) {
  const out = {};
  for (const name of names) out[name] = loadDep(name);
  return out;
}
