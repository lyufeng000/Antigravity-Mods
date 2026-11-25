// 动态加载 @electron/asar / jsdom：优先本地 node_modules，自动回退同级 agy-zh-cn/patcher 或 agy-weekly-quota/patcher 的 node_modules。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(here, '..', '..');

function candidatePackageJsons() {
  return [
    path.resolve(PROJECT_ROOT, '..', 'package.json'),
    path.join(PROJECT_ROOT, 'package.json'),
    path.join(PROJECT_ROOT, 'patcher', 'package.json'),
    path.resolve(PROJECT_ROOT, '..', 'agy-zh-cn', 'patcher', 'package.json'),
    path.resolve(PROJECT_ROOT, '..', 'agy-weekly-quota', 'patcher', 'package.json'),
    path.resolve(PROJECT_ROOT, '..', 'agy-weekly-quota', 'package.json'),
    path.join(os.homedir(), '.gemini', 'config', 'plugins', 'agy-zh-cn', 'patcher', 'package.json'),
  ];
}

export function loadDep(name) {
  for (const pkgJson of candidatePackageJsons()) {
    if (!fs.existsSync(pkgJson)) continue;
    try {
      return createRequire(pkgJson)(name);
    } catch { /* 继续查找下一个候选目录 */ }
  }
  return createRequire(import.meta.url)(name);
}
