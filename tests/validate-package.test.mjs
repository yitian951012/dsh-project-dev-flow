#!/usr/bin/env node
/**
 * tests/validate-package.test.mjs
 *
 * AUTHORING §9 要求：validate-package 的每条规则都必须有负向样本，否则就是「没验证的检查器」。
 * 本文件因此按规则编号组织：每个 it() 只制造一个缺陷，断言对应的 rule 被命中，
 * 同时保留一个「完全合法」的正例作为对照——没有正例的负例测试会悄悄把规则强化成「全红」。
 *
 * 运行：node --test tests/   （或 npm test）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePackage, validatePatchText, parseFrontmatter, lineCount, classifyAsset } from '../scripts/validate-package.mjs';
import { buildLock } from '../scripts/gen-sources-lock.mjs';
import { verifySources, findDocsRoot, validateLockShape } from '../scripts/check-sources.mjs';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* ------------------------------------------------------------------ */
/* fixtures                                                           */
/* ------------------------------------------------------------------ */

/** 动态生成复核日期，避免测试在一年后因 review_after 过期而变成「时间炸弹」。 */
function reviewDate(monthsFromNow = 6) {
  const date = new Date();
  date.setMonth(date.getMonth() + monthsFromNow);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const BASE_METHOD = `---
id: method-truth-and-lifecycle
title: 事实源分权与文档生命周期
kind: method
domain: governance
authority: fallback
lifecycle: active
status: active
version: 1.0.0
applies_when:
  - 需要判断某条结论该信谁
not_for:
  - 把单个项目的取舍当成通用规则
sources:
  - doc:doc-index
review_after: ${reviewDate()}
---
# 事实源分权与文档生命周期

## 何时使用
多个来源对同一事实给出不同说法时。

## 规则
- 当前实现与数字以当场命令输出为准。
- 范围与判据变更以人类授权的决策登记为准。
- 进度看板是投影，不是独立事实源。

## 停止条件
能指出每个关键结论的字段级来源即可停止。
`;

const BASE_TEMPLATE = `---
id: template-prd
title: 产品需求文档
kind: template
domain: product
authority: fallback
lifecycle: active
status: active
version: 1.0.0
applies_when:
  - 需要把需求写成可验收的文档
not_for:
  - 替代决策登记
sources:
  - doc:doc-index
review_after: ${reviewDate()}
---
# {{project.name}} 需求规格

> 文档根目录：{{doc:root}}；索引：{{doc:index}}

## 范围
- 目标：{{project.name}} 本阶段要解决的问题

## 验收
- 命令：{{command:test}}
`;

const BASE_CASE = `---
id: case-p-doc-audit
title: 文档索引缺失的审计与修复
kind: case
domain: history
authority: evidence-only
lifecycle: historical
status: closed
version: 1.0.0
applies_when:
  - 需要复盘一次文档治理失败
not_for:
  - 把当时结论当作通用判据
sources:
  - doc:doc-index
review_after: ${reviewDate()}
---
# 文档索引缺失的审计与修复

来源：来源项目（下称 P）2026-11 文档治理审计（脱敏，原文不随包发布）。

## 背景与约束
接手时没有唯一索引，多套口径并存。

## 当时的错误判断
以为「检查器绿灯」等于分层自洽；实际两套豁免正则互相矛盾。

## 候选方案与实际取舍
候选：直接改豁免正则。取舍：先登记口径差异，再统一豁免，避免静默改变扫描面。

## 可观察证据
审计命令输出了差异清单；改动后复跑检查器通过。

## 修复后仍未解决的风险
口径差异仍在，需要在后续轮次裁决。

## 能提炼的方法与不可外推边界
提炼：先登记差异再改守卫。边界：不适用于从未建立索引的项目。

## 与插件内方法的链接
参见 [事实源分权](../../methods/truth-and-lifecycle.md)。
`;

const BASE_SKILL = `---
name: project-docs
description: 项目文档治理：把项目文档落地成唯一索引 + 活/史/档 + 生命周期登记，并审计漂移与断链。
whenToUse: 用户要求整理、审计、迁移或合并项目文档时。
disable-model-invocation: false
---
# project-docs

## 何时使用
用户要求整理、审计、迁移或合并项目文档时。

## 输入
- 项目文档根目录与现有索引。

## 步骤
1. 找到唯一索引，没有就先建立。
2. 逐份标注活 / 史 / 档。
3. 复跑漂移检查。

## 输出
- 更新后的索引与生命周期登记。

## 停止条件
索引覆盖全部文档且检查器无告警。

## 常见错误
- 把历史文档当成现状依据。
`;

const BASE_REFERENCE = `# 检查清单

- 只读检查现有索引。
- 记录差异，不直接改守卫。
`;

const BASE_PATCH = `- insert:
    - id: preset-project-dev-flow
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: project-dev-flow
        plugins:
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
            config:
              customSkillDirs:
                - !!js path.join(pkgRoot, 'skills')
          - id: planning
            name: cordis:group
            config:
              - id: plan-mode
                name: '@deepseek-ai/dsh-plan-mode'
                config:
                  section: |
                    You are in plan mode until the user approves the plan; do not edit tracked files.
`;

function baseFiles() {
  return {
    'package.json': JSON.stringify(
      {
        name: '@local/dsh-project-dev-flow',
        version: '2.0.0',
        files: ['cordis.patch.yml', 'methods', 'templates', 'cases', 'skills'],
        engines: { dsh: '0.2.2-rc.3' },
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      null,
      2,
    ),
    'cordis.patch.yml': BASE_PATCH,
    'methods/truth-and-lifecycle.md': BASE_METHOD,
    'templates/prd.md': BASE_TEMPLATE,
    'cases/p-doc-audit/case.md': BASE_CASE,
    'skills/project-docs/SKILL.md': BASE_SKILL,
    'skills/project-docs/references/checklist.md': BASE_REFERENCE,
  };
}

async function makePackage(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'dpf-validate-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return root;
}

/** 复制一份基础包，只改一个文件里的一段文本 —— 一个 it() 只制造一个缺陷。 */
function mutate(rel, search, replacement) {
  const files = baseFiles();
  assert.ok(files[rel].includes(search), `fixture 里找不到要替换的片段：${search.slice(0, 40)}`);
  files[rel] = files[rel].replace(search, replacement);
  return files;
}

/** 在正文末尾追加一行（多数红线测试用这个）。 */
function appendTo(rel, line) {
  const files = baseFiles();
  files[rel] = `${files[rel]}\n${line}\n`;
  return files;
}

async function validateFixture(files, options = {}) {
  const root = await makePackage(files);
  try {
    return { ...(await validatePackage({ root, docsRoot: false, ...options })), root };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function rulesOf(list) {
  return list.map((item) => item.rule);
}

function hasRule(list, rule) {
  return list.some((item) => item.rule === rule);
}

function runScript(scriptRel, args = []) {
  return spawnSync(process.execPath, [path.join(PLUGIN_ROOT, scriptRel), ...args], {
    cwd: PLUGIN_ROOT,
    encoding: 'utf8',
  });
}

/* ------------------------------------------------------------------ */
/* 正例                                                              */
/* ------------------------------------------------------------------ */

describe('正例：合法包', () => {
  it('合法包 0 错误、0 告警，并统计出各类资产', async () => {
    const result = await validateFixture(baseFiles());
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0, `不应有错误：${JSON.stringify(result.errors, null, 2)}`);
    assert.equal(result.warnings.length, 0, `不应有告警：${JSON.stringify(result.warnings, null, 2)}`);
    assert.equal(result.summary.assets, 5);
    assert.deepEqual(result.summary.byKind, { method: 1, template: 1, case: 1, skill: 1, reference: 1 });
  });

  it('parseFrontmatter 支持标量/引号/块文本/列表/行内列表', () => {
    const fm = parseFrontmatter(
      ['---', 'id: method-x', 'list:', '  - a', '  - "b"', 'block: |', '  line1', '  line2', 'flag: true', 'inline: [x, y]', '---', 'body'].join('\n'),
    );
    assert.equal(fm.ok, true);
    assert.deepEqual(fm.data.list, ['a', 'b']);
    assert.equal(fm.data.block, 'line1\nline2');
    assert.equal(fm.data.flag, true);
    assert.deepEqual(fm.data.inline, ['x', 'y']);
    assert.equal(fm.body, 'body');
  });

  it('lineCount 不计末尾空行；classifyAsset 认得五类受管路径', () => {
    assert.equal(lineCount('a\nb\n'), 2);
    assert.equal(lineCount('a\nb'), 2);
    assert.equal(classifyAsset('methods/x.md').kind, 'method');
    assert.equal(classifyAsset('cases/c/case.md').kind, 'case');
    assert.equal(classifyAsset('skills/s/SKILL.md').kind, 'skill');
    assert.equal(classifyAsset('skills/s/references/r.md').kind, 'reference');
    assert.equal(classifyAsset('references/adapters/a.md').kind, 'adapter');
    assert.equal(classifyAsset('random/notes.md').kind, 'unknown');
  });
});

describe('负例：包级文件', () => {
  it('package.json 不是合法 JSON → PKG-JSON 错误', async () => {
    const files = baseFiles();
    files['package.json'] = '{ "name": "@local/x", ';
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'PKG-JSON'));
    assert.match(result.errors.find((e) => e.rule === 'PKG-JSON').message, /JSON/);
  });

  it('缺 package.json → PKG-JSON 告警（脚本仍可独立运行）', async () => {
    const files = baseFiles();
    delete files['package.json'];
    const result = await validateFixture(files);
    assert.equal(result.ok, true);
    assert.ok(hasRule(result.warnings, 'PKG-JSON'));
  });

  it('没有任何内容资产 → ASSET-NONE note，而不是崩溃', async () => {
    const result = await validateFixture({
      'package.json': baseFiles()['package.json'],
      'cordis.patch.yml': BASE_PATCH,
    });
    assert.equal(result.ok, true);
    assert.equal(result.summary.assets, 0);
    assert.ok(result.notes.some((item) => item.rule === 'ASSET-NONE'));
  });

  it('未分类的 Markdown → ASSET-UNCLASSIFIED 告警', async () => {
    const files = baseFiles();
    files['cases/notes.md'] = '# 备注\n';
    const result = await validateFixture(files);
    assert.equal(result.ok, true);
    assert.ok(hasRule(result.warnings, 'ASSET-UNCLASSIFIED'));
  });
});

/* ------------------------------------------------------------------ */
/* 负例：frontmatter / 字段                                           */
/* ------------------------------------------------------------------ */

describe('负例：frontmatter', () => {
  it('缺结束行 --- → FM-MISSING', async () => {
    const files = mutate('methods/truth-and-lifecycle.md', '---\n# 事实源分权', '# 事实源分权');
    const result = await validateFixture(files);
    assert.equal(result.ok, false);
    assert.ok(hasRule(result.errors, 'FM-MISSING'));
    assert.match(result.errors[0].fix, /---/);
  });

  it('frontmatter 里出现无法解析的行 → FM-MISSING', async () => {
    const files = mutate('methods/truth-and-lifecycle.md', 'kind: method', 'kind: method\nid method-bad-line');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'FM-MISSING'), JSON.stringify(result.errors));
    assert.match(result.errors.find((e) => e.rule === 'FM-MISSING').message, /无法解析/);
  });

  it('缺必填字段 authority → FM-REQUIRED 并给出 Fix', async () => {
    const files = mutate('methods/truth-and-lifecycle.md', 'authority: fallback\n', '');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'FM-REQUIRED'));
    const error = result.errors.find((item) => item.rule === 'FM-REQUIRED');
    assert.match(error.message, /authority/);
    assert.ok(error.fix.length > 0);
  });

  it('id 前缀不等于 kind → FM-ID', async () => {
    const files = mutate('methods/truth-and-lifecycle.md', 'id: method-truth-and-lifecycle', 'id: truth-and-lifecycle');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'FM-ID'));
    assert.match(result.errors.find((e) => e.rule === 'FM-ID').message, /method-/);
  });

  it('kind 与目录不一致 → FM-KIND', async () => {
    const files = mutate('methods/truth-and-lifecycle.md', 'kind: method', 'kind: template');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'FM-KIND'));
  });

  it('domain 枚举非法 → FM-ENUM', async () => {
    const files = mutate('methods/truth-and-lifecycle.md', 'domain: governance', 'domain: marketing');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'FM-ENUM'));
    assert.match(result.errors.find((e) => e.rule === 'FM-ENUM').fix, /governance/);
  });

  it('version 不是语义化版本 → FM-VERSION', async () => {
    const files = mutate('methods/truth-and-lifecycle.md', 'version: 1.0.0', 'version: 1.0');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'FM-VERSION'));
    assert.match(result.errors.find((e) => e.rule === 'FM-VERSION').fix, /semver/);
  });

  it('review_after 超出 12 个月 → FM-REVIEW-AFTER', async () => {
    const files = mutate('methods/truth-and-lifecycle.md', `review_after: ${reviewDate()}`, `review_after: ${reviewDate(14)}`);
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'FM-REVIEW-AFTER'));
    assert.match(result.errors.find((e) => e.rule === 'FM-REVIEW-AFTER').message, /12 个月/);
  });

  it('review_after 已过期 → 告警（不阻断）', async () => {
    const files = mutate('methods/truth-and-lifecycle.md', `review_after: ${reviewDate()}`, 'review_after: 2020-01-01');
    const result = await validateFixture(files);
    assert.equal(result.ok, true);
    assert.ok(hasRule(result.warnings, 'FM-REVIEW-AFTER'));
  });

  it('sources 写绝对路径 → FM-SOURCES', async () => {
    const files = mutate('methods/truth-and-lifecycle.md', '  - doc:doc-index', '  - E:\\docs\\index.md');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'FM-SOURCES'));
  });

  it('id 重复 → ASSET-DUP-ID', async () => {
    const files = baseFiles();
    files['methods/another.md'] = files['methods/truth-and-lifecycle.md'];
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'ASSET-DUP-ID'));
  });
});

