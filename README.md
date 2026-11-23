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
├── package.json              # dsh.bundle.patch + engines.dsh（兼容区间）
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
├── MIGRATION.md              # 从 1.x 升级与版本对齐
├── AUTHORING.md              # 内容生产规范（作者必读）
├── .gitignore                # 仓库忽略：node_modules / dist / *.tgz / 本地环境
└── .npmignore                # 发布兜底：白名单失效时仍不打包产物与本地环境
```

---

## 3. 安装

**前置条件**：DSH 版本区间 `>=0.2.2-rc.1 <0.3.0`（最低适配 `0.2.2-rc.1`，最高适配不含 `0.3.0`），Node `>=24.22.3`（对齐 DSH 0.2.3 的硬要求，已在清单用 `engines.node` 声明）。已校验运行时：`0.2.3-alpha.2`——最近一次在它上面完成结构校验、bundle patch 结构校验、包内测试与隔离 profile 装配烟测（证据见 `evidence/compat-2.1.2-*`）；`0.2.2-rc.5` 为历史验证点。换用区间内其它版本前，先在目标运行时走一遍 [MIGRATION.md](MIGRATION.md) 的验证清单。

在 DSH 的 Plugins 面板中安装本目录（bundle 安装，选择本包所在目录）。
安装后**新开一个会话**，在模式选择器中选择「项目开发流程」。
已存在的会话保留启动时的 preset，不会热切换。

升级：先移除旧包再安装新包。npm 包发布后也可直接安装：`dsh plugin --profile <profile> add @yitian951012/dsh-project-dev-flow`。
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
跨版本升级与回滚用 `node scripts/smoke-profile.mjs --upgrade-from <旧版本.tgz>`（先装旧包 → 装本包 → 回滚，核对版本号）。
未跑真实会话时，只能写「包内验证与隔离装配通过，真实会话行为未验证」。

新增内容前先读 [AUTHORING.md](AUTHORING.md)；源文档变更后必须重新评审提炼内容，而不是静默更新哈希。

版本与变更见 [CHANGELOG.md](CHANGELOG.md)；从旧版升级与版本对齐见 [MIGRATION.md](MIGRATION.md)。
