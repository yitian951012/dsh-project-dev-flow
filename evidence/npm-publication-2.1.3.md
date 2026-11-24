# npm 发布记录：`@yitian951012/dsh-project-dev-flow@2.1.3`

> 记录时间：2026-11-24 · 方式：只读核对 registry 与本地构建物（未执行发布）
> 结论：**2.1.3 已在 registry 上**（`latest = 2.1.3`），其产物对应提交 **`766de1b`**（不是 tag `v2.1.3` 的 `4702071`）；`2.1.1` / `2.1.2` 仍未发布。

## 1. registry 事实（`npm view` 与 tarball 下载核对）

| 项 | 值 |
| :--- | :--- |
| `versions` | `0.0.0-stage`、`2.0.2`、`2.1.0`、`2.1.3` |
| `dist-tags.latest` | `2.1.3` |
| `2.1.3` `gitHead` | `766de1b70cf231dfaa7640b032f7b458fb844459` |
| `2.1.3` `dist.shasum`（SHA1） | `fc5e234ce4fe6fcfddf59891ce3d4e81953e96a3` |
| `2.1.3` `dist.integrity` | `sha512-i3WPgas4P912OEczsvz0qBkZKUOgTWctXnFdp0L7L4Z0X3mX3YUZm59J86IYgGqMrL/6LpI0RmRFrp3lBkXtGQ==` |
| `2.1.3` `dist.fileCount` / 下载字节 | 78 files / **200217** B |
| 下载后重算 SHA1 | `fc5e234c…`（与 `dist.shasum` 一致） |
| 下载后重算 SHA256 | `77381acf9b1585ecf5dc8b417c60b557535f51090d62ee0e899df2e113952a1f` |
| `2.1.1` / `2.1.2` | **E404**（registry 无此版本，无 `dist.shasum` 可比） |

## 2. 产物与 tag 的偏离（必须记录）

`v2.1.3` tag 指向 `4702071`；registry 的 `gitHead` 是它的**后继提交** `766de1b`（补录 `evidence/release-2.1.2.*` 与 `evidence/README.md` 索引的那次提交）。

| 构建物 | 来源 | 文件数 | 字节 | SHA1 | SHA256 |
| :--- | :--- | :---: | ---: | :--- | :--- |
| **npm 已发布产物** | 从 registry 下载 | 78 | 200217 | `fc5e234ce4fe6fcfddf59891ce3d4e81953e96a3` | `77381acf9b1585ecf5dc8b417c60b557535f51090d62ee0e899df2e113952a1f` |
| tag `v2.1.3` 树构建物 | 本地 `npm pack`（`4702071`） | 76 | 197789 | `50dbb35ac0d24d5ae7e9a0fa837f2f1d55f98ff9` | `8f1fa3cec17f2a4a327614c24f431984f3a3109cb697d9007efdfd48981268ca` |

差异恰为两个文件：`evidence/release-2.1.2.json`、`evidence/release-2.1.2.md`。

**判定**：npm 上的 2.1.3 = `766de1b` 的树；`v2.1.3` tag 的树比它少两份证据。两者都不是「错包」，但不能声称「tag 与 npm 产物逐字节一致」。若要对齐，只有两条路：移动 tag（改写已发布 tag，破坏性）或让后续版本以 tag 树发布——本次两条都不做，先记录事实。

## 3. 对 Release 附件的影响

| Release | 应挂的产物 | 与 `dist.shasum` 的关系 |
| :--- | :--- | :--- |
| `v2.1.3` | **npm 已发布字节**（200217 B，`fc5e234c…`） | **一致**（已核对） |
| `v2.1.1` | tag `v2.1.1`（`8c84fbe`）的本地构建物：177500 B，SHA1 `b64fd9d0…`，SHA256 `e0136166…` | **无法比对**：registry 无该版本 |
| `v2.1.2` | tag `v2.1.2`（`6b5dd3c`）的本地构建物：186698 B，SHA1 `406b6f9d…`，SHA256 `e226a1e6…` | **无法比对**：registry 无该版本 |

## 4. 未执行项

- `2.1.1` / `2.1.2` 发布到 npm：**未执行**（需 6 位 TOTP 或 Automation token；发布顺序与 `latest` 策略需人定）。
- 移动 `v2.1.3` tag 使其与 npm 产物逐字节一致：**未执行**（改写已发布 tag，属破坏性操作，需人授权）。
