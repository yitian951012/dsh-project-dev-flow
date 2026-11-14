#!/usr/bin/env node
/**
 * gen-sources-lock.mjs — 生成 sources.lock.json（AUTHORING §8）
 *
 * sha256 一律由脚本计算，禁止手写；disposition 映射是「提炼决策」的唯一声明处，
 * 因此它写在本文件（代码评审可见的 diff）里，而不是写进 lock 再让脚本照抄。
 *
 * 输出确定性：不含时间戳、条目按路径排序、JSON 缩进固定 ⇒ 同一份 docs/ 永远得到同一份 lock，
 * 从而 --check 可以当作 CI 守卫（lock 过期 = 提炼未重新评审）。
 *
 * 用法、退出码与示例见 --help。
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  LOCK_SCHEMA_VERSION,
  LIFECYCLES,
  DISPOSITIONS,
  defaultRoot,
  findDocsRoot,
  listDocs,
  sha256File,
  makePainter,
  colorEnabled,
} from './check-sources.mjs';

/* ------------------------------------------------------------------ */
/* disposition 映射：每份源文档的去向                                 */
/* ------------------------------------------------------------------ */

/**
 * 键 = docs/ 下相对路径去掉 `.md`；值 = { lifecycle, disposition, note }。
 *
 * lifecycle 依据 docs/00_入口_文档总索引.md 的「性质」列（活=active / 史=historical / 档=archive）。
 * disposition 五选一：method | template | case | evidence | not-migrate。
 * note 必须回答「为什么不迁移」或「提炼到哪里」——这是评审时唯一需要读的字段。
 *
 * 新增 docs/ 文档时：gen 会用兜底值（not-migrate + 告警）生成条目，但评审必须补上本表。
 */
