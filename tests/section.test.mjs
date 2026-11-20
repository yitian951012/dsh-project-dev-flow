#!/usr/bin/env node
/**
 * tests/section.test.mjs
 *
 * section.mjs 是 2.1.0 引入的公共读取入口，被五个技能在日常路径上调用，
 * 但此前零专项测试——参数被静默宽化（2junk / 2.9 / 1e2 都当成 2）就是由此漏出的。
 *
 * 本文件按「普通 / 边界 / 异常」三类覆盖真实 CLI 契约：
 * 退出码、stdout 只含请求小节、stderr 与文档一致。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(PLUGIN_ROOT, 'scripts', 'section.mjs');

const FIXTURE = [
  '# 示例方法',
  '',
  '## 1. 概述',
  '',
  'OVERVIEW-MARK',
  '',
  '## 2. 核心判断',
  '',
  'CORE-MARK',
  '',
  '## 3. 步骤',
  '',
  'STEPS-MARK',
  '',
  '## 4. 反例',
  '',
  'ANTI-MARK',
  '',
].join('\n');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

async function makeFixture(content = FIXTURE) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dpf-section-'));
  const file = path.join(dir, 'sample.md');
  await writeFile(file, content, 'utf8');
  return { dir, file };
}

describe('节读取：普通路径', () => {
  it('单个小节只输出该节，且不含相邻小节内容', async () => {
    const { dir, file } = await makeFixture();
    try {
      const result = run([file, '2']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /CORE-MARK/);
      assert.doesNotMatch(result.stdout, /OVERVIEW-MARK|STEPS-MARK|ANTI-MARK/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('区间输出 §2–§3，且遇到 §4 停止', async () => {
    const { dir, file } = await makeFixture();
    try {
      const result = run([file, '2', '3']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /CORE-MARK/);
      assert.match(result.stdout, /STEPS-MARK/);
      assert.doesNotMatch(result.stdout, /OVERVIEW-MARK|ANTI-MARK/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('裸方法名解析到包内 methods/<名称>.md', () => {
    const result = run(['design-and-invariants', '2', '3']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /##\s+2\./);
    assert.match(result.stdout, /##\s+3\./);
    assert.doesNotMatch(result.stdout, /##\s+1\./);
  });

  it('兼容 CRLF 与无末尾换行', async () => {
    const { dir, file } = await makeFixture(FIXTURE.replace(/\n/g, '\r\n').replace(/\r\n$/, ''));
    try {
      const result = run([file, '3']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /STEPS-MARK/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('节读取：异常与边界', () => {
  it('文件或小节不存在 → 退出码 1', async () => {
    const { dir, file } = await makeFixture();
    try {
      const missingSection = run([file, '9']);
      assert.equal(missingSection.status, 1);
      assert.match(missingSection.stderr, /没有 §9/);

      const missingFile = run([path.join(dir, 'nope.md'), '2']);
      assert.equal(missingFile.status, 1);
      assert.match(missingFile.stderr, /读不到文件/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('起始节大于结束节 → 退出码 2', async () => {
    const { dir, file } = await makeFixture();
    try {
      const result = run([file, '3', '2']);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /起始节不大于结束节/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('非正整数形式一律退出码 2，不得被 parseInt 宽化', async () => {
    const { dir, file } = await makeFixture();
    try {
      for (const bad of ['2junk', '2.9', '1e2', '0', '-1', '+2', '', ' 2']) {
        const result = run([file, bad]);
        assert.equal(result.status, 2, `输入 ${JSON.stringify(bad)} 应被拒绝，实际退出码 ${result.status}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('参数个数不对 → 退出码 2', async () => {
    assert.equal(run([]).status, 2);
    assert.equal(run(['only-target']).status, 2);
    const extra = run(['design-and-invariants', '2', '3', 'unexpected']);
    assert.equal(extra.status, 2, extra.stderr);
    assert.match(extra.stderr, /用法/);
  });
});
