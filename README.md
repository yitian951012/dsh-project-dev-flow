# 插件交付说明

`dsh-project-dev-flow` 是一个 **DSH bundle + agent preset + 技能包**：
在会话模式选择器里提供「项目开发流程」，把一套经过真实项目校正的开发治理方法，按需加载到 agent 的上下文里。

- **不是** 源文档的打包副本；
- **不是** 一个替你决定范围与优先级的产品经理；
- **不是** 强制门禁 —— 真正的门禁在项目自己的命令、CI 与人的签认。

插件详情页见 [detail/DETAIL.md](detail/DETAIL.md)。

---

## 1. 五秒钟说明

选中「项目开发流程」后，agent 会：

1. 先做**项目适配**：只读确认命令、文档、角色与证据规则，找不到就标「未验证」；
2. 按**六阶段**路由：需求受理 → 设计定型 → 实现 → 验证 → 交付 → 复盘；
3. 用**方法 / 模板 / 案例**按需加载：方法只按节读 §2 核心判断与 §3 步骤，其余按场景读；不把所有内容塞进人格段或上下文；
4. 交付时只写「候选完成 + 证据链 + 剩余风险」。

---

## 2. 资产结构

```text
dsh-project-dev-flow/
├── cordis.patch.yml          # bundle patch：一个 preset + 工具面 + 包内技能目录
├── package.json              # dsh.bundle.patch + engines.dsh（兼容区间）+ engines.node（Node 地板）
├── icon.svg                  # 插件图标（Plugins 面板与详情页使用）
├── locale/                   # 面板显示文案（不进入会话上下文）
│   ├── zh.json               # meta.title / meta.description / meta.detail
│   └── en.json
├── detail/
│   └── DETAIL.md             # 插件详情页：30 秒说明、安装、技能入口、边界、维护
├── skills/                   # 5 个技能（3 个可自动路由 / 2 个仅显式调用）
│   ├── project-dev-flow/     # 适配 + 六阶段路由
│   ├── project-intake/       # 需求分类、需求卡、决策草案
│   ├── project-docs/         # 文档治理：索引、性质、生命周期、漂移审计
│   ├── project-acceptance/   # 验收矩阵、证据包（仅用户显式调用）
│   └── project-case-distill/ # 案例蒸馏（仅用户显式调用）
├── methods/                  # 项目中立方法（判断与协议）
├── templates/                # 参数化模板（占位符，无项目结论）
├── cases/                    # 真实案例（含错误判断与不可外推边界）
├── references/adapters/      # 项目类型适配地图
├── evidence/                 # 证据级别与案例溯源（不进默认上下文）
├── config/                   # 项目档案示例（模板的机读副本）
├── scripts/                  # 校验器；section.mjs 另供技能运行时按节读方法
├── tests/                    # 校验器的正负样本（单元与集成分开）
├── sources.lock.json         # 源文档去向登记（哈希 + 映射口径）
├── README.md                 # 本文件：五秒说明、安装、边界
├── CHANGELOG.md              # 版本与变更
├── MIGRATION.md              # 从 1.x / 2.x 升级到 3.0.0 与现行区间对齐
├── AUTHORING.md              # 内容生产规范（作者必读）
├── .gitignore                # 仓库忽略：node_modules / dist / *.tgz / 本地环境
└── .npmignore                # 发布兜底：白名单失效时仍不打包产物与本地环境
```

---

## 3. 安装

**前置条件**（现行值以包内 `package.json` 的 `engines` 为准）：

- **DSH 版本区间** `>=0.2.3-alpha.2 <0.3.0-0`。下限是**能力下限**，不是保守值：3.0.0 的看板入口依赖 0.2.3 才有的 `sidebar.panellist`，0.2.2 线没有该槽位——装得进、入口不出来，属于静默降级。上限写成 `<0.3.0-0`，是为了让 DSH 的 `includePrerelease` 判定也拒掉 `0.3.0` 的预发布：旧的 `<0.3.0` 会放行 `0.3.0-alpha.x`，而那是未验证宿主（DEC-017）。
- **Node 版本** `^24.22.3 || >=26.13.1`（`24.x` 用 `24.22.3+`，`26.13.1` 及以上且不设上界）。该字段自 2.1.2 起在清单里声明、2.1.3 收紧；旧值 `>=24.22.3` 会放行 `25.x`，不作当前依据。Node 不满足时 `npm install` 报 `EBADENGINE`，DSH 自己也会拒绝启动。
- **已校验运行时** `0.2.3-alpha.2`：`dsh --version` 输出该版本、退出码 0。结构校验、bundle patch 结构校验与包内测试都在该运行时上全绿；隔离 profile 装配烟测的记录在 2.1.2 / 2.1.3；`3.0.0` 本轮（2026-11-26）**已重跑通过（exit 0）**。换用区间内其它运行时仍要按 [MIGRATION.md](MIGRATION.md) 的验证清单自己走一遍。`0.2.2-rc.5` 仅作历史验证点，且没有留下 `dsh --version` 记录，不能当作当前校验依据。

