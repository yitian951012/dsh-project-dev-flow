#!/usr/bin/env node
/**
 * acceptance-session.mjs — 真实会话验收（技能自动路由 + slash 显式调用）
 *
 * 包内测试只能证明「技能文件存在、frontmatter 合法、命令字符串正确」，
 * 证明不了「选了模式之后模型真的路由到技能；slash 手势真的注入技能」。
 *
 * 本脚本不改宿主 profile：用 --patch 临时覆盖 skill-filesystem 的 customSkillDirs，
 * 跑三条任务（两条自动路由 + 一条 slash），用 --json 采集事件并断言。
 *
 * 没有模型凭据时返回 3（blocked），把错误原文写进证据——不把「跑不了」记成「通过」。
 *
 * 用法：node scripts/acceptance-session.mjs [--profile headless] [--json]
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const TASKS = [
  {
    id: 'route-docs',
    kind: 'route',
    expect: 'project-docs',
    prompt: '这个仓库的文档有点乱，同一件事写在好几处，文档和代码也开始对不上了。帮我梳理一下该怎么治理。',
    note: '不点名技能，观察是否自动路由到文档治理技能',
  },
  {
    id: 'route-intake',
    kind: 'route',
    expect: 'project-intake',
    prompt: '我们要给插件加一个导出功能，你先把需求接下来：判断类型、列出判据和需要谁拍板。',
    note: '不点名技能，观察是否自动路由到需求受理技能',
  },
  {
    id: 'slash-acceptance',
    kind: 'slash',
    expect: 'project-acceptance',
    prompt: '/project-acceptance 给出三条交付判定要点，并说明需要哪些证据。',
    note: '斜杠手势：验证显式调用能注入技能',
  },
];

function runDsh(profile, overlay, prompt) {
  const result = spawnSync('dsh', ['--profile', profile, '--patch', overlay, '--json', prompt], {
    cwd: PLUGIN_ROOT,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function parseEvents(stdout) {
  const events = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try { events.push(JSON.parse(trimmed)); } catch { /* 非事件行忽略 */ }
  }
  return events;
}

function errorOf(events, raw) {
  const final = events.find((event) => event.type === 'final');
  if (final && final.reason && final.reason.kind === 'error') {
    const err = final.reason.error || {};
    return { code: err.code || 'UNKNOWN', message: err.message || '' };
  }
  if (/MISSING_CREDENTIAL|NO_ADAPTER/.test(raw)) {
    return { code: 'MISSING_CREDENTIAL', message: raw.trim().split(/\r?\n/).slice(-1)[0] || '' };
  }
  return null;
}