/* ------------------------------------------------------------------ */
/* 负例：技能（§4）                                                   */
/* ------------------------------------------------------------------ */

describe('负例：技能', () => {
  it('技能名含大写与下划线 → SKILL-NAME（并要求名字=目录名）', async () => {
    const files = mutate('skills/project-docs/SKILL.md', 'name: project-docs', 'name: Project_Docs');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'SKILL-NAME'), JSON.stringify(result.errors));
    const messages = result.errors.filter((e) => e.rule === 'SKILL-NAME').map((e) => e.message);
    assert.ok(messages.some((m) => /kebab-case/.test(m)));
    assert.ok(messages.some((m) => /目录名/.test(m)));
  });

  it('技能名与目录不一致 → SKILL-NAME', async () => {
    const files = mutate('skills/project-docs/SKILL.md', 'name: project-docs', 'name: project-other');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'SKILL-NAME'));
  });

  it('缺 description → SKILL-DESC', async () => {
    const files = mutate(
      'skills/project-docs/SKILL.md',
      'description: 项目文档治理：把项目文档落地成唯一索引 + 活/史/档 + 生命周期登记，并审计漂移与断链。\n',
      '',
    );
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'SKILL-DESC'));
    assert.match(result.errors.find((e) => e.rule === 'SKILL-DESC').message, /description/);
  });

  it('description 超过 120 字 → SKILL-DESC', async () => {
    const files = mutate(
      'skills/project-docs/SKILL.md',
      'description: 项目文档治理：把项目文档落地成唯一索引 + 活/史/档 + 生命周期登记，并审计漂移与断链。',
      `description: ${'很长'.repeat(70)}`,
    );
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'SKILL-DESC'));
    assert.match(result.errors.find((e) => e.rule === 'SKILL-DESC').message, /120/);
  });

  it('缺 whenToUse → SKILL-WHEN 告警', async () => {
    const files = mutate('skills/project-docs/SKILL.md', 'whenToUse: 用户要求整理、审计、迁移或合并项目文档时。\n', '');
    const result = await validateFixture(files);
    assert.equal(result.ok, true);
    assert.ok(hasRule(result.warnings, 'SKILL-WHEN'));
  });

  it('历史证据类技能没有 disable-model-invocation: true → SKILL-DISABLE', async () => {
    const files = baseFiles();
    files['skills/project-history-evidence/SKILL.md'] = BASE_SKILL.replace('name: project-docs', 'name: project-history-evidence');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'SKILL-DISABLE'));
  });

  it('缺六段结构 → SKILL-STRUCTURE 告警（不阻断）', async () => {
    const files = mutate('skills/project-docs/SKILL.md', '## 停止条件', '## 其他说明');
    const result = await validateFixture(files);
    assert.equal(result.ok, true);
    assert.ok(hasRule(result.warnings, 'SKILL-STRUCTURE'));
    assert.match(result.warnings.find((w) => w.rule === 'SKILL-STRUCTURE').message, /停止条件/);
  });
});

