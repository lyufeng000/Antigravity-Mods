# Antigravity 爆改补丁研发规范（DEV_GUIDE.md）

本工作区（仓库 `lyufeng000/Antigravity-Mods`）集中维护 Antigravity 桌面端的所有独立改造补丁与联合更新恢复编排器。任何在本项目内**新增、改造或修复补丁源码**的开发，必须遵守以下规范（日常让 Agent 引导补丁生效请看 [AGENTS.md](./AGENTS.md)）。

## 1. 模块留档与按功能分目录规范

- **必须完整留档**：严禁只修改安装目录（`resources/app.asar` 或 `resources/bin/language_server.exe`），也不允许把补丁逻辑散落成根目录单文件或临时脚本。所有改造必须沉淀为完整、独立、可反复构建与卸载的工程模块。
- **按功能独立存放**：每个独立功能独占一个根目录子文件夹，统一使用全小写连字符命名 `agy-<feature>/`（如 `agy-periodic-model/`），职责单一、互不耦合。
- **现有模块清单**：
  - `agy-zh-cn/`：全量简体中文界面汉化与词典工具链
  - `agy-weekly-quota/`：左下角多账号周额度插槽
  - `agy-file-menu/`：本地文件增强右键菜单
  - `agy-token-meter/`：输入框下方实时 `tok/s` 输出速度与 Tokens 用量
  - `agy-periodic-model/`：Gemini 4 元素周期表模型选择器（含二级菜单与周额度显示）
  - `agy-win-notify/`：Windows 系统通知点击跳转修复（绑定 AUMID、保活 Notification、修复 BaseWindow 派发与强制窗口前置）
  - `agy-zh-title/`：中文对话标题生成（`language_server.exe` 提示词原位替换）
  - `agy-zh-steps/`：中文步骤与状态摘要生成（`language_server.exe` 9 处步骤清单、焦点状态及 UI 标签约束原位替换）
  - `agy-compact-retitle/`：压缩后自动重命名标题（原生 `PreInvocation` + `Stop` 钩子插件）
  - 共享基础设施：`package.json`（根目录共享依赖 `@electron/asar` / `acorn` / `acorn-walk` / `jsdom`）、`.backup/`（纯净原包与元信息池）、`repatch-all.mjs`（9 项联合编排器）、`AGENTS.md`（Agent 生效引导流程）、`README.md`
- **标准模块目录骨架**：新增或重构注入型功能模块时，须按如下结构落盘：

```text
agy-<feature>/
├── package.json                  # 声明 "type": "module" 及 test / check / patch / restore 脚本
├── README.md                     # 功能说明、注入标记、交互逻辑与常用命令
├── src/                          # 运行时源码（如 <feature>-preload.js / <feature>-main-ipc.js）
├── patcher/
│   ├── check.mjs                 # 状态自检（支持 --json）
│   ├── patch.mjs                 # 独立幂等注入与 --dry-run 包头/内容校验
│   ├── restore.mjs               # 独立剥离（保留共存补丁；无其他补丁时还原纯净备份）
│   └── lib/
│       ├── app.mjs               # 定位安装目录与读取版本（TEMP_ROOT 优先 D:\Data\.temp）
│       ├── common.mjs            # 标记常量、共享 .backup/、进程过滤与文件校验工具
│       └── deps.mjs              # 自动按相对路径解析根目录及同级 patcher 的依赖（禁止写死本机绝对路径）
└── test/                         # node --test 自动化单测（含 JSDOM 行为测试与共存幂等测试）
```

- **联合编排同步**：新增模块完成后，必须同步接入：
  1. `repatch-all.mjs`：在 `PATCH_REGISTRY` 注册短 ID、加入预检项、`inspectState()` 状态项、合并注入/同步与计数校验；
  2. `AGENTS.md`：更新补丁能力总表中的 ID、说明与是否需重启标记；
  3. 根目录 `README.md`：更新补丁总数与模块说明表。

## 2. 多补丁共存与注入技术红线

- **唯一标记块与幂等剥离**：
  - 所有代码注入必须使用满足 `ANY_PATCH_RE = /\/\*AGY-[A-Z0-9_-]+-BEGIN\*\//` 的独立注释块：`/*AGY-<NAME>-BEGIN*/ ... /*AGY-<NAME>-END*/`（主进程 `dist/main.js` 附加 `-MAIN-` 后缀）。
  - 每个模块的 `strip*` 与 `build*` 必须严格幂等：剥离自身时不得破坏同文件中的其他补丁块，重打包时必须校验选中项标记块恰好出现 1 次、未选中项出现 0 次。
