# Antigravity 本地化名词对应表与风格规范 v2.3

> 所有译者、审校者必须严格遵守。同一英文概念在相同语境下只能有一个中文译法；`lint-dict.mjs` 会自动解析 **第二节「核心术语」** 进行术语一致性、保留英文单数形式、占位符、硬标识及中英文空格校验。遇到多义词时按语境区分并在备注中显式标注“多义”。

## 一、风格与格式规范

1. **简洁的界面语气**：按钮、菜单与操作项用动宾短语（如“删除对话”），不加“请”“您”；说明文字用陈述句或祈使句，可以用“你”，不用“您”。
2. **标点与空格**：中文句子用全角标点（，。：；？！“”（））。省略号统一用单字符 `…`（英文原文里的 `...` 也译成 `…`）。**中文与英文单词、数字、占位符之间加一个半角空格**（例如“子 Agent”“MCP 服务器”“已更改 {0} 个文件”）；全角标点两侧不加空格。
3. **占位符**：
   - 一般占位符（`{0}`、`{1}`……）必须原样保留、数量与编号集合一致，可按中文语序调整位置。
   - **英文单复数后缀占位符**：当上下文（`ctx`）明确表明紧贴单词末尾的 `{n}` 是 `""` / `"s"` / `"es"` 单复数后缀（如 `Push {0} commit{1} to {2}`、`{0} tool{1} enabled`、`({0} step{1})`）时，中文译文**省略该复数占位符**（如 `将 {0} 个 Commit 推送到 {2}`、`已启用 {0} 个 Tool`），运行时正则会自动将其编译为可选后缀 `(?:s|es|ies)?`。
   - **尾部 UI 组件占位符**：由 React 子节点拼接出的 `Continue{0}`、`Submit{0}`、`Toggle Word Wrap{0}` 等，看 `ctx`：若 `{0}` 只是图标/徽章等非文本子组件（且纯文本键已在词典中），该条标 `null`；若 `{0}` 是快捷键提示或后缀状态文本且自带前导空格，保留 `{0}` 并加入词典 `meta.lintIgnore` 以放行空格告警。
4. **硬标识保持原文**：产品名与品牌名（Antigravity、Gemini、Claude、Google、GitHub、Chrome、Cloudtop、CitC）、协议与技术缩写（MCP、CLI、SDK、API、URL、URI、JSON、CEL、SSH、OAuth、HTTP、HTTPS、Markdown）、斜杠命令（`/plan`）、快捷键（Ctrl+K、⌘、Enter、Esc）、代码、文件名、路径、环境变量、设置项 ID，以及反引号包裹的内容。
5. **保留原文的英文词规范**：下表中中文列为英文原文的专有名词（如 `Agent`、`Tool`、`Hook`、`Skill`、`Prompt`、`Token`、`Worktree`、`Diff`、`Fork`、`Commit`、`Branch`、`Sandbox`、`Swarm`、`Sidecar`、`Trajectory`、`Payload`），在中文译文中一律**首字母大写、使用单数形式**（例如 `Active Skills` 译为“已启用的 Skill”，`Expand Diffs` 译为“展开 Diff”，`Loading worktrees...` 译为“正在加载 Worktree…”），不加复数 `-s`。
6. **大小写无关（仅指规范要求，匹配时按原键区分）**：`New Conversation` 和 `New conversation` 译法一致；运行时 `exact` 匹配严格区分首尾空白外的主体大小写，因此存在大小写变体时均需收录。
7. **不翻译的条目**：代码表达式、SQL/日志模板、调试前缀（如 `, host=`）、纯标识符与技术枚举值一律标 `null`，表示保留原文，避免运行时漏译采集重复报警。
8. **片段与分组（`text` vs `group`）**：类型为 `text` 且以空格或标点开头/结尾的短片段，往往与动态变量拼接渲染（需看 `ctx`）。片段译文须保证拼接后中文通顺；若英汉语序差异导致片段无法通顺拼接，优先翻译对应的 `group` 整句模式，片段本身标 `null`。
9. **失败类提示**：`Failed to X`、`Couldn't X`、`Unable to X` 统一译为“无法 X”（按规则决定中英空格，如“无法加载对话”“无法 Fork 对话”）；`X failed` 译为“X 失败”。
10. **进行时**：`Loading...` → “正在加载…”，`Saving...` → “正在保存…”，统一使用“正在…”。
11. **确认类弹窗**：`Are you sure you want to X?` → “确定要…吗？”；`This action cannot be undone.` → “此操作无法撤销。”