export const DISPOSITION_MAP = Object.freeze({
  // ---- 入口层（口径与台账） ----
  '00_入口_文档总索引': {
    lifecycle: 'active',
    disposition: 'method',
    note: '提炼「唯一索引 + 四层分类 + 性质标注」的索引方法；索引条目表与项目文件名不迁移。',
  },
  '01_入口_项目状态看板': {
    lifecycle: 'active',
    disposition: 'evidence',
    note: '看板是事实源的投影而非独立真相：只作「事实源分权」的例证，不迁移表格与进度数字。',
  },
  '02_入口_决策登记': {
    lifecycle: 'active',
    disposition: 'method',
    note: '提炼 DEC/OPEN 唯一编号台账与「先登记决策再改码」机制；具体 DEC 条目留源文档。',
  },
  '03_入口_不做清单': {
    lifecycle: 'active',
    disposition: 'method',
    note: '提炼「显式不做清单 + 与待办互斥、不得双重记账」的范围治理规则。',
  },
  '04_入口_待裁决台账': {
    lifecycle: 'active',
    disposition: 'method',
    note: '提炼待裁决队列与「决策只在一个队列里收口」的分权机制。',
  },
  '05_入口_文档生命周期登记': {
    lifecycle: 'active',
    disposition: 'method',
    note: '提炼生命周期元数据登记与「扫描面变更必须留痕」的口径变更纪律；四套口径差异作案例素材。',
  },

  // ---- 功能层 ----
  '10_功能_市场调研': {
    lifecycle: 'active',
    disposition: 'evidence',
    note: '竞品与领域调研只作领域适配证据，含真实产品名，不迁移入包。',
  },
  '11_功能_产品需求PRD': {
    lifecycle: 'active',
    disposition: 'evidence',
    note: 'PRD 骨架（矩阵 / 优先级 / 用户故事）作为需求方法的素材；骨架未入包，目标模板待补。',
  },
  '12_功能_界面交互设计': {
    lifecycle: 'active',
    disposition: 'evidence',
    note: '界面分区与交互约定只作领域适配素材；界面模板未入包（产品专属内容不强行通用化）。',
  },
  '13_功能_使用指南': {
    lifecycle: 'active',
    disposition: 'not-migrate',
    note: '产品专属使用流程，通用化会失真：不迁移，仅作领域理解材料。',
  },
  '14_功能_已知限制与方案': {
    lifecycle: 'active',
    disposition: 'method',
    note: '「已知限制」四要素（限制 / 用户可感知影响 / 方案 / 残余风险）进入证据与验收方法的判据；不单独建模板。',
  },
  '15_功能_剩余问题': {
    lifecycle: 'active',
    disposition: 'method',
    note: '提炼剩余问题分级与处置优先级方法；附录原文属证据，只登记不迁移。',
  },
  '16_功能_技能自动调用计划': {
    lifecycle: 'active',
    disposition: 'evidence',
    note: '技能自动调用判据已落为总控技能的阶段路由与调用权限（3 个可自动、2 个仅显式）；无独立方法资产。',
  },
  '17_功能_下一步工作清单': {
    lifecycle: 'active',
    disposition: 'template',
    note: '提炼「唯一下一步清单」模板：北极星 / 优先序 / 裁决项三栏。',
  },

  // ---- 架构层 ----
  '20_架构_系统架构': {
    lifecycle: 'active',
    disposition: 'template',
    note: '提炼系统架构说明书模板（选型 BOM / 数据模型 / 安全模型），删除本项目技术栈结论。',
  },
  '21_架构_顶层设计': {
    lifecycle: 'active',
    disposition: 'template',
    note: '提炼顶层设计模板（架构图 / 关键流程 / API 清单 / 术语表）；附录提示词工厂原文不迁移。',
  },
  '22_架构_部署运维手册': {
    lifecycle: 'active',
    disposition: 'evidence',
    note: '运维步骤与备份/升级要点作为运维方法素材；运维模板未入包（首批不含运维技能）。',
  },
  '23_架构_共用构件指南': {
    lifecycle: 'active',
    disposition: 'method',
    note: '提炼「共用构件优先、禁止各切片重复造轮子」的复用判定方法与守卫思路。',
  },
  '24_架构_ADR收据原子性': {
    lifecycle: 'active',
    disposition: 'template',
    note: '收据原子性的取舍结构进入 ADR 模板的「收据」字段；具体表名与路由不迁移。',
  },
  '25_架构_不变量守卫': {
    lifecycle: 'active',
    disposition: 'method',
    note: '提炼不变量守卫方法：守什么、假绿风险点、变异验证怎么做。',
  },

  // ---- 验收层 ----
  '30_验收_项目验收手册': {
    lifecycle: 'active',
    disposition: 'template',
    note: '提炼验收手册模板（四级定义 / 判定门控 / 范围红线），保留判据结构，删除带时点状态快照。',
  },
  '31_验收_WBS拆解明细': {
    lifecycle: 'active',
    disposition: 'template',
    note: '提炼 WBS 拆解模板（前端 / 后端 / 连通性三线逐条验收），删除条目数字与工时。',
  },
  '32_验收_交付就绪度': {
    lifecycle: 'active',
    disposition: 'template',
    note: '提炼交付就绪清单模板（复跑表 / 收口审计），删除具体交付结论与百分比。',
  },
  '33_验收_问题看板': {
    lifecycle: 'active',
    disposition: 'template',
    note: '提炼问题看板模板（P0/P1/P2 + 证据 + 决策人 + 残余风险转出）。',
  },
  '34_验收_开发模式手册': {
    lifecycle: 'active',
    disposition: 'method',
    note: '本插件的直接母本：提炼六阶段 / 门禁矩阵 / 人签清单为方法；带时点基线的数字不迁移。',
  },

  // ---- 历史层（只讲当时） ----
  '40_历史_修复进展': {
    lifecycle: 'historical',
    disposition: 'method',
    note: '按轮次的修复进展提炼「历史沉淀」方法与案例结构；原始数字与结论只留源文档。',
  },
  '41_历史_交付日志': {
    lifecycle: 'historical',
    disposition: 'not-migrate',
    note: '纯时间线留痕，对方法与模板无提炼价值：不迁移。',
  },
  '42_历史_技术债计划': {
    lifecycle: 'historical',
    disposition: 'case',
    note: '技术债计划 + 执行 + 变异测试总表：提炼技术债排序与守卫验证案例。',
  },
  '43_历史_副驾缓存优化': {
    lifecycle: 'historical',
    disposition: 'evidence',
    note: '性能与成本权衡要点仅作素材（含供应商信息，需脱敏后才能成案例）；案例未入包。',
  },
  '44_历史_文风对齐方案': {
    lifecycle: 'historical',
    disposition: 'evidence',
    note: '风格收敛的阶段性取舍只作素材；案例未入包，避免把未完成方案写成通用方法。',
  },
  '45_历史_工期估算': {
    lifecycle: 'historical',
    disposition: 'not-migrate',
    note: '工期估算绑定当时范围与口径，外推即失真：不迁移，仅作估算偏差证据。',
  },
  '46_历史_浏览器实测问题': {
    lifecycle: 'historical',
    disposition: 'case',
    note: '「实测问题 → 方案 → 进展」闭环：提炼「实测优先于推断」案例。',
  },
  '47_历史_实测留痕合集': {
    lifecycle: 'historical',
    disposition: 'evidence',
    note: '单次实测留痕只作证据链，脱敏后可供案例引用，不单独成文。',
  },
  '48_历史_参考库三阶段': {
    lifecycle: 'historical',
    disposition: 'evidence',
    note: '渐进交付与范围控制的取舍只作素材；案例未入包。',
  },
  '49_历史_2026-10轮次快照': {
    lifecycle: 'historical',
    disposition: 'evidence',
    note: '轮次快照合集，只代表当时：仅作证据，不迁移。',
  },
  '50_历史_2026-11文档审计': {
    lifecycle: 'historical',
    disposition: 'case',
    note: '本次文档治理的直接来源：提炼「索引缺失 → 审计 → 登记 → 检查器」治理案例。',
  },
  '51_历史_审计归档合集': {
    lifecycle: 'archive',
    disposition: 'not-migrate',
    note: '性质=档，审计归档原文仅作证据链，不作为判断依据：不迁移。',
  },
  '52_历史_2026-11-08全量测试报告': {
    lifecycle: 'historical',
    disposition: 'evidence',
    note: '全量测试报告含项目数字与缺陷清单，只作证据；结论不外推为通用判据。',
  },
  '53_历史_2026-11-08复测报告': {
    lifecycle: 'historical',
    disposition: 'evidence',
    note: '复测 go/no-go 判定只对当时有效：只作证据，不迁移为验收标准。',
  },
});