async function main(argv) {
  const profileIndex = argv.indexOf('--profile');
  const profile = profileIndex >= 0 ? argv[profileIndex + 1] : 'headless';
  const asJson = argv.includes('--json');

  const pkg = JSON.parse(await readFile(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'));
  const result = {
    generatedAt: new Date().toISOString(),
    package: pkg.name,
    version: pkg.version,
    profile,
    skillDir: path.join(PLUGIN_ROOT, 'skills'),
    prerequisites: [
      '目标 profile 必须有一条可用的模型路由（桌面端凭据不会自动注入 CLI）',
      'DSH 需提供 skill / skill-filesystem / tool-skill / commands 插件（base 自带）',
    ],
    mount: null,
    tasks: [],
    status: 'blocked',
    summary: '',
    blockedReason: null,
  };

  const tmp = await mkdtemp(path.join(tmpdir(), 'dpf-accept-'));
  const overlay = path.join(tmp, 'overlay.yml');
  const skillsDir = path.join(PLUGIN_ROOT, 'skills').replace(/\\/g, '/');
  await writeFile(
    overlay,
    `- id: skill-filesystem\n  config:\n    customSkillDirs:\n      - ${skillsDir}\n`,
    'utf8',
  );

  try {
    const dump = spawnSync('dsh', ['--profile', profile, '--patch', overlay, '--dump-config'], {
      cwd: PLUGIN_ROOT, encoding: 'utf8', shell: true, maxBuffer: 32 * 1024 * 1024,
    });
    const dumpText = dump.stdout || '';
    result.mount = {
      ok: dump.status === 0 && dumpText.includes('dsh-project-dev-flow/skills'),
      exitCode: dump.status ?? 1,
      customSkillDirsVisible: /customSkillDirs/.test(dumpText),
      skillsDir,
    };

    for (const task of TASKS) {
      const run = runDsh(profile, overlay, task.prompt);
      const events = parseEvents(run.stdout);
      const err = errorOf(events, run.stdout + '\n' + run.stderr);
      const matched = run.stdout.includes(task.expect) || run.stderr.includes(task.expect);
      result.tasks.push({
        id: task.id,
        kind: task.kind,
        expect: task.expect,
        prompt: task.prompt,
        note: task.note,
        exitCode: run.status,
        eventCount: events.length,
        matched,
        error: err,
        excerpt: run.stdout.split(/\r?\n/).filter((line) => line.trim().startsWith('{')).slice(0, 3),
      });
    }

    const blocked = result.tasks.some((task) => task.error && /MISSING_CREDENTIAL|NO_ADAPTER/.test(task.error.code));
    const allPassed = !blocked && result.tasks.every((task) => task.exitCode === 0 && task.matched && !task.error);

    result.status = blocked ? 'blocked' : allPassed ? 'passed' : 'failed';
    result.summary = blocked
      ? '模型凭据未注入 CLI：任务未真正执行，不能记为通过'
      : allPassed
        ? '技能自动路由与 slash 显式调用均命中'
        : '会话已执行但未命中预期技能，需人工看会话内容';
    result.blockedReason = blocked
      ? (result.tasks.find((task) => task.error) || {}).error?.message || ''
      : null;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  const outDir = path.join(PLUGIN_ROOT, 'evidence');
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `acceptance-${pkg.version}.json`);
  const mdPath = path.join(outDir, `acceptance-${pkg.version}.md`);
  await writeFile(jsonPath, JSON.stringify(result, null, 2) + '\n', 'utf8');

  const lines = [
    `# 真实会话验收：${result.package}@${result.version}`,
    '',
    `> 时间：${result.generatedAt} · profile：\`${result.profile}\` · 结论：**${result.status}**`,
    '',
    result.summary,
    '',
    '## 前置条件',
    '',
    ...result.prerequisites.map((item) => `- ${item}`),
    '',
    '## 装配（不调用模型）',
    '',
    `- 技能目录进入运行时配置：${result.mount.ok ? '是' : '否'}`,
    `- customSkillDirs 可见：${result.mount.customSkillDirsVisible ? '是' : '否'}`,
    `- 路径：\`${result.mount.skillsDir}\``,
    '',
    '## 任务',
    '',
    '| 任务 | 类型 | 期望命中 | 退出码 | 命中 | 错误 |',
    '| :--- | :--- | :--- | ---: | :---: | :--- |',
    ...result.tasks.map((task) => `| \`${task.id}\` | ${task.kind} | \`${task.expect}\` | ${task.exitCode} | ${task.matched ? '是' : '否'} | ${task.error ? task.error.code : '—'} |`),
    '',
  ];
  if (result.blockedReason) {
    lines.push('## 阻塞原因（原文）', '', '```text', result.blockedReason, '```', '');
  }
  lines.push('> 本文件是验收证据，不是承诺：只有 status=passed 且三条任务均命中，才算真实会话通过。');
  await writeFile(mdPath, lines.join('\n') + '\n', 'utf8');

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`\n真实会话验收：${result.status}\n`);
    process.stdout.write(`  装配：${result.mount.ok ? '✔' : '✗'}  skillsDir=${result.mount.skillsDir}\n`);
    for (const task of result.tasks) {
      const mark = task.exitCode === 0 && task.matched ? '✔' : '✗';
      process.stdout.write(`  ${mark} ${task.id}（期望 ${task.expect}）${task.error ? ' —— ' + task.error.code : ''}\n`);
    }
    if (result.blockedReason) process.stdout.write(`  阻塞：${result.blockedReason}\n`);
    process.stdout.write(`  证据：${jsonPath}\n`);
  }

  return result.status === 'passed' ? 0 : result.status === 'blocked' ? 3 : 1;
}

process.exitCode = await main(process.argv.slice(2));