## 二、核心术语

| English | 中文 | 备注 |
| :--- | :--- | :--- |
| Agent | Agent | **保留原文** |
| Subagent | 子 Agent | |
| Coordinator | 协调者 | Swarm 中的主 Agent |
| Swarm | Swarm | **保留原文** |
| Worker（Swarm 成员） | 成员 | |
| Conversation | 对话 | 不用“会话” |
| Session | 会话 | 仅指登录、浏览器、远程会话 |
| Chat | 聊天 | |
| Message | 消息 | |
| Prompt | Prompt | **保留原文**（多义：AI 提示词保留 Prompt；终端/密码交互提示可译“提示”） |
| Model | 模型 | 多义：AI 模型译“模型”；计费/商业模式（Billing model）可译“模式” |
| Mode | 模式 | |
| Context | 上下文 | 多义：AI 语境译“上下文”；`Context Menu` 译“右键菜单” |
| Token | Token | **保留原文**（LLM 计量与 OAuth/Access 凭据均保留 Token，不用“令牌”） |
| Side Question | 旁问 | 不打断主对话的插问 |
| Goal | 目标 | |
| Plan（Agent 计划、计划产物） | 计划 | |
| Plan（订阅） | 套餐 | |
| Walkthrough | 工作总结 | Agent 完成任务后的总结产物 |
| Artifact | 产物 | 不用“工件”“制品” |
| Document | 文档 | |
| Annotation | 批注 | |
| Comment | 评论 | |
| Feedback | 反馈 | |
| Fork | Fork | **保留原文**（动词、名词均保留，如“Fork 对话”） |
| Archive / Archived | 归档 / 已归档 | |
| Pin / Pinned | 置顶 / 已置顶 | |
| Workspace | 工作区 | |
| Project | 项目 | |
| Folder | 文件夹 | |
| File | 文件 | |
| Repository | 代码库 | |
| Worktree | Worktree | **保留原文**，不用“工作树” |
| Branch | Branch | **保留原文**，不用“分支” |
| Commit | Commit | **保留原文**（动词、名词均保留，不用“提交”） |
| Amend | Amend | **保留原文** |
| Pull Request | Pull Request | **保留原文** |
| Issue | Issue | **多义**：GitHub/Buganizer 议题保留“Issue”；一般问题/故障译“问题” |
| Diff | Diff | **保留原文**，不用“差异” |
| Changes | 更改 | “Files Changed”译为“已更改的文件” |
| Review | 审查 | |
| Accept / Reject | 接受 / 拒绝 | |
| Customizations | 自定义 | |
| Skill | Skill | **保留原文**，不用“技能” |
| Rule | 规则 | |
| Workflow | 工作流 | |
| Hook | Hook | **保留原文**，不用“钩子” |
| Plugin | 插件 | |
| Bundle | 合集 | 插件市场语境译“合集”；Debug Bundle 译“调试包” |
| Marketplace | 插件市场 | |
| Extension | 扩展 | |
| Sidecar | Sidecar | **保留原文**；插件附带的后台进程和面板 |
| MCP server | MCP 服务器 | |
| Tool | Tool | **保留原文**，不用“工具” |
| Automation | 自动化 | |
| Trigger | 触发器 | |
| Schedule | 定时计划 | 动词 schedule 译“安排”“定时” |
| Event | 事件 | |
| Terminal | 终端 | |
| Command | 命令 | |
| Run（动词） / Run（名词，一次执行） | 运行 / 运行记录 | |
| Running | 运行中 | 状态标签 |
| Task | 任务 | |
| Background task | 后台任务 | |
| Step | 步骤 | 多义：“第 {0} 步”可译“步” |
| Execution | 执行 | |
| Output | 输出 | |
| Logs | 日志 | |
| Trajectory | Trajectory | **保留原文**（如 Trajectory ID、Trajectory 调试视图） |
| Payload | Payload | **保留原文** |
| Browser | 浏览器 | |
| Tab | 标签页 | |
| Page | 页面 | 多义：页码与翻页（Next/Previous Page、Page {0}）译“页”或“下一页”“上一页” |
| Site | 网站 | |
| Recording | 录制 | 多义：音频录制可译“录音” |
| Screenshot | 截图 | |
| Voice | 语音 | 多义：指具体声音/音色时可译“声音” |
| Notebook | 笔记本 | |
| Settings | 设置 | |
| Preferences | 偏好设置 | |
| Permission | 权限 | |
| Allow / Deny | 允许 / 拒绝 | |
| Always allow | 始终允许 | |
| Ask（权限选项） | 每次询问 | |
| Sandbox | Sandbox | **保留原文**，不用“沙箱” |
| Policy | 策略 | 多义：隐私与法律条款（Privacy/Use Policy）译“政策” |
| Access | 访问权限 | 动词 access 译“访问” |
| Credentials | 凭据 | |
| Password | 密码 | |
| Account | 账号 | |
| Sign in / Sign out | 登录 / 退出登录 | |
| Organization | 组织 | |
| Team | 团队 | |
| Quota | 配额 | |
| Credits | 额度 | |
| Usage | 用量 | |
| Telemetry | 遥测 | |
| Remote | 远程 | `Remote Control` 译“远程控制” |
| Local | 本地 | |
| Environment | 环境 | |
| Machine | 机器 | |
| Device | 设备 | |
| Sidebar | 侧边栏 | |
| Aux pane / Auxiliary pane | 辅助面板 | |
| Side Panel | 侧边面板 | |
| Side Pane | 侧边窗格 | |
| Panel | 面板 | |
| Pane | 窗格 | |
| Window | 窗口 | |
| Split | 拆分 | |
| Toolbar | 工具栏 | |
| Menu | 菜单 | |
| Preview | 预览 | |
| Default | 默认 | |
| Custom | 自定义 | 形容词 |
| Enable / Enabled | 启用 / 已启用 | |
| Disable / Disabled | 禁用 / 已禁用 | |
| Toggle | 切换 | |
| Learn more | 了解详情 | 多义：“Learn more about …”可译“详细了解”或“了解…详情” |
| Show more / Show less | 显示更多 / 收起 | |
| See all / View all | 查看全部 | |
| Open / Close | 打开 / 关闭 | |
| Add / Remove / Delete | 添加 / 移除 / 删除 | remove 是从列表里拿掉，delete 是彻底删除 |
| Clear | 清除 | |
| Reset | 重置 | |
| Copy / Paste | 复制 / 粘贴 | |
| Save / Cancel | 保存 / 取消 | |
| Edit | 编辑 | |
| Create / New | 创建 / 新建 | 多义：“New conversation”译为“新对话”；独立标签“New”译“新” |
| Search / Filter | 搜索 / 筛选 | |
| Select | 选择 | 多义：“Select All”译“全选”，“Multi-select”译“多选” |
| Continue / Proceed | 继续 | |
| Stop | 停止 | |
| Retry / Try again | 重试 | |
| Restart / Reload | 重启 / 重新加载 | 多义：重启流程（Restart sign-in）可译“重新开始” |
| Update | 更新 | |
| Download / Upload | 下载 / 上传 | |
| Connect / Connected | 连接 / 已连接 | |
| Install / Uninstall | 安装 / 卸载 | |
| Expand / Collapse | 展开 / 折叠 | |
| Help | 帮助 | |
| Main Agent | 主 Agent | |
| SSH Host | SSH 主机 | |
| Word Wrap | 自动换行 | |
| Command Palette | 命令面板 | |
| Screen Recording | 屏幕录制 | |
| Accessibility | 无障碍 | 多义：macOS 系统权限语境可译“辅助功能” |
| Draft | 草稿 | |
| Clipboard | 剪贴板 | |
| Notification | 通知 | |
| Shortcut | 快捷键 | 多义：文件或桌面快捷方式可译“快捷方式” |
| History | 历史记录 | 多义：紧凑标签可译“历史” |
| Layout | 布局 | 多义：“Interface Layout”译为“界面布局” |
| Knowledge Work | 知识工作 | |
| Software Engineering | 软件工程 | |
| Error / Warning | 错误 / 警告 | 多义：“Error doing X”可译“X 时出错” |

