# agy-zh-title

Antigravity **中文对话标题**补丁：通过**等长 UTF-8 原位字节替换**，修改 `resources/bin/language_server.exe` 内硬编码的 `626` 字节对话标题生成系统提示词，让新对话从源头稳定生成简体中文标题（避免因代码/英文缩写混杂而被提示词中的 `3-5 words, title-cased` 诱导为英文标题）。

## 设计特点

- **零额外请求、无闪烁**：直接修改本地标题生成提示词，不额外调用 `GetModelResponse`，侧边栏不会先出现英文再回写中文。
- **严格等长（626 字节）原位替换**：不改变 Go 字符串常量长度及文件总大小，不影响可执行文件内后续区间与尾部内嵌前端 ZIP（`main.js` / `compiled_tailwind.css`）。
- **位级可逆**：`restore` 会校验并将提示词准确还原为原始 626 字节英文模板，SHA-256 与官方原文件完全一致；元信息写入 `.backup/language_server.title-meta.json`。
- **安全门禁**：仅当目标唯一命中且与内嵌 ZIP 无重叠时才允许写入；若未来官方更新改动了原文提示词，会主动报错停手并打印当前二进制片段，方便核对更新 `ORIG_PROMPT`。

## 常用命令

```powershell
# 运行单元测试（仅在临时目录合成二进制上测试，不触碰安装目录）
Set-Location "F:\Code\Antigravity\agy-zh-title"
npm.cmd test

# 检查当前状态
node patcher/check.mjs

# 推荐：通过工作区联合编排器检查 / 预检 / 一键重打六补丁
node "F:\Code\Antigravity\repatch-all.mjs" check
node "F:\Code\Antigravity\repatch-all.mjs" --dry-only
node "F:\Code\Antigravity\repatch-all.mjs"
```

## 客户端自动更新后提示词变更怎么办？

若未来 Antigravity 升级后 `check.mjs` 显示 `上游提示词已变更`（`prompt_changed`），运行 `node patcher/check.mjs` 查看打印出的当前二进制片段，将 `patcher/lib/prompt.mjs` 中的 `ORIG_PROMPT` 更新为新版原文，并保证 `PATCHED_PROMPT` 与其 UTF-8 字节长度一致后再重新打补丁即可。
