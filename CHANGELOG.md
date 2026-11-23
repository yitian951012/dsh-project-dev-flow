# CHANGELOG

## 2.1.3 — 2026-11-23

**修正发布：15 项（12 项文档与声明口径 + 3 项门禁/校验器）。不改 preset id、5 个技能与六阶段判定口径，不新增能力，不移动 `v2.1.2` tag。npm 仍未发布本版（registry 最新版是 `2.1.0`）。**

### 修正（12 项文档与声明口径）

1. **`engines.node` 收紧为 `^24.22.3 || >=26.13.1`**：2.1.2 的 `>=24.22.3` 会放行 `25.x` 这类未适配运行时；新值的语义是 `^24.22.3`（`24.22.3`–`24.x`）或 `>=26.13.1`（`26.13.1` 及以上，不设上界）。对齐 DSH `0.2.3-alpha.2` 的 Node 硬要求（`docs/upgrade-guide/v0.2.3-alpha.1/node-24-22-3`）。用 npm 自带 semver 复核：`24.22.3` true、`25.8.0` false、`26.13.1` true、`26.0.0` false。
2. **`engines.node` 的引入版本改正**：该字段首次出现在 **2.1.2**，不是 2.0。`MIGRATION.md` 的 1.x→2.0 对照表里原本把它写成 2.0 的产出，现移出该表，改为表下注记「2.1.2 起」。
3. **`0.3.0` 边界写准**（README / DETAIL / MIGRATION / 本文件）：`0.3.0` 正式版被拒，但 `0.3.0-alpha.x` 因 DSH 以 `includePrerelease` 判定仍会装入且未验证。同一区间 `>=0.2.2-rc.1 <0.3.0` 的 semver 复核：`0.2.3-alpha.2` 默认 false / `includePrerelease` **true**；`0.3.0-alpha.1` 默认 false / `includePrerelease` **true**；`0.3.0` 两种判定都 false。
4. **Cordis 版本改正**：`0.2.3-alpha.2` 实际装配 `@deepseek-ai/cordis@4.2.0-alpha.1`（`resources/app.asar` 内 assembly 清单的 `sharedPackages`）；`4.0.0-rc.12` 属 `0.2.3-alpha.1` 时期。2.1.2 条目原写作 `4.0.0-rc.12`，是错的。
5. **「已校验运行时」口径**：`0.2.2-rc.5` 只保留为历史验证点，并注明**没有 `dsh --version` 记录**可查；现行校验点 `0.2.3-alpha.2` 有 `dsh --version` → 输出 `0.2.3-alpha.2`、exit 0 的记录。
6. **npm 通道限定**（README / DETAIL）：npm 上目前是 `2.1.0`，`2.1.1` / `2.1.2` / `2.1.3` 只在仓库、尚未发布；`dsh plugin … add @yitian951012/dsh-project-dev-flow` 这条命令现在装到的仍是 `2.1.0`。
7. **测试与打包计数一律带树标签**：不再出现无树名的计数。2.1.3 源树（工作树，`node --test` 与 `npm pack --dry-run` 实测，命令见下「验收状态」）为 `tests 170` / `suites 38`、`test:source 2`、pack 72 files（在 2.1.3 证据入库之前）；2.1.3 初始树为 `tests 168` / `suites 37`，随后契约测试与校验器单测共补入 2 条。
8. **DETAIL 标题版本区间**：「读取与工具面（2.1.0）」改为「读取与工具面（2.1.0–2.1.3）」，不再读成只覆盖 2.1.0。
9. **`隔离开户` → 隔离 profile**：2.1.2 条目里的错字改正（其余 `隔离 profile` 用法一致）。
10. **MIGRATION 新增「关于 2.1.3」**小节：修正项、tag 不动、`engines.node` 收紧、npm 未发布。
11. **README / DETAIL 的 Node 声明与 `engines.node` 同步**：当前值都写成 `^24.22.3 || >=26.13.1`；历史值 `>=24.22.3` 只在标注「2.1.2 旧值」时出现。
12. **2.1.2 条目与口径同步**：该条目的 `165` / `70 files` 保留但标注所属树（2.1.2 树，提交 `12e92c8`；pack 数在该版证据入库前），并同步 Cordis 与 Node 的改正结论。