## 三、保留英文原文专有名词速查表

中文 AI 与开发者工具语境下，以下概念已成行业通用硬标识，保留英文比强行意译更准确且无歧义。**统一规范：首字母大写、一律使用单数形式（禁止加复数 `-s`/`-es`）、与前后中文之间留半角空格**。

| 分类 | 标准写法 | 禁用写法 / 常见误译 | 正确示例 |
| :--- | :--- | :--- | :--- |
| **Agent 与多智能体编排** | `Agent`、`子 Agent`、`主 Agent`、`Swarm` | 代理、智能体、子代理、Agents、蜂群 | `当前有 {0} 个子 Agent 正在运行` |
| **自定义与扩展机制** | `Skill`、`Hook`、`Tool`、`Prompt`、`Sidecar`、`MCP`、`Sandbox` | 技能、钩子、工具、提示词（AI 语境）、沙箱、Tools | `已启用 {0} 个 Tool` / `安装新 Skill` |
| **版本控制与代码变更** | `Worktree`、`Branch`、`Commit`、`Amend`、`Pull Request`、`Issue`（议题）、`Diff`、`Fork` | 工作树、分支、提交、修改提交、差异、复刻 | `Fork 对话` / `展开 Diff` / `将 {0} 个 Commit 推送到 {2}` |
| **调试、协议与数据载体** | `Token`、`Trajectory`、`Payload`、`CLI`、`SDK`、`API`、`OAuth`、`SSH` | 令牌（含 LLM 与凭据）、轨迹、载荷、Token 数复数加 s | `消耗更少 Token` / `验证 GitHub Token 失败` |

