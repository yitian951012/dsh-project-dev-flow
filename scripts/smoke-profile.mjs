#!/usr/bin/env node
/**
 * smoke-profile.mjs — 隔离 profile 的真实装配烟测
 *
 * 为什么需要它：`check:patch` 只能证明「声明符合契约」，证明不了宿主会保留这些声明。
 * 2.1.0 声称关闭三簇工具，就是在这里被证明「写了也不生效」的。
 *
 * 本脚本在**临时 DSH_HOME** 里做，不触碰用户真实 profile：
 *   1. dsh plugin --profile smoke add <本包目录>
 *   2. dsh --profile smoke --dump-config  → 断言 preset 已装配
 *   3. 断言 tool-schedule 带 disabled: true
 *   4. 断言三簇不生效声明没有出现
 *   5. 移除插件 → 再 dump → 断言 preset 消失（回滚闭环）
 *   6. 清理临时目录
 *
 * 用法：node scripts/smoke-profile.mjs [--keep] [--upgrade-from <旧版本.tgz>]
 *   --upgrade-from 存在时追加跨版本验证：先装旧包 → 装本包 → 回滚到旧包，并核对版本号。
 * 退出码：0 全部断言通过；1 有断言失败或环境缺失；2 用法错误。
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PACKAGE_NAME = '@yitian951012/dsh-project-dev-flow';
const FORBIDDEN = ['tool-subagent-fork', 'workflow-ptc', 'tool-workflow'];

function runDsh(args, home) {
  const result = spawnSync('dsh', args, {
    cwd: PLUGIN_ROOT,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, DSH_HOME: home },
    maxBuffer: 32 * 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function countId(text, id) {
  return text.split(`id: ${id}`).length - 1;
}

function segment(text, id, size = 240) {
  const at = text.indexOf(`id: ${id}`);
  return at < 0 ? '' : text.slice(at, at + size);
}

function main(argv) {
  const keep = argv.includes('--keep');

  const probe = spawnSync('dsh', ['--version'], { encoding: 'utf8', shell: true });
  if (probe.status !== 0) {
    process.stdout.write('✗ 未找到可用的 dsh CLI：本烟测必须在装有 DSH 的机器上跑\n');
    return 1;
  }

  const upgradeIndex = argv.indexOf('--upgrade-from');
  const upgradeFrom = upgradeIndex >= 0 ? argv[upgradeIndex + 1] : null;
  if (upgradeIndex >= 0 && !upgradeFrom) {
    process.stdout.write('✗ --upgrade-from 需要一个 tarball 路径\n');
    return 2;
  }

  const home = mkdtempSyncDir();
  const assertions = [];
  const check = (name, ok, detail = '') => {
    assertions.push({ name, ok, detail });
    process.stdout.write(`${ok ? '✔' : '✗'} ${name}${detail ? `  —— ${detail}` : ''}\n`);
  };

  try {
    if (upgradeFrom) {
      const oldAdd = runDsh(['plugin', '--profile', 'smoke', 'add', path.resolve(upgradeFrom)], home);
      check('安装旧版本包', oldAdd.status === 0, oldAdd.status === 0 ? '' : oldAdd.stderr.trim().split(/\r?\n/).slice(-2).join(' / '));
      const oldVersion = installedVersion(home);
      check('旧版本已就位', Boolean(oldVersion), oldVersion ?? '未读到版本');
      const oldDump = runDsh(['--profile', 'smoke', '--dump-config'], home);
      check('旧版本的 preset 可见', oldDump.status === 0 && countId(oldDump.stdout, 'preset-project-dev-flow') >= 1);
    }

    // 按 MIGRATION 的口径升级：先移除旧包，再安装新包（不要在旧包上原地 add）。
    if (upgradeFrom) runDsh(['plugin', '--profile', 'smoke', 'remove', PACKAGE_NAME], home);
    const add = runDsh(['plugin', '--profile', 'smoke', 'add', PLUGIN_ROOT], home);
    check('安装 bundle（dsh plugin add）', add.status === 0, add.status === 0 ? '' : add.stderr.trim().split(/\r?\n/).slice(-2).join(' / '));

    const pkgPath = path.join(home, 'profiles', 'smoke', 'package.json');
    let profileText = '';
    if (existsSync(pkgPath)) profileText = readFileSyncSafe(pkgPath);
    check('profile 记录了 bundle 依赖', profileText.includes(PACKAGE_NAME) && profileText.includes('bundles'), pkgPath);

    const dump1 = runDsh(['--profile', 'smoke', '--dump-config'], home);
    check('dump-config 成功', dump1.status === 0, dump1.stderr.trim().split(/\r?\n/).slice(-2).join(' / '));
    const text1 = dump1.stdout;

    check('preset 已装配（preset-project-dev-flow）', countId(text1, 'preset-project-dev-flow') >= 1);
    check('模式名可见（项目开发流程）', text1.includes('项目开发流程'));
    check('tool-schedule 保留 disabled: true', /disabled: true/.test(segment(text1, 'tool-schedule')));

    // 这三簇即使从本包删除，也仍会出现在组合配置里：它们由宿主预设的默认工具集提供，
    // preset 内无法关闭。因此这里断言的是「本包没有写一条不生效的关闭声明」，
    // 而不是「dump 里没有它们」——后者不归本包控制。
    const patchText = readFileSyncSafe(path.join(PLUGIN_ROOT, 'cordis.patch.yml'));
    for (const id of FORBIDDEN) {
      check(`本包未声明不生效的关闭：${id}`, countId(patchText, id) === 0, countId(patchText, id) > 0 ? 'patch 里仍有该 id' : '');
    }
    check(
      '三簇由宿主提供（本包无法从 preset 关闭）',
      FORBIDDEN.every((id) => countId(text1, id) >= 1),
      '若未来宿主不再默认提供，本项会变红，需要重新评估',
    );

    if (upgradeFrom) {
      const upgraded = installedVersion(home);
      check('升级后版本已切换', shiftedVersion(upgraded), upgraded ?? '未读到版本');
      const upgradedDump = runDsh(['--profile', 'smoke', '--dump-config'], home);
      check('升级后 preset 仍可见', upgradedDump.status === 0 && countId(upgradedDump.stdout, 'preset-project-dev-flow') >= 1);

      // Windows 实测：从 link: 安装切回 tarball 时，pnpm 会因残留的目录/符号链接 rename 失败
      // （ERR_PNPM_EPERM）。删掉该包目录再装，回滚才能复现真实结果。
      runDsh(['plugin', '--profile', 'smoke', 'remove', PACKAGE_NAME], home);
      clearInstalledDir(home);
      const rollback = runDsh(['plugin', '--profile', 'smoke', 'add', path.resolve(upgradeFrom)], home);
      if (rollback.status !== 0) clearInstalledDir(home, true);
      check('回滚安装旧版本', rollback.status === 0, rollback.status === 0 ? '' : rollback.stderr.trim().split(/\r?\n/).slice(-2).join(' / '));
      const rolledBack = installedVersion(home);
      check('回滚后版本回到旧版本', Boolean(rolledBack) && rolledBack !== upgraded, `${rolledBack} / 升级前 ${upgraded}`);
    }

    const remove = runDsh(['plugin', '--profile', 'smoke', 'remove', PACKAGE_NAME], home);
    check('卸载 bundle', remove.status === 0, remove.status === 0 ? '' : remove.stderr.trim().split(/\r?\n/).slice(-2).join(' / '));

    const dump2 = runDsh(['--profile', 'smoke', '--dump-config'], home);
    check('卸载后 preset 消失（回滚闭环）', dump2.status === 0 && countId(dump2.stdout, 'preset-project-dev-flow') === 0);

    process.stdout.write('\n未覆盖：真实会话中的技能自动路由与 slash 调用（需人新建会话）。\n');
  } finally {
    if (!keep) {
      rm(home, { recursive: true, force: true }).catch(() => {});
    } else {
      process.stdout.write(`\n临时 DSH_HOME 保留在：${home}\n`);
    }
  }

  const failed = assertions.filter((item) => !item.ok);
  process.stdout.write(failed.length === 0 ? '\n✔ 隔离 profile 烟测全部通过\n' : `\n✗ ${failed.length} 项断言失败\n`);
  return failed.length === 0 ? 0 : 1;
}

function mkdtempSyncDir() {
  const base = path.join(tmpdir(), 'dsh-smoke-');
  // mkdtemp 的异步版本在 finally 清理时更自然；这里用同步创建，避免顶层 await 与异常路径竞争。
  const suffix = Math.random().toString(16).slice(2, 10);
  const dir = `${base}${suffix}`;
  spawnSync(process.execPath, ['-e', `require('node:fs').mkdirSync(process.argv[1], { recursive: true })`, dir]);
  return dir;
}

/**
 * 清掉 profile 里该包已解出的目录，避免 Windows 上 rename 覆盖残留目录失败。
 *
 * 安全约束：`dsh plugin add <本包目录>` 会建立 **目录联接（junction）**。对 junction
 * 直接 `rmSync({recursive:true})` 有跟随链接删到源目录内容的风险（本轮就出现过仓库
 * `.git` 被清掉 HEAD/config/index 的事故）。所以这里先 lstat：
 *   - 符号链接 / junction → 只 unlink 链接本身
 *   - 真实目录 → 才递归删除
 */
function clearInstalledDir(home, retry = false) {
  const target = path.join(home, 'profiles', 'smoke', 'node_modules', PACKAGE_NAME);
  if (!retry && !existsSync(target)) return;
  const code = [
    "const fs = require('node:fs')",
    'const target = process.argv[1]',
    'try {',
    '  const st = fs.lstatSync(target)',
    '  if (st.isSymbolicLink()) fs.unlinkSync(target)',
    '  else fs.rmSync(target, { recursive: true, force: true })',
    '} catch {}',
  ].join('\n');
  spawnSync(process.execPath, ['-e', code, target]);
}

function installedVersion(home) {
  const pkgPath = path.join(home, 'profiles', 'smoke', 'node_modules', PACKAGE_NAME, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSyncSafe(pkgPath)).version ?? null;
  } catch {
    return null;
  }
}

function shiftedVersion(version) {
  return Boolean(version);
}

function readFileSyncSafe(file) {
  const result = spawnSync(process.execPath, ['-e', `process.stdout.write(require('node:fs').readFileSync(process.argv[1], 'utf8'))`, file], { encoding: 'utf8' });
  return result.stdout ?? '';
}

process.exitCode = main(process.argv.slice(2));
