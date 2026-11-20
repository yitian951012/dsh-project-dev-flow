#!/usr/bin/env node
/**
 * tests/check-patch-yaml.test.mjs
 *
 * 覆盖 check-patch-yaml.mjs 的**解析后结构校验**（纯函数 validatePatchStructure）：
 * 一个合法 fixture 作为对照，每个负例只制造一个缺陷，断言对应规则命中且带 Fix。
 * fixture 直接构造 JS 对象（等价于 yaml 解析器 toJS() 的结果），自包含，
 * 不读本仓库的 cordis.patch.yml、docs/ 或其他内容资产，也不依赖解析器是否安装。
 *
 * CLI 契约（--help / 退出码 / --json / 缺解析器降级与 --require-yaml）单独一组，
 * 用临时目录里的最小 patch 验证，避免碰真实资产。
 *
 * 运行：node --test tests/check-patch-yaml.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PATCH_RULES,
  validatePatchStructure,
  pathLabel,
  referencesSkills,
} from '../scripts/check-patch-yaml.mjs';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(PLUGIN_ROOT, 'scripts/check-patch-yaml.mjs');

/* ------------------------------------------------------------------ */
/* 自包含 fixture：等价于 yaml 解析后的 JS 结构                        */
/* ------------------------------------------------------------------ */

const PLAN_SECTION =
  'You are in plan mode. Stay in plan mode until the user approves the plan; explore with non-mutating reads only.';

/** 解析后 !!js 会降级为字符串，所以 fixture 里也是字符串——校验器必须按字符串处理。 */
const DEGRADED_SKILL_DIRS = "process.getBuiltinModule('node:path').join(pkgRoot, 'skills')";

function basePatch() {
  return [
    {
      insert: [
        {
          id: 'preset-project-dev-flow',
          name: '@deepseek-ai/dsh-agent-preset',
          config: {
            id: 'project-dev-flow',
            name: '项目开发流程',
            description: '测试用 preset（fixture，与真实内容无关）',
            order: 5,
            plugins: [
              { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: '你是项目流程模式的执行 agent。' } },
              {
                id: 'skill-filesystem',
                name: '@deepseek-ai/dsh-skill-filesystem',
                config: { customSkillDirs: [DEGRADED_SKILL_DIRS] },
              },
              {
                id: 'planning',
                name: 'cordis:group',
                group: true,
                isolate: { planMode: true },
                config: [
                  { id: 'plan-mode', name: '@deepseek-ai/dsh-plan-mode', config: { section: PLAN_SECTION } },
                ],
              },
              {
                id: 'delegation',
                name: 'cordis:group',
                group: true,
                config: [
                  {
                    id: 'tool-subagent-control',
                    name: '@deepseek-ai/dsh-tool-subagent-control',
                    config: { interrupt: false },
                  },
                  { id: 'tool-subagent', name: '@deepseek-ai/dsh-tool-subagent', config: { provider: 'spawn' } },
                ],
              },
              {
                id: 'tool-bash',
                name: '@deepseek-ai/dsh-tool-bash',
                // 第 65 行那种 !!js：解析器降级为字符串，校验器不得因此失败。
                disabled: "process.platform === 'win32'",
              },
            ],
          },
        },
      ],
    },
  ];
}

function mutate(mutator) {
  const patch = structuredClone(basePatch());
  mutator(patch);
  return patch;
}

/** 从 fixture 里按 id 找插件项（只用于定位缺陷，不参与校验逻辑）。 */
function pluginById(patch, id) {
  const preset = patch[0].insert[0];
  let found = null;
  (function walk(list) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      if (item.id === id && !found) found = item;
      if (Array.isArray(item.config)) walk(item.config);
    }
  })(preset.config.plugins);
  return found;
}

function rulesOf(result) {
  return result.errors.map((item) => item.rule);
}

function hasRule(result, rule) {
  return result.errors.some((item) => item.rule === rule);
}

function hasWarning(result, rule) {
  return result.warnings.some((item) => item.rule === rule);
}

/* ------------------------------------------------------------------ */
/* 正例                                                              */
/* ------------------------------------------------------------------ */

