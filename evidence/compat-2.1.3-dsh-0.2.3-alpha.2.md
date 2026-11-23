# DSH 0.2.3-alpha.2 适配修正证据：`@yitian951012/dsh-project-dev-flow@2.1.3`

> 时间：2026-11-23 · 依据提交：`8e87e98`（前序修正提交 `b03af91`）· 决策：DEC-013 / DEC-014 · 工作区干净
> 结论：**包级适配与门禁已实测通过；真实会话路由未重跑；npm 未发布。**
> 本文件取代 `compat-2.1.2-*` 的声明与计数口径；`v2.1.2` tag 不移动，仅作历史标签。

## 1. 运行环境

| 项 | 值 | 证据 |
| :--- | :--- | :--- |
| DSH | `0.2.3-alpha.2` | `dsh --version` → exit **0** |
| Node | `24.22.3` | `node -v`；`resources/runtime/versions.json` |
| npm / pnpm | `11.19.1` / `11.28.5` | `release-2.1.3.md` |
| 包内 YAML 解析器 | `2.9.1` | `release-2.1.3.md`（探针已修正，不再是「未验证」） |

## 2. 版本门禁与 Node 地板（semver 复核，exit 0）

`engines.dsh = >=0.2.2-rc.1 <0.3.0`（DSH 用 `semver.satisfies(runtime, range, { includePrerelease: true })`）：

| 运行时 | 默认语义 | includePrerelease（DSH 实际） |
| :--- | :---: | :---: |
| `0.2.2-rc.1` | true | true |
| `0.2.3-alpha.2` | false | **true** |
| `0.3.0-alpha.1` | false | **true**（已知边界：会装入但未验证） |
| `0.3.0` | false | **false**（正式版被拒） |

`engines.node = ^24.22.3 || >=26.13.1`（对齐 DSH `docs/upgrade-guide/v0.2.3-alpha.1/node-24-22-3`）：

| Node | 判定 |
| :--- | :---: |
| `24.22.2` | false |
| `24.22.3` | **true** |
| `25.8.0` | **false**（2.1.2 的 `>=24.22.3` 会误放行） |
| `26.0.0` / `26.12.0` | false |
| `26.13.1` | **true** |

## 3. 命令与 exit code

| 检查 | 命令 | 结果 | exit |
| :--- | :--- | :--- | ---: |
| 版本 | `dsh --version` | `0.2.3-alpha.2` | **0** |
| 隔离 profile 装配 | `node scripts/smoke-profile.mjs` | 12 项断言全过（安装 / `--dump-config` / preset / 模式名 / `tool-schedule` disabled / 三簇未声明 / 卸载回滚） | **0** |
| 包内门禁 | `node scripts/verify.mjs` | 七步全绿，`tests=170 pass=170`、`test:source 2/2`、pack 72（证据入库前），尾部打印「目标 DSH 运行时：0.2.3-alpha.2」 | **0** |
| 发布证据 | `node scripts/release-evidence.mjs` | `commit=8e87e98`、`clean=true`、`yaml=2.9.1` | **0** |
| semver 复核 | npm 自带 semver 探针 | 见 §2 | **0** |
| 移除工具的引用面 | `git grep -n working_directory -- cordis.patch.yml skills methods templates config` | 无命中（exit 1）；全仓库仅 `CHANGELOG.md`（本次修正说明）与 `evidence/acceptance-2.1.1-desktop.json`（历史 `toolsUsed`） | 1 / — |

## 4. 专家复核项 → 修复对照（13 项）

| 编号 | 原问题 | 本版修复 |
| :--- | :--- | :--- |
| P0-1 | 证据写 `tests=165` / `pack=70` | 2.1.3 证据与 CHANGELOG 全部带树标签：源树 `tests 170` / `suites 38` / `test:source 2` / pack 72（证据入库前）；2.1.2 证据加「更正说明」指向本文件 |
| P0-2 | `verify.mjs` 只认 `# tests`，Node 24 输出 `ℹ tests` | 正则扩为 `^(?:# \|ℹ )<key> <n>`；新增 `resolveDshVersion()` 注入 validate；`--json` 增 `dshVersion`，取不到进 `notVerified` |
| P0-3 | MIGRATION 把 `engines.node` 记成 2.0 已有 | 移出 1.x→2.0 表，改为「2.1.2 起，2.1.3 收紧」注记 + 新增「关于 2.1.3」 |
| P0-4 | `0.3.0` 边界与证据冲突 | 四份文档统一写清正式版被拒 / `0.3.0-alpha.x` 会装入但未验证 |
| P0-5 | Node 地板测试只校验前缀 | 改用 `engineSatisfies` 区间判定（24.22.3 ✓ / 24.22.2 ✗ / 26.13.1 ✓ / 26.12.0 ✗），并把 `0.3.0-alpha.1` 作为已知边界显式断言 |
| P1-6 | `engines.node` 比 DSH 地板宽 | 收紧为 `^24.22.3 \|\| >=26.13.1` |
| P1-7 | `package-lock.json` 停留 2.1.1 | `npm install --package-lock-only` 重新生成 |
| P1-8 | Cordis 版本号错写 `4.0.0-rc.12` | 改为实测 `4.2.0-alpha.1`（`resources/app.asar` assembly `sharedPackages`），`4.0.0-rc.12` 标为 `0.2.3-alpha.1` 时期 |
| P1-9 | `working_directory` 的 grep 断言不实 | 改为精确范围陈述（见 §3 末行） |
| P1-10 | 证据链接包外 `docs/` 断链 | 2.1.3 证据不再链接包外路径，决策号与要点内联 |
| P1-11 | 证据时间戳早于所引提交 | 先提交修正，再在干净树生成证据（`commit=8e87e98`、`clean=true`） |
| P1-12 | 缺 `release-2.1.3` 发布证据 | 补跑 `release-evidence.mjs`，并在其输出中补 `engines.node` 行 |
| P2-13 | 「包内 YAML 解析器」永久未验证 | 改直读清单，实测 `2.9.1` |

## 5. 未验证项（如实披露）

1. **真实会话的自动路由与 slash** 在 `0.2.3-alpha.2` 上**未重跑**（现有桌面证据 `acceptance-2.1.1-desktop.*` 出自 0.2.2 时期，自身结论为 partial）。
2. **npm 发布**：registry `versions` 仍为 `0.0.0-stage / 2.0.2 / 2.1.0`，`latest = 2.1.0`；2.1.1 / 2.1.2 / 2.1.3 均未发布（需 OTP 或 automation token，由人执行）。
3. `0.3.0-alpha.x`：会被装入但没有验证。

## 6. 已知边界

- `engines.dsh` 上界按 DSH 的 `includePrerelease` 判定会放行 `0.3.0-alpha.x`；DEC-013 明确保持区间不收紧，DEC-014 未改变这一点，仅把事实写进四份文档。
- `engines.node` 为 `^24.22.3 || >=26.13.1`：Node 25.x 与 26.0–26.12 被声明拒绝；本包不含运行时 probe，`smoke-profile` 也不校验 `process.version`，因此该声明属「安装时提示」级别，不构成门禁。
