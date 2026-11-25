// 中文步骤与状态摘要等长目标校验、二进制定位与纯内存替换。
export const TARGETS = [
  {
    id: 'update_steps_desc',
    label: '步骤清单工具描述 (update_steps)',
    kind: 'text',
    anchor: 'Shows the user a live checklist of the steps you are carrying out.',
    orig: [
      'Shows the user a live checklist of the steps you are carrying out.',
      '',
      'When to use:',
      "- Call it once you have committed to an ordered list of 3 to 12 distinct steps for the current request, whatever their source: an approved plan, a list the user gave you, a skill's procedure, or steps you worked out yourself.",
      '- Skip it for requests that take 1-2 steps, pure questions, and open-ended exploration where you cannot name the steps yet (use update_focus for that). Never invent steps just to fill the list.',
      '',
      'How to use:',
      '- Always send the full list. Each call replaces the previous one, so to re-plan, send the new list. Keep steps in the order you do them: when you split or add a step, put it where it happens, not at the end.',
      '- Mark the step you are working on "in_progress"; the rest are "pending", "done", "skipped" or "failed". When you work on several steps at once (for example, parallel subagents), mark each of them "in_progress".',
      '- Call it in parallel with the first tool call of a step, so it adds no extra turn: once at the start (first step in_progress), then each time you move on (mark the finished step done and the next one in_progress in the same call).',
      '- When the last step is finished, call it once more with every step done before writing your final reply.',
      '- Each time you mark a step done, tell the user in one or two sentences what you did and what comes next, in your message alongside that call.',
      '',
      'Titles:',
      '- Short and imperative (2-6 words), in plain words the user would use, e.g. "Merge branch into main".',
      '- No numbers, IDs or labels from your plan ("0.1", "Step 2:", "P0"), and no code identifiers unless the user named them.',
      '- Aim for 3 to 8 steps; group small tasks into one step rather than listing each.',
      '- Keep using update_focus for the finer-grained activity inside a step.',
    ].join('\n'),
    patched: [
      'Shows the user a live checklist of the steps you are carrying out.',
      '',
      'When to use:',
      "- Call it once you have committed to an ordered list of 3 to 12 distinct steps for the current request, whatever their source: an approved plan, a list the user gave you, a skill's procedure, or steps you worked out yourself.",
      '- Skip it for requests that take 1-2 steps, pure questions, and open-ended exploration where you cannot name the steps yet (use update_focus for that). Never invent steps just to fill the list.',
      '',
      'How to use:',
      '- Always send the full list. Each call replaces the previous one, so to re-plan, send the new list. Keep steps in order: when you split or add a step, put it where it happens, not at the end.',
      '- Mark the step you are working on "in_progress"; the rest are "pending", "done", "skipped" or "failed". When working on several steps at once (e.g. parallel subagents), mark each of them "in_progress".',
      '- Call it in parallel with the first tool call of a step, so it adds no extra turn: once at the start (first step in_progress), then each time you move on (mark the finished step done and the next one in_progress in the same call).',
      '- When the last step is finished, call it once more with every step done before writing your final reply.',
      '- Each time you mark a step done, tell the user in one or two sentences what you did and what comes next alongside that call.',
      '',
      'Titles:',
      '- Always write step titles in Simplified Chinese (简体中文), even for English code or git tasks. Keep it concise (4-14 chars), e.g. "合并分支到 main".',
      '- No numbers, IDs or plan labels ("0.1", "Step 2:", "P0"), and no code identifiers unless named by the user.',
      '- Aim for 3 to 8 steps; group small tasks into one step rather than listing each.',
      '- Keep using update_focus for finer-grained activity inside a step.',
    ].join('\n'),
  },
  {
    id: 'update_steps_title_tag',
    label: '步骤标题参数 (update_steps.title)',
    kind: 'struct_tag',
    anchor: 'json:"title" jsonschema:"required" jsonschema_description:"',
    orig: 'json:"title" jsonschema:"required" jsonschema_description:"Short imperative title of the step (2-6 words), e.g. \'Merge branch into main\'."',
    patched: 'json:"title" jsonschema:"required" jsonschema_description:"Concise Simplified Chinese (简体中文) title, e.g., \'合并分支到 main\'."',
  },
  {
    id: 'update_focus_desc',
    label: '状态摘要工具描述 (update_focus)',
    kind: 'text',
    anchor: 'Updates the live status summary shown to the user while tool calls are collapsed.',
    orig: [
      'Updates the live status summary shown to the user while tool calls are collapsed.',
      '',
      'Guidelines:',
      '- Call this tool on multi-step tasks (3+ tool calls) to communicate your high-level goal instead of low-level per-tool activity. Skip it for simple replies or 1-2 tool lookups.',
      '- Always call it in parallel alongside the first tool call of a new phase so it adds no extra turn latency.',
      '- Call it again whenever you transition to a distinct new phase (e.g. from investigating code to editing files or running tests) so the displayed focus never goes stale.',
    ].join('\n'),
    patched: [
      'Updates the live status summary shown to the user while tool calls are collapsed.',
      '',
      'Guidelines:',
      '- Use on multi-step tasks (3+ tool calls) to state your high-level goal instead of per-tool activity. Skip for simple replies or 1-2 lookups.',
      "- Always write focus in Simplified Chinese (简体中文), e.g. '正在同步上游仓库', even on English tasks.",
      '- Always call it alongside the first tool call of a new phase so it adds no extra latency.',
      '- Call it again on each distinct phase change (investigating, editing, testing) so focus never goes stale.',
    ].join('\n'),
  },
  {
    id: 'update_focus_param_tag',
    label: '状态摘要参数 (update_focus.focus)',
    kind: 'struct_tag',
    anchor: 'json:"focus" jsonschema:"required" jsonschema_description:"',
    orig: 'json:"focus" jsonschema:"required" jsonschema_description:"Concise present-participle phrase (3-8 words) describing the high-level task you are currently working on, e.g. \'Inspecting auth token refresh flow\' or \'Running unit tests to verify fix\'."',
    patched: 'json:"focus" jsonschema:"required" jsonschema_description:"Concise Simplified Chinese (简体中文) status phrase (4-16 chars) stating the current task in progress, e.g. \'正在排查令牌刷新流程\' or \'正在运行单元测试验证修复\'."',
  },
  {
    id: 'run_command_summary_tag',
    label: '命令摘要参数 (run_command.toolSummary)',
    kind: 'text',
    anchor: 'Brief 2-5 word noun phrase describing the command task.',
    orig: 'Brief 2-5 word noun phrase describing the command task. Capitalize like a sentence. Some examples: \'Git status check\', \'Unit test execution\', \'Package build\', \'Dev server startup\'.',
    patched: 'Brief 2-5 word noun phrase describing the command task. Write in Simplified Chinese (简体中文), e.g., \'检查 Git 状态\', \'运行单元测试\', \'构建项目\', \'启动服务\'.',
  },
  {
    id: 'subagent_role_tag',
    label: '子代理角色参数 (invoke_subagent.Role)',
    kind: 'struct_tag',
    anchor: 'json:"Role" jsonschema:"required" jsonschema_description:"',
    orig: 'json:"Role" jsonschema:"required" jsonschema_description:"A 2-5 word description of the subagent\'s role. Should read similar to a job title, e.g. \'Codebase Researcher\', \'Database Debugger\', etc. Should also be detailed enough to distinguish between different subagents who might share similar purposes."',
    patched: 'json:"Role" jsonschema:"required" jsonschema_description:"A concise Simplified Chinese (简体中文) job-title-style role for this subagent, e.g. \'代码库研究员\', \'数据库排查专家\'. Always write in Simplified Chinese and keep it specific enough to distinguish different subagents in the UI."',
  },
  {
    id: 'browser_cursor_intent_tag',
    label: '浏览器光标意图 (browser.intent)',
    kind: 'struct_tag',
    anchor: 'json:"intent,omitempty" jsonschema_description:"',
    orig: 'json:"intent,omitempty" jsonschema_description:"Short user-facing purpose of this step in 3 words or fewer, shown next to the agent cursor (e.g. \'Finding search box\', \'Opening first result\')."',
    patched: 'json:"intent,omitempty" jsonschema_description:"Short Simplified Chinese (简体中文) step purpose (2-8 chars) shown next to the agent cursor, e.g., \'定位搜索框\', \'打开首条结果\'."',
  },
  {
    id: 'browser_overlay_intention_tag',
    label: '浏览器浮层摘要 (browser.intention)',
    kind: 'struct_tag',
    anchor: 'json:"intention" jsonschema:"required" jsonschema_description:"Short ',
    orig: 'json:"intention" jsonschema:"required" jsonschema_description:"Short summary of what this browser script intends to inspect or actuate (shown to the user on the page overlay)."',
    patched: 'json:"intention" jsonschema:"required" jsonschema_description:"Short Simplified Chinese (简体中文) summary of what this browser script will do (shown on the page overlay)."',
  },
  {
    id: 'swarm_title_desc',
    label: '协作群组标题 (swarm.title)',
    kind: 'json_prop',
    anchor: '"title": {\n      "type": "string",\n      "description": "',
    orig: '"title": {\n      "type": "string",\n      "description": "A short title for the swarm, for the UI."',
    patched: '"title": {\n      "type": "string",\n      "description": "Chinese (简体中文) title for the UI."',
  },
];

