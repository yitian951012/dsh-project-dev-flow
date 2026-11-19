# CHANGELOG

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
- `engines.dsh` 由精确版本 `0.2.2-rc.3` 改为兼容区间 `>=0.2.2-rc.1 <0.3.0`：最低适配 `0.2.2-rc.1`，最高适配不含 `0.3.0`。

### 兼容说明

- 区间表示「不因版本号被直接拒绝」，不等于区间内每个版本都实测过；区间内换版本仍需执行 MIGRATION 的验证清单。
- 低于 `0.2.2-rc.1` 或达到 `0.3.0` 及以上会被版本约束拒绝。
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