### 修正（3 项门禁 / 校验器）

13. **`verify.mjs` 计数器兼容 Node 24**：解析正则由 `^# <key> <n>` 扩为 `^(?:# |ℹ )<key> <n>`——DSH 0.2.3 自带 Node 24 的 reporter 输出 `ℹ tests`，旧正则使 `test` 步骤的计数**静默为空**，这正是 2.1.2 证据沿用 165 的根因。同时新增 `resolveDshVersion()`（优先 `DSH_FLOW_TARGET_DSH`，否则 `dsh --version`，都拿不到则 `null`），把运行时版本注入 validate 步骤环境，`--json` 载荷新增 `dshVersion`；解析不到时写入 `notVerified`，不静默放过。
14. **`release-evidence.mjs` 输出 `engines.node`**：生成的发布证据此前只打印 `engines.dsh`，会静默漏掉 Node 地板；现补一行。
15. **`engineSatisfies` 支持 `||` 并集与 `^x.y.z`（major ≥ 1）**，并修复 `compareSemver` 的三段补齐缺陷：原先 `25` 与 `25.0.0` 比较时会把 `undefined` 当数值（`<25` 会误放行 `25.x`）。`^0.x` 语义与 `^1+` 不同，仍按「宁可报红也不假绿」返回 false。新增单测钉住：`^24.22.3 || >=26.13.1` 接受 `24.22.3`/`26.13.1`、拒绝 `24.22.2`/`25.8.0`/`26.12.0`。
16. **`release-evidence.mjs` 的 YAML 解析器探针改直读清单**：原先 `node -p "require('./node_modules/yaml/package.json')"` 在本包 `"type": "module"` 下解析失败，导致发布证据里「包内 YAML 解析器」永久显示「未验证」；现直接读文件，实测报 `2.9.1`。

### 验收状态（如实披露）

- 文本与计数复核：`node --test tests/validate-package.test.mjs tests/check-patch-yaml.test.mjs tests/section.test.mjs tests/contract-consistency.test.mjs` → `tests 170` / `suites 38`、exit 0；`node --test tests/source-integration.test.mjs` → `tests 2`、exit 0；`npm pack --dry-run --json --ignore-scripts` → 72 files、exit 0。
- 门禁全链：`node scripts/verify.mjs` → exit 0（validate / sources / lock / patch / test / test:source / pack 七步全绿），尾部打印「目标 DSH 运行时：0.2.3-alpha.2（validate 已比对 engines.dsh）」。
- 运行时记录：`dsh --version` → `0.2.3-alpha.2`、exit 0；`node -v` → `v24.22.3`。
- registry：`npm view @yitian951012/dsh-project-dev-flow versions dist-tags --json` → versions `["0.0.0-stage","2.0.2","2.1.0"]`、`latest: 2.1.0`。
- 真实会话的技能自动路由与 slash 在 `0.2.3-alpha.2` 上：**未重跑**（`evidence/acceptance-2.1.1-*` 出自 0.2.2 时期），本版不据此宣称路由通过。

## 2.1.2 — 2026-11-23

**运行时适配版：只对齐 DSH `0.2.3-alpha.2` 的版本声明与证据，不新增能力、不改 preset id、5 个技能与六阶段判定口径（DEC-013）。本版未发布到 npm：registry 最新版仍是 `2.1.0`。**

### 适配

