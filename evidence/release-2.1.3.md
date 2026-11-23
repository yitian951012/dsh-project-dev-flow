# 发布证据：@yitian951012/dsh-project-dev-flow@2.1.3

> 生成时间：2026-11-23T13:39:50.597Z · 结论：**包内验证全部通过**

## 基线与制品

| 项 | 值 |
| :--- | :--- |
| 包名 | `@yitian951012/dsh-project-dev-flow` |
| 版本 | `2.1.3` |
| engines.dsh | `>=0.2.2-rc.1 <0.3.0` |
| engines.node | `^24.22.3 || >=26.13.1` |
| commit | `8e87e9857c2e61fb5110a39e73576b20550d314d` |
| 工作区干净 | 是 |
| Node | `v24.22.3` |
| npm | `11.19.1` |
| 包内 YAML 解析器 | 2.9.1 |

## 验证步骤

| 步骤 | 退出码 | 耗时 | 关键指标 |
| :--- | :---: | :---: | :--- |
| `validate` | 0 | 109ms | — |
| `sources` | 0 | 75ms | docs=39 / entries=39 |
| `lock` | 0 | 70ms | — |
| `patch` | 0 | 98ms | — |
| `test` | 0 | 2034ms | tests=170 / pass=170 |
| `test:source` | 0 | 179ms | tests=2 / pass=2 |
| `pack` | 0 | 565ms | files=72 |

## 关键文件哈希

| 文件 | sha256 |
| :--- | :--- |
| `package.json` | `90cd514f6cb0d9b576817fd1937d13742b806d1d4059c2a94e66da707de5e690` |
| `package-lock.json` | `c6e7db4e41dcfbdc4d1420b264b3a4ed0b53b0a5ce5fc830e609c6e609086d9f` |
| `cordis.patch.yml` | `78e6e11a0e25fb874d3e86707ebb39d8cc13701bcee5e7e206275d1d3be8e665` |
| `sources.lock.json` | `ffc7d3019c43a984db3b986c3e7ad590c3160748bc6d1bbed1672d995154c60f` |

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
