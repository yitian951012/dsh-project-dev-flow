---
name: project-dev-flow
description: 项目开发流程总控：进入陌生项目、任务横跨多个阶段，或不确定该走哪个流程技能时使用；也用于项目适配与阶段判定。
whenToUse: 进入陌生项目、任务跨多个阶段、或不确定该走哪个流程技能时；需要先做项目适配或更新状态投影时。
disable-model-invocation: false
---

# 项目开发流程（总控）

## 何时使用

- 刚进入目标项目，还不知道验证命令、文档根、决策与验收类文档在哪。
- 任务横跨需求、设计、实现、验证中的两段以上，需要阶段判定。
- 已有 profile 过期（命令或文档结构变了），需要重新适配。

## 输入

- 目标项目的只读事实：脚本入口、CI 配置、测试入口、文档根、决策与验收类文档、项目自带规范与技能。
- 用户口述的目标与约束。
- 已有 profile（若有）与 {{doc:status}} 当前投影。

## 步骤

1. 方法按节读：`node <技能base>/../../scripts/section.mjs truth-and-lifecycle 2 3` 与 `node <技能base>/../../scripts/section.mjs intake-and-decision 2 3`（不要用读文件工具整份读；§1/§4/§5 只在对应场景读，同一文件本会话不重复读）；本技能不复述其判据，profile 字段见 `references/project-profile.md`。目标项目为本地优先应用（单机运行、数据落本地、无多租户）时，另读 `../../references/adapters/local-first-app.md`。
2. 只读检查，按 `../../templates/project-profile.md` 的字段表逐项填值（字段语义见 `references/project-profile.md`），每项记出处（文件+行位或命令输出）。
3. 找不到出处的字段写「未验证」；禁止沿用其他项目或其他仓库的命令与门禁。
4. 经用户确认后才写回项目文档；未确认时只作会话内「临时 profile」使用并显式标注。
5. 按 `references/stage-routing.md` 判定当前阶段，并说出「现在在哪一段 / 下一动作 / 谁确认」。
6. 阶段 2 设计定型：范围、契约、数据、判据变化先登记 {{doc:decision-log}} 再动代码；按节读 `node <技能base>/../../scripts/section.mjs design-and-invariants 2 3`。
7. 阶段 3 实现：先写会失败的用例，再实现；跑 {{command:test}} 与 {{command:verify}}，记录 exit code 与 {{commit:head}}；按节读 `node <技能base>/../../scripts/section.mjs design-and-invariants 2 3`（契约→可失败断言）与 `node <技能base>/../../scripts/section.mjs evidence-and-acceptance 2 3`（证据与判级）。
8. 阶段 4/5 与阶段 6 对应技能默认不可自动加载：提示用户单独一行发送 `/project-acceptance` 或 `/project-case-distill`（前后留空格或换行，否则不会注入）；用户未调用时，按节读 `node <技能base>/../../scripts/section.mjs evidence-and-acceptance 2 3`、`node <技能base>/../../scripts/section.mjs history-and-cases 2 3` 的判据自行执行，并标注「技能未加载」。文档治理类转 `project-docs`；阶段切换时只更新 {{doc:status}} 投影，不重写看板结论。
9. 每次阶段切换输出证据块：命令原文 + exit code + commit；未执行的写「计划，未跑」。

## 输出

- 项目 profile 字段表：值 + 出处 + 未验证标记。
- 阶段判定：当前阶段 / 下一动作 / 需确认人。
- 本次证据块与未执行项清单。
- 需人工签认项单列，不由 agent 代签。

- 适配结果落成 [项目档案](../../templates/project-profile.md)；进度投影落成 [状态看板](../../templates/status-dashboard.md)。

## 停止条件

- 阶段判定已给出且用户确认下一动作 → 交给对应技能，本技能停止。
- 关键字段（验证命令、判据归属、决策人）无法取得 → 停在「未验证」，只输出缺口清单，不给结论。
- 触及决策、数据、凭据变更或需要跨阶段跳步 → 停在人工确认。

## 常见错误

- 把模板里的命令当本项目验证命令；profile 未标注出处却当事实用。
- 跳过设计定型直接改码，事后补登记。
- 把 {{doc:status}} 看板当独立事实源，用看板数字覆盖当场命令结果。
- 未跑验证就写「完成」或「100% 完成」。
- 用其他项目的门禁判据否掉当前项目的合法做法。