describe('正例：合法结构', () => {
  it('合法 fixture → 0 错误、0 告警，并统计出 preset / 插件 / customSkillDirs / section', () => {
    const result = validatePatchStructure(basePatch());
    assert.equal(result.errors.length, 0, JSON.stringify(result.errors, null, 2));
    assert.equal(result.warnings.length, 0, JSON.stringify(result.warnings, null, 2));
    assert.equal(result.summary.presetId, 'project-dev-flow');
    assert.equal(result.summary.presetItemId, 'preset-project-dev-flow');
    assert.equal(result.summary.pluginCount, 8);
    assert.equal(result.summary.uniqueIdCount, 8);
    assert.equal(result.summary.duplicateIdCount, 0);
    assert.equal(result.summary.customSkillDirs, 1);
    assert.equal(result.summary.sectionChars, PLAN_SECTION.length);
    assert.equal(result.summary.interrupt, false);
  });

  it('!!js 标签降级为字符串：只告警，不算失败（预期行为）', () => {
    const result = validatePatchStructure(basePatch(), {
      degradedTags: [
        { tag: 'tag:yaml.org,2002:js', label: '!!js', line: 65 },
        { tag: 'tag:yaml.org,2002:js', label: '!!js', line: 68 },
        { tag: 'tag:yaml.org,2002:js', label: '!!js', line: 86 },
      ],
    });
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 3);
    assert.equal(result.summary.degradedTags, 3);
    assert.ok(result.warnings.every((item) => item.rule === 'PATCH-YAML-TAG'));
    assert.match(result.warnings[0].message, /!!js/);
    assert.equal(result.warnings[0].line, 65);
  });

  it('同标签同行的降级告警去重（解析器可能重复报同一处）', () => {
    const tag = { tag: 'tag:yaml.org,2002:js', label: '!!js', line: 65 };
    const result = validatePatchStructure(basePatch(), { degradedTags: [tag, tag] });
    assert.equal(result.warnings.length, 1);
  });

  it('referencesSkills 只认真正的 skills 目录，不把 project-skills/skillsets 当命中', () => {
    assert.equal(referencesSkills("path.join(pkgRoot, 'skills')"), true);
    assert.equal(referencesSkills('/opt/pkg/skills'), true);
    assert.equal(referencesSkills('skills'), true);
    assert.equal(referencesSkills('project-skills'), false);
    assert.equal(referencesSkills('skillsets'), false);
    assert.equal(referencesSkills('/opt/skill'), false);
    assert.equal(referencesSkills(''), false);
    assert.equal(referencesSkills(42), false);
  });

  it('pathLabel 渲染出可定位的语义路径', () => {
    assert.equal(pathLabel([0, 'insert', 0, 'config', 'plugins', 2]), '[0].insert[0].config.plugins[2]');
    assert.equal(pathLabel([]), '(root)');
    assert.equal(pathLabel(['$weird key']), '.$weird key');
  });

  it('locate 把语义路径映射回 YAML 行号（解析器集成时用）', () => {
    const patch = mutate((value) => {
      value[0].insert[0].config.plugins[0].name = ''; // 制造一个错误，检查行号传递
    });
    const result = validatePatchStructure(patch, { locate: () => 42 });
    assert.ok(result.errors.length > 0);
    assert.equal(result.errors[0].line, 42);
  });
});

/* ------------------------------------------------------------------ */
/* 负例：顶层与 preset                                                */
/* ------------------------------------------------------------------ */

