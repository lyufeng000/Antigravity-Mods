# agy-periodic-model

Antigravity 桌面端的 **Gemini 4 元素周期表模型选择器**补丁（复刻 Google AI Studio 的 *THE PERIODIC TABLE OF Gemini 4* 视觉），以独立标记块 `/*AGY-PERIODIC-MODEL-BEGIN*/ ... /*AGY-PERIODIC-MODEL-END*/` 注入 `dist/preload.js`，直接**原地替换**原版模型下拉菜单（`[data-testid="model-selector-panel"]`），不另弹新模态窗。

## 核心特性

- **原地替换原版下拉面板**：沿用原生 Popover 定位、毛玻璃面板外壳、外部点击/Esc 关闭，并保留最底部原生「查看用量 >」。
- **18×6 完整化学元素周期表**：自动点亮当前账号可用的所有 `Gemini 4 <Element>` 模型（当前 `1 H`、`6 C`、`10 Ne`、`18 Ar`，未来新增自动点亮）；未支持元素置灰严禁选中（悬停可在下方预览中英文元素名）。
- **推理档位与 Orchestrator 一键切换**：选中模型或思考等级后菜单保持打开，方便连续挑完模型和 `Low / Medium / High / XHigh`（或对应 `Orchestrator`）；点击空白处、`Esc` 或再次点底部模型按钮关闭。
- **按分组显示周额度**：通过只读旁路 `RetrieveUserQuotaSummary`（零额外请求）展示所属模型分组的周额度百分比与悬停重置倒计时（Gemini 组 / Claude & GPT 组各自独立展示）。
- **完整兼顾表外模型（二级菜单）**：面板顶栏内置 `All`、`其他模型` 与动态系列胶囊（`Orchestrator`、`Gemini`、`Claude`、`GPT`、`Custom`）以及搜索框，支持原地切换任意非表内模型。
- **原版列表随时切换**：右上角点「原版」可原地切回官方窄列表（随时点「切回周期表」回来）；Best of N 多选模式自动透传原版。

## 常用命令

```powershell
# 运行单元测试
Set-Location "F:\Code\Antigravity\agy-periodic-model"
npm.cmd test

# 检查注入状态
node patcher/check.mjs

# 推荐：使用工作区联合编排器一键合并注入五补丁
node "F:\Code\Antigravity\repatch-all.mjs"
```
