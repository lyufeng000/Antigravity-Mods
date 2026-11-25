# agy-zh-steps

Antigravity **中文步骤与状态摘要**补丁：通过**严格等长 UTF-8 原位字节替换**，修改 `resources/bin/language_server.exe` 内硬编码的 9 处内置工具描述与 Go 反射结构体标签（`jsonschema_description`），让模型在调用工具生成动态进度卡片、状态摘要与 UI 标签时从源头直接输出简体中文。

## 为什么需要这个补丁？

Antigravity 的任务步骤卡片（`step-plan`）外壳静态文案（如 `已耗时 {0}`、`{0}/{1} 个步骤`）已由 `agy-zh-cn` 覆盖，但卡片里的具体步骤文字、下方焦点摘要、命令简述与子代理角色名称并非前端静态词条，而是模型运行时依据 `language_server.exe` 内置的工具描述与 JSON Schema 约束动态生成的：

| 目标 ID | 作用范围 | 替换字节 | 修改要点 |
| :--- | :--- | ---: | :--- |
| `update_steps_desc` | `update_steps` 工具主描述 | 1800 | 将 `Short and imperative (2-6 words), e.g. "Merge branch into main"` 改为要求简体中文标题与中文示例 |
| `update_steps_title_tag` | `update_steps.steps[].title` 标签 | 138 | 要求输出 `Simplified Chinese (简体中文)` 标题并给出中文例句 |
| `update_focus_desc` | `update_focus` 工具主描述 | 549 | 明确要求状态摘要统一使用简体中文（含英文/命令行任务） |
| `update_focus_param_tag` | `update_focus.focus` 标签 | 247 | 将英文现在分词格式要求改为简体中文进行时态短语与中文示例 |
| `run_command_summary_tag` | `run_command.toolSummary` 描述 | 180 | 将英文名词短语格式要求改为简体中文命令任务短语与中文示例 |
| `subagent_role_tag` | `invoke_subagent.Role` 标签 | 303 | 将英文职位头衔描述改为简体中文子代理角色与中文示例 |
| `browser_cursor_intent_tag` | 浏览器光标意图 `intent` 标签 | 192 | 将 3 词以内英文描述改为简体中文光标意图标签 |
| `browser_overlay_intention_tag` | 浏览器浮层摘要 `intention` 标签 | 176 | 将脚本浮层摘要约束改为简体中文输出 |
| `swarm_title_desc` | `swarm.title` JSON Schema 描述 | 98 | 将 Swarm UI 标题约束改为简体中文输出 |

## 设计特点

- **严格等长原位替换**：每处替换前后 UTF-8 字节长度完全一致，不改变 Go 字符串常量长度、`abi.Name` varint 长度、JSON Schema 语法或二进制总大小，也不触碰 Go `pclntab` 函数符号与尾部内嵌前端 ZIP（`main.js` / `compiled_tailwind.css`）。
- **单次原子写入 + 多区间校验**：9 处替换合并到单次临时文件拷贝与 `fsync` 原子替换中完成，校验每处偏移回读字节与整文件 SHA-256。
- **与 `agy-zh-title` 无缝共存**：使用独立元信息文件 `.backup/language_server.steps-meta.json`，两套补丁可按任意顺序独立注入、升级与互不干扰地还原。
- **安全门禁**：要求 9 项全部唯一命中且互不重叠、不与内嵌 ZIP 重叠；若上游版本改动原文，会报错停手并打印当前二进制片段以便更新 `TARGETS`。

## 常用命令

```powershell
# 运行单元测试（仅在临时目录合成二进制上运行，不触碰安装目录）
Set-Location "F:\Code\Antigravity\agy-zh-steps"
npm.cmd test

# 检查当前 9 处目标状态
node patcher/check.mjs

# 推荐：通过工作区联合编排器检查 / 预检 / 一键重打七补丁
node "F:\Code\Antigravity\repatch-all.mjs" check
node "F:\Code\Antigravity\repatch-all.mjs" --dry-only
node "F:\Code\Antigravity\repatch-all.mjs"
```

## 客户端自动更新后提示词变更怎么办？

若未来 Antigravity 升级后 `check.mjs` 显示某项为 `上游提示词已变更`（`prompt_changed`），运行 `node patcher/check.mjs` 查看对应目标打印出的当前二进制片段，同步更新 `patcher/lib/targets.mjs` 中该项的 `orig` 与严格等长 `patched` 后重新运行即可。
