# 发布证据：@yitian951012/dsh-project-dev-flow@3.0.0

> 生成时间：2026-11-26T14:35:43.482Z · 结论：**包内验证全部通过**

## 基线与制品

| 项 | 值 |
| :--- | :--- |
| 包名 | `@yitian951012/dsh-project-dev-flow` |
| 版本 | `3.0.0` |
| engines.dsh | `>=0.2.3-alpha.2 <0.3.0-0` |
| engines.node | `^24.22.3 || >=26.13.1` |
| dsh.client | `web` |
| commit | `bd9fcb5d62413b740dc81063d8e5f2a5820184b7` |
| 工作区干净 | 否 |
| Node | `v24.22.3` |
| npm | `11.19.1` |
| 包内 YAML 解析器 | 2.9.1 |

## 验证步骤

| 步骤 | 退出码 | 耗时 | 关键指标 |
| :--- | :---: | :---: | :--- |
| `validate` | 0 | 105ms | — |
| `sources` | 0 | 76ms | docs=39 / entries=39 |
| `lock` | 0 | 70ms | — |
| `patch` | 0 | 96ms | — |
| `test` | 0 | 2284ms | tests=223 / pass=223 |
| `test:source` | 0 | 206ms | tests=2 / pass=2 |
| `pack` | 0 | 536ms | files=96 |

## 关键文件哈希

| 文件 | sha256 |
| :--- | :--- |
| `package.json` | `ee48928afd98de724e0e402f73df78c53101a8dc3d0aa6aa0bcfd8e5ba40d193` |
| `package-lock.json` | `468c14ea49073791cd6a1dc3384d22097fb794f47663f5def4f4277041cea438` |
| `cordis.patch.yml` | `502e61a4b1908c39a7dad7d0af7f5034736dcd4745e890e965faad06049d20be` |
| `sources.lock.json` | `0baf2c78b69de61d8849cb1043a45a00d78c0e272032e6ec397bc63505eeeb62` |
| `client/client.js` | `be740d4a5ffd8adb5bd498c470b47fa32bb3745bdaf624f56f94b7c76b64e323` |
| `schema/board.schema.json` | `d6c62e097e7ccac7b74a90e97576149c697fa34bbcbeea93dfbf5fa85eb1d230` |
| `index.js` | `e8e85c0a44ad7199d22586e9e4df2974158aac322f27f0a5f0d53a4bd02164d2` |

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