- **运行时实测**：在 `dsh 0.2.3-alpha.2`（Node 地板 `24.22.3`）上完成隔离 profile 装配烟测（安装 / `--dump-config` / preset 装配 / 卸载回滚，12 项断言全过）与包内门禁（validate / sources / lock / patch / 测试 / 作者侧测试 / 打包面；计数按树计入——2.1.2 树（提交 `12e92c8`）：`tests 165`、`test:source 2`、pack 70 files（2.1.2 证据入库前））。
- **`engines.dsh` 保持不变**：`>=0.2.2-rc.1 <0.3.0`。DSH 的版本门禁用 `semver.satisfies(runtime, range, { includePrerelease: true })` 判定，因此 `0.2.3-alpha.1` / `0.2.3-alpha.2` 已被覆盖，`0.3.0` 正式版仍被拒绝；但同一判定也放行 `0.3.0-alpha.x`——它们会装入且未验证（2.1.3 起在 README / DETAIL / MIGRATION 统一写明）。新增契约测试钉住该区间，防止被顺手放宽或收紧。
- **新增 `engines.node >=24.22.3`**：对齐 DSH 0.2.3 的硬要求（`dsh-v0.2.3-alpha.2` 的唯一变更就是这条 Node 地板，`docs/upgrade-guide/v0.2.3-alpha.1/node-24-22-3`）。这个值本身不够精确：`>=24.22.3` 会放行 `25.x` 等未适配运行时，2.1.3 已收紧为 `^24.22.3 || >=26.13.1`（`24.x` 用 `24.22.3+`，`26.13.1` 及以上）。
- **兼容声明更新**：README / DETAIL / MIGRATION 的「已校验运行时」由 `0.2.2-rc.5` 改为 `0.2.3-alpha.2`，并写清 Node 前置条件；`0.2.2-rc.5` 保留为历史验证点，但该点没有留下 `dsh --version` 记录，不能当作当前校验依据（2.1.3 起明确标注）。
- **DSH 0.2.3 变更面复核**：Cordis 实际装配 `@deepseek-ai/cordis@4.2.0-alpha.1`（本条原写作 `4.0.0-rc.12`，那是 `0.2.3-alpha.1` 时期的版本，2.1.3 已改正；YAML 解析与配置校验随之变化）下，本包 `cordis.patch.yml` 的 `insert` 与 `!!js` 表达式仍被保留（隔离 profile `--dump-config` 可见 `customSkillDirs`）；工具失败结果统一携带结构化错误码后，`final.reason.error.code` 仍为 `MISSING_CREDENTIAL`，验收脚本的事件解析不受影响；`working_directory` 等被移除的工具本包未声明。

### 未变

- preset id `project-dev-flow`、5 个技能、3 自动 / 2 显式分工、六阶段判定口径、方法 / 模板 / 案例均不变；除 `engines.node` 外无新声明。

### 验收状态（如实披露）

- 隔离 profile 装配烟测：**已实测通过**（`node scripts/smoke-profile.mjs` exit 0）。
- 包内门禁：**已实测通过**（`node scripts/verify.mjs` exit 0；2.1.2 树（提交 `12e92c8`）：`tests=165 pass=165`、`test:source` 2/2、pack 70 files（2.1.2 证据入库前））。
- 真实会话中的技能自动路由与 slash 调用在 `0.2.3-alpha.2` 上：**未重跑**（`evidence/acceptance-2.1.1-desktop.*` 出自 0.2.2 时期）；本会话仅证明 preset 装配与技能加载可用，不据此宣称路由通过。

## 2.1.1 — 2026-11-20

**正确性与证据闭环修正：不新增内容能力，不改 preset id、5 个技能与六阶段判定口径。把上一轮「静态全绿但语义仍漂移」的缺口逐条钉死。本版未发布到 npm：registry 最新版仍是 `2.1.0`。**

### 修正