换用区间内其它版本前，先在目标运行时走一遍 [MIGRATION.md](MIGRATION.md) 的验证清单——区间表达的是「不因版本号被直接拒绝」，不是「每个版本都验证过」。

在 DSH 的 Plugins 面板中安装本目录（bundle 安装，选择本包所在目录）。
安装后**新开一个会话**，在模式选择器中选择「项目开发流程」。
已存在的会话保留启动时的 preset，不会热切换。

升级：先移除旧包再安装新包。**npm 上 `latest` 是 `2.1.3`**（2026-11-23T14:33Z 发布，`gitHead 766de1b`）：`dsh plugin --profile <profile> add @yitian951012/dsh-project-dev-flow` 现在装到的就是 `2.1.3`。`2.1.1` / `2.1.2` 也已补发（2026-11-24），但挂在 **`legacy`** dist-tag 上（当前 `legacy = 2.1.2`）；要装它们须显式写版本，如 `…add @yitian951012/dsh-project-dev-flow@2.1.1`。
本仓库的 `3.0.0`（含看板）**尚未发布到 npm**，状态见 §8：从 npm 通道装不到看板版本，要试只能用 GitHub 源或本地目录安装。
卸载：移除 bundle；包内技能与 preset 一并消失，项目自己的 `.dsh/skills`、`.agents/skills` 不受影响。
面板中的标题、描述与详情页来自 `locale/`、`detail/`、`icon.svg`，不需要启用插件即可查看。

---

## 4. 技能一览

包内共 5 个技能：**3 个可由模型按任务自动路由**（`project-dev-flow`、`project-intake`、`project-docs`），**2 个只能由用户以斜杠命令显式调用**（`project-acceptance`、`project-case-distill`）——后两个处理历史证据与复盘结论，模型不得自动调用。

| 技能 | 何时用 | 调用方式 |
| :--- | :--- | :--- |
| `project-dev-flow` | 进入陌生项目 / 需要走完整流程 | 模型可自动路由 |
| `project-intake` | 提需求、改范围、改契约或判据 | 模型可自动路由 |
| `project-docs` | 文档散乱、漂移、需要索引与生命周期治理 | 模型可自动路由 |
| `project-acceptance` | 要交付、要判级、要证据包 | 仅用户斜杠显式调用 |
| `project-case-distill` | 把真实交付整理成案例 | 仅用户斜杠显式调用 |

显式调用示例：`/project-acceptance 帮我判这次能不能交付`

---

## 5. 算力预算

每次请求都在为上下文与工具块付账。2.1.0 从三处收：

1. **人格段只留判定口径**：事实源、阶段路由、不可退让、交付、资源与占位符各一段，同一约束只出现一次。
2. **方法按节读**：技能读方法时只取 §2 核心判断与 §3 步骤；§1 / §4 / §5 只在对应场景读，同一文件同一会话不重复读。
3. **与流程无关的工具不声明**：定时任务（`tool-schedule`）在 preset 内显式 `disabled: true`，已用隔离 profile 的 `--dump-config` 实测保留；工作流编排与子代理 fork 三簇**本包不声明、也无法在 preset 内关闭**——隔离 profile 实测：即使从本包删除，它们仍由宿主预设的默认工具集提供；在 preset 内写 `disabled: true` 会被合并逻辑丢弃。保留声明只会造成「看起来关了、实际没关」，所以本包改为不声明，并在 README 明确这条边界：要关它们只能在宿主 profile 层处理。

按节读必须给可执行命令——只写「按节读」时，模型仍会整份读文件。在本包目录下：

```bash
node scripts/section.mjs design-and-invariants 2 3
```

- 方法名不带扩展名且不含路径分隔符时，按包内 `methods/<方法名>.md` 解析；也可直接传文件路径。
- 省略结束节时只打印该节；退出码 0 成功、1 文件或小节不存在、2 参数错误。

技能内调用同一脚本，写法是 `node <技能base>/../../scripts/section.mjs <方法名> 2 3`。

需要恢复定时任务工具：删除 `cordis.patch.yml` 中 `tool-schedule` 的 `disabled: true` 并重装。变更明细见 [CHANGELOG.md](CHANGELOG.md) 的 2.1.1。

