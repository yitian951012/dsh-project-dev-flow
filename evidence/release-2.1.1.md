# 发布证据：@yitian951012/dsh-project-dev-flow@2.1.1

> 生成时间：2026-11-20T09:03:31.502Z · 结论：**包内验证全部通过**

## 基线与制品

| 项 | 值 |
| :--- | :--- |
| 包名 | `@yitian951012/dsh-project-dev-flow` |
| 版本 | `2.1.1` |
| engines.dsh | `>=0.2.2-rc.1 <0.3.0` |
| commit | `3f32e9df6dc1a5b9273a4676367a74fe12d46aa1` |
| 工作区干净 | 否 |
| Node | `v22.23.0` |
| npm | `10.9.8` |
| 包内 YAML 解析器 | 未验证 |

## 验证步骤

| 步骤 | 退出码 | 耗时 | 关键指标 |
| :--- | :---: | :---: | :--- |
| `validate` | 0 | 155ms | — |
| `sources` | 0 | 105ms | docs=39 / entries=39 |
| `lock` | 0 | 99ms | — |
| `patch` | 0 | 149ms | — |
| `test` | 0 | 3018ms | tests=165 / pass=165 |
| `test:source` | 0 | 275ms | tests=2 / pass=2 |
| `pack` | 0 | 847ms | files=68 |

## 关键文件哈希

| 文件 | sha256 |
| :--- | :--- |
| `package.json` | `00a2f6517c48ffe9150897a980487e428d1390c6b389f7032ea30a47573426af` |
| `package-lock.json` | `37e8353a427d16c3346808410a22b73df4346f8becad1556d4dc13635357fb5b` |
| `cordis.patch.yml` | `78e6e11a0e25fb874d3e86707ebb39d8cc13701bcee5e7e206275d1d3be8e665` |
| `sources.lock.json` | `41fc29a29e85c2648c63994002687cf9a8039a6ab25322b8344d89beb5febe93` |

## 真实会话验收

| 项 | 值 |
| :--- | :--- |
| 状态 | **blocked** |
| 技能目录进入运行时配置 | 是 |
| 证据时间 | 2026-11-20T09:00:15.039Z |
| 阻塞原因 | llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment |

| 任务 | 期望技能 | 退出码 | 命中 | 错误 |
| :--- | :--- | ---: | :---: | :--- |
| `route-docs` | `project-docs` | 1 | 否 | MISSING_CREDENTIAL |
| `route-intake` | `project-intake` | 1 | 否 | MISSING_CREDENTIAL |
| `slash-acceptance` | `project-acceptance` | 1 | 否 | MISSING_CREDENTIAL |

## 未验证（需要真实宿主，不能由本清单替代）

- 真实会话中的技能自动路由与 slash 调用
- 工具 schema 与 token 实测
- 真实模型的任务成功率

> 本清单证明的是「当前 commit 上包内检查全部通过」。它**不证明** DSH 装配、技能路由、升级回滚可用；那需要隔离 profile 的真实安装记录。
