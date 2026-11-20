#!/usr/bin/env node
/**
 * metrics.mjs — 算力预算的可复算度量
 *
 * 2.1.0 声称「减少上下文与工具块」，但当时没有任何前后对照数据。本脚本把可静态测量的部分固定下来：
 *   - 人格段字符数（prefix + suffix）
 *   - 计划模式 section 字符数
 *   - preset 声明的插件项数 / 显式禁用项数
 *   - 技能 SKILL.md 与 references 的字节数
 *   - 方法文件「整份读」与「只读 §2–§3」的字节差
 *
 * 基线取 git 标签 v2.0.1（同一仓库的历史版本），当前取工作区。
 * 明确不测量：真实 token 数、工具 schema 的字节数、模型实际读取量——这些需要真实会话与宿主采样。
 *
 * 用法：node scripts/metrics.mjs [--baseline v2.0.1] [--json] [--out <dir>]
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const YAML = require('yaml');

function git(args) {
  return execFileSync('git', args, { cwd: PLUGIN_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function collectItems(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectItems(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  if (typeof node.id === 'string' && typeof node.name === 'string') out.push(node);
  for (const value of Object.values(node)) collectItems(value, out);
  return out;
}

function measurePatch(text) {
  const doc = YAML.parseDocument(text, { logLevel: 'silent' });
  const items = collectItems(doc.toJS());
  let personaChars = 0;
  let planSectionChars = 0;
  for (const item of items) {
    const config = item.config ?? {};
    if (typeof config.prefix === 'string') personaChars += config.prefix.length;
    if (typeof config.suffix === 'string') personaChars += config.suffix.length;
    if (typeof config.section === 'string') planSectionChars += config.section.length;
  }
  return {
    personaChars,
    planSectionChars,
    pluginItems: items.filter((item) => item.name !== '@deepseek-ai/dsh-agent-preset').length,
    declaredDisabled: items.filter((item) => item.disabled === true).length,
  };
}

function sliceSections(text, from, to) {
  const lines = text.split(/\r?\n/);
  const startOf = (n) => lines.findIndex((line) => new RegExp(`^##\\s+${n}\\.(?:\\s|$)`).test(line));
  const start = startOf(from);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

function measureMethodsFromDisk() {
  const dir = path.join(PLUGIN_ROOT, 'methods');
  const files = readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
  let fullBytes = 0;
  let sectionBytes = 0;
  const perFile = [];
  for (const name of files) {
    const text = readFileSync(path.join(dir, name), 'utf8');
    const sliced = sliceSections(text, 2, 3) ?? '';
    fullBytes += Buffer.byteLength(text, 'utf8');
    sectionBytes += Buffer.byteLength(sliced, 'utf8');
    perFile.push({ name, fullBytes: Buffer.byteLength(text, 'utf8'), sectionBytes: Buffer.byteLength(sliced, 'utf8') });
  }
  return { files: files.length, fullBytes, sectionBytes, perFile };
}

function measureMethodsFromGit(ref) {
  const names = git(['ls-tree', '-r', '--name-only', ref, 'methods/']).trim().split(/\r?\n/).filter(Boolean);
  let fullBytes = 0;
  let sectionBytes = 0;
  for (const rel of names) {
    const text = git(['show', `${ref}:${rel}`]);
    const sliced = sliceSections(text, 2, 3) ?? '';
    fullBytes += Buffer.byteLength(text, 'utf8');
    sectionBytes += Buffer.byteLength(sliced, 'utf8');
  }
  return { files: names.length, fullBytes, sectionBytes };
}

function measureSkillsFromDisk() {
  const dir = path.join(PLUGIN_ROOT, 'skills');
  let files = 0;
  let bytes = 0;
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, entry.name);
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        files += 1;
        bytes += statSync(childAbs).size;
      }
    }
  };
  walk(dir, 'skills');
  return { files, bytes };
}

function measureSkillsFromGit(ref) {
  const names = git(['ls-tree', '-r', '--name-only', ref, 'skills/']).trim().split(/\r?\n/).filter((rel) => rel.endsWith('.md'));
  let bytes = 0;
  for (const rel of names) bytes += Buffer.byteLength(git(['show', `${ref}:${rel}`]), 'utf8');
  return { files: names.length, bytes };
}

function ratio(a, b) {
  if (b === 0) return null;
  return Number(((a / b) * 100).toFixed(1));
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# 算力预算度量：${report.currentLabel} vs ${report.baselineLabel}`);
  lines.push('');
  lines.push(`> 生成时间：${report.generatedAt} · 基线 ${report.baselineLabel}（commit ${report.baselineCommit}）`);
  lines.push('');
  lines.push('## 静态可测项');
  lines.push('');
  lines.push('| 指标 | 基线 | 当前 | 变化 |');
  lines.push('| :--- | ---: | ---: | ---: |');
  const row = (label, a, b, unit = '') => {
    const delta = b - a;
    const pct = a === 0 ? '—' : `${delta >= 0 ? '+' : ''}${ratio(delta, a)}%`;
    lines.push(`| ${label} | ${a}${unit} | ${b}${unit} | ${delta >= 0 ? '+' : ''}${delta}${unit}（${pct}） |`);
  };
  row('人格段字符', report.baseline.patch.personaChars, report.current.patch.personaChars);
  row('计划模式 section 字符', report.baseline.patch.planSectionChars, report.current.patch.planSectionChars);
  row('preset 插件项', report.baseline.patch.pluginItems, report.current.patch.pluginItems, ' 项');
  row('显式禁用项', report.baseline.patch.declaredDisabled, report.current.patch.declaredDisabled, ' 项');
  row('技能 Markdown 字节', report.baseline.skills.bytes, report.current.skills.bytes, ' B');
  row('方法整份读字节', report.baseline.methods.fullBytes, report.current.methods.fullBytes, ' B');
  row('方法 §2–§3 字节', report.baseline.methods.sectionBytes, report.current.methods.sectionBytes, ' B');
  lines.push('');
  lines.push(`方法读取节省：${report.current.methods.fullBytes - report.current.methods.sectionBytes} B（按节读相对整份读，${ratio(report.current.methods.sectionBytes, report.current.methods.fullBytes)}%）。`);
  lines.push('');
  lines.push('## 未测量项（需要真实宿主采样）');
  lines.push('');
  for (const item of report.notMeasured) lines.push(`- ${item}`);
  lines.push('');
  lines.push(`> 字符与字节不等于 token：这里只能证明「声明面积」变小或变大，不能证明模型实际少付了多少。`);
  return `${lines.join('\n')}\n`;
}

async function main(argv) {
  const baseIndex = argv.indexOf('--baseline');
  const baselineRef = baseIndex >= 0 ? argv[baseIndex + 1] : 'v2.0.1';
  const outIndex = argv.indexOf('--out');
  const outDir = outIndex >= 0 ? path.resolve(argv[outIndex + 1]) : path.join(PLUGIN_ROOT, 'evidence');
  const json = argv.includes('--json');

  const pkg = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'));
  let baselinePatch;
  try {
    baselinePatch = git(['show', `${baselineRef}:cordis.patch.yml`]);
  } catch {
    process.stdout.write(`✗ 找不到基线 ${baselineRef}：先确认 git 标签存在\n`);
    return 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baselineLabel: baselineRef,
    baselineCommit: git(['rev-parse', '--short', baselineRef]).trim(),
    currentLabel: `${pkg.name}@${pkg.version}`,
    baseline: {
      patch: measurePatch(baselinePatch),
      skills: measureSkillsFromGit(baselineRef),
      methods: measureMethodsFromGit(baselineRef),
    },
    current: {
      patch: measurePatch(readFileSync(path.join(PLUGIN_ROOT, 'cordis.patch.yml'), 'utf8')),
      skills: measureSkillsFromDisk(),
      methods: measureMethodsFromDisk(),
    },
    notMeasured: [
      '真实 token 数（需对系统提示与工具 schema 做宿主侧采样）',
      '工具 schema 字节数（dump 到实际注册的 JSON Schema）',
      '模型实际读取的文件与次数（需会话轨迹）',
      '任务成功率与人工接管次数（需真实任务统计）',
    ],
  };

  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `metrics-${pkg.version}.json`);
  const mdPath = path.join(outDir, `metrics-${pkg.version}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(mdPath, renderMarkdown(report), 'utf8');

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderMarkdown(report));
    process.stdout.write(`\n已写入：\n  ${jsonPath}\n  ${mdPath}\n`);
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
