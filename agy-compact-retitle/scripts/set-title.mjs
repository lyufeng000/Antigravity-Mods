import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QUOTE_PAIRS = [
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['《', '》'],
  ['「', '」'],
  ['【', '】'],
];

/**
 * 清洗并校验待写入的对话标题。
 */
export function sanitizeTitle(raw) {
  if (typeof raw !== 'string') {
    throw new Error('标题必须是字符串');
  }
  let text = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  let stripped = true;
  while (stripped && text.length >= 2) {
    stripped = false;
    for (const [open, close] of QUOTE_PAIRS) {
      if (text.startsWith(open) && text.endsWith(close)) {
        text = text.slice(open.length, text.length - close.length).trim();
        stripped = true;
        break;
      }
    }
  }
  if (!text) {
    throw new Error('标题不能为空');
  }
  if (text.length > 60) {
    text = text.slice(0, 60).trim();
  }
  return text;
}

async function callConversationService(method, body, { lsAddress, csrfToken, fetchImpl = fetch }) {
  const url = `http://${lsAddress}/product.v1.ConversationService/${method}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
      'x-antigravity-csrf-token': csrfToken,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} failed (${res.status}): ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * 跳过子代理会话后，调用本地 ConversationService 更新当前对话标题。
 */
export async function updateConversationTitle({
  title,
  lsAddress,
  csrfToken,
  conversationId,
  fetchImpl = fetch,
}) {
  if (!lsAddress || !csrfToken || !conversationId) {
    throw new Error('缺少必需参数：ANTIGRAVITY_LS_ADDRESS / ANTIGRAVITY_CSRF_TOKEN / ANTIGRAVITY_CONVERSATION_ID');
  }
  const cleanTitle = sanitizeTitle(title);
  const conv = await callConversationService(
    'GetConversation',
    { conversationId },
    { lsAddress, csrfToken, fetchImpl },
  );
  if (conv?.metadata?.parentConversationId) {
    return { skipped: true, reason: 'child_conversation' };
  }
  const oldTitle = conv?.annotations?.title || conv?.state?.summary || '';
  await callConversationService(
    'UpdateConversation',
    {
      conversationId,
      annotations: { title: cleanTitle },
    },
    { lsAddress, csrfToken, fetchImpl },
  );
  return { skipped: false, oldTitle, newTitle: cleanTitle };
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
  const args = process.argv.slice(2);
  let rawTitle = '';
  if (args.includes('--stdin')) {
    rawTitle = await readStdinText();
  } else {
    rawTitle = args.join(' ');
  }
  const lsAddress = process.env.ANTIGRAVITY_LS_ADDRESS || '';
  const csrfToken = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
  const conversationId = process.env.ANTIGRAVITY_CONVERSATION_ID || '';

  if (!lsAddress || !csrfToken || !conversationId) {
    console.error(
      '缺少必需环境变量：ANTIGRAVITY_LS_ADDRESS、ANTIGRAVITY_CSRF_TOKEN 或 ANTIGRAVITY_CONVERSATION_ID',
    );
    process.exitCode = 1;
    return;
  }

  const result = await updateConversationTitle({
    title: rawTitle,
    lsAddress,
    csrfToken,
    conversationId,
  });
  if (result.skipped) {
    console.log('SKIP: child conversation');
    return;
  }
  console.log(`OK: "${result.oldTitle}" -> "${result.newTitle}"`);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

if (isMainModule()) {
  runCli().catch((err) => {
    console.error(err?.message || String(err));
    process.exitCode = 1;
  });
}