## 四、高频多义词与实战消歧表

以下条目均来自 Antigravity 真实界面验收与版本升级过程，翻译或审校时务必先核对上下文位置：

| 英文 | 场景 A（界面位置） | 场景 A 译法 | 场景 B（界面位置） | 场景 B 译法 | 避坑与门禁说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `New` | 模型列表/功能卡片独立徽章 | `新` | `New conversation` | `新对话` | 仅文件/文件夹/窗口等实体新建动作译“新建…”，模型徽章严禁译成“新建” |
| `Fast` / `Notice` / `Limited time` | 模型选择下拉列表右侧徽章 | `快速` / `提示` / `限时` | `Fast Mode`（设置项） | `快速模式` | 由服务端 `clientModelConfigs.tagTitle/tagDescription` 下发 |
| `Conversation` / `Session` / `Group Chat` | Antigravity 对话线程 | `对话` | 登录态、浏览器、远程连接；多人协作对话 | `会话`；`群聊` | 严格区分“对话”与“会话”；`Group Chat` 含 `Chat` 但不译“群聊天”，需入 `lintIgnore` |
| `Plan` | Agent 实现计划 / `/plan` 产物 | `计划` | 账号订阅档位（Pro/Teams） | `套餐` | 二级核心术语表已标多义，按模块语境区分 |
| `Model` / `Mode` | `Select Model` / 模型配额卡片 | `模型` | `Billing model` / `Plan mode` | `模式` | `Gemini Models` → `Gemini 模型`；`Claude and GPT models` → `Claude 和 GPT 模型` |
| `Prompt` | 对话输入框占位 / AI 指令 | `Prompt` | 浏览器/终端操作前向用户确认 | `提示` / `每次提示` | 动词性 `Prompt for approval...` 译“提示批准…” |
| `Issue` | GitHub / Buganizer 跟踪条目 | `Issue` | 错误诊断、`Bug Report` | `问题` / `问题报告` | 见具体链接与上下文区分 |
| `Policy` | 组织策略、执行安全策略 | `策略` | 隐私政策、使用条款链接 | `政策` | `Disabled by organization policy` → `已被组织策略禁用` |
| `Bundle` | 插件市场打包推荐 | `合集` | `Download Debug Bundle` | `调试包` | |
| `Context` | 窗口/Token 上下文管理 | `上下文` | `Context Menu` | `右键菜单` | |
| `Working copy` | Git / JJ 状态栏本地更改集 | `工作副本` | — | — | 因包含 `Copy` 易触发“复制”术语报错，整词需加入 `meta.lintIgnore` |
| `...managing agents.` | 布局卡片长句描述 | `…Agent 管理…` | — | — | 名词化短语“Agent 管理”可顺畅成句，必要时将整句加入 `meta.lintIgnore` |

