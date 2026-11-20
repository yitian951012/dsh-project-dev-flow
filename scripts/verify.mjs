#!/usr/bin/env node
/**
 * verify.mjs — 统一验证管道
 *
 * 把分散的 npm script 串成一条可复跑的链路，并给出机器可读结果：
 *   validate → sources(require-docs) → lock 确定性 → patch(require-yaml)
 *   → 单元契约测试 → 作者侧集成测试 → 打包面
 *
 * 设计约束：
 *   - 只做「调用已有检查器」，不在这里复制规则；
 *   - 任一步非零退出即整体失败，并**继续跑完**后续步骤（一次拿到全部证据）；
 *   - 明确标注「未验证」项，不把降级当通过。
 *
 * 用法：node scripts/verify.mjs [--json] [--quiet]
 * 退出码：0 全部通过；1 有步骤失败；2 用法错误。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const STEPS = [
  { id: 'validate', label: '结构 / 红线 / 链接 / 篇幅', cmd: [process.execPath, ['scripts/validate-package.mjs']] },
  { id: 'sources', label: '来源登记一致性（强制要有 docs）', cmd: [process.execPath, ['scripts/check-sources.mjs', '--require-docs']] },
  { id: 'lock', label: '来源锁确定性（不写盘）', cmd: [process.execPath, ['scripts/gen-sources-lock.mjs', '--check']] },
  { id: 'patch', label: 'YAML 语义 + 算力预算 + !!js 允许清单', cmd: [process.execPath, ['scripts/check-patch-yaml.mjs', '--require-yaml']] },
  { id: 'test', label: '包内契约测试', cmd: [process.execPath, ['--test', 'tests/validate-package.test.mjs', 'tests/check-patch-yaml.test.mjs', 'tests/section.test.mjs', 'tests/contract-consistency.test.mjs']] },
  { id: 'test:source', label: '作者侧集成测试', cmd: [process.execPath, ['--test', 'tests/source-integration.test.mjs']] },
  { id: 'pack', label: '打包文件面', cmd: [npmCommand(), ['pack', '--dry-run', '--json', '--ignore-scripts'], true] },
];

function npmCommand() {
  return 'npm';
}

function parseTestTotals(stdout) {
  const totals = {};
  for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const match = new RegExp(`^# ${key} (\\d+)$`, 'm').exec(stdout);
    if (match) totals[key] = Number(match[1]);
  }
  return Object.keys(totals).length > 0 ? totals : null;
}

function parsePackFiles(stdout) {
  try {
    const payload = JSON.parse(stdout);
    const entry = Array.isArray(payload) ? payload[0] : payload;
    if (!entry) return null;
    return { files: Array.isArray(entry.files) ? entry.files.length : 0, size: entry.size ?? null, filename: entry.filename ?? null };
  } catch {
    return null;
  }
}

function runStep(step) {
  const [command, args, useShell = false] = step.cmd;
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: PLUGIN_ROOT,
    encoding: 'utf8',
    shell: useShell,
    env: process.env,
  });
  const durationMs = Date.now() - started;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const exitCode = result.status ?? 1;

  const metrics = {};
  if (step.id === 'test' || step.id === 'test:source') {
    const totals = parseTestTotals(stdout);
    if (totals) metrics.tests = totals;
  }
  if (step.id === 'pack') {
    const pack = parsePackFiles(stdout);
    if (pack) metrics.pack = pack;
  }
  if (step.id === 'lock' || step.id === 'sources') {
    const match = /(\d+)\s*份文档\s*\/\s*(\d+)\s*条登记/.exec(stdout);
    if (match) metrics.docs = { docs: Number(match[1]), entries: Number(match[2]) };
  }

  return {
    id: step.id,
    label: step.label,
    command: `${path.basename(command)} ${args.join(' ')}`,
    exitCode,
    ok: exitCode === 0,
    durationMs,
    metrics,
    stdoutTail: stdout.trim().split(/\r?\n/).slice(-4),
    stderrTail: stderr.trim() ? stderr.trim().split(/\r?\n/).slice(-4) : [],
  };
}

function main(argv) {
  const json = argv.includes('--json');
  const quiet = argv.includes('--quiet');

  const results = STEPS.map(runStep);
  const failed = results.filter((step) => !step.ok);
  const payload = {
    tool: 'dsh-project-dev-flow/verify',
    root: PLUGIN_ROOT,
    generatedAt: new Date().toISOString(),
    node: process.version,
    ok: failed.length === 0,
    steps: results,
    failed: failed.map((step) => step.id),
    // 本管道只覆盖包内检查；装配与卸载回滚由 smoke:profile 单独覆盖。
    notVerified: ['真实会话中的技能自动路由与 slash 调用', '工具 schema 与 token 实测', '真实模型的任务成功率'],
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write('\nDSH 项目开发流程 · verify\n');
    for (const step of results) {
      const icon = step.ok ? '✔' : '✗';
      const extra = step.metrics.tests
        ? `  tests=${step.metrics.tests.tests ?? '?'} pass=${step.metrics.tests.pass ?? '?'} fail=${step.metrics.tests.fail ?? '?'}`
        : step.metrics.pack
          ? `  files=${step.metrics.pack.files}`
          : '';
      process.stdout.write(`${icon} ${step.id.padEnd(12)} exit=${step.exitCode} ${step.durationMs}ms${extra}\n`);
      if (!step.ok && !quiet) {
        for (const line of [...step.stdoutTail, ...step.stderrTail]) process.stdout.write(`      ${line}\n`);
      }
    }
    process.stdout.write(`\n${failed.length === 0 ? '✔ 全部通过' : `✗ ${failed.length} 个步骤失败：${failed.map((s) => s.id).join('、')}`}\n`);
    process.stdout.write('ℹ 未验证（需真实宿主）：技能路由、slash 调用、工具 schema 与 token 实测\n');
  }

  return failed.length === 0 ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
