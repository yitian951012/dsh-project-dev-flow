# 内容编写规范（AUTHORING）

> 本文件是插件内容的生产规范，不对外发布。任何作者（人或 agent）新增/修改 `methods/`、`templates/`、`cases/`、`skills/`、`skills/*/references/` 时必须遵守。
> 违反本规范的内容由 `scripts/validate-package.mjs` 拦下，不靠人工记忆。

---

## 1. 四类资产的分工

| 目录 | kind | 回答的问题 | 不允许出现 |
| :--- | :--- | :--- | :--- |
| `methods/` | `method` | 应该怎样判断和推进 | 任何当前项目的数字、命令、路径、产品名 |
| `templates/` | `template` | 项目要生成什么文档 | 真实项目结论；必须全部使用占位符 |
| `cases/` | `case` | 方法为什么值得采用、在哪里失败过 | 未脱敏的路径/账号/密钥；不得写成「推荐做法」 |
| `references/adapters/` | `adapter` | 某类项目的领域适配地图 | 当前进度数字 |
| `skills/*/references/` | `reference` | 某个技能的按需细节 | 与 SKILL.md 重复的大段正文 |

**判定口诀**：可复用的判断 → method；可填空的文档 → template；带日期与失败过程的真实经历 → case；只能溯源不能推断 → evidence。

---

## 2. 文件头（method / template / case / adapter 必须有）

```yaml
---
id: method-truth-and-lifecycle        # 全局唯一，kebab-case，前缀=kind
title: 事实源分权与文档生命周期
kind: method                          # method | template | case | adapter
domain: governance                    # governance | product | architecture | acceptance | history | operations
authority: fallback                   # fallback | example | evidence-only
lifecycle: active                     # active | historical | archive
status: active                        # draft | active | superseded | closed
version: 1.0.0
applies_when:
  - 需要判断某条结论该信谁
not_for:
  - 把单个项目的取舍当成通用规则
sources:
  - doc:00_入口_文档总索引
review_after: 2027-05-01
---
```

规则：

- `authority: fallback` = 缺省方法，项目明确规则优先；`example` = 只作示例；`evidence-only` = 只作证据索引。
- `lifecycle` 与 `status` 是两个维度：历史案例可以是 `lifecycle: historical` + `status: closed`，仍生效的决策是 `active` + `active`。
- `sources` 使用 `doc:<文件名不含扩展名>` 或 `case:<case-id>`；不得写绝对路径。
- `review_after` 必填，最长不超过 12 个月。

## 3. 篇幅预算

| 文件 | 上限 | 说明 |
| :--- | ---: | :--- |
| `methods/*.md` | 110 行 | 方法正文；细节放 references |
| `templates/*.md` | 90 行 | 占位符 + 必填项 + 校验规则 |
| `cases/*/case.md` | 100 行 | 必须包含失败过程与残余风险 |
| `skills/*/SKILL.md` | 75 行 | 是路由与协议，不是手册 |
| `skills/*/references/*.md` | 70 行 | 单主题，可独立阅读 |

超预算不是硬性运行错误，但 `validate-package.mjs` 会告警；连续两次告警视为缺陷。

---

## 4. 技能文件（SKILL.md）

```markdown
---
name: project-docs
description: 项目文档治理：把项目自己的文档落地成唯一索引 + 活/史/档 + 生命周期登记，并审计漂移与断链。
whenToUse: 用户要求整理、审计、迁移、合并项目文档，或文档与代码开始漂移时。
disable-model-invocation: false
---
```

规则：

- `name` 必须等于目录名，kebab-case，仅小写字母、数字、连字符。
- `description` 一句话说明「什么时候用」，不超过 120 字。
- 历史证据类技能必须 `disable-model-invocation: true`，只能用户显式调用。
- 正文结构固定：**何时使用 → 输入 → 步骤 → 输出 → 停止条件 → 常见错误**。
- 正文不得重复 methods 全文；用「先加载 `methods/xxx.md`」引用。

---

## 5. 占位符约定

模板与技能中一律使用以下占位符，禁止写死具体项目的命令与文件名：