/* ------------------------------------------------------------------ */
/* 负例：篇幅与链接                                                   */
/* ------------------------------------------------------------------ */

describe('负例：篇幅与内部链接', () => {
  it('SKILL.md 超过 75 行 → LINE-BUDGET 告警（超预算不是硬错误）', async () => {
    const extra = Array.from({ length: 60 }, (_, index) => `- 细节第 ${index + 1} 条`).join('\n');
    const files = baseFiles();
    files['skills/project-docs/SKILL.md'] = `${BASE_SKILL}${extra}\n`;
    const result = await validateFixture(files);
    assert.equal(result.errors.length, 0);
    assert.ok(hasRule(result.warnings, 'LINE-BUDGET'));
    assert.match(result.warnings.find((w) => w.rule === 'LINE-BUDGET').message, /75/);
  });

  it('坏内部链接 → LINK（并指出解析到了哪）', async () => {
    const files = appendTo('methods/truth-and-lifecycle.md', '参见 [不存在的模板](../templates/missing.md)。');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'LINK'));
    assert.match(result.errors.find((e) => e.rule === 'LINK').message, /missing\.md/);
  });

  it('链接指向包外 → LINK', async () => {
    const files = appendTo('methods/truth-and-lifecycle.md', '参见 [包外文档](../../../outside.md)。');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'LINK'));
  });
});

