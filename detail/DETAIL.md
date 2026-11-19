# 项目开发流程

## 30 秒说明

「项目开发流程」是一个 DSH bundle。安装后，模式选择器里会多出一个同名模式；选中它，agent 先只读适配目标项目，再按需求受理 → 设计定型 → 实现 → 验证 → 交付 → 复盘推进。

它的产出是「候选完成 + 证据链 + 剩余风险」，不是一句「已经做完」。方法、模板与案例按需加载，不常驻人格段：方法只按节读 §2 核心判断与 §3 步骤，不整份读；插件不写入目标项目文件，除非你明确要求生成项目档案。

## 安装

**前置条件**：DSH 版本区间 `>=0.2.2-rc.1 <0.3.0`。本包在 `0.2.2-rc.5` 上完成校验（结构校验、patch 结构校验、包内测试与装配冒烟）；区间内换版本前，先在目标运行时重新验证，见包根 `MIGRATION.md`。

安装方式：

- npm 包：`dsh plugin --profile <profile> add @yitian951012/dsh-project-dev-flow`
- GitHub 源：`dsh plugin --profile <profile> add github:yitian951012/dsh-project-dev-flow`

1. 在 DSH 的 Plugins 面板中以 bundle 安装方式选择本包目录。
2. 安装后新开一个会话——已有会话保留启动时的模式，不会热切换。
3. 在模式选择器中选择「项目开发流程」。
4. 验证：模式可选中；技能目录出现包内技能；`/project-acceptance` 可显式调用；在包目录执行 `node scripts/section.mjs design-and-invariants 2 3` 能打印该方法 §2–§3。

升级：先移除旧包，再安装新包。卸载：移除 bundle，包内技能与模式一并消失；项目自己的 `.dsh/skills`、`.agents/skills` 不受影响。

## 读取与工具面（2.1.0）

- **方法按节读**：技能读方法只取 §2 核心判断与 §3 步骤，靠一条可执行命令，而不是一句提示——在包目录执行 `node scripts/section.mjs <方法名> 2 3`；裸方法名按包内 `methods/` 解析。
- **三簇重工具默认关闭**：定时任务、工作流编排、子代理 fork 默认不在本模式的工具面中；需要时在 `cordis.patch.yml` 删除对应 `disabled: true` 并重装。

## 五个技能入口

| 技能 | 何时用 | 调用方式 |
| :--- | :--- | :--- |
| `project-dev-flow` | 进入陌生项目，或任务横跨多个阶段、不确定该走哪条流程 | 模型可自动路由 |
| `project-intake` | 收到新需求、变更或缺陷反馈，需要把口头目标转成可执行判据 | 模型可自动路由 |
| `project-docs` | 文档散乱、同一结论多处出现、文档与代码开始漂移 | 模型可自动路由 |
| `project-acceptance` | 要判定某项是否通过、准备交付交接、或复核证据是否过期 | 仅用户斜杠显式调用 |
| `project-case-distill` | 把一次真实交付或事故整理成可复用的七段案例 | 仅用户斜杠显式调用 |

显式调用示例：`/project-acceptance 帮我判这次能不能交付`、`/project-case-distill 把这次返工整理成案例`。

## 边界

1. **不代替项目文档。** 项目自己的工程手册与同名技能优先；本插件是缺省值。
2. **不代替人类决策。** 新能力、契约、数据、判据与范围变化由决策人裁决，agent 只起草。
3. **不代替人类签认。** 验收签认不可代理；代理签认只能是项目级的显式策略。
4. **不提供强制力。** 插件约束行为与措辞，不是 CI 门禁。
5. **不含真实项目的规模与进度。** 方法、模板与技能里不写任何项目的数字；案例只保留机制与陪跑结论。

## 维护命令

```bash
npm run validate       # 结构 + 内容红线 + 链接 + 篇幅
npm run check:sources  # 源文档哈希是否漂移
npm run check:patch    # bundle patch 的 YAML 结构门禁
npm test               # 结构校验与 patch 校验的单元样本
npm run test:source    # 来源登记集成样本
```

源文档变更后必须重新评审提炼内容，再运行 `npm run gen:sources` 更新登记；不要静默改哈希。版本与变更见 `CHANGELOG.md`，从旧版升级见 `MIGRATION.md`。