- **纯净备份池不可污染**：`.backup/app.asar.<version>` 及原生二进制备份/元信息文件只能源自未含任何 `ANY_PATCH_RE` 标记的官方原版包；严禁把已打补丁的包写入 `.backup/`。
- **Electron 沙箱与重打包约束**：
  - `dist/preload.js` 运行在沙箱环境（`contextIsolation: true`、`nodeIntegration: false`），无法直接 `require('fs')` 动态读取本地外部脚本；所有运行时逻辑与资源必须在打包期完整内联，并转义 `\u2028` / `\u2029`，落盘前后通过 `node --check`。
  - 重打包 `app.asar` 必须保留原包头的 `unpacked`（含点开头隐藏路径）与 POSIX `executable` 位，并通过包头与再解包全量哈希校验。
- **Main World 注入规范**：
  - 注入到 Main World 的函数（经 `webFrame.executeJavaScript`）必须完全自包含，不得引用外层闭包变量；须同时在立即执行与 `DOMContentLoaded` / `load` 时兜底绑定，不得假定 `preload.js` 执行瞬间 `document.documentElement` 已存在。
  - 所有 UI/脚本注入须跳过非主Hub页面，屏蔽 `top !== self` 的 iframe，并跳过 `--agy-backend=ssh` 远程窗口。
- **补丁间协同与 DOM 安全边界**：
  - **防汉化误改**：所有新增原生 DOM/弹窗容器须打上 `data-agy-zh-skip="1"`，避免 `agy-zh-cn` 误译或打断自定义文本节点。
  - **链式旁路 LS 客户端**：监听 Language Server 响应必须通过 `Object.defineProperty` 链式包裹 `globalThis.__JETSKI_LS_CLIENT_DECORATOR__`（保留先前装饰器），严禁覆盖全局钩子、严禁主动发起额外网络请求、严禁读取本地 OAuth 凭证。
  - **防闪烁与防抢焦点**：高频扫描/定时同步必须先比对数据指纹再按需更新 DOM，严禁无变化时销毁重建元素导致 hover 闪烁或滚动重置。
- **二进制原位补丁红线（如 `language_server.exe`）**：
  - 仅允许唯一匹配且严格等长 UTF-8 原位字节替换，必须显式校验命中区不与尾部内嵌前端 ZIP 重叠，并支持位级可逆还原；上游文本变化时报错停手并输出特征上下文。
- **原生插件目录规范（如 `agy-compact-retitle`）**：
  - Windows 下 Antigravity 插件扫描器会跳过目录联接（Junction），外部插件同步必须落盘为真实目录，卸载或重建时须先用 `lstatSync` 判断符号链接并只解除链接本身，绝不可递归删除波及源码目录。

## 3. 安全打补丁与验收门禁

- **禁止强杀宿主进程**：严禁在脚本或终端内强杀正在运行的 `Antigravity.exe` 主进程。安装/替换必须通过 `node repatch-all.mjs`（利用 WMI `Win32_Process.Create` 脱离宿主进程树），等待用户手动关窗后自动完成替换与重开（`runningCount` 须排除不锁 `app.asar` 的 `sidecar_sdk/register_loader.js` 进程）。
- **交付前双门禁**：每次修改任意补丁模块后，交付或提交前必须确认全部通过：
  1. 所属模块测试：`Set-Location <module>; npm.cmd test` 及根目录 `npm.cmd test` 全部通过；
  2. 联合重打包预检：在根目录执行 `node repatch-all.mjs --dry-only` 全部预检通过，且不污染本地安装目录。

## 4. Git 仓库与隐私卫生

- **严禁入库文件**：`.backup/`、各处 `node_modules/`、`agy-zh-cn/work/`、`agy-weekly-quota/accounts.json`（含个人账号与额度快照）、`agy-periodic-model/equiv-api-cost.json`、`*.log` 与 `*.tmp` 一律通过根目录 `.gitignore` 排除，严禁提交到远端。
- **提交前自检**：执行 `git add` / `git commit` 前检查 `git status --short` 与变更体积，确认无临时构建产物、无个人邮箱/密钥等敏感信息泄漏。
