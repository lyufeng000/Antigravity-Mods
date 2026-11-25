// 检查 Windows 通知跳转补丁状态、宿主版本、共存补丁状态与备份状态。
// 用法：node check.mjs [--json]
import fs from 'node:fs';
import { ASAR, appInfo } from './lib/app.mjs';
import {
  PROJECT_DIR, MAIN_SCRIPT, MAIN_MARK_BEGIN,
  isPatched, backupList, parseArgs,
} from './lib/common.mjs';

const args = parseArgs();
const r = {
  projectDir: PROJECT_DIR,
  asar: ASAR,
  mainScriptExists: fs.existsSync(MAIN_SCRIPT),
};

try {
  const buf = fs.readFileSync(ASAR);
  const raw = buf.toString('latin1');
  r.version = appInfo(ASAR).version;
  r.winNotifyPatched = isPatched(ASAR) && raw.includes(MAIN_MARK_BEGIN);
  r.zhPatched = raw.includes('/*AGY-ZH-BEGIN*/');
  r.quotaPatched = raw.includes('/*AGY-QUOTA-BEGIN*/');
  r.fileMenuPatched = raw.includes('/*AGY-FILE-MENU-BEGIN*/');
  r.tokenMeterPatched = raw.includes('/*AGY-TOKEN-METER-BEGIN*/');
  r.periodicModelPatched = raw.includes('/*AGY-PERIODIC-MODEL-BEGIN*/');
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
  L.push(`源码脚本：main=${r.mainScriptExists ? '就绪' : '缺失'}`);
  if (r.error) {
    L.push(r.error);
  } else {
    L.push(
      `版本：${r.version}    通知跳转补丁：${r.winNotifyPatched ? '已注入' : '未注入'}    `
      + `汉化：${r.zhPatched ? '已注入' : '未注入'}    周额度：${r.quotaPatched ? '已注入' : '未注入'}    `
      + `文件菜单：${r.fileMenuPatched ? '已注入' : '未注入'}    Tokens：${r.tokenMeterPatched ? '已注入' : '未注入'}    `
      + `周期表：${r.periodicModelPatched ? '已注入' : '未注入'}`,
    );
  }
  L.push(`共享备份：${r.backup.length ? r.backup.map((b) => `${b.version}${b.matches ? '（匹配）' : '（旧版）'}`).join('，') : '无'}`);
  console.log(L.join('\n'));
}
