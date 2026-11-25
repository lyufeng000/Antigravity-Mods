# Antigravity Windows 系统通知点击跳转修复（`agy-win-notify`）

修复 Antigravity 桌面端（2.34.0+）在 Windows 10/11 上点击系统通知无法切回窗口及跳转到对应对话的问题。

## 根因与修复机制

1. **绑定匹配的 AUMID**：启动时在 `app.whenReady()` 前调用 `app.setAppUserModelId('electron.app.Antigravity')`，精确匹配开始菜单快捷方式 `Antigravity.lnk` 与 Windows 通知设置注册表项。
2. **保活 `Notification` 实例**：用全局 `Set` 持有每次创建的 `Notification` 对象，直到触发 `click` / `close` / `failed` 或 30 分钟超时兜底再释放，防止未点击前被 V8 GC 回收导致监听失效。
3. **修复 `BaseWindow` 点击事件派发与多窗口定位**：通过 `utils.getHubWebContents(win)`（兼容 `win.webContents`）派发 `notification:clicked`；本地通知优先聚焦发起通知的窗口，远程 SSH 窗口保持隔离，窗口已销毁时不错误唤醒本地窗口。
4. **突破 Windows 焦点抢占限制**：点击通知及非 `--ssh-host=` 的 `second-instance`（如 `-ToastActivated`）唤起时，依次执行 `flashFrame(false)` → `restore()` → `show()` → 临时 `setAlwaysOnTop(true, 'screen-saver')` → `moveTop()` → `app.focus({ steal: true })` → `win.focus()` → `targetContents.focus()`，并在 140ms 后撤销临时置顶（保留原本就置顶的窗口状态，且用 `WeakMap` 防止连续点击把窗口锁死在永久置顶）再补一次焦点。

## 注入标记与共存

- 仅注入 `dist/main.js`（不改动 `dist/preload.js` 与 `language_server.exe`）：
  - `/*AGY-WIN-NOTIFY-MAIN-BEGIN*/ ... /*AGY-WIN-NOTIFY-MAIN-END*/`
- 共享根目录纯净备份池 `F:\Code\Antigravity\.backup`，与其他补丁零冲突共存。

## 常用命令

日常推荐使用根目录 `repatch.cmd` / `repatch-all.mjs` 统一重打全部补丁；如需单独管理本模块：

```powershell
# 检查注入与备份状态
node "F:\Code\Antigravity\agy-win-notify\patcher\check.mjs"

# 执行 dry-run 预检（不修改安装目录）
node "F:\Code\Antigravity\agy-win-notify\patcher\patch.mjs" --dry-run

# 单独注入（保留共存补丁）
node "F:\Code\Antigravity\agy-win-notify\patcher\patch.mjs" --wait-exit --relaunch

# 单独剥离（仅移除通知修复块，保留其他补丁；无其他补丁时还原纯净原包）
node "F:\Code\Antigravity\agy-win-notify\patcher\restore.mjs" --wait-exit --relaunch

# 运行自动化单测与共存测试
Set-Location "F:\Code\Antigravity\agy-win-notify"
npm.cmd test
```