> 工具面能不能真的缩小，以隔离 profile 的 `dsh --profile <name> --dump-config` 为准；`check:patch` 只能证明「声明符合契约」，证明不了宿主会保留它——这正是 2.1.0 声称关闭三簇却未验证的地方。

## 6. 边界（重要）

1. **不代替项目文档。** 项目自己的工程手册与同名技能优先；本插件是缺省值。
2. **不代替人类决策。** 新能力、契约、数据、判据、范围变化必须由决策人裁决；agent 只起草。
3. **不代替人类签认。** 验收签认不可代理；代理签认只能是项目级的显式策略。
4. **不提供强制力。** 插件约束的是行为与措辞，不是 CI 门禁。
5. **不含真实项目的规模与进度。** 方法、模板、技能里不写任何项目的数字；案例只保留机制与陪跑结论。

---

## 7. 维护

```bash
npm ci                     # 安装作者侧固定依赖（yaml@2.9.1）
npm run verify             # 一条管道跑完：结构 / 来源 / 锁 / patch / 测试 / 打包面
npm run check:patch:ci     # CI 用：缺 YAML 解析器直接失败，不降级
npm run check:sources      # 作者 / CI：缺 docs 即失败（安装态用 check:sources:portable）
npm run smoke:profile      # 隔离 DSH_HOME 安装 → dump-config → 卸载，验装配与回滚
npm run evidence           # 生成 evidence/release-<版本>.json|.md
npm run metrics            # 2.0.1 ↔ 当前的声明面积对照
npm run acceptance -- --profile <name>   # 真实会话验收：技能自动路由 + slash 显式调用
```

`acceptance` 的前置条件是目标 profile 有一条**可用模型路由**（桌面端凭据不会自动注入 CLI）；脚本用 `--patch` 临时挂载本包技能目录，不改宿主 profile。返回码：0 通过、1 未命中、3 被凭据/适配器阻塞。

发布前的最小证据链：`verify` 全绿 + `smoke:profile` 全绿 + 同一 commit 上生成 `evidence`。
**发布通道现状**：registry 的 `latest` 仍是 `2.1.3`（`dist.shasum fc5e234c…`、`78 files`、`gitHead 766de1b`，对应 tag `v2.1.3` = `4702071`）；本仓库 `package.json` 已是 `3.0.0`，并已在本地封板（commit + tag `v3.0.0`，未 push），但**未发布到 npm**（状态见 §8）。`2.1.1`（`b64fd9d0…`、68 files）与 `2.1.2`（`406b6f9d…`、72 files）已于 2026-11-24 补发，挂在 `legacy`（当前 `legacy = 2.1.2`），`latest` 未回退。npm 上 `v2.1.3` 的产物与 tag `v2.1.3`（`4702071`）相差两份证据文件，差异记录在 [evidence/npm-publication-2.1.3.md](evidence/npm-publication-2.1.3.md)。
跨版本升级与回滚用 `node scripts/smoke-profile.mjs --upgrade-from <旧版本.tgz>`（先装旧包 → 装本包 → 回滚，核对版本号）。
未跑真实会话时，只能写「包内验证与隔离装配通过，真实会话行为未验证」。

新增内容前先读 [AUTHORING.md](AUTHORING.md)；源文档变更后必须重新评审提炼内容，而不是静默更新哈希。

版本与变更见 [CHANGELOG.md](CHANGELOG.md)；从旧版升级与版本对齐见 [MIGRATION.md](MIGRATION.md)。

---

## 8. 看板（3.0.0，只读）

3.0.0 起本包多一个 Web 半边：侧栏出现「项目看板」入口，面板按工作空间读取该工作区的看板数据。

**发布状态（2026-11-26）**：`3.0.0` 已在**本地封板**——**已 commit + tag `v3.0.0`（本地），未发布 npm、未 push**，npm 上不存在。npm `latest` 仍是 `2.1.3`，所以 npm 通道装不到看板；只有 GitHub 源或本地目录安装才会拿到它。阻塞项是两项真实页面验证：登录态里点开面板的实际出数、卸载后刷新页面侧栏条目是否消失。包内门禁与隔离 profile 装配（`smoke:profile`，2026-11-26 本轮重跑 exit 0）均全绿，真实会话行为**未验证**。

**数据从哪来**：`node scripts/import-board.mjs --root <工作区根>` 解析 `docs/` 里的五类台账，产出 `.dsh/project-board/board.json`。表头签名优先于文件名，认不出的表跳过并计数，**不猜、不编**；同一输入两次导入字节一致，内容未变不写盘，`--check` 在漂移时 exit 1。