/* ------------------------------------------------------------------ */
/* 负例：内容红线（§6）                                              */
/* ------------------------------------------------------------------ */

describe('负例：内容红线 §6', () => {
  it('§6.1 当前项目数字（1952、1759 行）→ REDLINE-NUMBER', async () => {
    const files = appendTo('methods/truth-and-lifecycle.md', '本仓库有 1952 个用例，日志 1759 行。');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'REDLINE-NUMBER'));
    assert.match(result.errors.find((e) => e.rule === 'REDLINE-NUMBER').message, /1952/);
  });

  it('§6.1 规模数字（66 个 route）→ REDLINE-NUMBER', async () => {
    const files = appendTo('methods/truth-and-lifecycle.md', '该服务有 66 个 route。');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'REDLINE-NUMBER'));
  });

  it('§6.2 Windows 绝对路径 → REDLINE-PATH', async () => {
    const files = appendTo('methods/truth-and-lifecycle.md', '配置在 E:\\work\\app\\config 里。');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'REDLINE-PATH'));
  });

  it('§6.2 内网 IP 与 localhost 端口 → REDLINE-PATH', async () => {
    const files = appendTo('methods/truth-and-lifecycle.md', '服务跑在 192.168.1.24 与 localhost:8080。');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'REDLINE-PATH'));
  });

  it('§6.3 明文密钥 → REDLINE-CRED', async () => {
    const files = appendTo('methods/truth-and-lifecycle.md', '导出时把 sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV 写进了日志。');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'REDLINE-CRED'));
  });

  it('§6.4 真实产品名 → REDLINE-WORK', async () => {
    const files = appendTo('methods/truth-and-lifecycle.md', `参考 ${'Story' + 'Forge'} 的做法。`);
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'REDLINE-WORK'));
  });

  it('§6.7 允许 agent 代签 → REDLINE-AI-SIGN', async () => {
    const files = appendTo('methods/truth-and-lifecycle.md', '允许 agent 代签验收结论。');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'REDLINE-AI-SIGN'));
  });

  it('§6.8 未加引号的「100% 完成」→ REDLINE-100', async () => {
    const files = appendTo('methods/truth-and-lifecycle.md', '本阶段 100% 完成。');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'REDLINE-100'));
  });

  it('引号内的「100% 完成」是反面示范，不应误报', async () => {
    const files = appendTo('skills/project-docs/SKILL.md', '- 常见错误：写「100% 完成」，而非「候选完成 + 证据链 + 剩余风险」。');
    const result = await validateFixture(files);
    assert.equal(result.errors.length, 0, JSON.stringify(result.errors, null, 2));
  });

  it('§6.5 大段引用 → REDLINE-QUOTE 告警', async () => {
    const files = appendTo('skills/project-docs/SKILL.md', `> ${'外部原文'.repeat(120)}`);
    const result = await validateFixture(files);
    assert.equal(result.ok, true);
    assert.ok(hasRule(result.warnings, 'REDLINE-QUOTE'));
  });
});

