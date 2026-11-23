# DSH 运行时适配证据：`@yitian951012/dsh-project-dev-flow@2.1.2`

> 时间：2026-11-23 · 依据提交：`12e92c8` · 决策：**DEC-013**（[决策登记](../../docs/02_入口_决策登记.md) 由主理人裁决）
> 结论：**隔离 profile 装配与包内门禁在 `0.2.3-alpha.2` 上已实测通过**；真实会话路由未重跑，不据此宣称通过。

## 1. 目标版本

| 项 | 值 | 证据 |
| :--- | :--- | :--- |
| DSH 运行时 | `0.2.3-alpha.2` | `dsh --version` → exit **0** |
| 发布记录 | `dsh-v0.2.3-alpha.1`（2026-11-22 03:19，`d98f5d6`）与 `dsh-v0.2.3-alpha.2`（2026-11-22 11:00，`4b399c3`） | GitHub Releases |
| alpha.2 的唯一变更 | Node.js 地板提到 `24.22.3`（24.x）/ `26.13.1`（26.x） | release notes + `docs/upgrade-guide/v0.2.3-alpha.1/node-24-22-3` |
| 运行时自带 Node | `24.22.3`（pnpm `11.28.5`） | `resources/runtime/versions.json` |

## 2. 版本门禁为什么不用改 `engines.dsh`

DSH 的兼容判定实现在 `packages/boot/app-boot/src/plugin-compatibility.ts`：

```ts
semver.satisfies(runtimeVersion, range, { includePrerelease: true })
```

对 `>=0.2.2-rc.1 <0.3.0` 的实测判定：

| 运行时版本 | 默认 semver | DSH 实际口径（includePrerelease） |
| :--- | :---: | :---: |
| `0.2.3-alpha.1` | false | **true** |
| `0.2.3-alpha.2` | false | **true** |
| `0.3.0` | false | false |

所以 `engines.dsh` 保持原区间即可覆盖 0.2.3 预发布；真正需要补的是 **Node 地板**（`engines.node >=24.22.3`）。

## 3. 实测清单（命令 + exit code）

| 检查 | 命令 | 结果 | exit |
| :--- | :--- | :--- | ---: |
| 安装 + 装配 + 回滚 | `node scripts/smoke-profile.mjs` | 12 项断言全过（含 `tool-schedule` 保留 `disabled`、三簇未被声明、卸载后 preset 消失） | **0** |
| 包内门禁 | `node scripts/verify.mjs` | validate / sources / lock / patch / test（165 pass）/ test:source（2 pass）/ pack（70 files） | **0** |
| 隔离开户安装 + dump | `dsh plugin --profile probe add <本包目录>` → `--dump-config` | 安装 `@yitian951012/dsh-project-dev-flow 2.1.2`；`customSkillDirs` 的 `!!js` 表达式原样保留 | **0 / 0** |
| CLI 事件契约 | `dsh --profile headless --json "只回复两个字：可以"` | `final.reason.error.code = MISSING_CREDENTIAL`（未因 0.2.3 的错误码统一而改名）；exit 1 属凭据缺失 | **1**（符合预期） |
| 方法按节读 | `node scripts/section.mjs truth-and-lifecycle 2 3` | 正常输出 §2/§3 | **0** |
| 契约测试（先红后绿） | `node --test tests/contract-consistency.test.mjs` | 实现前 2 条断言失败 → 实现后通过 | **1 → 0** |

## 4. DSH 0.2.3 变更面复核（与本包相关）

| 变更（alpha.1） | 对本包的影响 | 实测 |
| :--- | :--- | :--- |
| Cordis 同步 `4.0.0-rc.12`，YAML 解析与配置校验调整 | `cordis.patch.yml` 的 `insert` 与 `!!js` 表达式是否有变 | 装配烟测 + 隔离开户 dump 均通过，表达式原样保留 |
| 工具失败结果统一携带结构化错误名/错误码，部分改名 | 验收脚本解析 `final.reason.error.code` | 仍为 `MISSING_CREDENTIAL`，解析未失效 |
| 移除 `working_directory` 与委派 cwd 参数 | 本包 preset 未声明该工具 | 仓库内无引用（`git grep` 无命中） |
| `--patch` 覆盖在 HMR 下无需重启 | 验收脚本用法不变 | 未改脚本 |
| 模块导出入口规范化、测试专用导出移除 | 本包不引用 DSH 源码类型 | 无影响 |

## 5. 未验证项（如实披露，不据此宣称通过）

1. **真实会话的技能自动路由与 slash**在 `0.2.3-alpha.2` 上未重跑：`evidence/acceptance-2.1.1-desktop.*` 的会话出自 0.2.2 时期；本会话只能证明 preset 装配、技能目录与手动加载可用。要补这项，按该文件的复现方法在看板重跑三张卡。
2. `0.3.0` 及以上：区间外，按设计拒绝。
3. 区间内其它版本：未逐个实测，按 `MIGRATION.md` 的验证清单走。

## 6. 已知边界

- `engines.dsh` 由 DSH 以 `includePrerelease` 判定，因此 `0.3.0-alpha.x` 也会落在当前上界内；DEC-013 明确**保持区间不收紧**，此边界记录在案。
- `engines.node >=24.22.3` 会让 Node 22 环境执行 `npm install` 时收到 `EBADENGINE` 警告（不阻断安装）；DSH 自身运行时已带 Node 24.22.3。
