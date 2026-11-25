# Antigravity-Mods（Agent-Native 补丁生效项目）

本项目集中管理 Antigravity 桌面端的 **9 项增强与本地化补丁**。项目以 [AGENTS.md](./AGENTS.md) 作为流程驱动核心——无论是自己本地用，还是把 GitHub 仓库地址直接发给朋友，**让 AI Agent 接手即可全自动完成克隆、依赖安装、体检、按需勾选、预检生效与远端更新**。

> [!IMPORTANT]
> **AI Agent 接管指令（收到本仓库地址或刚克隆本仓库时必读）**：
> 1. 固定持久化目录为 `%USERPROFILE%\.antigravity-mods`（已有则直接复用并运行 `node repatch-all.mjs update --json`，没有再 `git clone https://github.com/lyufeng000/Antigravity-Mods.git "%USERPROFILE%\.antigravity-mods"`）。
> 2. **严禁在 `%TEMP%` / `AppData\Local\Temp` / `/tmp` 等系统临时目录里直接运行安装或生成 `.backup/`**。
> 3. 进入固定目录装好依赖（`npm.cmd install --no-package-lock`）后，**立即读取 [AGENTS.md](./AGENTS.md)** 从 Step 1 开始引导用户。

## 方式一：把仓库地址发给朋友的 Agent（零门槛远端安装）

只要电脑上装了 Antigravity 客户端、Node.js 和 Git，打开任意 AI 编程助手（Antigravity / Claude Code / Cursor 等）把仓库链接和一句话发给它即可：

> **直接复制发给 Agent**：
> `https://github.com/lyufeng000/Antigravity-Mods.git 给我安装这些补丁`

Agent 会按上方指引完成目录就位、装好依赖，并移交 [AGENTS.md](./AGENTS.md) 接管（全自动体检出表、交互勾选、预检门禁与生效，无需用户手动敲命令）。

---

## 方式二：已在本地工作区直接对话

在 Antigravity 中打开本仓库目录后，直接用自然语言说一句即可：

- **第一次用 / 安装插件**：`安装插件` 或 `帮我检查当前状态并按需启用补丁`
- **只想要某几个功能**：`帮我只启用汉化、Windows 通知跳转和压缩自动改名，其余不要`
- **同步 GitHub 最新版本**：`更新补丁`、`检查更新` 或 `同步远端`
- **想看现在装了哪些补丁**：`体检` 或 `看看现在 9 个补丁分别是什么状态`
- **临时想退回官方原版**：`还原原版` 或 `帮我把 Antigravity 完整还原成官方未修改原版`
- **大版本更新后出现新英文**：`客户端升级了，帮我检查并补译新增英文词条`

> 涉及修改客户端核心文件且客户端正在运行时，只需按 Agent 提示手动关闭一次窗口，后台会在 3～5 秒内自动完成注入并重开。

## 内置 9 项补丁一览

| 短 ID | 补丁名称 | 能力简介 | 生效目标 | 需关窗重开 |
| :--- | :--- | :--- | :--- | :--- |
| `zh-cn` | 全量简体中文界面 | Antigravity 界面全量简体中文汉化与动态翻译（`agy-zh-cn/`） | `app.asar` | 是 |
| `weekly-quota` | 左下角周额度插槽 | 左下角「设置」上方多账号周额度面板，0 主动请求（`agy-weekly-quota/`） | `app.asar` | 是 |
| `file-menu` | 本地文件增强右键菜单 | 支持复制、复制路径、资源管理器定位与默认浏览器/程序打开（`agy-file-menu/`） | `app.asar` | 是 |
| `token-meter` | 实时 Tokens 与速度统计 | 输入框下方实时展示 `tok/s` 速度、上下文占比与日/周消耗（`agy-token-meter/`） | `app.asar` | 是 |
| `periodic-model` | 周期表模型选择器 | Gemini 4 元素周期表选择器、分桶周额度饼图与同档位等效月 API 费用（`agy-periodic-model/`） | `app.asar` | 是 |
| `win-notify` | Windows 通知点击跳转 | 绑定匹配 `AppUserModelId`、保活通知实例并修复多窗口点击前置（`agy-win-notify/`） | `app.asar` | 是 |
| `zh-title` | 中文对话标题 | 等长原位替换标题生成提示词，新对话源头输出简体中文标题（`agy-zh-title/`） | `language_server.exe` | 是 |
| `zh-steps` | 中文步骤与状态卡片 | 等长原位替换 9 处步骤清单、焦点状态及工具标签约束（`agy-zh-steps/`） | `language_server.exe` | 是 |
| `compact-retitle` | 压缩后自动重命名 | 自动或 `/compact` 压缩后通过原生钩子唤醒并更新中文对话标题（`agy-compact-retitle/`） | `~/.gemini/config/plugins/` | 否 |

## 仓库关键文档

- [AGENTS.md](./AGENTS.md)：Agent 补丁生效与远端更新总控流程（远端接入 → 体检 → 勾选 → 预检 → 安全执行 → 验收回滚）。
- [DEV_GUIDE.md](./DEV_GUIDE.md)：补丁模块研发规范、多补丁共存红线与测试门禁（仅开发或修改源码时阅读）。
- [repatch-all.mjs](./repatch-all.mjs)：底层 9 项联合编排引擎（支持 `check --json`、`update`、`--only` / `--exclude`、`--dry-only` 与 `restore`）。