- **按节读取入口**：`scripts/section.mjs` 改为先校验原始字符串（`/^[1-9]\d*$/`）再转数字，并限制参数个数；`2junk` / `2.9` / `1e2` / 多余参数不再被静默宽化。新增 12 项专项测试（普通 / 边界 / 异常）。
- **独立环境可复现**：把 `yaml@2.9.1` 固定为作者侧 `devDependency`，提交 `package-lock.json`；测试改用包内解析器。移除宿主 DSH 解析器环境变量后，此前 51 项中 1 项失败，现在全绿。新增 `check:patch:ci` 强制 `--require-yaml`。
- **来源完整性三态**：`check:sources` 在找不到 docs/ 时不再输出「✔ sources 一致 0/0」，改为「⚠ 未验证」；新增 `--require-docs` 让作者 / CI 缺源文档即失败。默认 `check:sources` 使用强制模式，另设 `check:sources:portable` 供安装态使用。
- **targets 路径穿越**：lock 结构校验拒绝绝对路径、盘符、反斜杠、空段、`.` 与 `..`；存在性检查再加 package 根 containment。`methods/../package.json` 不再能冒充方法落点。
- **凭据扫描**：取消凭据规则的「否定语 / 引号」豁免（`禁止提交 …` 不再安全通行）；新增 AWS Secret Access Key、`github_pat_`、GitLab PAT、Slack Token 形态；扫描范围从内容资产扩展到 README / AUTHORING / MIGRATION / CHANGELOG / detail / locale / config / evidence 等实际发布文件面。
- **主密钥忽略**：根与插件 `.gitignore`、`.npmignore` 补 `.secret-key` 与 `.secret-key.bak-*`（`*.key` 不匹配这类点开头的轮换文件）。
- **profile 契约对齐**：模板、字段表与机读示例统一「一键门禁」（`command:gate`）与「验收清单」（`doc:acceptance-checklist`）字段；机读示例删除与模板互斥的 `proxySignoff`。
- **受理双写**：`project-intake` 第 8 步改为「已明确不做 / 尚未决定」二选一归口，删除与 `不得双重记账` 自相矛盾的「一律写入」。
- **按节读命令**：`project-dev-flow` 第 1/7/8 步的裸方法名改为完整可执行命令。
- **验收路由**：`project-acceptance` 不再要求「必须走本技能」，改为「必须执行验收判据；未显式调用则按 methods 执行并标注技能未加载」。
- **算力预算**：隔离 profile 的 `--dump-config` 实测发现，2.1.0 声称关闭的三簇（`tool-subagent-fork` / `workflow-ptc` / `tool-workflow`）即使写 `disabled: true` 也会被宿主预设合并逻辑丢弃（组内、列表顶层、带不带 `config` 都一样）——等于「看起来关了、实际没关」。本版把这三项从 preset 中移除（不安装即不占工具块），只保留实测生效的 `tool-schedule`；新增 `PATCH-TOOL-DISABLED`（该工具被重新启用即失败）与 `PATCH-TOOL-INEFFECTIVE-DISABLE`（把不生效的关闭声明加回来即失败）。
- **表达式门禁**：新增 `PATCH-JS-EXPRESSION`，`!!js` 只允许平台判定与包内 skills 路径解析；child_process / exec / spawn / eval / Function / fetch / process.env / 文件读写一律拒绝。检查前移到结构早退之前，坏结构也会被查。
- **写入口径**：DETAIL / MIGRATION 改为「安装与卸载本身不写目标项目；运行时 agent 经授权可写回，回滚不撤销已发生的项目修改」。
- **AUTHORING 发布口径**：不再自称「不对外发布」，改为「面向内容维护者、随包发布、不进入默认会话上下文」。
- **源文档母本**：`docs/34` 的安装 / 维护段增加现行口径并把三文件表述标为 2026-10 历史记录；来源锁按内容重评审后重算。

### 新增

- `tests/contract-consistency.test.mjs`：把上述语义矛盾转成回归测试（双写、裸命令、验收路由、profile 同构、AUTHORING 口径）。
- `npm run verify`（统一管道）、`npm run evidence`（发布证据清单）、`npm run metrics`（声明面积对照）。
- `npm run acceptance`（`scripts/acceptance-session.mjs`）：真实会话验收——用 `--patch` 临时挂载包内技能，跑两条自动路由任务 + 一条 slash 任务，断言命中 `project-docs` / `project-intake` / `project-acceptance`，结果写入 `evidence/acceptance-<版本>.json|md`。

### 验收状态（如实披露）

- 隔离 profile 的安装 / 装配转储 / 卸载回滚 / 2.1.0 → 2.1.1 → 2.1.0 升级回滚：**已实测通过**。
- 技能目录进入运行时配置：**已由 `--patch` 覆盖后的 `--dump-config` 实测确认**。
- 技能自动路由与 slash 调用：**未通过**。本环境 CLI profile 没有可用模型路由（`MISSING_CREDENTIAL: no API key for provider route "deepseek-official"`；关掉 api-key 路由后为 `NO_ADAPTER`），验收脚本 status=blocked，证据见 `evidence/acceptance-2.1.1.json`。该项不能用包内测试替代。

### 兼容

- preset id、5 个技能、3 自动 / 2 显式分工与六阶段判定口径不变；`engines.dsh` 不变。
- 新增的是作者侧开发依赖（`yaml`），不会进入 bundle 运行时依赖。
- 升级按 `MIGRATION.md` 重装并走验证清单；旧会话不热切换。

## 2.1.0 — 2026-11-19