/** 未映射文档的兜底（宁可显式暴露，也不静默猜一个 disposition）。 */
export const FALLBACK_DISPOSITION = 'not-migrate';

/* ------------------------------------------------------------------ */
/* 生成                                                               */
/* ------------------------------------------------------------------ */

function fallbackLifecycle(rel) {
  // 文件名约定「NN_历史_」是唯一可推断的信号；archive 无法从名字推断，一律按 historical 兜底并告警。
  return rel.includes('_历史_') ? 'historical' : 'active';
}

function lookupMapping(rel) {
  const stem = rel.replace(/\.md$/i, '');
  return DISPOSITION_MAP[stem] ?? DISPOSITION_MAP[`docs/${stem}`] ?? null;
}

/**
 * 由 docs/ 生成 lock 对象与确定性文本。
 * @param {{ docsRoot: string, strict?: boolean }} opts
 * @returns {Promise<{ lock: object, text: string, warnings: Array<string>, summary: object }>}
 */
/** 每份源文档在包内的落点（targets）；空数组 = 只登记去向不产出文件。 */
export const TARGETS = Object.freeze({
  '00_入口_文档总索引': ['methods/truth-and-lifecycle.md', 'templates/docs-index.md'],
  '01_入口_项目状态看板': ['templates/status-dashboard.md'],
  '02_入口_决策登记': ['methods/intake-and-decision.md', 'templates/decision-record.md'],
  '03_入口_不做清单': ['methods/intake-and-decision.md', 'templates/open-item.md'],
  '04_入口_待裁决台账': ['methods/intake-and-decision.md', 'templates/open-item.md'],
  '05_入口_文档生命周期登记': ['methods/truth-and-lifecycle.md', 'templates/docs-index.md'],
  '14_功能_已知限制与方案': ['methods/evidence-and-acceptance.md'],
  '15_功能_剩余问题': ['methods/evidence-and-acceptance.md', 'templates/status-dashboard.md'],
  '16_功能_技能自动调用计划': [],
  '17_功能_下一步工作清单': ['templates/status-dashboard.md'],
  '20_架构_系统架构': ['methods/design-and-invariants.md', 'templates/adr.md'],
  '21_架构_顶层设计': ['methods/design-and-invariants.md', 'templates/adr.md'],
  '23_架构_共用构件指南': ['methods/design-and-invariants.md'],
  '24_架构_ADR收据原子性': ['templates/adr.md'],
  '25_架构_不变量守卫': ['methods/design-and-invariants.md', 'cases/false-green-guard/case.md'],
  '30_验收_项目验收手册': ['methods/evidence-and-acceptance.md', 'templates/verification-report.md'],
  '31_验收_WBS拆解明细': ['templates/wbs-acceptance.md'],
  '32_验收_交付就绪度': ['templates/verification-report.md'],
  '33_验收_问题看板': ['templates/open-item.md'],
  '34_验收_开发模式手册': ['methods/intake-and-decision.md', 'methods/evidence-and-acceptance.md', 'templates/verification-report.md'],
  '40_历史_修复进展': ['methods/history-and-cases.md'],
  '42_历史_技术债计划': ['cases/false-green-guard/case.md'],
  '46_历史_浏览器实测问题': ['cases/false-green-guard/case.md', 'methods/evidence-and-acceptance.md'],
  '47_历史_实测留痕合集': ['methods/history-and-cases.md'],
  '50_历史_2026-11文档审计': ['cases/docs-governance/case.md', 'methods/truth-and-lifecycle.md'],
  '52_历史_2026-11-08全量测试报告': ['cases/no-go-to-go/case.md', 'templates/verification-report.md'],
  '53_历史_2026-11-08复测报告': ['cases/no-go-to-go/case.md', 'methods/evidence-and-acceptance.md'],
});

