---
name: project-acceptance
description: 验收与交付：需要逐条判定是否通过、准备验收或交付交接、复核证据是否过期时使用（仅 /project-acceptance 显式调用）。
whenToUse: 需要判定某项是否通过、准备验收或交付交接、或需要复核已有证据是否过期时。
disable-model-invocation: true
---

# 验收与交付

## 何时使用

- 交给用户一条「完成了」的结论之前，必须执行验收判据；本技能只在用户显式调用时加载，未加载则按 `methods/evidence-and-acceptance.md` 的判据执行并标注「技能未加载」。
- 需要把一批判据逐条判定为通过 / 失败 / 未验证。
- 需要交付交接包，或复核历史证据是否仍可作为现状。

## 输入

- 验收判据集合与其归属层（单测 / 接口 / 端到端 / 人工）。
- 项目 profile 的命令与证据有效期 {{evidence:ttl}}。
- 待验收的 {{commit:head}} 与实现方提交的证据（若有）。

## 步骤

1. 方法按节读：`node <技能base>/../../scripts/section.mjs evidence-and-acceptance 2 3`（不要用读文件工具整份读，同一文件本会话不重复读）；证据要素见 `references/evidence-chain.md`，判据或白名单被动过时用同法读 `design-and-invariants` 的 §2–§3 做变异复核。
2. 逐条判据确定可执行命令（{{command:verify}} / {{command:test}} / {{command:e2e}} / {{command:build}}）；未配置 → 记「未验证」，不编造命令。
3. 在同一 {{commit:head}} 上跑；跨 commit 的证据必须标注差异，不得混用。
4. 反证优先：先跑最可能红的用例；红了记录最小复现与失败细节，按 `references/red-item-triage.md` 处置。
5. 一条「通过」= 判据编号 + 五要素（命令原文 + exit code + {{commit:head}} + 时间 + 输出摘要），完整定义见 `references/evidence-chain.md`（六项最小要素）；缺任一即降为「未验证」。
6. 未执行的写「计划，未跑」；降级或替代验证如实标「降级验证」，不得说成真实产出。
7. 交付口径固定顺序：结论先行 → 证据 → 剩余风险 → 人工签认项。
8. 签认：agent 只起草验收记录，{{role:approver}} 签认；证据超过 {{evidence:ttl}} 或 commit 变更需重跑。

## 输出

- 验收记录表：判据编号 / 命令 / exit code / commit / 结论。
- 未验证与未跑清单，含缺什么要素。
- 剩余风险与残余问题（含不修的项与理由）。
- 签认待办：需要谁签、签什么。

- 产出一份 [验证报告](../../templates/verification-report.md) 与 [WBS 验收行](../../templates/wbs-acceptance.md)。

## 停止条件

- 每条判据都有明确结论（通过 / 失败 / 未验证 / 降级）→ 可交付记录。
- 出现红项 → 停在阶段 3，输出失败细节，不继续做交付结论。
- 证据过期、commit 变更、或关键命令未配置 → 回阶段 4 重跑，不出交付结论。

## 常见错误

- 没有 commit 的「通过」；把不同 commit 的证据拼成一组。
- 改测试、改判据、改守卫让红变绿。
- 未跑写成「通过」，或把降级验证写成真实产出。
- 代签，或把「草稿已写」说成「已签认」。
- 写「100% 完成」，而非「候选完成 + 证据链 + 剩余风险」。