describe('负例：顶层结构与 preset', () => {
  it('顶层不是序列 → PATCH-ROOT', () => {
    const result = validatePatchStructure({ insert: [] });
    assert.ok(hasRule(result, 'PATCH-ROOT'));
    assert.match(result.errors[0].message, /序列/);
    assert.equal(result.errors[0].rule, 'PATCH-ROOT');
  });

  it('顶层有两条记录 → PATCH-ROOT（要求单条 insert）', () => {
    const patch = basePatch();
    patch.push({ insert: [{ id: 'preset-second', name: '@deepseek-ai/dsh-agent-preset', config: { id: 'second', plugins: [] } }] });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-ROOT'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-ROOT').message, /2 条/);
  });

  it('顶层条目出现 insert 之外的键 → PATCH-ROOT', () => {
    const patch = basePatch();
    patch[0].extra = true;
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-ROOT'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-ROOT').message, /extra/);
  });

  it('insert 缺失 → PATCH-ROOT', () => {
    const patch = basePatch();
    delete patch[0].insert;
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-ROOT'));
  });

  it('insert 为空列表 → PATCH-ROOT', () => {
    const result = validatePatchStructure([{ insert: [] }]);
    assert.ok(hasRule(result, 'PATCH-ROOT'));
  });

  it('insert 内没有 preset（没有 config.plugins 的项）→ PATCH-PRESET', () => {
    const patch = basePatch();
    patch[0].insert = [{ id: 'tool-orphan', name: '@deepseek-ai/dsh-tool-fs' }];
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-PRESET'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-PRESET').message, /没有 preset 项/);
  });

  it('preset 的 config.id 为空 → PATCH-PRESET（宿主无法注册模式）', () => {
    const patch = mutate((value) => {
      value[0].insert[0].config.id = '';
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-PRESET'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-PRESET').message, /config\.id/);
  });

  it('preset 项本身缺 id → PATCH-PRESET', () => {
    const patch = mutate((value) => {
      value[0].insert[0].id = '';
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-PRESET'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-PRESET').message, /preset 项缺少 id/);
  });

  it('insert 内出现两个 preset → PATCH-PRESET', () => {
    const patch = basePatch();
    patch[0].insert.push({ id: 'preset-other', name: '@deepseek-ai/dsh-agent-preset', config: { id: 'other-flow', plugins: [] } });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-PRESET'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-PRESET').message, /2 个 preset/);
  });
});

/* ------------------------------------------------------------------ */
/* 负例：插件项                                                       */
/* ------------------------------------------------------------------ */