function validateStructTag(t, fieldValue) {
  const marker = 'jsonschema_description:"';
  const idx = fieldValue.indexOf(marker);
  if (idx < 0) throw new Error(`${t.id} 缺少 ${marker}`);
  if (!fieldValue.endsWith('"')) throw new Error(`${t.id} struct_tag 必须以双引号结尾`);
  const inner = fieldValue.slice(idx + marker.length, -1);
  if (/[\\"\r\n]/.test(inner)) {
    throw new Error(`${t.id} jsonschema_description 内不允许包含未转义的引号、反斜杠或换行符`);
  }
}

export function validateTargets(targets = TARGETS) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error('TARGETS 不能为空');
  }
  const seenIds = new Set();
  const items = [];
  let totalBytes = 0;

  for (const t of targets) {
    if (!t || typeof t.id !== 'string' || !t.id) throw new Error('目标项缺少有效的 id');
    if (seenIds.has(t.id)) throw new Error(`存在重复的目标 id：${t.id}`);
    seenIds.add(t.id);

    const { id, label = id, kind = 'text', anchor, orig, patched } = t;
    if (typeof anchor !== 'string' || !anchor.length) throw new Error(`${id}: anchor 不能为空`);
    if (typeof orig !== 'string' || !orig.length) throw new Error(`${id}: orig 不能为空`);
    if (typeof patched !== 'string' || !patched.length) throw new Error(`${id}: patched 不能为空`);
    if (orig === patched) throw new Error(`${id}: orig 与 patched 不能相同`);
    if (orig.includes('\0') || patched.includes('\0') || anchor.includes('\0')) {
      throw new Error(`${id}: 文本中不能包含 NUL 字节`);
    }
    if (!orig.startsWith(anchor)) throw new Error(`${id}: orig 必须以 anchor 开头`);
    if (!patched.startsWith(anchor)) throw new Error(`${id}: patched 必须以 anchor 开头`);

    const origBuf = Buffer.from(orig, 'utf8');
    const patchedBuf = Buffer.from(patched, 'utf8');
    if (origBuf.toString('utf8') !== orig || patchedBuf.toString('utf8') !== patched) {
      throw new Error(`${id}: UTF-8 编码回环校验失败`);
    }
    if (origBuf.length !== patchedBuf.length) {
      throw new Error(`${id}: UTF-8 字节长度不一致（orig=${origBuf.length}，patched=${patchedBuf.length}）`);
    }

    if (kind === 'struct_tag') {
      validateStructTag(t, orig);
      validateStructTag(t, patched);
    } else if (kind === 'json_prop') {
      try {
        JSON.parse(`{ ${orig} } }`);
        JSON.parse(`{ ${patched} } }`);
      } catch (e) {
        throw new Error(`${id}: JSON 属性语法校验失败：${e.message}`);
      }
    }

    totalBytes += origBuf.length;
    items.push({ id, label, kind, byteLength: origBuf.length });
  }

  return { count: items.length, totalBytes, items };
}

