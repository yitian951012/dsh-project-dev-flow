# 证据索引（evidence）

> 本目录**不参与默认上下文**，只用于回答「这个案例当时凭什么这样判断」。
> 它不随技能目录加载，也不进入人格段；只有人显式要求溯源时才读取。

## 1. 证据可获得性三态

| 标记 | 含义 | 能否被第三方独立复现 |
| :--- | :--- | :--- |
| `bundled` | 随包提供，可直接核对 | 可以 |
| `external` | 外部可访问（仓库、报告链接） | 可以，但受访问权限影响 |
| `unavailable` | 只有摘要或摘要 + 时点，原始产物未保留 | **不可以**，不得宣称可复现 |

本包当前**没有** `bundled` 级原始证据：三个案例的证据级别均为 `unavailable`（原项目产物与现场未随包发布）。
因此案例正文只写机制、结论与代价，不写「可复现某数字」这类断言。

## 2. 案例溯源表

| 案例 | 证据级别 | 依赖的源文档 | 说明 |
| :--- | :---: | :--- | :--- |
| [文档治理收敛](../cases/docs-governance/case.md) | unavailable | 文档审计、生命周期登记、唯一索引 | 只保留审计结论与索引结构变化 |
| [No-Go 到 GO](../cases/no-go-to-go/case.md) | unavailable | 全量测试报告、复测报告 | 只保留判定逻辑与关注点，不含项目数字 |
| [检查器假绿](../cases/false-green-guard/case.md) | unavailable | 不变量守卫、技术债计划、实测问题 | 只保留失败机制与判别方法 |

## 3. 使用规则

1. 引用证据必须写明级别；`unavailable` 只能作为「当时的判断依据」，不能作为「今天仍然成立」的证明。
2. 不把证据摘录复制进 `methods/` 或 `skills/`：那会把历史数字带进默认上下文。
3. 若要把某条案例升级为通用规则，必须补齐 `bundled` 或 `external` 级证据，并由人类裁决。
4. 新增证据必须脱敏：无绝对路径、无账号、无内网地址、无凭据、无可识别业务数据。

## 4. 与来源清单的关系

每份源文档的去向与哈希记录在 [`../sources.lock.json`](../sources.lock.json)；本目录只登记**证据级别与案例对应**，不复制源文档正文。
源文档变更后先跑 `node scripts/check-sources.mjs`，不一致时重新评审提炼内容，而不是静默更新哈希。

## 5. 发布证据索引（`release-*.json|md`）

`release-evidence.mjs` 在 2.1.1 才引入，因此 2.1.0 及更早没有同类文件。逐版状态：

| 版本 | 文件 | verify 结论 | 基线 commit | tests / pack | Node / 包内 YAML | 三态 | 备注 |
| :--- | :--- | :---: | :--- | :--- | :--- | :---: | :--- |
| `2.1.0` | **无** | n/a | — | — | — | unavailable（不适用） | 发布当时无 `release-evidence.mjs`；可复现证据是 npm 上的 tarball：`shasum 5c10910c…`、`gitHead 3f32e9d`、55 files（`npm view …@2.1.0 dist`） |
| `2.1.1` | `release-2.1.1.json|md` | ok=true | `36640ae` | 165 / 36；68 files | v22.23.0 / 未验证 | bundled | 发布当时生成；该版未发布到 npm |
| `2.1.2` | `release-2.1.2.json|md` | ok=**false** | `6b5dd3c` | metrics 空（该树脚本缺陷）；72 files | v24.22.3 / 未验证 | **unavailable**（事后补录） | 唯一失败原因是 `docs/02` 哈希前移（不可复现）；`patch/test/test:source/pack` 均 exit 0；见文件内「补录说明」 |
| `2.1.3` | `release-2.1.3.json|md` | ok=true | `8e87e98` | 170 / 38；72 files | v24.22.3 / 2.9.1 | bundled | 发布当时生成；**npm 未发布**，`registry latest` 仍是 2.1.0 |

> `pack` 数是「生成证据那一刻的打包面」；证据文件入库后包体变大（2.1.3 现为 76 files）。发布包的指纹以 registry 的 `dist.shasum` 为准，未发布时不作承诺。
