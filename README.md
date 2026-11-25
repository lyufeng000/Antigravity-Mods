# Antigravity 八补丁工作区（本地化、周额度、文件右键菜单、实时 Tokens、周期表模型选择器、Windows 通知跳转、中文对话标题、中文步骤）

本目录管理 Antigravity 桌面端的八个独立 UI/交互补丁工程及更新后一键重打脚本，八者共享纯净原包备份池与元信息目录、互不覆盖：

| 路径 | 说明 |
| :--- | :--- |
| `agy-zh-cn/` | 全量简体中文界面汉化项目（`/*AGY-ZH-BEGIN*/ ... /*AGY-ZH-END*/`），已通过目录联接映射至 `~/.gemini/config/plugins/agy-zh-cn` |
| `agy-weekly-quota/` | 左下角「设置」上方账号周额度插槽项目（`/*AGY-QUOTA-BEGIN*/ ... /*AGY-QUOTA-END*/` + `/*AGY-QUOTA-MAIN-BEGIN*/ ... /*AGY-QUOTA-MAIN-END*/`），0 主动请求、不读本地 OAuth |
| `agy-file-menu/` | 本地文件增强右键菜单项目（`/*AGY-FILE-MENU-BEGIN*/ ... /*AGY-FILE-MENU-END*/` + `/*AGY-FILE-MENU-MAIN-BEGIN*/ ... /*AGY-FILE-MENU-MAIN-END*/`），支持复制、复制路径、资源管理器定位、默认程序与默认浏览器打开 |
| `agy-token-meter/` | 输入框下方实时 `tok/s` 输出速度与 Tokens 用量补丁（`/*AGY-TOKEN-METER-BEGIN*/ ... /*AGY-TOKEN-METER-END*/` + `/*AGY-TOKEN-METER-MAIN-BEGIN*/ ... /*AGY-TOKEN-METER-MAIN-END*/`），旁路 LS 流式输出速度/上下文占比并结合本地 `transcript.jsonl` 展示今日/本周消耗 |
| `agy-periodic-model/` | Gemini 4 元素周期表模型选择器补丁（`/*AGY-PERIODIC-MODEL-BEGIN*/ ... /*AGY-PERIODIC-MODEL-END*/` + `/*AGY-PERIODIC-MODEL-MAIN-BEGIN*/ ... /*AGY-PERIODIC-MODEL-MAIN-END*/`），复刻 Google AI Studio 元素周期表交互，支持分桶周额度饼图与同档位（Ultra/Pro 不混合）平均等效月 API 费用统计（保留最近 20 次） |
| `agy-win-notify/` | Windows 系统通知点击跳转修复补丁（`/*AGY-WIN-NOTIFY-MAIN-BEGIN*/ ... /*AGY-WIN-NOTIFY-MAIN-END*/`），绑定匹配 `Antigravity.lnk` 的 `AppUserModelId`、保活 `Notification` 实例、修复 `BaseWindow` 的 `notification:clicked` 派发并绕过 Windows 焦点抢占限制 |
| `agy-zh-title/` | 中文对话标题补丁，等长原位替换 `resources/bin/language_server.exe` 内 626 字节标题生成系统提示词，让新对话直接输出简体中文标题 |
| `agy-zh-steps/` | 中文步骤与状态摘要补丁，等长原位替换 `resources/bin/language_server.exe` 内 9 处步骤清单、状态焦点、命令摘要、子代理角色、浏览器光标/浮层与 Swarm 标题约束，让动态进度卡片从源头直接输出简体中文 |
| `agy-compact-retitle/` | 压缩后自动重命名标题插件（原生 `PreInvocation` + `Stop` 钩子），在自动或手动 `/compact` 压缩完成后自动触发 Agent 根据摘要更新对话标题，不改动安装包、客户端升级不失效（Windows 下需通过 `npm.cmd run install-plugin` 以真实目录部署至 `~/.gemini/config/plugins/`） |
| `.backup/` | 共享官方纯净 `app.asar.<版本>` 备份与 `language_server.title-meta.json` / `language_server.steps-meta.json` 元信息目录（任意含补丁标记的包绝不会写入备份） |
| `repatch.cmd` / `repatch-all.mjs` | Antigravity 自动更新后的一键八补丁重打编排器（同时管理 `app.asar` 与 `language_server.exe`） |

## Antigravity 自动更新后如何一键恢复八补丁

客户端自动更新会用新版本覆盖 `resources/app.asar` 与 `resources/bin/language_server.exe`。按下面任意一种方式即可在数秒内恢复**中文界面 + 左下角周额度插槽 + 本地文件增强右键菜单 + 实时 Tokens + 周期表模型选择器 + Windows 通知跳转 + 中文对话标题 + 中文步骤卡片**：

### 方式一：双击脚本（最快）

1. 双击运行 `F:\Code\Antigravity\repatch.cmd`。
2. 若 Antigravity 当前已关闭，脚本会直接完成新版本纯净备份、八补丁合并注入并自动打开客户端；若正在运行，按提示关掉一次窗口，后台会在约 3～5 秒内自动打好补丁并重开。

### 方式二：命令行检查 / 重打 / 还原

```powershell
# 查看当前客户端版本、八补丁各自的注入状态与共享备份状态
node "F:\Code\Antigravity\repatch-all.mjs" check

# 仅执行九道预检（词典 Lint + 四项脚本语法 + 标题/步骤提示词校验 + 通知脚本语法 + 八补丁合并 dry-run），不改安装目录
node "F:\Code\Antigravity\repatch-all.mjs" --dry-only

# 一键重打八补丁（汉化 + 周额度 + 文件右键菜单 + 实时 Tokens + 周期表 + 通知跳转 + 中文标题 + 中文步骤）
node "F:\Code\Antigravity\repatch-all.mjs"

# 一键完整还原为官方未修改原版（app.asar 与 language_server.exe）
node "F:\Code\Antigravity\repatch-all.mjs" restore
```

> **提示**：若大版本更新后发现个别新增英文界面词条，重打补丁会先立即恢复 99%+ 既有汉化、周额度插槽、文件右键菜单、实时 Tokens、周期表模型选择器、Windows 通知跳转、中文对话标题与中文步骤卡片；随后可在 Antigravity 对话中让 AI 按 `agy-zh-cn` 技能执行增量 diff 补译后再跑一次 `repatch-all.mjs`。
