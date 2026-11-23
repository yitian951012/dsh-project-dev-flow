# 发布证据：@yitian951012/dsh-project-dev-flow@2.1.2

> 生成时间：2026-11-23T13:59:34.524Z · 结论：**存在失败步骤，不可发布**

## 基线与制品

| 项 | 值 |
| :--- | :--- |
| 包名 | `@yitian951012/dsh-project-dev-flow` |
| 版本 | `2.1.2` |
| engines.dsh | `>=0.2.2-rc.1 <0.3.0` |
| commit | `6b5dd3c12845f4963120b683e463303846ef77b4` |
| 工作区干净 | 是 |
| Node | `v24.22.3` |
| npm | `11.19.1` |
| 包内 YAML 解析器 | 未验证 |

## 验证步骤

| 步骤 | 退出码 | 耗时 | 关键指标 |
| :--- | :---: | :---: | :--- |
| `validate` | 1 | 106ms | — |
| `sources` | 1 | 77ms | docs=39 / entries=39 |
| `lock` | 1 | 69ms | — |
| `patch` | 0 | 97ms | — |
| `test` | 0 | 2010ms | — |
| `test:source` | 0 | 180ms | — |
| `pack` | 0 | 562ms | files=72 |

## 关键文件哈希

| 文件 | sha256 |
| :--- | :--- |
| `package.json` | `c78d71843e56c6204c6573fc4a7da6b9427bffa8fb2a659a36ff678b32a16e80` |
| `package-lock.json` | `37e8353a427d16c3346808410a22b73df4346f8becad1556d4dc13635357fb5b` |
| `cordis.patch.yml` | `78e6e11a0e25fb874d3e86707ebb39d8cc13701bcee5e7e206275d1d3be8e665` |
| `sources.lock.json` | `dd7318a4bf4a8d0f48c6a9ded037072eda7f56cb8d324e6cbfd1366c5ecfcb26` |

## 真实会话验收

| 项 | 值 |
| :--- | :--- |
| 状态 | **not-run** |
| 技能目录进入运行时配置 | 未验证 |
| 证据时间 | — |

## 未验证（需要真实宿主，不能由本清单替代）

- 真实会话中的技能自动路由与 slash 调用
- 工具 schema 与 token 实测
- 真实模型的任务成功率

> 本清单证明的是「当前 commit 上包内检查全部通过」。它**不证明** DSH 装配、技能路由、升级回滚可用；那需要隔离 profile 的真实安装记录。

## 补录说明（2026-11-23）

本文件是**事后补录**，不是发布当时生成：2.1.2 的 `release-evidence.mjs` 当时从未运行。

- **生成方式**：在 `v2.1.2`（`6b5dd3c`）的独立 worktree 上、用**该树自带的**工具生成，未改动该树任何文件（`clean: true`）。
- **结论「不可发布」的唯一原因**：`docs/02_入口_决策登记.md` 的 sha256 已前移（该母本不在任何 git，DEC-013/014 在此之后追加）——`sources.lock.json` 登记 `c006066d…`、实际 `8d83007f…`。这属**不可复现**，不是 2.1.2 代码缺陷。
- **其余步骤在该树上实测通过**：`patch` exit 0、`test` exit 0、`test:source` exit 0、`pack` exit 0（72 files）。
- **测试计数为空的原因**：该树自带的 `verify.mjs` 只认 `# tests`，Node 24 reporter 输出 `ℹ tests`（2.1.3 第 13 条修复）。2.1.2 树的真实数字（`tests 168` / `suites 37`）记在 `compat-2.1.2-dsh-0.2.3-alpha.2.md` 的更正说明里。
- **三态等级**：`unavailable`（第三方无法复现当时的源文档状态），不得据此宣称 2.1.2「可发布」或「已验证通过」。
