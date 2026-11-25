import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MAX_INITIAL_AGE_MS = 10 * 60 * 1000;
const ALLOWED_STOP_REASONS = new Set([
  '',
  undefined,
  'NO_TOOL_CALL',
  'TERMINAL_STEP_TYPE',
  'TERMINAL_CUSTOM_HOOK',
]);

/**
 * 解析状态文件存储目录，优先使用 PLUGIN_DATA，其次 D:\Data\.temp，最后系统临时目录。
 */
export function resolveStateDir(env = process.env) {
  if (env.PLUGIN_DATA) {
    return env.PLUGIN_DATA;
  }
  const preferredRoot = 'D:\\Data\\.temp';
  try {
    if (fs.existsSync(preferredRoot)) {
      return path.join(preferredRoot, 'agy-compact-retitle');
    }
    if (fs.existsSync('D:\\Data')) {
      fs.mkdirSync(preferredRoot, { recursive: true });
      return path.join(preferredRoot, 'agy-compact-retitle');
    }
  } catch {
    // 回退到系统临时目录
  }
  return path.join(os.tmpdir(), 'agy-compact-retitle');
}

/**
 * 从末尾向前扫描 transcript.jsonl，返回最新一条已完成的 CHECKPOINT 记录。
 */
export function findLatestCheckpoint(transcriptPath) {
  let content;
  try {
    content = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }
  if (!content.includes('CHECKPOINT')) {
    return null;
  }
  const lines = content.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || !line.includes('CHECKPOINT')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj?.type === 'CHECKPOINT' && obj?.status === 'DONE' && Number.isInteger(obj?.step_index)) {
        return {
          stepIndex: obj.step_index,
          createdAt: obj.created_at || null,
        };
      }
    } catch {
      // 忽略损坏或半截 JSON 行
    }
  }
  return null;
}

/**
 * 判断 CHECKPOINT 是否属于近期产生的压缩事件（防止旧对话首次接管时误触发）。
 */
export function isRecentCheckpoint(createdAt, nowMs = Date.now(), maxAgeMs = DEFAULT_MAX_INITIAL_AGE_MS) {
  if (!createdAt) return false;
  const ts = Date.parse(createdAt);
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts <= maxAgeMs && ts - nowMs <= 60_000;
}

/**
 * 构造提示 Agent 更新对话标题的系统指令。
 */
export function buildRetitlePrompt({ stepIndex, setTitleScriptPath, isStopEvent }) {
  const cmd = `node "${setTitleScriptPath}" "<新标题>"`;
  const common = [
    `[agy-compact-retitle] 检测到上下文刚刚完成一次压缩（CHECKPOINT #${stepIndex}）。`,
    '请根据上下文中最新生成的压缩摘要（<summary> 与当前核心任务），为当前对话重新起一个 4～14 字的准确简体中文标题（保留必要的英文产品名与专业缩写，不要加引号、书名号或 Markdown 格式），然后立即通过 run_command 执行以下命令更新对话标题：',
    cmd,
  ];
  if (isStopEvent) {
    common.push('标题更新完成后，仅用一句话简短告知用户已将对话标题更新为「新标题」，不要重复之前的回复内容。');
  } else {
    common.push('请在本轮优先/顺手静默完成标题更新，继续正常响应用户当前请求，不要在回复中展开汇报改标题的过程。');
  }
  return common.join('\n');
}

function getStateFilePath(stateDir, conversationId) {
  const safeId = String(conversationId).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(stateDir, `${safeId}.json`);
}

function readState(stateFile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function writeStateAtomic(stateFile, state) {
  const dir = path.dirname(stateFile);
  fs.mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(state);
  const tmpFile = path.join(dir, `.${path.basename(stateFile)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpFile, body, 'utf8');
    fs.renameSync(tmpFile, stateFile);
  } catch {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
    fs.writeFileSync(stateFile, body, 'utf8');
  }
}

function defaultSetTitlePath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'set-title.mjs');
}

/**
 * 处理 PreInvocation / Stop 钩子请求并返回符合 Antigravity 契约的 JSON 对象。
 */
export function handleHookEvent(payload, opts = {}) {
  if (!payload || !payload.conversationId || !payload.transcriptPath) {
    return {};
  }

  const mode = opts.mode || (payload.hookEventName === 'Stop' ? 'stop' : 'pre-invocation');
  const isStopEvent = mode === 'stop';

  if (isStopEvent) {
    if (payload.continuationActive === true) {
      return {};
    }
    if (!ALLOWED_STOP_REASONS.has(payload.terminationReason)) {
      return {};
    }
  }

  let stat;
  try {
    stat = fs.statSync(payload.transcriptPath);
  } catch {
    return {};
  }

  const stateDir = opts.stateDir || resolveStateDir(opts.env || process.env);
  const stateFile = getStateFilePath(stateDir, payload.conversationId);
  const prevState = readState(stateFile);

  if (
    prevState &&
    prevState.lastFileSize === stat.size &&
    prevState.lastMtimeMs === stat.mtimeMs
  ) {
    return {};
  }

  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const maxInitialAgeMs = Number.isFinite(opts.maxInitialAgeMs)
    ? opts.maxInitialAgeMs
    : DEFAULT_MAX_INITIAL_AGE_MS;

  const latest = findLatestCheckpoint(payload.transcriptPath);
  if (!latest) {
    writeStateAtomic(stateFile, {
      lastHandledStep: prevState?.lastHandledStep ?? -1,
      lastFileSize: stat.size,
      lastMtimeMs: stat.mtimeMs,
      updatedAt: nowMs,
    });
    return {};
  }

  if (prevState && Number.isInteger(prevState.lastHandledStep) && latest.stepIndex <= prevState.lastHandledStep) {
    writeStateAtomic(stateFile, {
      lastHandledStep: prevState.lastHandledStep,
      lastFileSize: stat.size,
      lastMtimeMs: stat.mtimeMs,
      updatedAt: nowMs,
    });
    return {};
  }

  if (!prevState && !isRecentCheckpoint(latest.createdAt, nowMs, maxInitialAgeMs)) {
    writeStateAtomic(stateFile, {
      lastHandledStep: latest.stepIndex,
      lastFileSize: stat.size,
      lastMtimeMs: stat.mtimeMs,
      updatedAt: nowMs,
    });
    return {};
  }

  writeStateAtomic(stateFile, {
    lastHandledStep: latest.stepIndex,
    lastFileSize: stat.size,
    lastMtimeMs: stat.mtimeMs,
    updatedAt: nowMs,
  });

  const prompt = buildRetitlePrompt({
    stepIndex: latest.stepIndex,
    setTitleScriptPath: opts.setTitleScriptPath || defaultSetTitlePath(),
    isStopEvent,
  });

  if (isStopEvent) {
    return {
      decision: 'continue',
      reason: prompt,
    };
  }

  return {
    injectSteps: [
      {
        systemMessage: {
          systemMessage: prompt,
        },
      },
    ],
  };
}

function readStdinText() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function runCli() {
  const modeArg = process.argv[2];
  const mode = modeArg === 'stop' ? 'stop' : modeArg === 'pre-invocation' ? 'pre-invocation' : undefined;
  let output = {};
  try {
    const raw = await readStdinText();
    if (raw.trim()) {
      const payload = JSON.parse(raw);
      output = handleHookEvent(payload, { mode });
    }
  } catch {
    output = {};
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

if (isMainModule()) {
  runCli().catch(() => {
    process.stdout.write('{}\n');
  });
}
