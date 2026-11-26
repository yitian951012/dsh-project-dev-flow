#!/usr/bin/env node
/**
 * tests/contract-consistency.test.mjs
 *
 * 语义契约测试：现有 131 个结构测试全绿时，以下矛盾仍可同时存在——
 *   - 受理技能同一句既要求「一律双写」又要求「不得双重记账」；
 *   - 总控技能只写半条 section 命令（模型仍会整份读或跑不动）；
 *   - 显式验收技能一边禁止自动调用、一边要求「必须走本技能」；
 *   - profile 的模板 / 字段表 / 机器可读示例不是同一套字段。
 *
 * 这些不是「再加一条扫描规则」，而是把已经写进 CHANGELOG 的修正钉住：
 * 任何人改回矛盾写法，测试必须先红。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineSatisfies } from '../scripts/validate-package.mjs';
import { parseTestTotals } from '../scripts/verify.mjs';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function read(rel) {
  return readFile(path.join(PLUGIN_ROOT, rel), 'utf8');
}

describe('受理：范围外只记一个台账', () => {
  it('不得同时出现「一律写入不做清单与待裁决项」与「不得双重记账」', async () => {
    const text = await read('skills/project-intake/SKILL.md');
    assert.equal(/一律写入[^。\n]{0,20}待裁决项/.test(text), false, '范围外不得再要求双写');
    assert.match(text, /已明确不做[^。\n]{0,40}不做清单/);
    assert.match(text, /尚未决定[^。\n]{0,40}待裁决项/);
    assert.match(text, /不得双重记账/);
  });
});

describe('总控：按节读取必须是完整可执行命令', () => {
  it('五份技能里每个 section.mjs 调用都带 node 与包内相对脚本路径', async () => {
    const dirs = await readdir(path.join(PLUGIN_ROOT, 'skills'));
    for (const dir of dirs) {
      const text = await read(`skills/${dir}/SKILL.md`);
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!line.includes('section.mjs')) return;
        assert.match(
          line,
          /node\s+<技能base>\/.\.\/\.\.\/scripts\/section\.mjs\s+[a-z-]+\s+\d/,
          `${dir}/SKILL.md:${index + 1} 的 section 调用不是完整命令：${line.trim()}`,
        );
      });
    }
  });

  it('总控技能不得只写方法名（如 `design-and-invariants 2 3`）', async () => {
    const text = await read('skills/project-dev-flow/SKILL.md');
    assert.equal(/按节读s*`(?!node )/.test(text), false, '按节读后面必须跟完整命令');
  });
});

describe('验收：显式调用与 fallback 不能自相矛盾', () => {
  it('不再要求「必须走本技能」', async () => {
    const text = await read('skills/project-acceptance/SKILL.md');
    assert.equal(text.includes('必须走本技能'), false);
    assert.match(text, /未加载则按[^。\n]{0,40}evidence-and-acceptance/);
  });
});

describe('profile：模板 / 字段表 / 机器可读示例同构', () => {
  it('一键门禁三处都有', async () => {
    const template = await read('templates/project-profile.md');
    const reference = await read('skills/project-dev-flow/references/project-profile.md');
    const yaml = await read('config/project-profile.example.yml');
    assert.match(template, /\|\s*一键门禁\s*\|\s*\{\{command:gate\}\}/);
    assert.match(reference, /\|\s*一键门禁\s*\|/);
    assert.match(yaml, /gate:\s*"\{\{command:gate\}\}"/);
  });

  it('验收清单在模板与 YAML 都有，且 YAML 不再新开代理签认例外', async () => {
    const template = await read('templates/project-profile.md');
    const yaml = await read('config/project-profile.example.yml');
    assert.match(template, /\|\s*验收清单\s*\|\s*\{\{doc:acceptance-checklist\}\}/);
    assert.match(yaml, /acceptance:/);
    assert.match(yaml, /checklist:\s*"\{\{doc:acceptance-checklist\}\}"/);
    assert.equal(/proxySignoff/.test(yaml), false, '代理签认只能在项目书面策略里，不在 profile 开例外');
  });
});

describe('运行时适配：DSH 0.2.3-alpha.2 口径（DEC-013）', () => {
  async function engines() {
    return JSON.parse(await read('package.json')).engines ?? {};
  }

  it('engines.node 按区间判定：接受 24.22.3 / 26.13.1，拒绝 24.22.2 / 26.12.0', async () => {
    const node = (await engines()).node;
    assert.equal(typeof node, 'string', 'engines.node 缺失：DSH 0.2.3 要求 Node >=24.22.3，需在清单里声明');
    assert.equal(engineSatisfies(node, '24.22.3'), true, `engines.node=${node} 未接受实测运行时 Node 24.22.3`);
    assert.equal(engineSatisfies(node, '24.22.2'), false, `engines.node=${node} 错误地接受了低于地板的 24.22.2`);
    assert.equal(engineSatisfies(node, '26.13.1'), true, `engines.node=${node} 未接受 DSH 0.2.3 放行的 Node 26.13.1`);
    assert.equal(engineSatisfies(node, '26.12.0'), false, `engines.node=${node} 错误地接受了 26.13.1 以下的 26.12.0`);
  });

  it('engines.dsh 按区间判定：接受 0.2.3-alpha.2，拒绝旧地板与 0.3.x 预发布（DEC-017）', async () => {
    const dsh = String((await engines()).dsh ?? '').trim().split(/\s+/).join(' ');
    assert.equal(engineSatisfies(dsh, '0.2.3-alpha.2'), true, `engines.dsh=${dsh} 未覆盖已校验运行时 0.2.3-alpha.2`);
    assert.equal(engineSatisfies(dsh, '0.2.3-alpha.1'), false, `engines.dsh=${dsh} 错误地接受了旧地板以下的 0.2.3-alpha.1`);
    assert.equal(engineSatisfies(dsh, '0.2.2-rc.5'), false, `engines.dsh=${dsh} 错误地接受了 2.x 时代的 0.2.2-rc.5`);
    assert.equal(engineSatisfies(dsh, '0.3.0'), false, `engines.dsh=${dsh} 错误地覆盖了 0.3.0`);
    // DEC-017：3.0.0 起上限写作 <0.3.0-0——旧写法 <0.3.0 在 includePrerelease 下会放行
    // 0.3.0-alpha.x，而 3.0 的看板入口依赖 0.2.3 才有的 sidebar.panellist，不能装进未验证宿主。
    assert.equal(engineSatisfies(dsh, '0.3.0-alpha.1'), false, 'engines.dsh 应使用 <0.3.0-0 上限（DEC-017）');
  });

  it('三处兼容声明以「已校验运行时」口径写明 0.2.3-alpha.2，并保留 Node 地板 24.22.3', async () => {
    for (const rel of ['README.md', 'detail/DETAIL.md', 'MIGRATION.md']) {
      const text = await read(rel);
      assert.match(text, /已校验运行时[^。\n]{0,24}0\.2\.3-alpha\.2/, `${rel} 未以「已校验运行时 … 0.2.3-alpha.2」口径写明已校验版本`);
      assert.match(text, /24\.22\.3/, `${rel} 未写明 Node 地板 24.22.3`);
      assert.equal(/本包在 `0\.2\.2-rc\.5` 上完成校验/.test(text), false, `${rel} 仍称在 0.2.2-rc.5 上校验`);
    }
  });
});

describe('verify 管道：测试总数兼容 TAP 与 Node 24 spec reporter', () => {
  it('parseTestTotals 同时识别 `# tests 3` 与 `ℹ tests 3`', () => {
    assert.deepEqual(parseTestTotals('# tests 3\n# pass 2\n# fail 1'), { tests: 3, pass: 2, fail: 1 });
    assert.deepEqual(parseTestTotals('ℹ tests 3\nℹ pass 2\nℹ fail 1'), { tests: 3, pass: 2, fail: 1 });
    assert.equal(parseTestTotals('no totals here'), null);
  });
});

describe('发布口径：AUTHORING 不再自称不对外发布', () => {
  it('说明它是随包提供的作者规范', async () => {
    const text = await read('AUTHORING.md');
    const firstLines = text.split(/\r?\n/).slice(0, 6).join('\n');
    assert.equal(firstLines.includes('不对外发布'), false);
  });
});