export function buildEqualLengthBuffer(text, targetBytes) {
  if (typeof text !== 'string') throw new Error('text 必须是字符串');
  if (!Number.isInteger(targetBytes) || targetBytes <= 0) throw new Error(`无效的目标字节数：${targetBytes}`);
  if (text.includes('\0')) throw new Error('text 中不能包含 NUL 字节');
  const raw = Buffer.from(text, 'utf8');
  if (raw.length > targetBytes) {
    throw new Error(`文本 UTF-8 字节长度 (${raw.length}) 超出目标长度 (${targetBytes})`);
  }
  if (raw.length === targetBytes) return raw;
  const out = Buffer.alloc(targetBytes, 0x20);
  raw.copy(out, 0);
  return out;
}

export function findAllOffsets(buf, needleBuf) {
  if (!needleBuf.length) return [];
  const offsets = [];
  let pos = -1;
  while ((pos = buf.indexOf(needleBuf, pos + 1)) !== -1) {
    offsets.push(pos);
  }
  return offsets;
}

export function findWebZipRange(buf) {
  const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  let i = -1;
  while ((i = buf.indexOf(EOCD, i + 1)) !== -1) {
    if (i + 22 > buf.length) break;
    const cdSize = buf.readUInt32LE(i + 12);
    const cdOff = buf.readUInt32LE(i + 16);
    const cdStart = i - cdSize;
    const zipStart = cdStart - cdOff;
    if (cdStart < 0 || zipStart < 0 || cdStart + 4 > buf.length) continue;
    if (buf.readUInt32LE(cdStart) !== 0x02014b50) continue;
    const cd = buf.subarray(cdStart, i).toString('latin1');
    if (cd.includes('main.js') && cd.includes('compiled_tailwind.css')) {
      return { start: zipStart, end: i + 22 };
    }
  }
  return null;
}

