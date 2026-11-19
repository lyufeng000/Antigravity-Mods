// 检查周额度插槽补丁状态、宿主版本、共存补丁状态与备份状态。
// 用法：node check.mjs [--json]
import fs from 'node:fs';
import { ASAR, appInfo } from './lib/app.mjs';
import { PROJECT_DIR, SLOT_SCRIPT, ACCOUNTS_CONFIG_FILE, isPatched, backupList, parseArgs } from './lib/common.mjs';

const args = parseArgs();
const r = {
  projectDir: PROJECT_DIR,
  asar: ASAR,
  slotScriptExists: fs.existsSync(SLOT_SCRIPT),
  accountsConfigFile: ACCOUNTS_CONFIG_FILE,
  savedAccounts: [],
};

if (fs.existsSync(ACCOUNTS_CONFIG_FILE)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(ACCOUNTS_CONFIG_FILE, 'utf8'));
    if (cfg?.accounts && typeof cfg.accounts === 'object') {
      r.savedAccounts = Object.keys(cfg.accounts);
    }
  } catch { /* ignore */ }
}

try {
  r.version = appInfo().version;
  r.quotaPatched = isPatched(ASAR);
  r.zhPatched = fs.readFileSync(ASAR).includes(Buffer.from('/*AGY-ZH-BEGIN*/', 'latin1'));
} catch (e) {
  r.error = `读取 app.asar 失败：${e.message}`;
}

r.backup = backupList().map((b) => ({
  version: b.version,
  file: b.file,
  matches: b.version === r.version,
}));

if (args.has('--json')) {
  console.log(JSON.stringify(r, null, 2));
} else {
  const L = [];
  L.push(`项目目录：${r.projectDir}`);
  L.push(`安装包：${r.asar}`);
  if (r.error) {
    L.push(r.error);
  } else {
    L.push(`版本：${r.version}    周额度补丁：${r.quotaPatched ? '已注入' : '未注入'}    汉化补丁：${r.zhPatched ? '已注入' : '未注入'}`);
  }
  L.push(`共享备份：${r.backup.length ? r.backup.map((b) => `${b.version}${b.matches ? '（与当前版本一致）' : '（与当前版本不一致）'}`).join('，') : '无'}`);
  L.push(`账号配置：${r.accountsConfigFile}（已记录 ${r.savedAccounts.length} 个账号${r.savedAccounts.length ? '：' + r.savedAccounts.join(', ') : ''}）`);
  console.log(L.join('\n'));
}