describe('负例：插件项 id 与 name', () => {
  it('插件 id 重复（跨 group 嵌套）→ PATCH-PLUGIN-ID，并指出另一处位置', () => {
    const patch = mutate((value) => {
      value[0].insert[0].config.plugins[0].id = 'plan-mode'; // 与 planning 组内的 plan-mode 重名
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-PLUGIN-ID'));
    const error = result.errors.find((item) => item.rule === 'PATCH-PLUGIN-ID');
    assert.match(error.message, /plan-mode/);
    // 后出现的嵌套项是重复项，报错位置指向它，并给出首次出现位置。
    assert.ok(error.path.includes('plugins[2].config[0]'), error.path);
    assert.match(error.message, /\[0\]\.insert\[0\]\.config\.plugins\[0\]/);
    assert.equal(result.summary.duplicateIdCount, 1);
  });

  it('插件项缺 name → PATCH-PLUGIN-NAME', () => {
    const patch = mutate((value) => {
      delete value[0].insert[0].config.plugins[0].name;
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-PLUGIN-NAME'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-PLUGIN-NAME').message, /persona/);
  });

  it('插件项缺 id → PATCH-PLUGIN-ID', () => {
    const patch = mutate((value) => {
      delete value[0].insert[0].config.plugins[0].id;
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-PLUGIN-ID'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-PLUGIN-ID').message, /缺少 id/);
  });

  it('插件项是裸字符串 → PATCH-PLUGIN-ID（不是映射对象）', () => {
    const patch = basePatch();
    patch[0].insert[0].config.plugins.push('tool-bad');
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-PLUGIN-ID'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-PLUGIN-ID').message, /不是映射对象/);
  });

  it('preset 下一个插件都没有 → PATCH-PLUGIN-ID 告警，同时必需项缺失各自报错', () => {
    const patch = mutate((value) => {
      value[0].insert[0].config.plugins = [];
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasWarning(result, 'PATCH-PLUGIN-ID'));
    assert.match(result.warnings.find((item) => item.rule === 'PATCH-PLUGIN-ID').message, /没有任何插件项/);
    // 空插件列表本身不是唯一问题：必需的 skill-filesystem / plan-mode / subagent-control 也都不在。
    const rules = new Set(rulesOf(result));
    assert.ok(rules.has('PATCH-SKILL-DIRS'));
    assert.ok(rules.has('PATCH-SECTION'));
    assert.ok(rules.has('PATCH-SUBAGENT'));
    assert.equal(result.summary.pluginCount, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 负例：skill-filesystem                                             */
/* ------------------------------------------------------------------ */

describe('负例：skill-filesystem 与 customSkillDirs', () => {
  it('缺少 skill-filesystem 插件项 → PATCH-SKILL-DIRS', () => {
    const patch = mutate((value) => {
      value[0].insert[0].config.plugins = value[0].insert[0].config.plugins.filter((item) => item.id !== 'skill-filesystem');
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-SKILL-DIRS'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-SKILL-DIRS').message, /未找到 skill-filesystem/);
  });

  it('customSkillDirs 缺失 → PATCH-SKILL-DIRS', () => {
    const patch = mutate((value) => {
      delete pluginById(value, 'skill-filesystem').config.customSkillDirs;
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-SKILL-DIRS'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-SKILL-DIRS').message, /customSkillDirs/);
  });

  it('customSkillDirs 是空数组 → PATCH-SKILL-DIRS', () => {
    const patch = mutate((value) => {
      pluginById(value, 'skill-filesystem').config.customSkillDirs = [];
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-SKILL-DIRS'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-SKILL-DIRS').message, /为空/);
  });

  it('customSkillDirs 不指向 skills（project-skills 不算）→ PATCH-SKILL-DIRS', () => {
    const patch = mutate((value) => {
      pluginById(value, 'skill-filesystem').config.customSkillDirs = ['/opt/project-skills'];
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-SKILL-DIRS'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-SKILL-DIRS').message, /没有任何一项指向 skills/);
  });

  it('customSkillDirs 含非字符串项 → PATCH-SKILL-DIRS', () => {
    const patch = mutate((value) => {
      pluginById(value, 'skill-filesystem').config.customSkillDirs = [42];
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-SKILL-DIRS'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-SKILL-DIRS').message, /不是非空字符串/);
  });

  it('降级后的 !!js 字符串指向 skills 仍算命中（这是解析后的真实形态）', () => {
    const patch = basePatch();
    const dirs = pluginById(patch, 'skill-filesystem').config.customSkillDirs;
    assert.deepEqual(dirs, [DEGRADED_SKILL_DIRS]);
    const result = validatePatchStructure(patch);
    assert.equal(result.errors.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 负例：plan-mode.section                                           */
/* ------------------------------------------------------------------ */

describe('负例：plan-mode.section', () => {
  it('section 缺失 → PATCH-SECTION', () => {
    const patch = mutate((value) => {
      delete pluginById(value, 'plan-mode').config.section;
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-SECTION'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-SECTION').message, /section/);
  });

  it('section 只有空白字符 → PATCH-SECTION（非空不等于有内容）', () => {
    const patch = mutate((value) => {
      pluginById(value, 'plan-mode').config.section = '   \n\t  ';
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-SECTION'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-SECTION').message, /只有空白字符/);
  });

  it('section 不是字符串 → PATCH-SECTION', () => {
    const patch = mutate((value) => {
      pluginById(value, 'plan-mode').config.section = 42;
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-SECTION'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-SECTION').message, /不是字符串/);
  });

  it('缺少 plan-mode 插件项 → PATCH-SECTION', () => {
    const patch = mutate((value) => {
      const planning = pluginById(value, 'planning');
      planning.config = planning.config.filter((item) => item.id !== 'plan-mode');
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-SECTION'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-SECTION').message, /未找到 plan-mode/);
  });
});

/* ------------------------------------------------------------------ */
/* 负例：tool-subagent-control                                        */
/* ------------------------------------------------------------------ */

describe('负例：tool-subagent-control.interrupt', () => {
  it('interrupt 缺失 → PATCH-SUBAGENT', () => {
    const patch = mutate((value) => {
      delete pluginById(value, 'tool-subagent-control').config.interrupt;
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-SUBAGENT'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-SUBAGENT').message, /缺少 config\.interrupt/);
  });

  it('interrupt 为 true → PATCH-SUBAGENT', () => {
    const patch = mutate((value) => {
      pluginById(value, 'tool-subagent-control').config.interrupt = true;
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-SUBAGENT'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-SUBAGENT').message, /应为 false/);
  });

  it('interrupt 是字符串 "false"（!!js 降级的形态）→ PATCH-SUBAGENT', () => {
    const patch = mutate((value) => {
      pluginById(value, 'tool-subagent-control').config.interrupt = 'false';
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-SUBAGENT'));
  });

  it('缺少 tool-subagent-control 插件项 → PATCH-SUBAGENT', () => {
    const patch = mutate((value) => {
      const delegation = pluginById(value, 'delegation');
      delegation.config = delegation.config.filter((item) => item.id !== 'tool-subagent-control');
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-SUBAGENT'));
    assert.match(result.errors.find((item) => item.rule === 'PATCH-SUBAGENT').message, /未找到 tool-subagent-control/);
  });
});

/* ------------------------------------------------------------------ */
/* 诊断契约：规则编号与 Fix                                           */
/* ------------------------------------------------------------------ */

describe('诊断契约', () => {
  it('多个缺陷一起出现时，每条错误都有已登记规则编号、可读位置和 Fix', () => {
    const patch = mutate((value) => {
      value[0].insert[0].config.plugins[0].name = '';
      delete pluginById(value, 'skill-filesystem').config.customSkillDirs;
      pluginById(value, 'plan-mode').config.section = '   ';
      delete pluginById(value, 'tool-subagent-control').config.interrupt;
      value[0].insert[0].config.plugins[1].id = 'plan-mode'; // 与嵌套 plan-mode 重名
    });
    const result = validatePatchStructure(patch, { file: 'cordis.patch.yml' });
    assert.ok(result.errors.length >= 5, JSON.stringify(result.errors, null, 2));
    for (const item of result.errors) {
      assert.ok(Object.hasOwn(PATCH_RULES, item.rule), `未登记的规则编号：${item.rule}`);
      assert.equal(item.severity, 'error');
      assert.equal(item.file, 'cordis.patch.yml');
      assert.ok(typeof item.fix === 'string' && item.fix.length > 0, `缺 Fix：${JSON.stringify(item)}`);
      assert.ok(typeof item.path === 'string' && item.path.length > 0);
    }
    const rules = new Set(rulesOf(result));
    for (const rule of ['PATCH-PLUGIN-NAME', 'PATCH-SKILL-DIRS', 'PATCH-SECTION', 'PATCH-SUBAGENT', 'PATCH-PLUGIN-ID']) {
      assert.ok(rules.has(rule), `缺少 ${rule}`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* CLI 契约（临时目录，不碰真实资产）                                  */
/* ------------------------------------------------------------------ */

const VALID_PATCH_TEXT = `- insert:
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
                    You are in plan mode. Stay in plan mode until the user approves the plan; explore with non-mutating reads only.
          - id: delegation
            name: cordis:group
            config:
              - id: tool-subagent-control
                name: '@deepseek-ai/dsh-tool-subagent-control'
                config:
                  interrupt: false
`;

const DUPLICATE_ID_PATCH_TEXT = `${VALID_PATCH_TEXT}          - id: plan-mode
            name: '@deepseek-ai/dsh-plan-mode'
`;

async function makePackage(patchText) {
  const root = await mkdtemp(path.join(tmpdir(), 'dpf-patch-yaml-'));
  if (patchText != null) await writeFile(path.join(root, 'cordis.patch.yml'), patchText, 'utf8');
  return root;
}

/**
 * 作者侧环境：强制使用包内固定依赖 node_modules/yaml，不再依赖宿主 profile 里的解析器。
 * 这样「干净机器 + npm ci」能复现同一结果；宿主侧解析器只作为额外的候选位置。
 */
const AUTHOR_ENV = {
  ...process.env,
  DSH_FLOW_YAML_PARSER: path.join(PLUGIN_ROOT, 'node_modules'),
  DSH_PROFILE_DIR: '',
  DSH_HOME: '',
  DSH_INSTALL_DIR: '',
  NODE_PATH: '',
};

function run(args, { env = AUTHOR_ENV, cwd = PLUGIN_ROOT } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env });
}

/** 把 DSH 解析器搜索位置全部指到一个空目录：确定性模拟「机器上没有 yaml」。 */
function envWithoutParser(emptyDir) {
  return {
    ...process.env,
    DSH_FLOW_YAML_PARSER: emptyDir,
    DSH_PROFILE_DIR: emptyDir,
    DSH_HOME: emptyDir,
    DSH_INSTALL_DIR: emptyDir,
    NODE_PATH: '',
  };
}

async function makeEmptyDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'dpf-no-parser-'));
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('CLI 契约', () => {
  it('--help 退出 0，给出用法、解析器查找顺序、退出码与示例', () => {
    const result = run(['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /用法/);
    assert.match(result.stdout, /退出码/);
    assert.match(result.stdout, /--require-yaml/);
    assert.match(result.stdout, /--json/);
    assert.match(result.stdout, /DSH_FLOW_YAML_PARSER/);
    assert.match(result.stdout, /!!js/);
  });

  it('未知参数 → 退出码 2，并提示 --help', () => {
    const result = run(['--bogus']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--help/);
  });

  it('合法 patch --json → 退出 0，payload 可解析且结构统计正确', async () => {
    const root = await makePackage(VALID_PATCH_TEXT);
    try {
      const result = run(['--root', root, '--json']);
      assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.exitCode, 0);
      assert.equal(payload.patch, path.join(root, 'cordis.patch.yml'));
      assert.equal(payload.summary.presetId, 'project-dev-flow');
      assert.ok(payload.summary.pluginCount > 0);
      assert.equal(payload.summary.interrupt, false);
      assert.equal(typeof payload.verified, 'boolean');
      assert.equal(payload.degraded, false);
      assert.equal(payload.parser.ok, true);
      // !!js 降级告警属预期：有告警也不算失败。
      assert.ok(payload.warnings.some((item) => item.rule === 'PATCH-YAML-TAG'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('重复插件 id → 退出 1，错误带规则编号；有解析器时精确到 PATCH-PLUGIN-ID', async () => {
    const root = await makePackage(DUPLICATE_ID_PATCH_TEXT);
    try {
      const result = run(['--root', root, '--json']);
      assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, false);
      assert.ok(payload.errors.length > 0);
      if (payload.verified) {
        assert.ok(payload.errors.some((item) => item.rule === 'PATCH-PLUGIN-ID'), JSON.stringify(payload.errors));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('patch 文件不存在 → 退出 1，PATCH-FILE 指出创建位置', async () => {
    const root = await makePackage(null);
    try {
      const result = run(['--root', root, '--json']);
      assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`);
      const payload = JSON.parse(result.stdout);
      assert.ok(payload.errors.some((item) => item.rule === 'PATCH-FILE'));
      assert.match(payload.errors[0].fix, /cordis\.patch\.yml|--patch/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('无解析器 + 合法 patch：默认降级并明确说「未验证」，退出 0', async () => {
    const root = await makePackage(VALID_PATCH_TEXT);
    const emptyDir = await makeEmptyDir();
    try {
      const result = run(['--root', root, '--json'], { env: envWithoutParser(emptyDir) });
      assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.verified, false);
      assert.equal(payload.degraded, true);
      assert.equal(payload.parser.ok, false);
      assert.ok(payload.warnings.some((item) => item.rule === 'PATCH-YAML-MISSING'));
      // 不假装通过：note 明确写出未验证的语义项。
      assert.ok(payload.notes.some((item) => /未验证 YAML 语义/.test(item.message)));
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('无解析器 + --require-yaml：直接失败（退出 1），并给出安装/指路 Fix', async () => {
    const root = await makePackage(VALID_PATCH_TEXT);
    const emptyDir = await makeEmptyDir();
    try {
      const result = run(['--root', root, '--json', '--require-yaml'], { env: envWithoutParser(emptyDir) });
      assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.verified, false);
      assert.equal(payload.parser.ok, false);
      assert.ok(payload.errors.some((item) => item.rule === 'PATCH-YAML-MISSING'));
      assert.ok(payload.errors.every((item) => typeof item.fix === 'string' && item.fix.length > 0));
      assert.match(payload.parser.fix, /DSH_FLOW_YAML_PARSER|安装 yaml/);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* 负例：prompt 段不得含 {{（DSH 装配期当变量引用，实测会让模式装不上） */
/* ------------------------------------------------------------------ */

describe('负例：prompt 段含 {{', () => {
  it('人格段 prefix 含 {{doc:index}} → PATCH-PROMPT-PLACEHOLDER', () => {
    const patch = mutate((value) => {
      pluginById(value, 'persona').config.prefix = '先读 {{doc:index}} 再动手。';
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-PROMPT-PLACEHOLDER'));
    const error = result.errors.find((item) => item.rule === 'PATCH-PROMPT-PLACEHOLDER');
    assert.match(error.message, /人格段 prefix/);
    assert.match(error.message, /\{\{doc:index\}\}/);
    assert.match(error.message, /malformed prompt variable reference/);
    assert.ok(error.path.endsWith('config.prefix'), error.path);
    assert.match(error.fix, /doc:index/);
    assert.equal(error.line, null);
    assert.equal(result.summary.promptPlaceholders, 1);
  });

  it('事故原样写法 {{doc:*}} → 同样拦截', () => {
    const patch = mutate((value) => {
      pluginById(value, 'persona').config.prefix = '{{doc:*}} 由项目 profile 解析。';
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-PROMPT-PLACEHOLDER'));
    assert.match(
      result.errors.find((item) => item.rule === 'PATCH-PROMPT-PLACEHOLDER').message,
      /\{\{doc:\*\}\}/,
    );
  });

  it('未配对的孤立 {{ 也拦', () => {
    const patch = mutate((value) => {
      pluginById(value, 'persona').config.prefix = '语气词 {{ 暂未闭合。';
    });
    const result = validatePatchStructure(patch);
    assert.ok(hasRule(result, 'PATCH-PROMPT-PLACEHOLDER'));
    assert.match(
      result.errors.find((item) => item.rule === 'PATCH-PROMPT-PLACEHOLDER').message,
      /未配对/,
    );
  });

  it('人格段 suffix 同属一片风险面', () => {
    const patch = mutate((value) => {
      pluginById(value, 'persona').config.suffix = '（签认人：{{role:approver}}）';
    });
    const result = validatePatchStructure(patch);
    const error = result.errors.find((item) => item.rule === 'PATCH-PROMPT-PLACEHOLDER');
    assert.ok(error);
    assert.match(error.message, /人格段 suffix/);
  });

  it('plan-mode.section 含 {{command:test}} → 同一规则', () => {
    const patch = mutate((value) => {
      pluginById(value, 'plan-mode').config.section = 'Plan first, then run {{command:test}}.';
    });
    const result = validatePatchStructure(patch);
    const error = result.errors.find((item) => item.rule === 'PATCH-PROMPT-PLACEHOLDER');
    assert.ok(error, JSON.stringify(result.errors));
    assert.match(error.message, /计划模式 section/);
    assert.match(error.message, /进入计划模式/);
  });

  it('多处命中 → 每字段各一条，不合并', () => {
    const patch = mutate((value) => {
      pluginById(value, 'persona').config.prefix = '{{doc:index}}';
      pluginById(value, 'plan-mode').config.section = '{{command:verify}}';
    });
    const result = validatePatchStructure(patch);
    assert.equal(
      rulesOf(result).filter((rule) => rule === 'PATCH-PROMPT-PLACEHOLDER').length,
      2,
    );
    assert.equal(result.summary.promptPlaceholders, 2);
  });

  it('给 rawText 时行号精确到 {{ 所在行', () => {
    const patch = mutate((value) => {
      pluginById(value, 'persona').config.prefix = '第一行\n第二行含 {{doc:index}}\n第三行';
    });
    const rawText = [
      '# 注释',
      '- insert:',
      '    - id: preset-x',
      '      config:',
      '        prefix: |-',
      '          第一行',
      '          第二行含 {{doc:index}}',
      '          第三行',
    ].join('\n');
    const result = validatePatchStructure(patch, { rawText, locate: () => 5 });
    assert.equal(result.errors[0].line, 7);
  });
});

describe('正例：prompt 段不带花括号', () => {
  it('doc:index / command:test / role:approver 写法 → 0 错误', () => {
    const patch = mutate((value) => {
      pluginById(value, 'persona').config.prefix =
        '阶段路由用 doc:index；验证跑 command:test；签认找 role:approver。';
    });
    const result = validatePatchStructure(patch);
    assert.equal(result.errors.length, 0, JSON.stringify(result.errors, null, 2));
    assert.equal(result.summary.promptPlaceholders, 0);
  });

  it('preset 不带 persona → 不报（缺项不是本规则的问题）', () => {
    const patch = mutate((value) => {
      const preset = value[0].insert[0];
      preset.config.plugins = preset.config.plugins.filter((item) => item.id !== 'persona');
    });
    const result = validatePatchStructure(patch);
    assert.equal(
      result.errors.filter((item) => item.rule === 'PATCH-PROMPT-PLACEHOLDER').length,
      0,
    );
    assert.equal(result.errors.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 2.1.0 算力预算与 !!js 表达式                                        */
/* ------------------------------------------------------------------ */

describe('负例：默认关闭的工具簇被重新启用', () => {
  it('tool-schedule 缺 disabled: true → PATCH-TOOL-DISABLED', () => {
    const patch = mutate((value) => {
      const preset = value[0].insert[0];
      preset.config.plugins.push({ id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule' });
    });
    const result = validatePatchStructure(patch);
    assert.ok(rulesOf(result).includes('PATCH-TOOL-DISABLED'), JSON.stringify(result.errors, null, 2));
  });

  it('tool-schedule 的 disabled 被改成 false 同样失败', () => {
    const patch = mutate((value) => {
      const preset = value[0].insert[0];
      preset.config.plugins.push({ id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule', disabled: false });
    });
    const result = validatePatchStructure(patch);
    assert.ok(rulesOf(result).includes('PATCH-TOOL-DISABLED'), JSON.stringify(result.errors, null, 2));
  });

  it('显式 disabled: true 通过（控制组）', () => {
    const patch = mutate((value) => {
      const preset = value[0].insert[0];
      preset.config.plugins.push({ id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule', disabled: true });
    });
    const result = validatePatchStructure(patch);
    assert.equal(rulesOf(result).includes('PATCH-TOOL-DISABLED'), false);
  });

  it('声明 workflow-ptc / tool-workflow / fork → PATCH-TOOL-INEFFECTIVE-DISABLE', () => {
    for (const [id, name] of [
      ['workflow-ptc', '@deepseek-ai/dsh-workflow-ptc'],
      ['tool-workflow', '@deepseek-ai/dsh-tool-workflow'],
      ['tool-subagent-fork', '@deepseek-ai/dsh-tool-subagent'],
    ]) {
      const patch = mutate((value) => {
        const preset = value[0].insert[0];
        preset.config.plugins.push({ id, name, disabled: true });
      });
      const result = validatePatchStructure(patch);
      assert.ok(
        rulesOf(result).includes('PATCH-TOOL-INEFFECTIVE-DISABLE'),
        `${id} 应被判定为不生效的关闭：${JSON.stringify(result.errors, null, 2)}`,
      );
    }
  });
});

describe('负例：!!js 表达式横向逃逸', () => {
  it('含 child_process / execSync 的表达式 → PATCH-JS-EXPRESSION', () => {
    const rawText = [
      '- insert:',
      '    - id: skill-filesystem',
      '      name: "@deepseek-ai/dsh-skill-filesystem"',
      '      config:',
      '        customSkillDirs:',
      "          - !!js require('node:child_process').execSync('whoami') + 'skills'",
    ].join('\n');
    const result = validatePatchStructure([], { rawText });
    assert.ok(rulesOf(result).includes('PATCH-JS-EXPRESSION'), JSON.stringify(result.errors, null, 2));
    assert.equal(result.errors.find((e) => e.rule === 'PATCH-JS-EXPRESSION').line, 6);
  });

  it('process.env / fetch / eval / Function 同样拒绝', () => {
    for (const expr of ["process.env.HOME + '/skills'", "fetch('https://x')", "eval('1')", "new Function('return 1')"]) {
      const result = validatePatchStructure([], { rawText: `- insert:\n  - id: x\n    name: y\n    config:\n      - !!js ${expr}` });
      assert.ok(rulesOf(result).includes('PATCH-JS-EXPRESSION'), `应拒绝 ${expr}`);
    }
  });

  it('平台判定与包内路径解析通过（控制组）', () => {
    for (const expr of ["process.platform === 'win32'", "process.platform !== 'win32'", "path.join(pkgRoot, 'skills')"]) {
      const result = validatePatchStructure([], { rawText: `- insert:\n  - id: x\n    name: y\n    config:\n      - !!js ${expr}` });
      assert.equal(rulesOf(result).includes('PATCH-JS-EXPRESSION'), false, `不应拒绝 ${expr}`);
    }
  });
});

describe('正例：本仓库真实 patch 的算力预算契约', () => {
  it('四个工具簇均显式 disabled，三条表达式均在允许清单内', () => {
    const result = run(['--root', PLUGIN_ROOT, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.errors.length, 0, JSON.stringify(payload.errors, null, 2));
    assert.equal(payload.summary.disabledTools, 1, JSON.stringify(payload.summary));
    assert.equal(payload.summary.jsExpressions, 3, JSON.stringify(payload.summary));
  });
});
