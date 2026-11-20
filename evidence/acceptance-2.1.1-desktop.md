# 真实会话验收（桌面宿主路径）：`@yitian951012/dsh-project-dev-flow@2.1.1`

> 时间：2026-11-20T10:52:46Z · 提交：`8c84fbe`（= tag `v2.1.1`，`v2.1.1-0-g8c84fbe`，工作树干净）
> 执行面：桌面宿主真会话（任务看板派发，`mode=project-dev-flow`）
> 结论：**partial —— 2 通过 + 1 命中未终答**（不记 passed）

本文件是 [`acceptance-2.1.1.json`](acceptance-2.1.1.json) 的**补充路径**，不是替代：CLI 路径在同一天复跑仍为 `blocked`（`node scripts/acceptance-session.mjs` → exit **3**，`MISSING_CREDENTIAL`，路由 `deepseek-official`）。判据未改，只换执行面。

## 1. 为什么换执行面

| 事实 | 证据 |
| :--- | :--- |
| CLI 默认路由拿不到凭据 | `dsh --profile headless --json "只回复两个字：可以"` → exit **1**，`final.reason.kind=error`，code `MISSING_CREDENTIAL`（provider route `deepseek-official`） |
| 桌面宿主有自己的路由 | 真会话里 `assistant/message.source` = `provider: huoshan` / `model: deepseek-v4.1-flash` |
| 结论 | 「桌面可跑、CLI 不可跑」是**路由差异**，不是凭据缺失；因此同一套判据改在桌面宿主执行 |

## 2. 标准流程（DSH 文档口径，context7 查证）

| 步骤 | 依据 | 本验收怎么用 |
| :--- | :--- | :--- |
| 会话技能目录按「会话组合（cwd + preset）」注入 | `docs/subsystems/skills.md` | 先跑探针确认 `agentPreset=project-dev-flow` 且 5 个技能名进入上下文 |
| 模型加载技能 = 调 `skill({ name })` | `docs/subsystems/skills.md`、`packages/skill/tool-skill/README.md` | 自动路由判据 = 会话里出现 `tool/call`，`name=skill`，`arguments.name=期望技能` |
| `/name` 出现在**直接用户输入**时，pre-step 注入 `<skill_content>` | `packages/skill/tool-skill/README.md`、`packages/client/ui-skill/README.md` | 斜杠判据 = `user/message` 里出现该技能正文与 base 目录，且模型无需再调 `skill` |
| `disable-model-invocation` 的技能只能靠 `/name` 进入 | 同上 | `project-acceptance` / `project-case-distill` 不进目录，斜杠是唯一入口 |
| 机器可读事件流用于断言 | `packages/bundle/headless/README.md` | 本验收直接读会话记录（多帧 zstd 的 `session.v4.jsonl.zstd`），逐帧解压后按 `type` 取 `tool/call` / `user/message` / `assistant/message` |

## 3. 装配前提（探针，不承担判据）

`session-56ff8427-ea61-427d-a8f4-64ca4028f6bf`：`agentPreset=project-dev-flow`，上下文中出现 5 个技能名（`project-dev-flow`、`project-docs`、`project-intake`、`project-acceptance`、`project-case-distill`），看板结果 `succeeded`。

## 4. 三条任务（prompt 与 `scripts/acceptance-session.mjs` 逐字一致）

| 任务 | 类型 | 期望 | 观察到的客观事实 | 判定 |
| :--- | :--- | :--- | :--- | :--- |
| `route-docs`<br>`session-b0061569…` | 路由 | `project-docs` | `tool/call` → `skill`，`arguments`=`{"name":"project-docs"}`；29 次工具调用；终答 5684 字符（落点：两个事实世界 + 治理顺序）；看板 `succeeded` | **通过** |
| `route-intake`<br>`session-e83600d4…` | 路由 | `project-intake` | `tool/call` → `skill`，`arguments`=`{"name":"project-intake"}`；17 次工具调用；随后调 `ask_user_question` 询问「插件指哪个包 / 导出对象与出口形态」，**无人在场应答 → 无终答**；看板执行由 agent `settle` 关闭（`cancelled`） | **命中未终答** |
| `slash-acceptance`<br>`session-976f8cee…` | 斜杠 | `project-acceptance` | **没有** `skill` 工具调用；`user/message`（seq=20）携带 `<skill_content>` + `<skill_instructions>`，正文为「# 验收与交付」，base 目录 `skills/project-acceptance`；17 次工具调用；终答 3388 字符（三条判定要点）；看板 `succeeded` | **通过** |

## 5. 与 CLI 口径的差异（如实披露）

1. 会话 cwd 是工作区根，不是插件根；三条 prompt 未改动一个字。
2. 会话经任务看板派发，比 CLI 多一层看板上下文（不构成额外技能提示）。
3. 模型路由不同（huoshan / deepseek-v4.1-flash vs deepseek-official）——这是换执行面的原因，也是结论只对本环境成立的原因。
4. 未改动任何判据、测试、CI、守卫；`evidence/acceptance-2.1.1.json|md` 未被改写。

## 6. 为什么整项不记 `passed`

`route-intake` 的命中只够证明「模型选对了技能」，不能证明「受理表交付完成」：会话停在向人询问口径的那一步——这恰好是该技能设计要多问人（需要谁拍板）的结果，不是路由失败。按「未跑验证不说完成」，这一项只能是 `hit_but_unfinished`，整体记 `partial`。

## 7. 复现方法（本机，无需绝对路径）

1. 任务看板建卡：`mode=project-dev-flow`、`permission=read-only`、prompt 逐字取自 `scripts/acceptance-session.mjs` 的 `TASKS`。
2. `task_board_run` 后由 `latestExecution.sessionId` 取会话 id。
3. 对 `~/.dsh/sessions/<cwd 编码>/<sessionId>/session.v4.jsonl.zstd`：按 zstd 帧魔数 `28 B5 2F FD` 切分，逐帧 `zlib.zstdDecompressSync` 解压，按行 `JSON.parse`；从 `tool/call` 取 `data.name` 与 `data.arguments`，从 `user/message` 取注入块。
4. 判定：路由看 `tool/call` 且 `arguments.name` 等于期望技能；斜杠看 `user/message` 是否带该技能正文与 base 目录。

> 本文件是证据，不是承诺：只有三项都终答且都命中，才可写「真实会话验收通过」。