/* ------------------------------------------------------------------ */
/* 负例：占位符（§5）                                                 */
/* ------------------------------------------------------------------ */

describe('负例：占位符 §5', () => {
  it('模板没有任何占位符 → PLACEHOLDER 错误', async () => {
    const files = baseFiles();
    files['templates/prd.md'] = BASE_TEMPLATE.replace(/\{\{[^}]+\}\}/g, '占位');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'PLACEHOLDER'));
    assert.match(result.errors.find((e) => e.rule === 'PLACEHOLDER').message, /没有/);
  });

  it('未知占位符 → PLACEHOLDER 告警', async () => {
    const files = mutate('templates/prd.md', '{{command:test}}', '{{command:bogus}}');
    const result = await validateFixture(files);
    assert.equal(result.ok, true);
    assert.ok(hasRule(result.warnings, 'PLACEHOLDER'));
    assert.match(result.warnings.find((w) => w.rule === 'PLACEHOLDER').message, /command:bogus/);
  });

  it('模板写死 pnpm 命令 → PLACEHOLDER 错误', async () => {
    const files = mutate('templates/prd.md', '{{command:test}}', 'pnpm test');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'PLACEHOLDER'));
    assert.match(result.errors.find((e) => e.rule === 'PLACEHOLDER').message, /包管理器|pnpm/);
  });
});

/* ------------------------------------------------------------------ */
/* 负例：案例（§7）                                                   */
/* ------------------------------------------------------------------ */

describe('负例：案例结构 §7', () => {
  it('缺「当时的错误判断」→ CASE-STRUCTURE', async () => {
    const files = mutate(
      'cases/p-doc-audit/case.md',
      '## 当时的错误判断\n以为「检查器绿灯」等于分层自洽；实际两套豁免正则互相矛盾。',
      '## 补充说明\n以为绿灯等于自洽。',
    );
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'CASE-STRUCTURE'));
    assert.match(result.errors.find((e) => e.rule === 'CASE-STRUCTURE').message, /当时的错误判断/);
  });

  it('缺「来源项目（下称 P）」→ CASE-SOURCE', async () => {
    const files = mutate('cases/p-doc-audit/case.md', '来源：来源项目（下称 P）', '来源：某项目');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'CASE-SOURCE'));
  });

  it('历史案例却写 status: active → HIST-STATUS', async () => {
    const files = mutate('cases/p-doc-audit/case.md', 'status: closed', 'status: active');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'HIST-STATUS'));
  });

  it('方法把历史案例列为来源 → HIST-SOURCE 告警（§6.6）', async () => {
    const files = mutate('methods/truth-and-lifecycle.md', '  - doc:doc-index\nreview_after', '  - doc:doc-index\n  - case:p-doc-audit\nreview_after');
    const result = await validateFixture(files);
    assert.equal(result.ok, true);
    assert.ok(hasRule(result.warnings, 'HIST-SOURCE'));
  });
});

/* ------------------------------------------------------------------ */
/* patch 契约                                                          */
/* ------------------------------------------------------------------ */

describe('patch 契约', () => {
  it('本仓库真实 cordis.patch.yml 不含禁用项且必需项齐全', async () => {
    const text = await readFile(path.join(PLUGIN_ROOT, 'cordis.patch.yml'), 'utf8');
    const ctx = { errors: [], warnings: [], notes: [] };
    validatePatchText(ctx, text);
    assert.equal(ctx.errors.length, 0, JSON.stringify(ctx.errors, null, 2));
  });

  it('出现 list-agents 子路径 → PATCH-FORBIDDEN', async () => {
    const files = mutate('cordis.patch.yml', "'@deepseek-ai/dsh-skill-filesystem'", "'@deepseek-ai/dsh-skill-filesystem/list-agents'");
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'PATCH-FORBIDDEN'));
  });

  it('出现 modelSelectionSettings → PATCH-FORBIDDEN', async () => {
    const files = mutate('cordis.patch.yml', '              customSkillDirs:', '              modelSelectionSettings: true\n              customSkillDirs:');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'PATCH-FORBIDDEN'));
  });

  it('缺 plan-mode 的 section → PATCH-REQUIRED', async () => {
    const files = baseFiles();
    files['cordis.patch.yml'] = BASE_PATCH.replace(/\n {18}section: \|[\s\S]*$/, '');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'PATCH-REQUIRED'));
    assert.match(result.errors.find((e) => e.rule === 'PATCH-REQUIRED').message, /section/);
  });

  it('plan-mode 的 section 为空 → PATCH-REQUIRED', async () => {
    const files = mutate('cordis.patch.yml', 'section: |\n                    You are in plan mode until the user approves the plan; do not edit tracked files.', 'section: ""');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'PATCH-REQUIRED'));
  });

  it('缺 customSkillDirs → PATCH-REQUIRED', async () => {
    const files = mutate('cordis.patch.yml', "              customSkillDirs:\n                - !!js path.join(pkgRoot, 'skills')\n", '');
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'PATCH-REQUIRED'));
  });

  it('插件 id 重复 → PATCH-STRUCTURE', async () => {
    const files = baseFiles();
    files['cordis.patch.yml'] = `${BASE_PATCH}          - id: planning\n            name: cordis:group\n`;
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'PATCH-STRUCTURE'));
  });

  it('插件项缺 name → PATCH-STRUCTURE', async () => {
    const files = baseFiles();
    files['cordis.patch.yml'] = `${BASE_PATCH}          - id: tool-orphan\n`;
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'PATCH-STRUCTURE'));
  });
});