| 占位符 | 含义 |
| :--- | :--- |
| `{{project.name}}` | 项目名 |
| `{{doc:root}}` | 文档根目录 |
| `{{doc:index}}` / `{{doc:decision-log}}` / `{{doc:status}}` | 逻辑文档引用 |
| `{{command:verify}}` / `{{command:test}}` / `{{command:build}}` / `{{command:e2e}}` | 由项目 profile 解析出的命令 |
| `{{role:approver}}` / `{{role:owner}}` | 决策人 / 负责人角色 |
| `{{date:today}}` / `{{commit:head}}` | 日期与提交 |
| `{{evidence:ttl}}` | 证据有效期 |

找不到对应值时，输出「未配置」并进入「未验证」模式，**不得编造命令**。
> **注意（2.1.0 起）**：`{{…}}` 只对 methods / templates / skills 的**正文**有效（模型读到的是字面量）。
> `cordis.patch.yml` 的 prompt 段（persona `prefix`/`suffix`、plan-mode `section`）由宿主求值，
> 那里写 `{{…}}` 会让 preset 装配直接失败（`malformed prompt variable reference`）。
> patch 里一律用 `doc:index` / `command:test` / `role:approver` 这种不带花括号的写法；
> 门禁为 `PATCH-PROMPT-PLACEHOLDER`（`npm run check:patch` 与 `npm run validate` 两处都会拦截）。

---

## 6. 内容红线（validate-package 强制）

1. **禁止项目特定规模数字**：测试用例数、路由数、文件行数、覆盖率、通过数等一律不得出现在 `methods/`、`templates/`、`skills/`、`references/`、`adapters/`。需要量级时写「按项目实测」或给区间，不给具体值。
2. **禁止绝对路径与主机信息**：`E:\`、`D:\`、`C:\Users`、`/Users/`、用户名、内网 IP、`localhost:` 端口。
3. **禁止凭据**：API Key、token、密码、`.env` 内容、账号 ID。
4. **禁止真实作品与可识别业务数据**：真实书名、真实客户、真实原稿片段。案例中统一写「来源项目（下称 P）」。
5. **禁止未授权第三方表达性内容**：大段引用外部作品原文。
6. **禁止把历史当现状**：`lifecycle: historical` 的内容不得被 method 以肯定语气引用为当前事实。
7. **禁止「AI 代签」成为默认流程**：只能写「agent 起草、人类签认」；代理签认只能作为项目级显式策略案例出现。
8. **禁止「100% 完成」类断言**：统一写「候选完成 + 证据链 + 剩余风险」。

允许出现的「来源项目」写法：`来源：P 项目 2026-11 文档治理审计（脱敏，原文不随包发布）`。

---

## 7. 案例的必备结构

`cases/<case-id>/case.md` 必须包含：

1. 背景与约束；
2. 当时的错误判断（**必须写**）；
3. 候选方案与实际取舍；
4. 可观察证据（命令类型、结果量级、时间；不含真实数字以外的主机信息）；
5. 修复后仍未解决的风险；
6. 能提炼的方法 + **不可外推的边界**；
7. 与插件内方法的链接。

没有第 2 条或第 6 条的案例不予收录——只写「最佳实践」的案例价值为零。

---

## 8. 来源登记

新增任何入包资产时，必须同步 `sources.lock.json`：

- `path`：源文档相对路径（`docs/xx.md`）；
- `sha256`：源文档哈希（由 `scripts/gen-sources-lock.mjs` 生成，不手写）；
- `lifecycle`：`active` / `historical` / `archive`；
- `disposition`：`method` / `template` / `case` / `evidence` / `not-migrate`；
- `targets`：插件内目标文件；`evidence` / `not-migrate` 允许为空，`method` / `template` / `case` 必须至少有一个对应目录下的落点（`methods/`、`templates/`、`cases/`），否则 `check-sources` 报 `SOURCE-TARGET-KIND`；
- `note`：一句话说明为什么不迁移或如何提炼。

服务端脚本 `scripts/check-sources.mjs` 会比对哈希；源文档变更后必须重新评审提炼内容，而不是静默更新哈希。

---

## 9. 评审与验收

- 内容提交前至少过一遍 `node scripts/validate-package.mjs`；
- `validate-package` 的每条规则都必须有负向样本（`tests/`），否则视为「没验证的检查器」；
- 方法类内容每季度复核一次，`review_after` 到期未复核视为过期。