**agent 侧**：`project_board` 工具只有两个只读动作——`action=list` 返回某个项目的分线进度与未完成条目（上限 40 条），`action=projects` 列出已配置项目；不写盘、不改 docs。写通道（拖拽、move/undo、锁与 CAS）在 **3.1.0**，本版不提供。

**边界**：看板是派生视图，docs 仍是唯一事实源；看板不回写 docs，也不在 3.0 里接受任何写入。

### 8.1 配置多个项目

看板按**项目注册表**取数，每条只认一个绝对路径。有两个来源，合并规则明确：

1. **面板绑定**（推荐）：弹窗里选目录并校验后，写入 `<profile>/plugin-data/yitian951012.dsh-project-dev-flow/projects.json`。这是绑定数据的**唯一事实源**，原子写，刷新页面即生效，不需要重装插件。
2. **手写默认**（可选）：写在用户 profile 的 patch 层（`<profile>/cordis.patch.yml`，按 id 定向覆盖）。适合随 profile 一起版本化的固定项目。

合并时按 `resolve(root)` 去重，**手写默认优先**；同一个路径不要两处都配。不要写进包内 `cordis.patch.yml`——包内会被重装/升级覆盖，还会把本机路径带进发布物。

```yaml
# <profile>/cordis.patch.yml
- id: project-dev-flow-board
  name: '@yitian951012/dsh-project-dev-flow'
  config:
    projects:
      - root: E:/dsh-workspace/项目管理
        # 可选：name（显示名）、docs、board 覆盖路径（缺省 docs/ 与 .dsh/project-board/board.json）
      - root: D:/work/other-project
        docs: spec
```

规则：`root` 必须是绝对路径；`id` 可选、缺省取目录名；配置里不要写 `- id:` 行（patch 校验器会把任意缩进的 `- id:` 当成插件项并报 PATCH-STRUCTURE）。相对路径与重复 id 会在面板里变成**可读错误**，不影响其他项目。没有配置项目时回落到当前工作空间。

### 8.2 接入一个新项目

```bash
# 1) 自检：识别哪些表能读、缺哪些角色（只读）
node scripts/adapt-project.mjs --root <项目绝对路径>

# 2) 需要钉死映射时才写清单（文件名叫什么都不影响，表头仍须相容）
node scripts/adapt-project.mjs --root <项目绝对路径> --write

# 3) 派生看板数据
node scripts/import-board.mjs --root <项目绝对路径>
```

清单落在 `<项目>/.dsh/project-board/manifest.json`，格式见 `schema/manifest.schema.json` 与 `templates/board-manifest.example.json`。清单只写识别成功的角色；缺的角色不会自动建卡。

项目还没有 `docs/` 时，绑定弹窗默认勾选「自动创建 5 份基础台账」：`scripts/scaffold-docs.mjs` 会生成阶段/WBS/待裁决/剩余问题/下一步五份占位文档（**已存在的文件一律跳过**），生成后即可导入。也可以手动跑：

```bash
node scripts/scaffold-docs.mjs --root <项目绝对路径> --write
```

面板的**按流程节点矩阵**，行不是写死的 8 阶段：

- **行集合来自节点卡**：只有 `kind=stage` / `kind=gate` 的卡片造行，行头标题取卡片；**同一份文档内按 `anchor.line` 升序**即流程顺序（跨文档行号不可比：节点最多的文档为主序列，其余文档整体排在它之后）。节点卡只造行，不计入任何列的张数。
- **编号与顺序要自洽**：行号取 id 末位数字（`STAGE-3`→`03`、`GATE-2`→`G2`），所以 `anchor.line` 的先后应与 id 编号一致；**重排表行或改用自定义 id，编号可能不单调甚至重复**（重复 id 只占一行，后出现的卡片提供标题与状态）。
- **没有节点卡就回退**：固定模板 8 阶段 + 2 门禁 = 10 行。头部「阶段 N / 门禁 M」与图例「N 阶段 + M 门禁」都按**实际行**计算（有节点卡时如 6 阶段 2 门禁，回退时 8/2），不写死。
- **非节点卡按 `derived.stage` 落位**：在清单里加 `stageMap`（键为 id 前缀如 `FE` / `A` / `P`，或完整 id；值为 `STAGE-n`）决定这个值；只有该阶段已经是某一行时才落进去，**没有对应行也不造行**。
- **未归属不渲染**：没有 `derived.stage`（或该阶段没有行）的非节点卡进未归属桶，**矩阵不渲染它**，也不出现「未归属阶段」兜底行（P-5：未归属只是数据桶，不是界面行），**不猜**。

示例：`"stageMap": { "FE": "STAGE-5", "BE": "STAGE-5", "P": "STAGE-7" }`（按你项目自己的语义填）。