export async function buildLock({ docsRoot, strict = false } = {}) {
  if (!docsRoot || !existsSync(docsRoot)) {
    const error = new Error('docs/ 目录不存在，无法生成 lock');
    error.fix = '用 --docs <dir> 指定 docs/，或确认从仓库根执行';
    throw error;
  }

  const rels = await listDocs(docsRoot);
  const warnings = [];
  const files = [];
  const summary = { total: rels.length, active: 0, historical: 0, archive: 0, unmapped: 0, dispositions: {} };

  for (const rel of rels) {
    const mapping = lookupMapping(rel);
    const stem = rel.replace(/\.md$/i, '');

    let lifecycle;
    let disposition;
    let note;
    if (mapping) {
      lifecycle = mapping.lifecycle;
      disposition = mapping.disposition;
      note = mapping.note;
      if (!LIFECYCLES.includes(lifecycle)) {
        warnings.push(`docs/${rel} 的映射 lifecycle 非法（${lifecycle}），按文件名兜底`);
        lifecycle = fallbackLifecycle(rel);
      }
      if (!DISPOSITIONS.includes(disposition)) {
        warnings.push(`docs/${rel} 的映射 disposition 非法（${disposition}），按 not-migrate 兜底`);
        disposition = FALLBACK_DISPOSITION;
      }
    } else {
      lifecycle = fallbackLifecycle(rel);
      disposition = FALLBACK_DISPOSITION;
      note = '未映射：需在 scripts/gen-sources-lock.mjs 的 DISPOSITION_MAP 中补 lifecycle/disposition/note 后重生成。';
      summary.unmapped += 1;
      warnings.push(`docs/${rel} 未在 DISPOSITION_MAP 中登记，已按 not-migrate 兜底`);
    }

    summary[lifecycle] += 1;
    summary.dispositions[disposition] = (summary.dispositions[disposition] ?? 0) + 1;

    files.push({
      path: `docs/${rel}`,
      sha256: await sha256File(path.join(docsRoot, rel)),
      lifecycle,
      disposition,
      targets: TARGETS[stem] ?? [],
      note,
    });
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const lock = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    generator: 'scripts/gen-sources-lock.mjs',
    docsRoot: 'docs',
    note: 'sha256 由脚本生成，禁止手写；源文档变更后必须重新评审提炼内容再重生成（AUTHORING §8）。',
    files,
  };

  const text = `${JSON.stringify(lock, null, 2)}\n`;

  if (strict && summary.unmapped > 0) {
    const error = new Error(`--strict：${summary.unmapped} 份文档缺少 disposition 映射`);
    error.fix = '在 DISPOSITION_MAP 中补登记（不要用兜底值蒙混过 CI）';
    error.warnings = warnings;
    throw error;
  }

  return { lock, text, warnings, summary };
}

