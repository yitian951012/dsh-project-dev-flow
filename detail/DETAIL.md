# 项目开发流程

## 30 秒说明

「项目开发流程」是一个 DSH bundle。安装后，模式选择器里会多出一个同名模式；选中它，agent 先只读适配目标项目，再按需求受理 → 设计定型 → 实现 → 验证 → 交付 → 复盘推进。

它的产出是「候选完成 + 证据链 + 剩余风险」，不是一句「已经做完」。方法、模板与案例按需加载，不常驻人格段：方法只按节读 §2 核心判断与 §3 步骤，不整份读。安装与卸载本身不写目标项目文件；运行时的 agent 只在你明确授权后写回项目档案、决策、索引或状态投影，回滚不会撤销这些已发生的项目修改。

## 安装

**前置条件**：DSH 版本区间 `>=0.2.2-rc.1 <0.3.0`——`0.3.0` 正式版被拒，但 `0.3.0-alpha.x` 因 DSH 以 `includePrerelease` 判定仍会装入且未验证；Node `^24.22.3 || >=26.13.1`（2.1.2 起声明，2.1.3 收紧）。已校验运行时 `0.2.3-alpha.2`（`dsh --version` 输出该版本、退出码 0；结构校验、patch 结构校验、包内测试与隔离 profile 装配烟测）；`0.2.2-rc.5` 仅作历史验证点，且没有 `dsh --version` 记录可查。区间内换版本前，先在目标运行时重新验证，见包根 `MIGRATION.md`。

安装方式（注意通道差异）：

- npm 包：`dsh plugin --profile <profile> add @yitian951012/dsh-project-dev-flow`——装到的是 **`2.1.3`**（registry `latest = 2.1.3`，2026-11-23 发布，`gitHead 766de1b`）。`2.1.1` / `2.1.2` 未发布。
- GitHub 源：`dsh plugin --profile <profile> add github:yitian951012/dsh-project-dev-flow`——取仓库当前版本（含未发布修正）；该通道的写法本身未在 2.1.3 上重跑验证。

1. 在 DSH 的 Plugins 面板中以 bundle 安装方式选择本包目录。
2. 安装后新开一个会话——已有会话保留启动时的模式，不会热切换。
3. 在模式选择器中选择「项目开发流程」。
4. 验证：模式可选中；技能目录出现包内技能；`/project-acceptance` 可显式调用；在包目录执行 `node scripts/section.mjs design-and-invariants 2 3` 能打印该方法 §2–§3。

升级：先移除旧包，再安装新包。卸载：移除 bundle，包内技能与模式一并消失；项目自己的 `.dsh/skills`、`.agents/skills` 不受影响。

## 读取与工具面（2.1.0–2.1.3）

- **方法按节读**：技能读方法只取 §2 核心判断与 §3 步骤，靠一条可执行命令，而不是一句提示——在包目录执行 `node scripts/section.mjs <方法名> 2 3`；裸方法名按包内 `methods/` 解析。
- **与流程无关的工具不声明**：定时任务在 preset 内显式关闭（已用隔离 profile 实测生效）；工作流编排与子代理 fork 三簇由宿主预设的默认工具集提供，本包不声明也无法在 preset 内关闭（实测：从本包删除后仍会出现，写 `disabled: true` 也会被丢弃）；要关闭只能在宿主 profile 层处理。
- **真实会话验收**：`node scripts/acceptance-session.mjs --profile <name>` 用 `--patch` 临时挂载技能并跑三条任务（自动路由 ×2 + slash ×1），结果写入 `evidence/acceptance-<版本>.json|md`；返回 3 表示 profile 缺少可用模型路由。在 `0.2.3-alpha.2` 上这项**未重跑**：`evidence/acceptance-2.1.1-*` 出自 `0.2.2` 时期，不能据此宣称路由在 `0.2.3-alpha.2` 上通过。

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