export function inspectBuffer(buf, { targets = TARGETS, previousPatchedMap = null } = {}) {
  validateTargets(targets);
  const webZipRange = findWebZipRange(buf);
  const items = [];
  let overlapsWebZip = false;

  for (const t of targets) {
    const origBuf = Buffer.from(t.orig, 'utf8');
    const patchedBuf = Buffer.from(t.patched, 'utf8');
    const anchorBuf = Buffer.from(t.anchor, 'utf8');
    const byteLength = origBuf.length;

    const origOffsets = findAllOffsets(buf, origBuf);
    const patchedOffsets = findAllOffsets(buf, patchedBuf);

    const prevStr = previousPatchedMap && typeof previousPatchedMap === 'object'
      ? (typeof previousPatchedMap[t.id] === 'string'
        ? previousPatchedMap[t.id]
        : previousPatchedMap[t.id]?.patched)
      : null;
    let prevOffsets = [];
    if (
      typeof prevStr === 'string'
      && prevStr.length > 0
      && prevStr !== t.orig
      && prevStr !== t.patched
      && Buffer.byteLength(prevStr, 'utf8') === byteLength
    ) {
      prevOffsets = findAllOffsets(buf, Buffer.from(prevStr, 'utf8'));
    }

    const anchorOffsets = findAllOffsets(buf, anchorBuf);
    const totalMatches = origOffsets.length + patchedOffsets.length + prevOffsets.length;

    let status = 'not_found';
    let offset = -1;
    let currentPreview = null;

    if (
      origOffsets.length > 1
      || patchedOffsets.length > 1
      || prevOffsets.length > 1
      || totalMatches > 1
      || (totalMatches === 0 && anchorOffsets.length > 1)
    ) {
      status = 'ambiguous';
      offset = patchedOffsets[0] ?? origOffsets[0] ?? prevOffsets[0] ?? anchorOffsets[0] ?? -1;
    } else if (patchedOffsets.length === 1) {
      status = 'patched';
      offset = patchedOffsets[0];
    } else if (origOffsets.length === 1) {
      status = 'unpatched';
      offset = origOffsets[0];
    } else if (prevOffsets.length === 1) {
      status = 'outdated_patch';
      offset = prevOffsets[0];
    } else if (anchorOffsets.length === 1) {
      status = 'prompt_changed';
      offset = anchorOffsets[0];
      currentPreview = buf
        .subarray(offset, Math.min(buf.length, offset + Math.max(byteLength + 100, 320)))
        .toString('utf8')
        .replace(/[\x00-\x08\x0b-\x1f]/g, '.');
    }

    let itemOverlapsZip = false;
    if (offset >= 0 && webZipRange) {
      const end = offset + byteLength;
      itemOverlapsZip = offset < webZipRange.end && end > webZipRange.start;
      if (itemOverlapsZip) overlapsWebZip = true;
    }

    items.push({
      id: t.id,
      label: t.label ?? t.id,
      kind: t.kind ?? 'text',
      status,
      offset,
      byteLength,
      origOffsets,
      patchedOffsets,
      prevOffsets,
      anchorOffsets,
      overlapsWebZip: itemOverlapsZip,
      currentPreview,
    });
  }

  // 检查全部有效区间是否两两重叠
  const validIntervals = items
    .filter((it) => it.offset >= 0)
    .map((it) => ({ id: it.id, start: it.offset, end: it.offset + it.byteLength }))
    .sort((a, b) => a.start - b.start);
  let hasOverlap = false;
  for (let i = 1; i < validIntervals.length; i++) {
    if (validIntervals[i].start < validIntervals[i - 1].end) {
      hasOverlap = true;
      break;
    }
  }

  const countOf = (st) => items.filter((it) => it.status === st).length;
  const patchedCount = countOf('patched');
  const unpatchedCount = countOf('unpatched');
  const outdatedCount = countOf('outdated_patch');
  const ambiguousItems = items.filter((it) => it.status === 'ambiguous');
  const changedItems = items.filter((it) => it.status === 'prompt_changed');
  const notFoundItems = items.filter((it) => it.status === 'not_found');

  let status;
  if (ambiguousItems.length > 0) status = 'ambiguous';
  else if (changedItems.length > 0) status = 'prompt_changed';
  else if (notFoundItems.length > 0) status = 'not_found';
  else if (hasOverlap) status = 'overlap';
  else if (patchedCount === items.length) status = 'patched';
  else if (unpatchedCount === items.length) status = 'unpatched';
  else if (outdatedCount > 0) status = 'outdated_patch';
  else status = 'partial';

  return {
    status,
    totalCount: items.length,
    patchedCount,
    unpatchedCount,
    outdatedCount,
    items,
    webZipRange,
    overlapsWebZip,
    hasOverlap,
  };
}

