#!/usr/bin/env node
/**
 * release-evidence.mjs — 生成一次可复核的发布证据清单
 *
 * 把「这次发布凭什么说能发」写成机器可读 JSON + 人读 Markdown：
 *   - 版本 / 包名 / engines / 当前 commit / 工作区是否干净
 *   - Node / npm / 包内 YAML 解析器版本
 *   - verify 管道每一步的退出码与关键指标
 *   - 关键文件 sha256（package.json / package-lock.json / cordis.patch.yml / sources.lock.json）
 *   - 明确列出「未验证」项，避免把包内通过当运行时验收
 *
 * 用法：node scripts/release-evidence.mjs [--out <dir>] [--quiet]
 * 默认输出到 evidence/release-<version>.json 与 .md
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function gitInfo() {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: PLUGIN_ROOT, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: PLUGIN_ROOT, encoding: 'utf8' });
  return {
    commit: head.status === 0 ? head.stdout.trim() : null,
    clean: status.status === 0 ? status.stdout.trim() === '' : null,
    note: head.status === 0 ? null : '当前目录不是 git 仓库：commit / clean 无法判定',
  };
}

function parserVersion() {
  // 直接读包内的清单：此前的 `node -p "require(...)"` 在 "type": "module" 下解析不了，会静默报「未验证」。
  try {
    const manifest = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, 'node_modules', 'yaml', 'package.json'), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

async function fileHashes() {
  const files = ['package.json', 'package-lock.json', 'cordis.patch.yml', 'sources.lock.json', 'client/client.js', 'schema/board.schema.json', 'index.js'];
  const out = {};
  for (const rel of files) {
    const abs = path.join(PLUGIN_ROOT, rel);
    if (!existsSync(abs)) {
      out[rel] = null;
      continue;
    }
    out[rel] = sha256(await readFile(abs));
  }
  return out;
}

async function readAcceptance(version) {
  const file = path.join(PLUGIN_ROOT, 'evidence', `acceptance-${version}.json`);
  if (!existsSync(file)) {
    return { present: false, status: 'not-run', note: '未运行真实会话验收（node scripts/acceptance-session.mjs）' };
  }
  try {
    const payload = JSON.parse(await readFile(file, 'utf8'));
    return {
      present: true,
      status: payload.status,
      blockedReason: payload.blockedReason ?? null,
      mount: payload.mount ?? null,
      tasks: (payload.tasks ?? []).map((task) => ({
        id: task.id, kind: task.kind, expect: task.expect, exitCode: task.exitCode, matched: task.matched,
        error: task.error?.code ?? null,
      })),
      generatedAt: payload.generatedAt ?? null,
    };
  } catch (error) {
    return { present: true, status: 'unreadable', note: error.message };
  }
}

function runVerify() {
  const result = spawnSync(process.execPath, ['scripts/verify.mjs', '--json'], {
    cwd: PLUGIN_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  let payload = null;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    payload = null;
  }
  return { exitCode: result.status ?? 1, payload, stderrTail: (result.stderr ?? '').trim().split(/\r?\n/).slice(-3) };
}

function renderMarkdown(evidence) {
  const lines = [];
  lines.push(`# 发布证据：${evidence.package}@${evidence.version}`);
  lines.push('');
  lines.push(`> 生成时间：${evidence.generatedAt} · 结论：${evidence.verify.ok ? '**包内验证全部通过**' : '**存在失败步骤，不可发布**'}`);
  lines.push('');
  lines.push('## 基线与制品');
  lines.push('');
  lines.push('| 项 | 值 |');
  lines.push('| :--- | :--- |');
  lines.push(`| 包名 | \`${evidence.package}\` |`);
  lines.push(`| 版本 | \`${evidence.version}\` |`);
  lines.push(`| engines.dsh | \`${evidence.engines.dsh}\` |`);
  lines.push(`| engines.node | \`${evidence.engines.node ?? '未验证'}\` |`);
  lines.push(`| dsh.client | ${evidence.dshClient ? `\`${evidence.dshClient.platform ?? '未声明 platform'}\`` : '未声明'} |`);
  lines.push(`| commit | \`${evidence.git.commit ?? '未验证'}\` |`);
  lines.push(`| 工作区干净 | ${evidence.git.clean === null ? '未验证' : evidence.git.clean ? '是' : '否'} |`);
  lines.push(`| Node | \`${evidence.runtime.node}\` |`);
  lines.push(`| npm | \`${evidence.runtime.npm}\` |`);
  lines.push(`| 包内 YAML 解析器 | ${evidence.runtime.yaml ?? '未验证'} |`);
  lines.push('');
  lines.push('## 验证步骤');
  lines.push('');
  lines.push('| 步骤 | 退出码 | 耗时 | 关键指标 |');
  lines.push('| :--- | :---: | :---: | :--- |');
  for (const step of evidence.verify.steps) {
    const metric = step.metrics.tests
      ? `tests=${step.metrics.tests.tests ?? '?'} / pass=${step.metrics.tests.pass ?? '?'}`
      : step.metrics.pack
        ? `files=${step.metrics.pack.files}`
        : step.metrics.docs
          ? `docs=${step.metrics.docs.docs} / entries=${step.metrics.docs.entries}`
          : '—';
    lines.push(`| \`${step.id}\` | ${step.exitCode} | ${step.durationMs}ms | ${metric} |`);
  }
  lines.push('');
  lines.push('## 关键文件哈希');
  lines.push('');
  lines.push('| 文件 | sha256 |');
  lines.push('| :--- | :--- |');
  for (const [rel, hash] of Object.entries(evidence.hashes)) {
    lines.push(`| \`${rel}\` | \`${hash ?? '未验证'}\` |`);
  }
  lines.push('');
  lines.push('## 真实会话验收');
  lines.push('');
  const acc = evidence.acceptance;
  lines.push(`| 项 | 值 |`);
  lines.push('| :--- | :--- |');
  lines.push(`| 状态 | **${acc.status}** |`);
  lines.push(`| 技能目录进入运行时配置 | ${acc.mount ? (acc.mount.ok ? '是' : '否') : '未验证'} |`);
  lines.push(`| 证据时间 | ${acc.generatedAt ?? '—'} |`);
  if (acc.blockedReason) lines.push(`| 阻塞原因 | ${acc.blockedReason.replace(/\|/g, '\\|')} |`);
  lines.push('');
  if (Array.isArray(acc.tasks) && acc.tasks.length > 0) {
    lines.push('| 任务 | 期望技能 | 退出码 | 命中 | 错误 |');
    lines.push('| :--- | :--- | ---: | :---: | :--- |');
    for (const task of acc.tasks) {
      lines.push(`| \`${task.id}\` | \`${task.expect}\` | ${task.exitCode} | ${task.matched ? '是' : '否'} | ${task.error ?? '—'} |`);
    }
    lines.push('');
  }
  lines.push('## 未验证（需要真实宿主，不能由本清单替代）');
  lines.push('');
  for (const item of evidence.notVerified) lines.push(`- ${item}`);
  lines.push('');
  lines.push('> 本清单证明的是「当前 commit 上包内检查全部通过」。它**不证明** DSH 装配、技能路由、升级回滚可用；那需要隔离 profile 的真实安装记录。');
  return `${lines.join('\n')}\n`;
}

async function main(argv) {
  const outIndex = argv.indexOf('--out');
  const outDir = outIndex >= 0 ? path.resolve(argv[outIndex + 1]) : path.join(PLUGIN_ROOT, 'evidence');
  const quiet = argv.includes('--quiet');

  const pkg = JSON.parse(await readFile(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'));
  const npmVersion = spawnSync('npm', ['--version'], { encoding: 'utf8', shell: true }).stdout.trim() || null;
  const verify = runVerify();

  const evidence = {
    generatedAt: new Date().toISOString(),
    package: pkg.name,
    version: pkg.version,
    engines: pkg.engines ?? {},
    dshClient: pkg.dsh?.client ?? null,
    runtime: { node: process.version, npm: npmVersion, yaml: parserVersion() },
    git: gitInfo(),
    hashes: await fileHashes(),
    verify: {
      ok: Boolean(verify.payload?.ok) && verify.exitCode === 0,
      exitCode: verify.exitCode,
      steps: verify.payload?.steps ?? [],
      failed: verify.payload?.failed ?? [],
      note: verify.payload ? null : `verify 未产出 JSON（stderr：${verify.stderrTail.join(' / ')}）`,
    },
    acceptance: await readAcceptance(pkg.version),
    notVerified: verify.payload?.notVerified ?? [
      'DSH 实际装配 / preset 可见性',
      '技能自动路由与 slash 调用',
      '升级与回滚',
      '隔离 profile 安装',
    ],
  };

  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `release-${pkg.version}.json`);
  const mdPath = path.join(outDir, `release-${pkg.version}.md`);
  await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await writeFile(mdPath, renderMarkdown(evidence), 'utf8');

  if (!quiet) {
    process.stdout.write(`\n发布证据已写入：\n  ${jsonPath}\n  ${mdPath}\n`);
    process.stdout.write(`结论：${evidence.verify.ok ? '包内验证全部通过' : '存在失败步骤，不可发布'}；真实会话验收：${evidence.acceptance.status}\n`);
  }

  return evidence.verify.ok ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