## 五、界面模块与标准句式对照表

### 1. Antigravity Hub 核心区域
| English | 中文 | 说明 |
| :--- | :--- | :--- |
| Sidebar | 侧边栏 | 左侧对话/项目导航栏 |
| Auxiliary Pane / Aux Pane | 辅助面板 | 右侧产物/终端/文件变更栏 |
| New Conversation | 新对话 | 新建顶级对话入口 |
| Files Changed | 已更改的文件 | 变更文件列表 |
| Background Tasks | 后台任务 | 定时/后台任务面板 |
| Artifacts | 产物 | Plan / Walkthrough / 截图等 |
| Walkthrough | 工作总结 | 任务完成总结文档 |
| Customizations | 自定义 | Rules / Workflows / Skills / MCP 入口 |
| Marketplace | 插件市场 | 浏览与安装插件/Skill |
| Settings / Preferences | 设置 / 偏好设置 | 应用配置 |
| Interface Layout (`Knowledge Work` / `Software Engineering`) | 界面布局（`知识工作` / `软件工程`） | 极简布局与完整开发者布局 |
| Usage (`Weekly Limit Remaining` / `Five Hour Limit Remaining`) | 用量（`本周剩余额度` / `5 小时剩余额度`） | 额度监控面板 |

### 2. 高频句式与递归时长模板
- **失败类**：`Failed to load conversation` → `无法加载对话`；`Fork failed` → `Fork 失败`。
- **进行时**：`Loading worktrees...` → `正在加载 Worktree…`；`Creating the forked conversation...` → `正在创建 Fork 对话…`。
- **确认框**：`Are you sure you want to delete this conversation?` → `确定要删除此对话吗？`
- **额度刷新提示（配合 `translator.js` 2 层递归匹配）**：
  - `You have used some / your weekly limit, it will fully refresh in {0}.` → `你已用掉部分本周额度，将在 {0}后完全恢复。`（因 `{0}` 递归后可能自带尾随空格或紧跟汉字，若报空格校验可列入 `meta.lintIgnore`）
  - `You have used all of your 5-hour limit, it will fully refresh in {0}.` → `你已用完 5 小时额度，将在 {0}后完全恢复。`
  - `{0} days, {1} hours` → `{0} 天 {1} 小时`
  - `{0} hours, {1} minutes` → `{0} 小时 {1} 分钟`
  - `{0} minutes, {1} seconds` → `{0} 分钟 {1} 秒`
