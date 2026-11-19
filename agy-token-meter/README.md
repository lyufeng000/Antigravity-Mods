# agy-token-meter — Antigravity 输入框下方实时速度与 Tokens 统计补丁

在 Antigravity 对话输入框正下方显示一行紧凑的实时性能与用量状态栏（将输入框整体自然上抬一行），并与 `agy-zh-cn`（汉化）、`agy-weekly-quota`（左下角周额度）、`agy-file-menu`（文件右键菜单）无冲突共存。

## 功能特性

- **实时输出速度（`tok/s`）**：通过 Main World 链式只读装饰 `__JETSKI_LS_CLIENT_DECORATOR__` 旁路 `streamAgentStateUpdates` 与 `getCascadeTrajectory`，模型流式生成中每秒实时跳动显示 `~xxx tok/s`，单步完成后基于服务端 `chatModel.streamingDuration` 与 `usage.outputTokens` 计算精确速度并展示首字延迟（TTFT）。
- **完整状态行指标**：轮次与步数、输出速度 `tok/s`、总输入 `↑ tok`、总输出 `↓ tok`、估算费用、缓存命中率 `%`、上下文窗口环形进度与占比 `%`。
- **今日 / 本周全量统计**：主进程被动只读监听 `~/.gemini/antigravity/brain/**/.system_generated/logs/transcript.jsonl`，单击状态栏向上展开详情卡片查看当前对话细分以及今日、本周全量消耗（含子代理），支持一键复制摘要（鼠标悬停不再弹出遮挡视野）。
- **极简 / 完整切换**：双击状态栏可在「完整数据视图」与「极简速度视图」间切换并持久化记忆。

## 常用命令

```powershell
# 查看当前注入状态
npm run check

# 运行全部单元测试
npm test

# 一键四补丁联合重打（推荐，位于根目录）
node "F:\Code\Antigravity\repatch-all.mjs"
```