**算力预算发布：人格段二次压缩、技能改为按节读取方法、默认关闭与流程无关的三个工具簇。不改变 preset id、5 个技能与六阶段判定口径。**

### 变更

- **人格段**：去重与合并——事实源、阶段路由、不可退让、交付、资源与占位符各一段，同一约束只出现一次；新增「同一文件同一会话不重复读」。
- **技能读取预算**：新增 `scripts/section.mjs`（按 `## <n>.` 小节切片打印），5 个技能改为「用该脚本按节读 §2 核心判断 + §3 步骤」；实测原来只写「按节读」时模型仍整份读取，必须给出可执行的命令才生效。`§1` / `§4` / `§5` 仍只在对应场景读，同一文件不重复读。
- **工具面**：`tool-schedule`（定时任务）、`workflow-ptc` 与 `tool-workflow`（工作流编排）、`tool-subagent-fork`（子代理 fork）改为默认 `disabled: true`——三者与六阶段判定无关，却始终占用每请求工具块。

### 修正

- **人格段占位符写法**：DSH 的系统提示模板把 `{{…}}` 当变量引用，`{{doc:*}}` 会让 preset 装配直接失败（实测报 `malformed prompt variable reference`，整个模式不可用）；改为 `doc:` / `command:` / `role:` 写法，现已由 `PATCH-PROMPT-PLACEHOLDER` 在 `npm run check:patch` 与 `npm run validate` 两处拦截（此前确实全绿也拦不住，装配冒烟仍是覆盖宿主侧的唯一确认）。
- **project-intake 范围外处置**：此前让「不做清单」与「待裁决项」两处都记，与 methods 的「不得双重记账」互斥规则冲突；现按「已明确不做 → 只记不做清单（写理由与重启条件）；尚未决定 → 只记待裁决项」分工，互斥条文指针改到 `methods/intake-and-decision.md §3`。
- **斜杠手势**：显式调用技能改为提示「单独一行发送 `/project-acceptance`」，写明前后需空格或换行——DSH 的 `/name` 手势要求空白边界，中文里紧贴文字不会注入。

### 兼容

- preset id `project-dev-flow`、5 个技能、3 自动 / 2 显式调用分工与判定口径不变；`engines.dsh` 不变。
- 定时、工作流与子代理 fork 默认不再出现在该模式的工具面；需要恢复时删除对应行的 `disabled: true` 并重装。
- 差异只在读取路径、人格段措辞与工具面，判定口径不变。

## 2.0.3 — 2026-11-18

**措辞与指针修正发布：人格段压缩去重、5 个技能说明改为触发语前置、资源与占位符解析规则成文、旧包名引用清理。不新增功能与运行时依赖，preset id 与调用方式不变。**

### 变更

- **人格段**：去掉与技能、方法重复的表述——同一约束只在一处写，细则指向对应技能或方法；保留身份 / 事实源分权 / 阶段路由 / 不可退让 / 交付口径五段，判定口径不变。
- **技能说明**：5 个 `SKILL.md` 的 `description` 改为先写触发条件、再点明用途；`name`、`whenToUse`、`disable-model-invocation` 未变，3 个可自动路由 / 2 个仅用户显式调用的分工不变，每条仍受 AUTHORING §4 的字数上限约束。

### 新增

- **资源路径解析**：技能内引用包内资产写成相对路径（`../../methods/…`、`references/…`、`../../templates/…`），并写明解析基准是引用者自身的 base 目录；不依赖宿主工作目录或包安装位置。
- **占位符解析**：`{{doc:*}}`、`{{command:*}}`、`{{role:*}}` 由项目 profile 解析；缺值写「未配置」并进入「未验证」，不编造命令、路径、签认人，也不照搬其他项目的命令与门禁。

### 修正

- **旧包名引用清理**：`cordis.patch.yml` 解析包内技能目录的表达式与卸载提示注释改用当前包名 `@yitian951012/dsh-project-dev-flow`；2.0.2 改名时该处仍指向旧包名，安装形态下会解析不到模块。
- **升级文档包名行**：`MIGRATION.md` 的包名行与升级步骤同步为当前包名，旧包名需移除后重装。

### 兼容

