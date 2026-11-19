# Antigravity 本地文件增强右键菜单（`agy-file-menu`）

为 Antigravity 界面中的本地文件元素（聊天文件芯片 `[data-uri]`、变更文件行 `[data-file-uri]`、Markdown `file://` 与本地路径链接、Artifact 卡片、右侧工作区文件树 `[role="treeitem"]`、本地媒体附件、文件查看器预览区 `[data-active-file-uri]`）提供原生上下文菜单：

- **复制**（优先复制当前选中文本，否则复制文件标签名或文件名）
- **复制文件路径**（规范化后的本地绝对路径）
- **在资源管理器里打开**（定位并选中目标文件，若文件尚不存在但父目录存在则打开父目录）
- **使用默认程序打开**（调用系统关联程序打开文件）
- **使用默认浏览器打开**（在 Windows 下解析系统默认浏览器 `.exe` 强制打开本地 `file:///...` URL，支持 `.md` / `.json` / `.html` / `.svg` / `.pdf` / 图片等在浏览器直接预览）

## 安全与共存设计

- **精准排除非文件元素**：自动放行输入框（`input` / `textarea` / `contenteditable`）、侧栏自带关闭菜单的标签页头 `[role="tab"]`、会话列表行 `[data-cascade-id]` 及 `http:` / `https:` 等非本地协议链接。
- **远程窗口安全隔离**：渲染层检测 `--agy-backend=ssh` 自动跳过挂载，主进程 `agy-file-menu:exec` IPC 二次校验 `isRemoteContents` 拒绝远程 SSH 窗口调用。
- **与 `agy-zh-cn`、`agy-weekly-quota` 零冲突共存**：使用独立注入块 `/*AGY-FILE-MENU-BEGIN*/ ... /*AGY-FILE-MENU-END*/`（`dist/preload.js`）与 `/*AGY-FILE-MENU-MAIN-BEGIN*/ ... /*AGY-FILE-MENU-MAIN-END*/`（`dist/main.js`），共享根目录纯净备份池 `F:\Code\Antigravity\.backup`。

## 独立命令

日常建议直接使用上级目录的 `F:\Code\Antigravity\repatch.cmd` 或 `repatch-all.mjs` 同时维护三补丁；如需单独操作本项目：

```powershell
# 检查文件菜单补丁与汉化、周额度补丁共存状态
node "F:\Code\Antigravity\agy-file-menu\patcher\check.mjs"

# 单独执行 dry-run 预检（不修改安装目录）
node "F:\Code\Antigravity\agy-file-menu\patcher\patch.mjs" --dry-run

# 单独应用/更新文件菜单补丁（保留已有的汉化与周额度补丁）
node "F:\Code\Antigravity\agy-file-menu\patcher\patch.mjs" --wait-exit --relaunch

# 单独卸载文件菜单补丁（仅剥离文件菜单块，保留汉化与周额度补丁）
node "F:\Code\Antigravity\agy-file-menu\patcher\restore.mjs" --wait-exit --relaunch

# 运行自动化测试
Set-Location "F:\Code\Antigravity\agy-file-menu"
node --test
```
