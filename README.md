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
3. 用**方法 / 模板 / 案例**按需加载，不把所有内容塞进人格段；
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
├── scripts/                  # 校验与来源核对（零依赖，仅开发期运行）
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

**前置条件**：DSH 版本区间 `>=0.2.2-rc.1 <0.3.0`（最低适配 `0.2.2-rc.1`，最高适配不含 `0.3.0`）。本包在 `0.2.2-rc.3` 上完成校验；换用区间内其它版本前，先在目标运行时走一遍 [MIGRATION.md](MIGRATION.md) 的验证清单。

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

## 5. 边界（重要）

1. **不代替项目文档。** 项目自己的工程手册与同名技能优先；本插件是缺省值。
2. **不代替人类决策。** 新能力、契约、数据、判据、范围变化必须由决策人裁决；agent 只起草。
3. **不代替人类签认。** 验收签认不可代理；代理签认只能是项目级的显式策略。
4. **不提供强制力。** 插件约束的是行为与措辞，不是 CI 门禁。
5. **不含真实项目的规模与进度。** 方法、模板、技能里不写任何项目的数字；案例只保留机制与陪跑结论。

---

## 6. 维护

```bash
npm run validate       # 结构 + 内容红线 + 链接 + 篇幅
npm run check:sources  # 源文档哈希是否漂移
npm run check:patch    # bundle patch 的 YAML 结构门禁
npm test               # 结构校验与 patch 校验的单元样本
npm run test:source    # 来源登记集成样本
```

新增内容前先读 [AUTHORING.md](AUTHORING.md)；源文档变更后必须重新评审提炼内容，而不是静默更新哈希。

版本与变更见 [CHANGELOG.md](CHANGELOG.md)；从旧版升级与版本对齐见 [MIGRATION.md](MIGRATION.md)。