- 不新增功能、不改运行时依赖；`engines.dsh` 仍为 `>=0.2.2-rc.1 <0.3.0`，运行时与验证面不变。
- preset id `project-dev-flow`、5 个技能与调用方式（3 自动 / 2 显式）均未变化；已安装 2.0.2 的用户按原方式升级即可。
- 差异只在措辞、指针与包名引用层面：项目侧若依赖了旧措辞或旧包名，需自行复核。

## 2.0.2 — 2026-11-16

**发布元数据调整：改为 npm 公开包，兼容性改为区间。不改变 preset id、技能、方法、模板与案例。**

### 变更

- 包名由 `@local/dsh-project-dev-flow` 改为公开 scope `@yitian951012/dsh-project-dev-flow`，`private: false`，`publishConfig.access: public`。
- 补 `repository` / `homepage` / `bugs` 指向 GitHub 仓库；keywords 增加 `dsh-plugin`。
- `engines.dsh` 由精确版本 `0.2.2-rc.3` 改为兼容区间 `>=0.2.2-rc.1 <0.3.0`：最低适配 `0.2.2-rc.1`，最高适配不含 `0.3.0` 正式版。

### 兼容说明

- 区间表示「不因版本号被直接拒绝」，不等于区间内每个版本都实测过；区间内换版本仍需执行 MIGRATION 的验证清单。
- 低于 `0.2.2-rc.1` 或达到 `0.3.0` 及以上会被版本约束拒绝（`0.3.0-alpha.x` 是例外：DSH 的 `includePrerelease` 判定会让它们装入且未验证，2.1.3 起写明）。
- preset id `project-dev-flow`、包内技能、调用方式均未变化；已安装的 2.0.1 用户不受影响。

## 2.0.1 — 2026-11-13

**修正发布：运行时对齐、工具面收敛、校验门禁拆分与面板展示资源补齐。不改变包名、preset id 与技能调用方式。**

### 兼容

- `engines.dsh` 由 `0.2.2-rc.1` 改为精确版本 `0.2.2-rc.3`，与制作和验证本包时的运行时一致；其它 DSH 版本会被版本约束拒绝，而不是按「大概兼容」放行。
- 升级到其它 DSH 版本需重新验证：模式可选、包内技能可见、两个显式技能可斜杠调用、工具面与 plan-mode 段完整；验证通过后才可调整约束，并在本文件记录验证范围。

### 变更

- **工具面**：子代理控制工具显式配置 `interrupt: false`，不注册 `interrupt_agent`；模式不给 agent 额外的强行中止入口，子代理按任务边界自然收敛。
- **计划模式**：`plan-mode` 的 `section` 改用官方预设全文，不再自行改写措辞；官方更新该段时需同步，避免内置文本漂移。
- **来源映射口径**：`sources.lock.json` 的 `disposition` 按统一口径判定——`method` / `template` / `case` 必须有可定位的 `targets`，`evidence` / `not-migrate` 必须在 `note` 写明不迁移理由；`doc:` 只写文件名去扩展名，`case:` 只写案例 id。
- **校验门禁**：bundle patch 的 YAML 结构单独成脚本（`npm run check:patch`）；结构校验与 patch 校验走单元样本，来源登记走集成样本，`npm test` 与 `npm run test:source` 分开执行。

### 新增（展示资源）

- `locale/zh.json`、`locale/en.json`：声明 `meta.title` / `meta.description` / `meta.detail`，指向 `detail/DETAIL.md`；Plugins 面板与详情页无需启用插件即可读取。
- `detail/DETAIL.md`：插件详情页正文——30 秒说明、安装与升级、五个技能入口、边界与维护命令。
- `icon.svg`：插件图标，供插件行与详情页使用。
- README 结构树补齐 `locale/`、`detail/`、`icon.svg`、`CHANGELOG.md`、`MIGRATION.md`。

### 修正

- 新增 `.gitignore`：排除 `node_modules/`、`dist/`、`build/`、`*.tgz`、本地环境与工具缓存；包内运行资产不受影响。
- 新增 `.npmignore`：与 `files` 白名单同一口径的兜底排除项；白名单存在时 npm 仍以 `files` 为准，本文件不改变打包结果。
- MIGRATION 的「已知不兼容」改为「版本对齐与验证边界」，给出可执行的验证清单，不再把「固定版本」写成待放宽的临时状态。
- README 技能表新增「调用方式」列，明确 3 个技能由模型自动路由、2 个技能仅用户斜杠显式调用；正文写明模型不得自动调用后两者。
- 安装段补充精确版本前置条件与「其它版本需重新验证」的指向；维护段补齐 patch 门禁与来源集成样本命令。
- 移除文档中对源文档数量的规模表述，统一改为「源文档去向登记」。

