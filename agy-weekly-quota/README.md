# Antigravity 左下角账号周额度插槽（`agy-weekly-quota`）

在 Antigravity 左侧边栏底部 **设置**（`[data-testid="settings-button"]`）正上方挂载原生风格的 **Gemini 每周限额** 卡片，顶部附带当前登录邮箱账号。

## 安全与设计边界

- **0 主动网络请求**：绝不发起轮询、冷启动主动请求或任何额外 RPC 调用，也不读取任何本地 OAuth / Token / SQLite 凭证文件。
- **纯被动旁路同步**：通过只读装饰器包装 `globalThis.__JETSKI_LS_CLIENT_DECORATOR__`，仅当 Antigravity 自身正常调用 `getUserStatus`（获知登录邮箱）与 `retrieveUserQuotaSummary`（例如打开「设置 → 模型与用量」时）才旁路提取返回对象。
- **仅保留核心周额度**：只提取 `Gemini Models` 的 `weekly` 桶（忽略 `5h` 滚动限额与 `Claude and GPT models` 第三方模型），倒计时保留与官方原生 `aqa()` 完全一致的英文格式（如 `Resets in 6d 23h`、`Resets in <1m`）。
- **多账号常驻展示 & 独立配置文件（`accounts.json`）**：所有登录过的账号统一保存在 `F:\Code\Antigravity\agy-weekly-quota\accounts.json`（不在 `localStorage` 或 `app_storage.json` 留副本）。当前在线账号亮绿点全亮显示，已登出账号保留上一次查询到的周额度不变，仅在本地正常计算 `Resets in ...` 倒计时。若临时登录过他人账号，直接打开 `accounts.json` 删掉对应邮箱对象保存即可实时清除痕迹。
- **与 `agy-zh-cn` 零冲突共存**：使用独立注入块 `/*AGY-QUOTA-BEGIN*/ ... /*AGY-QUOTA-END*/` 与共享纯净备份目录 `F:\Code\Antigravity\.backup`，插槽根节点带 `data-agy-zh-skip="true"` 防止误翻邮箱与英文倒计时。

## 独立命令

日常建议直接使用上级目录的 `F:\Code\Antigravity\repatch.cmd` 同时维护双补丁；如需单独操作本项目：

```powershell
# 检查周额度补丁与汉化补丁共存状态
node "F:\Code\Antigravity\agy-weekly-quota\patcher\check.mjs"

# 单独应用/更新周额度补丁（保留已有的汉化补丁）
node "F:\Code\Antigravity\agy-weekly-quota\patcher\launch-detached.mjs" patch

# 单独卸载周额度补丁（若含汉化补丁则仅剥离周额度块，不影响汉化）
node "F:\Code\Antigravity\agy-weekly-quota\patcher\launch-detached.mjs" restore

# 运行自动化测试（含双补丁共存与按块卸载测试）
Set-Location "F:\Code\Antigravity\agy-weekly-quota"
node --test
```
