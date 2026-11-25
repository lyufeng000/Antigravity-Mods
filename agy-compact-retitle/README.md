# agy-compact-retitle

Antigravity 压缩后自动重命名对话标题插件：在**自动压缩**或**手动 `/compact` 压缩**生成 `CHECKPOINT` 后，自动提醒 Agent 根据最新的上下文压缩摘要为当前对话重新起一个 4～14 字的简体中文标题，并写入本地 `ConversationService/UpdateConversation`。

## 工作原理

由于 Antigravity 原生 `hooks.json` 尚未开放独立的 `OnCompaction` 外部事件，本插件组合利用 `PreInvocation` 与 `Stop` 两个生命周期钩子覆盖全部压缩场景：

1. **自动压缩（模型上下文超限触发）**
   - 自动压缩多发生在单轮执行中间；下一次调用模型前的 `PreInvocation` 钩子从 `transcript.jsonl` 末尾检测到新的 `CHECKPOINT`（`status: "DONE"`），立即注入一条 `systemMessage`，引导模型在本轮顺手执行 `scripts/set-title.mjs` 更新标题，不打断原任务。
2. **手动压缩（用户输入 `/compact`）**
   - `/compact` 执行完成后会结束当前执行循环并触发 `Stop` 钩子；`Stop` 检测到新的 `CHECKPOINT` 后返回 `{ "decision": "continue", "reason": "..." }`，唤醒 Agent 立即根据刚生成的摘要调用 `scripts/set-title.mjs` 更新标题。

## 防误触与防循环机制

- **单会话状态去重**：按 `conversationId` 持久化记录 `lastHandledStep` 与文件大小/修改时间，同一 `CHECKPOINT` 只触发一次；文件未变化时零扫描直接返回 `{}`。
- **`Stop` 护栏**：遇到 `continuationActive: true`、`USER_CANCELED`、`ERROR`、`MAX_INVOCATIONS` 等中止状态直接跳过，杜绝死循环。
- **旧对话冷启动保护**：首次接入本插件打开历史对话时，若已有的最新 `CHECKPOINT` 超过 10 分钟，则静默记录基线不弹窗改名；后续再触发新压缩仍会正常生效。
- **子代理跳过**：`scripts/set-title.mjs` 会先调用 `GetConversation`，若检测到 `metadata.parentConversationId` 非空（子代理会话），自动跳过不改标题。
- **Fail-open 容错**：钩子脚本任意异常或解析失败均安全输出 `{}` 并以退出码 `0` 结束，绝不阻塞正常对话；不修改 `app.asar` 与 `language_server.exe`，客户端升级不失效。

## 部署位置与测试

- 全局真实目录：`C:\Users\lyufeng\.gemini\config\plugins\agy-compact-retitle`（Windows 下 Antigravity 插件扫描器会跳过目录联接 Junction，须以真实目录部署）
- 同步安装命令：

```powershell
Set-Location "F:\Code\Antigravity\agy-compact-retitle"
npm.cmd run install-plugin
```

- 运行单元测试：

```powershell
Set-Location "F:\Code\Antigravity\agy-compact-retitle"
npm.cmd test
```