## 2.0.0 — 2026-11-13

**从「单一长人格段」重构为「bundle + preset + 技能 + 方法 / 模板 / 案例」的声明式混合包。**

### 新增

- `skills/`：5 个技能（适配路由、需求受理、文档治理、验收、案例蒸馏），共 10 份 references。
- `methods/`：5 组项目中立方法（事实源与生命周期、需求与决策、设计与不变量、证据与验收、历史与案例）。
- `templates/`：9 份参数化模板（项目档案、文档索引、决策卡、待裁决项、ADR、状态看板、WBS 验收、验证报告、案例卡）。
- `cases/`：3 个真实案例（文档治理收敛、No-Go 到 GO、检查器假绿）。
- `references/adapters/`：本地优先应用适配地图。
- `scripts/`：`validate-package.mjs`（结构 / 红线 / 链接 / 篇幅校验）、`check-sources.mjs`（来源哈希核对）、`gen-sources-lock.mjs`（来源清单生成）。
- `tests/`：校验器的正负样本（每条规则至少一个负例；路由冲突、案例标题、打包缺失与来源空指向已单独补测）。
- `sources.lock.json`：源文档的去向登记（提炼 / 模板 / 案例 / 证据 / 不迁移）。

### 变更

- 人格段缩短为「适配 + 事实源分权 + 六阶段路由 + 不可退让 + 交付口径」，长内容移入技能与 references。
- `skill-filesystem` 通过 `customSkillDirs` 挂载包内技能目录（项目同名技能优先覆盖）。
- 工具面按当前 DSH 预设规范对齐：`plan-mode` 带必填 `section`；子代理使用 `modelSelection` / `modelDiscovery`；移除失效的 `list-agents` 子路径声明。
- 插件管理工具在模式内保持禁用（模式不得自行装卸插件改写宿主）。

### 修正

- 去除旧人格段中的示例项目路径、命令与产品判断。
- 历史证据类技能（验收、案例蒸馏）设为不可自动调用，避免旧结论自动参与当前判断。

### 兼容

- 包名与 preset id 保持不变（`@local/dsh-project-dev-flow` / `project-dev-flow`）。
- `engines.dsh` 固定为实际验证版本 `0.2.2-rc.1`；扩大范围前需重新验证。

### 修正（独立复核后）

- **路由与调用权限对齐**：`project-acceptance` / `project-case-distill` 设为仅用户显式调用后，人格段、总控技能与阶段路由表不再写「自动转」，改为「提示显式调用；未调用则按方法执行并标注技能未加载」。
- **校验器补盲区**：历史证据技能改为显式白名单（不再只靠目录名）；数字红线扩展到 reference / adapter；案例结构改为按标题判定（词面命中不再算通过）；来源清单新增「disposition=template/case 但 targets 为空」拦截；补 4 条负例。
- **字段表收敛**：受理单以 intake-checklist 为唯一字段表（九项）；证据要素以 evidence-chain 为唯一来源（六项）；索引列以 docs-index 模板为准（含 owner）；项目档案以 templates/project-profile.md 为唯一填写格式。
- **模板修正**：案例卡七段重编号；决策卡增加「已被取代 / 已推翻 / 重启条件」；ADR 补收据字段；WBS 拆分「证据类型 / 状态」；看板补复盘阶段；验证报告区分总结论（三值）与逐条结论（四值）。
- **脱敏与诚实性**：校验器与被测定数据不再内嵌参考项目产品名与具体规模；三个案例显式标 `evidence_level: unavailable`，残余风险列改为「当时状态（截至案例时点）」。
- **分发一致性**：`files` 补齐 evidence / tests；README 结构与 registry 说明对齐实际包。

## 1.0.0 — 2026-11-06

初版：单一 `cordis.patch.yml` + 长人格段（六阶段协议、门禁纪律、证据三件套、人工签认边界）。无技能、无模板、无案例。