/* ------------------------------------------------------------------ */
/* sources.lock / check-sources / gen                                  */
/* ------------------------------------------------------------------ */

describe('来源登记 §8', () => {
  async function makeDocsPackage() {
    const root = await mkdtemp(path.join(tmpdir(), 'dpf-sources-'));
    const docsRoot = path.join(root, 'docs');
    await mkdir(docsRoot, { recursive: true });
    await writeFile(path.join(docsRoot, 'alpha.md'), '# alpha\n', 'utf8');
    await writeFile(path.join(docsRoot, 'beta.md'), '# beta\n', 'utf8');
    const built = await buildLock({ docsRoot });
    await writeFile(path.join(root, 'sources.lock.json'), built.text, 'utf8');
    return { root, docsRoot };
  }

  it('lock 与 docs 一致 → verifySources ok，且 lock 覆盖全部文档', async () => {
    const { root, docsRoot } = await makeDocsPackage();
    try {
      const result = await verifySources({ root, docsRoot });
      assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
      assert.equal(result.summary.lockEntries, 2);
      assert.equal(result.summary.hashChecked, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('源文档变更 → SOURCE-HASH，并提示重新评审而非静默改哈希', async () => {
    const { root, docsRoot } = await makeDocsPackage();
    try {
      await writeFile(path.join(docsRoot, 'alpha.md'), '# alpha changed\n', 'utf8');
      const result = await verifySources({ root, docsRoot });
      assert.equal(result.ok, false);
      assert.ok(hasRule(result.errors, 'SOURCE-HASH'));
      assert.match(result.errors.find((e) => e.rule === 'SOURCE-HASH').fix, /重新评审/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('新增文档未登记 → SOURCE-UNREGISTERED', async () => {
    const { root, docsRoot } = await makeDocsPackage();
    try {
      await writeFile(path.join(docsRoot, 'gamma.md'), '# gamma\n', 'utf8');
      const result = await verifySources({ root, docsRoot });
      assert.ok(hasRule(result.errors, 'SOURCE-UNREGISTERED'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lock 登记的文档被删除 → SOURCE-DOC-MISSING', async () => {
    const { root, docsRoot } = await makeDocsPackage();
    try {
      await rm(path.join(docsRoot, 'beta.md'));
      const result = await verifySources({ root, docsRoot });
      assert.ok(hasRule(result.errors, 'SOURCE-DOC-MISSING'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lock 缺失 → SOURCE-LOCK-MISSING；结构坏 → SOURCE-LOCK-SCHEMA', async () => {
    const { root, docsRoot } = await makeDocsPackage();
    try {
      await rm(path.join(root, 'sources.lock.json'));
      const missing = await verifySources({ root, docsRoot });
      assert.ok(hasRule(missing.errors, 'SOURCE-LOCK-MISSING'));

      await writeFile(
        path.join(root, 'sources.lock.json'),
        JSON.stringify({ schemaVersion: 1, files: [{ path: 'docs/alpha.md', sha256: 'x', lifecycle: 'active', disposition: 'method', targets: [], note: '' }] }),
        'utf8',
      );
      const schema = await verifySources({ root, docsRoot });
      assert.ok(hasRule(schema.errors, 'SOURCE-LOCK-SCHEMA'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('validatePackage 会在 docs 可用时校验 lock（缺失即失败）', async () => {
    const { root } = await makeDocsPackage();
    try {
      await rm(path.join(root, 'sources.lock.json'));
      const result = await validatePackage({ root, docsRoot: path.join(root, 'docs') });
      assert.equal(result.ok, false);
      assert.ok(hasRule(result.errors, 'SOURCE-LOCK-MISSING'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('gen-sources-lock 确定性：两次生成字节一致，--check 通过', async () => {
    const docsRoot = await mkdtemp(path.join(tmpdir(), 'dpf-gen-docs-'));
    const outRoot = await mkdtemp(path.join(tmpdir(), 'dpf-gen-out-'));
    try {
      await writeFile(path.join(docsRoot, 'one.md'), '# one\n', 'utf8');
      await writeFile(path.join(docsRoot, 'two.md'), '# two\n', 'utf8');
      const first = await buildLock({ docsRoot });
      const second = await buildLock({ docsRoot });
      assert.equal(first.text, second.text);
      assert.match(first.text, /"schemaVersion": 1/);
      assert.equal(first.lock.files.length, 2);

      const out = path.join(outRoot, 'sources.lock.json');
      const write = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts/gen-sources-lock.mjs'), '--docs', docsRoot, '--out', out], { encoding: 'utf8' });
      assert.equal(write.status, 0, write.stderr);

      const check = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts/gen-sources-lock.mjs'), '--docs', docsRoot, '--out', out, '--check'], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);

      await writeFile(path.join(docsRoot, 'one.md'), '# one changed\n', 'utf8');
      const drift = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts/gen-sources-lock.mjs'), '--docs', docsRoot, '--out', out, '--check'], { encoding: 'utf8' });
      assert.equal(drift.status, 1);
      assert.match(`${drift.stdout}${drift.stderr}`, /哈希变化|不一致/);
    } finally {
      await rm(docsRoot, { recursive: true, force: true });
      await rm(outRoot, { recursive: true, force: true });
    }
  });

  it('--strict 遇未映射文档 → 失败并说明该补映射表', async () => {
    const docsRoot = await mkdtemp(path.join(tmpdir(), 'dpf-gen-strict-'));
    try {
      await writeFile(path.join(docsRoot, 'unmapped.md'), '# unmapped\n', 'utf8');
      await assert.rejects(() => buildLock({ docsRoot, strict: true }), (error) => {
        assert.match(error.message, /未映射|disposition/);
        assert.match(error.fix, /DISPOSITION_MAP/);
        return true;
      });
    } finally {
      await rm(docsRoot, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* CLI 契约                                                           */
/* ------------------------------------------------------------------ */

describe('CLI 契约：退出码与 --help/--json', () => {
  it('--help 退出 0 并给出用法与退出码', () => {
    const result = runScript('scripts/validate-package.mjs', ['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /用法/);
    assert.match(result.stdout, /退出码/);
    assert.match(result.stdout, /--json/);
  });

  it('未知参数 → 退出码 2 并提示 --help', () => {
    const result = runScript('scripts/validate-package.mjs', ['--bogus']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--help/);
  });

  it('合法包 --json → 退出 0，ok=true，输出可解析', async () => {
    const files = baseFiles();
    const root = await makePackage(files);
    try {
      const result = runScript('scripts/validate-package.mjs', ['--root', root, '--json']);
      assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.errors.length, 0);
      assert.equal(payload.exitCode, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('非法包 --json → 退出 1，错误里带 Fix', async () => {
    const files = appendTo('methods/truth-and-lifecycle.md', '本仓库有 1952 个用例。');
    const root = await makePackage(files);
    try {
      const result = runScript('scripts/validate-package.mjs', ['--root', root, '--json']);
      assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, false);
      assert.ok(payload.errors.some((item) => item.rule === 'REDLINE-NUMBER'));
      assert.ok(payload.errors.every((item) => typeof item.fix === 'string' && item.fix.length > 0));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('--strict 让告警也失败（退出码 1）', async () => {
    const files = baseFiles();
    files['package.json'] = JSON.stringify(
      { name: '@local/dsh-project-dev-flow', version: '2.0.0', files: ['README.md'], engines: { dsh: '0.2.2-rc.3' }, dsh: { bundle: { patch: './cordis.patch.yml' } } },
      null,
      2,
    );
    const root = await makePackage(files);
    try {
      const result = runScript('scripts/validate-package.mjs', ['--root', root, '--strict', '--json']);
      assert.equal(result.status, 1);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.strict, true);
      assert.equal(payload.exitCode, 1);
      assert.ok(hasRule(payload.warnings, 'PKG-FILES'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('check-sources --help 退出 0；gen-sources-lock --help 退出 0', () => {
    assert.equal(runScript('scripts/check-sources.mjs', ['--help']).status, 0);
    assert.equal(runScript('scripts/gen-sources-lock.mjs', ['--help']).status, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 负例：新增护栏（路由 / 来源落点 / 打包完整性）                     */
/* ------------------------------------------------------------------ */

describe('负例：新增护栏', () => {
  it('验收技能缺少 disable-model-invocation: true → SKILL-DISABLE（显式白名单，不靠目录名）', async () => {
    const files = baseFiles();
    files['skills/project-acceptance/SKILL.md'] = `---
name: project-acceptance
description: 验收与证据判定：逐条判据给出结论，缺证据即降级。
whenToUse: 用户要求判定能否交付、需要证据包时。
---
# 验收
## 何时使用
- 要判交付。
## 输入
- 判据与命令。
## 步骤
- 逐条跑并记录。
## 输出
- 验收记录。
## 停止条件
- 每条判据有结论。
## 常见错误
- 未跑写通过。
`;
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'SKILL-DISABLE'), JSON.stringify(result.errors, null, 2));
    assert.match(result.errors.find((e) => e.rule === 'SKILL-DISABLE').message, /disable-model-invocation/);
  });

  it('案例只在正文出现「错误判断」但没有对应标题 → CASE-STRUCTURE（词面不算通过）', async () => {
    const files = mutate(
      'cases/p-doc-audit/case.md',
      '## 当时的错误判断\n以为「检查器绿灯」等于分层自洽；实际两套豁免正则互相矛盾。',
      '## 补充说明\n当时的错误判断是以为绿灯等于自洽。',
    );
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'CASE-STRUCTURE'));
    assert.match(result.errors.find((e) => e.rule === 'CASE-STRUCTURE').message, /当时的错误判断/);
  });

  it('删掉 cordis.patch.yml → PATCH-FILE', async () => {
    const files = baseFiles();
    delete files['cordis.patch.yml'];
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'PATCH-FILE'), JSON.stringify(result.errors, null, 2));
  });

  it('lock 声明 disposition=template 但 targets 为空 → SOURCE-LOCK-SCHEMA（空指向不算落点）', () => {
    const lock = {
      schemaVersion: 1,
      files: [
        {
          path: 'docs/a.md',
          sha256: '0'.repeat(64),
          lifecycle: 'active',
          disposition: 'template',
          targets: [],
          note: '声称提炼为模板但没有目标文件',
        },
      ],
    };
    const shape = validateLockShape(lock);
    assert.ok(hasRule(shape.errors, 'SOURCE-LOCK-SCHEMA'));
    assert.match(shape.errors.find((e) => e.rule === 'SOURCE-LOCK-SCHEMA').message, /targets/);
  });
});


/* ------------------------------------------------------------------ */
/* 负例：引擎版本与来源去向类型                                       */
/* ------------------------------------------------------------------ */

describe('负例：引擎版本与来源去向类型', () => {
  it('缺少 engines.dsh → PKG-ENGINE', async () => {
    const files = baseFiles();
    const pkg = JSON.parse(files['package.json']);
    delete pkg.engines;
    files['package.json'] = JSON.stringify(pkg, null, 2);
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'PKG-ENGINE'), JSON.stringify(result.errors, null, 2));
    assert.match(result.errors.find((e) => e.rule === 'PKG-ENGINE').message, /engines\.dsh/);
  });

  it('engines.dsh 不覆盖目标运行时 → PKG-ENGINE', async () => {
    const result = await validateFixture(baseFiles(), { dshVersion: '9.9.9' });
    assert.ok(hasRule(result.errors, 'PKG-ENGINE'), JSON.stringify(result.errors, null, 2));
    assert.match(result.errors.find((e) => e.rule === 'PKG-ENGINE').message, /9\.9\.9/);
  });

  it('engineSatisfies 支持精确版本与 >=x <y 范围', async () => {
    const { engineSatisfies } = await import('../scripts/validate-package.mjs');
    assert.equal(engineSatisfies('0.2.2-rc.3', '0.2.2-rc.3'), true);
    assert.equal(engineSatisfies('0.2.2-rc.1', '0.2.2-rc.3'), false);
    assert.equal(engineSatisfies('>=0.2.2-rc.1 <0.3.0', '0.2.2-rc.3'), true);
    assert.equal(engineSatisfies('>=0.3.0', '0.2.2-rc.3'), false);
  });

  it('disposition=method 但 targets 指向 skills/ → SOURCE-LOCK-SCHEMA（去向与类型不一致）', () => {
    const lock = {
      schemaVersion: 1,
      files: [
        {
          path: 'docs/b.md',
          sha256: '0'.repeat(64),
          lifecycle: 'active',
          disposition: 'method',
          targets: ['skills/project-dev-flow/SKILL.md'],
          note: '声称提炼为方法但落点是技能',
        },
      ],
    };
    const shape = validateLockShape(lock);
    assert.ok(hasRule(shape.errors, 'SOURCE-LOCK-SCHEMA'));
    assert.match(shape.errors.find((e) => e.rule === 'SOURCE-LOCK-SCHEMA').message, /methods\//);
  });
});

/* ------------------------------------------------------------------ */
/* 负例：展示元数据（locale）                                          */
/* ------------------------------------------------------------------ */

describe('负例：展示元数据 locale', () => {
  it('缺 meta.title → LOCALE', async () => {
    const files = baseFiles();
    files['locale/zh.json'] = JSON.stringify({ meta: { title: '', description: '有描述' } });
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'LOCALE'), JSON.stringify(result.errors, null, 2));
    assert.match(result.errors.find((e) => e.rule === 'LOCALE').message, /meta\.title/);
  });

  it('meta.detail 指向不存在的文件 → LOCALE', async () => {
    const files = baseFiles();
    files['locale/zh.json'] = JSON.stringify({ meta: { title: '标题', description: '描述', detail: 'detail/MISSING.md' } });
    const result = await validateFixture(files);
    assert.ok(hasRule(result.errors, 'LOCALE'));
    assert.match(result.errors.find((e) => e.rule === 'LOCALE').message, /不存在/);
  });

  it('合法 locale → 无 LOCALE 错误', async () => {
    const files = baseFiles();
    files['locale/zh.json'] = JSON.stringify({ meta: { title: '标题', description: '描述' } });
    const result = await validateFixture(files);
    assert.equal(result.errors.filter((e) => e.rule === 'LOCALE').length, 0);
  });
});