export function patchBuffer(buf, opts = {}) {
  const targets = opts.targets ?? TARGETS;
  const info = inspectBuffer(buf, { ...opts, targets });

  if (info.status === 'ambiguous') {
    const first = info.items.find((it) => it.status === 'ambiguous');
    throw new Error(`发现多处候选位置 (${first.id}: ${first.anchorOffsets.join(', ')})，无法安全原位替换`);
  }
  if (info.status === 'prompt_changed') {
    const first = info.items.find((it) => it.status === 'prompt_changed');
    throw new Error(`上游提示词已变更 (${first.id}, 偏移 ${first.offset})：${first.currentPreview}`);
  }
  if (info.status === 'not_found') {
    const missing = info.items.filter((it) => it.status === 'not_found').map((it) => it.id).join(', ');
    throw new Error(`未在二进制中找到目标描述：${missing}`);
  }
  if (info.status === 'overlap' || info.hasOverlap) {
    throw new Error('检测到命中区间存在重叠，拒绝修改');
  }
  if (info.overlapsWebZip) {
    const bad = info.items.find((it) => it.overlapsWebZip);
    throw new Error(`命中区间 ${bad.id} [${bad.offset}, ${bad.offset + bad.byteLength}) 与内嵌前端 ZIP 重叠，拒绝修改`);
  }

  const out = Buffer.from(buf);
  if (info.status === 'patched') {
    return { buffer: out, changed: false, info };
  }

  const targetById = new Map(targets.map((t) => [t.id, t]));
  for (const item of info.items) {
    if (item.status === 'patched') continue;
    const t = targetById.get(item.id);
    Buffer.from(t.patched, 'utf8').copy(out, item.offset);
  }

  const after = inspectBuffer(out, { ...opts, targets });
  if (after.status !== 'patched') {
    throw new Error(`内存替换后校验异常：status=${after.status}`);
  }
  return { buffer: out, changed: true, info: after };
}

export function restoreBuffer(buf, opts = {}) {
  const targets = opts.targets ?? TARGETS;
  const info = inspectBuffer(buf, { ...opts, targets });

  if (info.overlapsWebZip) {
    const bad = info.items.find((it) => it.overlapsWebZip);
    throw new Error(`命中区间 ${bad.id} [${bad.offset}, ${bad.offset + bad.byteLength}) 与内嵌前端 ZIP 重叠，拒绝还原`);
  }
  if (info.status === 'ambiguous') {
    const first = info.items.find((it) => it.status === 'ambiguous');
    throw new Error(`发现多处候选位置 (${first.id}: ${first.anchorOffsets.join(', ')})，无法安全还原`);
  }
  if (info.status === 'overlap' || info.hasOverlap) {
    throw new Error('检测到命中区间存在重叠，拒绝还原');
  }
  if (info.status === 'unpatched') {
    return { buffer: Buffer.from(buf), changed: false, info };
  }
  if (info.status === 'prompt_changed' || info.status === 'not_found') {
    return { buffer: Buffer.from(buf), changed: false, info };
  }

  const out = Buffer.from(buf);
  const targetById = new Map(targets.map((t) => [t.id, t]));
  let changed = false;
  for (const item of info.items) {
    if (item.status !== 'patched' && item.status !== 'outdated_patch') continue;
    const t = targetById.get(item.id);
    Buffer.from(t.orig, 'utf8').copy(out, item.offset);
    changed = true;
  }

  if (!changed) {
    return { buffer: out, changed: false, info };
  }

  const after = inspectBuffer(out, { ...opts, targets });
  if (after.status !== 'unpatched') {
    throw new Error(`内存还原后校验异常：status=${after.status}`);
  }
  return { buffer: out, changed: true, info: after };
}