/* ------------------------------------------------------------------ */
/* 比对（--check）                                                     */
/* ------------------------------------------------------------------ */

function summarizeDiff(oldLock, newLock) {
  const oldFiles = Array.isArray(oldLock?.files) ? oldLock.files : [];
  const oldByPath = new Map(oldFiles.map((f) => [f.path, f]));
  const newByPath = new Map(newLock.files.map((f) => [f.path, f]));
  const added = [];
  const removed = [];
  const hashChanged = [];
  const metaChanged = [];

  for (const [p, entry] of newByPath) {
    const old = oldByPath.get(p);
    if (!old) added.push(p);
    else if (old.sha256 !== entry.sha256) hashChanged.push(p);
    else if (old.lifecycle !== entry.lifecycle || old.disposition !== entry.disposition || old.note !== entry.note) {
      metaChanged.push(p);
    }
  }
  for (const p of oldByPath.keys()) if (!newByPath.has(p)) removed.push(p);

  return { added, removed, hashChanged, metaChanged, counts: { added: added.length, removed: removed.length, hashChanged: hashChanged.length, metaChanged: metaChanged.length } };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

const HELP = `生成或校验 sources.lock.json（AUTHORING §8）。

用法:
  node scripts/gen-sources-lock.mjs [选项]

选项:
  --docs <dir>      docs/ 目录（默认：从 package 根向上查找最近的 docs/）
  --root <dir>      package 根目录（默认：脚本所在目录的上一级）
  --out <file>      lock 输出路径（默认：<root>/sources.lock.json）
  --check           只比对不写盘；lock 过期时以退出码 1 报告差异（供 CI 使用）
  --dry-run         把生成的 JSON 打到 stdout，不写盘（便于评审 diff）
  --strict          存在未映射文档时以退出码 1 失败（默认只告警）
  --json            --check 时输出机器可读差异
  --no-color        强制纯文本（管道/重定向时已自动关闭颜色）
  -h, --help        显示本帮助

环境变量:
  DSH_FLOW_DOCS_DIR  指定 docs/（优先级低于 --docs）

退出码:
  0  已写盘 / 已一致
  1  --check 发现差异，或 --strict 下有未映射文档
  2  用法错误（参数拼错/缺值）

示例:
  node scripts/gen-sources-lock.mjs                 # 更新 lock
  node scripts/gen-sources-lock.mjs --check         # CI：lock 是否与源文档一致
  node scripts/gen-sources-lock.mjs --dry-run | diff - sources.lock.json

说明:
  sha256 与 lifecycle 由脚本生成；disposition/note 来自本文件的 DISPOSITION_MAP。
  要改「这份文档往哪提炼」，改映射表并重生成——不要手改 sources.lock.json。
`;

function parseArgv(argv) {
  const opts = { root: null, docs: null, out: null, check: false, dryRun: false, strict: false, json: false, noColor: false, help: false };
  const takeValue = (index, flag) => {
    const value = argv[index];
    if (!value || value.startsWith('-')) throw usageError(`${flag} 需要一个路径参数`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--root': opts.root = takeValue((i += 1), '--root'); break;
      case '--docs': opts.docs = takeValue((i += 1), '--docs'); break;
      case '--out': opts.out = takeValue((i += 1), '--out'); break;
      case '--check': opts.check = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--strict': opts.strict = true; break;
      case '--json': opts.json = true; break;
      case '--no-color': opts.noColor = true; break;
      case '-h':
      case '--help': opts.help = true; break;
      default: throw usageError(`未知参数：${arg}`);
    }
  }
  return opts;
}

function usageError(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

export async function runCli(argv = process.argv.slice(2), io = process) {
  let opts;
  try {
    opts = parseArgv(argv);
  } catch (error) {
    io.stderr.write(`✗ ${error.message}\n  Fix: 运行 node scripts/gen-sources-lock.mjs --help 查看可用参数\n`);
    return 2;
  }
  if (opts.help) {
    io.stdout.write(HELP);
    return 0;
  }

  const rootAbs = path.resolve(defaultRoot(), opts.root ? opts.root : '.');
  const painter = makePainter(!opts.noColor && colorEnabled(io.stdout, argv));

  let docsRoot = opts.docs ? path.resolve(rootAbs, opts.docs) : null;
  if (!docsRoot) {
    const found = findDocsRoot({ root: rootAbs });
    if (found.dir) docsRoot = found.dir;
  }
  if (!docsRoot) {
    io.stderr.write(
      `✗ 找不到 docs/，无法生成 lock\n  Fix: 用 --docs <dir> 指定，或设置环境变量 DSH_FLOW_DOCS_DIR\n`,
    );
    return 1;
  }

  const outAbs = path.resolve(rootAbs, opts.out ?? 'sources.lock.json');

  let result;
  try {
    result = await buildLock({ docsRoot, strict: opts.strict });
  } catch (error) {
    io.stderr.write(`✗ ${error.message}\n  Fix: ${error.fix ?? '检查 docs/ 路径与权限'}\n`);
    if (error.warnings) for (const w of error.warnings) io.stderr.write(`  ⚠ ${w}\n`);
    return 1;
  }

  const { lock, text, warnings, summary } = result;
  const dist = `active ${summary.active} / historical ${summary.historical} / archive ${summary.archive}`;

  if (opts.dryRun) {
    io.stdout.write(text);
    if (!opts.json) {
      io.stderr.write(painter.dim(`\n(dry-run) 未写盘：共 ${summary.total} 份文档（${dist}）；${warnings.length} 条告警\n`));
    }
    return 0;
  }

  if (opts.check) {
    if (!existsSync(outAbs)) {
      const payload = { ok: false, reason: 'lock-missing', lockPath: outAbs, expectedEntries: summary.total };
      io.stdout.write(opts.json ? `${JSON.stringify(payload, null, 2)}\n` : '');
      if (!opts.json) {
        io.stdout.write(
          `✗ ${path.relative(rootAbs, outAbs)} 不存在\n  Fix: 运行 node scripts/gen-sources-lock.mjs 生成（共 ${summary.total} 份文档待登记）\n`,
        );
      }
      return 1;
    }
    let oldLock;
    try {
      oldLock = JSON.parse(await readFile(outAbs, 'utf8'));
    } catch {
      oldLock = null;
    }
    const same = text === (await readFile(outAbs, 'utf8'));
    if (same) {
      if (opts.json) io.stdout.write(`${JSON.stringify({ ok: true, lockPath: outAbs, entries: summary.total }, null, 2)}\n`);
      else io.stdout.write(painter.green(`✔ sources.lock.json 已一致：${summary.total} 份文档（${dist}）\n`));
      return 0;
    }

    const diff = summarizeDiff(oldLock, lock);
    if (opts.json) {
      io.stdout.write(`${JSON.stringify({ ok: false, reason: 'drift', lockPath: outAbs, diff, expectedEntries: summary.total }, null, 2)}\n`);
    } else {
      io.stdout.write(painter.red(`✗ sources.lock.json 与 docs/ 不一致\n`));
      if (diff.hashChanged.length) io.stdout.write(`  哈希变化（源文档已改）: ${diff.hashChanged.join('、')}\n`);
      if (diff.added.length) io.stdout.write(`  新增未登记: ${diff.added.join('、')}\n`);
      if (diff.removed.length) io.stdout.write(`  登记了但源文档已不在: ${diff.removed.join('、')}\n`);
      if (diff.metaChanged.length) io.stdout.write(`  映射变化: ${diff.metaChanged.join('、')}\n`);
      io.stdout.write(`  Fix: 重新评审上述文档的提炼内容，然后运行 node scripts/gen-sources-lock.mjs\n`);
    }
    return 1;
  }

  await writeFile(outAbs, text, 'utf8');
  if (opts.json) {
    io.stdout.write(`${JSON.stringify({ ok: true, wrote: outAbs, entries: summary.total, summary, warnings }, null, 2)}\n`);
  } else {
    io.stdout.write(painter.green(`✔ 写入 ${path.relative(rootAbs, outAbs)}：${summary.total} 份文档（${dist}）\n`));
    for (const w of warnings) io.stdout.write(`  ${painter.yellow('⚠')} ${w}\n`);
  }
  return 0;
}

/* 仅直接执行时跑 CLI；被 import 时保持纯模块。 */
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    process.stderr.write(`✗ 内部错误：${error.message}\n  Fix: 加 --json 或查看堆栈后反馈\n  Stack: ${error.stack}\n`);
    process.exitCode = 1;
  }
}
