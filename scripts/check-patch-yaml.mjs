#!/usr/bin/env node
/**
 * check-patch-yaml.mjs — cordis.patch.yml 的「真实 YAML」校验器
 *
 * 复核发现的问题：旧校验用正则逐行扫 patch，把「看起来像 YAML」当成「YAML 正确」，
 * 缩进、锚点、块标量、流程集合的语义全都没验证，出了问题却报「通过」。
 * 本工具改用真实 YAML 解析器（yaml@2，eemeli）解析，然后在**解析后的结构**上做契约校验：
 *
 *   1) 顶层只有一条 insert
 *   2) insert 内恰有一个 preset 项，且 preset id / config.id 非空
 *   3) 插件项 id 全局唯一、每项都有 name
 *   4) skill-filesystem 的 customSkillDirs 非空且指向 skills/
 *   5) plan-mode 的 config.section 非空
 *   6) tool-subagent-control 含 interrupt: false
 *
 * !!js 是 DSH patch 的运行时标签（如 `disabled: !!js process.platform === 'win32'`）。
 * 真实解析器不认识它，会把值降级为字符串并给出告警——这是预期行为，不是失败：
 * 解析期无法求值，本工具按字符串处理，并明确告警。
 *
 * 解析器是可选依赖：优先用 DSH_FLOW_YAML_PARSER 指定的位置，其次 DSH profile / DSH_HOME /
 * DSH_INSTALL_DIR / 包内 node_modules。全部找不到时，默认**降级**为行级结构检查并在报告里
 * 明确写「未验证 YAML 语义」——绝不假装通过；CI 用 --require-yaml 让缺解析器直接失败。
 *
 * 输出面向两类使用者：终端彩色报告（人读）与 --json（脚本/CI 消费）。
 * 每条错误都带 Fix；退出码见 --help。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defaultRoot, makePainter, colorEnabled, renderDiagnostic } from './check-sources.mjs';

/* ------------------------------------------------------------------ */
/* 规则表：编号是 CI 与测试的稳定契约，文案可改、编号不可改             */
/* ------------------------------------------------------------------ */

export const PATCH_RULES = Object.freeze({
  'PATCH-FILE': 'cordis.patch.yml 缺失或不可读',
  'PATCH-YAML-MISSING': '未找到可用的 YAML 解析器（已降级为行级检查）',
  'PATCH-YAML-LOAD': 'YAML 解析器候选位置加载失败（已降级或回退）',
  'PATCH-YAML-SYNTAX': 'YAML 语法错误（解析失败）',
  'PATCH-YAML-TAG': '未知 YAML 标签已降级为字符串（!!js，预期行为）',
  'PATCH-YAML-WARNING': 'YAML 解析器给出的非致命告警',
  'PATCH-ROOT': '顶层不是单条 insert',
  'PATCH-PRESET': '缺少 preset 项，或 preset id / config.id 非法',
  'PATCH-PLUGIN-ID': '插件项 id 缺失或重复',
  'PATCH-PLUGIN-NAME': '插件项缺少 name',
  'PATCH-SKILL-DIRS': 'skill-filesystem 的 customSkillDirs 缺失或未指向 skills/',
  'PATCH-SECTION': 'plan-mode.section 为空',
  'PATCH-SUBAGENT': 'tool-subagent-control 缺少 interrupt: false',
});

/* ------------------------------------------------------------------ */
/* 基础工具                                                           */
/* ------------------------------------------------------------------ */

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function typeName(value) {
  if (Array.isArray(value)) return '序列';
  if (value === null) return 'null';
  return typeof value;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** 把 JS 路径渲染成人能读的位置，如 `[0].insert[0].config.plugins[3].config[0]`。 */
export function pathLabel(pathSegments) {
  let out = '';
  for (const segment of pathSegments) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else if (/^[A-Za-z_$][\w$-]*$/.test(segment)) out += `${out ? '.' : ''}${segment}`;
    else out += `.${String(segment)}`;
  }
  return out || '(root)';
}

/**
 * customSkillDirs 的某一项是否指向包内 skills 目录。
 *
 * 解析后 !!js 会降级成字符串（如 `path.join(pkgRoot, 'skills')`），所以这里按
 * 「引号内的 skills / 路径段 skills / 单独一个 skills」判定，而不是求值。
 */
export function referencesSkills(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return false;
  if (/['"]skills['"]/.test(text)) return true;
  if (/[\\/]skills(?=$|['")\]}\s,])/.test(text)) return true;
  return text === 'skills';
}

function dedupeDiagnostics(list) {
  const seen = new Set();
  return list.filter((item) => {
    const key = `${item.severity}|${item.rule}|${item.file}|${item.line}|${item.path}|${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortDiagnostics(a, b) {
  const fileA = a.file ?? '';
  const fileB = b.file ?? '';
  if (fileA !== fileB) return fileA < fileB ? -1 : 1;
  const lineA = a.line ?? Number.MAX_SAFE_INTEGER;
  const lineB = b.line ?? Number.MAX_SAFE_INTEGER;
  if (lineA !== lineB) return lineA - lineB;
  return a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* 结构校验（纯函数：输入是已解析的对象，输出诊断）                   */
/* ------------------------------------------------------------------ */

/**
 * 在**解析后**的 patch 结构上做契约校验。不读文件、不解析 YAML，方便单元测试。
 *
 * @param {unknown} value              解析结果（顶层应是 [{ insert: [...] }]）
 * @param {{ file?: string, locate?: ((path: number[]) => number|null)|null,
 *           degradedTags?: Array<{ tag: string, label?: string, line?: number|null }> }} options
 * @returns {{ errors: Array, warnings: Array, notes: Array, summary: object }}
 *   locate 用于把语义路径映射回 YAML 行号；测试里可不传（line 为 null）。
 */
export function validatePatchStructure(value, { file = 'cordis.patch.yml', locate = null, degradedTags = [] } = {}) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const items = [];
  const summary = {
    presetId: null,
    presetItemId: null,
    pluginCount: 0,
    uniqueIdCount: 0,
    duplicateIdCount: 0,
    customSkillDirs: null,
    sectionChars: null,
    interrupt: undefined,
    degradedTags: 0,
  };

  const lineFor = (segments) => {
    if (typeof locate !== 'function') return null;
    try {
      const line = locate(segments);
      return Number.isInteger(line) ? line : null;
    } catch {
      return null;
    }
  };
  const fail = (rule, segments, message, fix) => {
    errors.push({
      severity: 'error',
      rule,
      file,
      line: lineFor(segments),
      path: pathLabel(segments),
      message,
      fix,
    });
  };
  const warn = (rule, segments, message, fix, line = null) => {
    warnings.push({
      severity: 'warning',
      rule,
      file,
      line: Number.isInteger(line) ? line : lineFor(segments),
      path: pathLabel(segments),
      message,
      fix,
    });
  };

  // 未知标签（!!js）降级为字符串是预期行为：告警，不失败。
  for (const tag of dedupeTags(degradedTags)) {
    summary.degradedTags += 1;
    warn(
      'PATCH-YAML-TAG',
      [],
      `未知标签 ${tag.label ?? tag.tag} 已降级为字符串（第 ${tag.line ?? '?'} 行）：解析期不求值`,
      '预期行为：无需改；本工具按字符串处理该值。若要精确类型校验，把它换成静态值（编译期可判定的写法）',
      tag.line ?? null,
    );
  }

  /* ---- 1) 顶层：单条 insert ------------------------------------------------ */

  if (!Array.isArray(value)) {
    fail(
      'PATCH-ROOT',
      [],
      `顶层是${typeName(value)}，但 patch 必须是 YAML 序列（文件以 "- insert:" 开头）`,
      '把文件写成顶层序列：第一行 - insert:，其下缩进写 insert 内容（不要把 insert 直接放在根上）',
    );
    return finish();
  }
  if (value.length !== 1) {
    fail(
      'PATCH-ROOT',
      [],
      `顶层有 ${value.length} 条记录，契约要求只有单条 insert`,
      '合并为一条 - insert:；多条 insert 会让 patch 的应用顺序依赖宿主实现，不可控',
    );
    return finish();
  }
  const rootEntry = value[0];
  if (!isPlainObject(rootEntry)) {
    fail('PATCH-ROOT', [0], `顶层第 1 条是${typeName(rootEntry)}，必须是含 insert 键的映射对象`, '写成 - insert:，缩进在其下写 insert 列表');
    return finish();
  }
  const extraKeys = Object.keys(rootEntry).filter((key) => key !== 'insert');
  if (extraKeys.length > 0) {
    fail(
      'PATCH-ROOT',
      [0],
      `顶层条目出现了 insert 之外的键：${extraKeys.join('、')}`,
      '顶层只允许 insert；其他 patch 动作请放进 insert 的插件列表或另开 bundle',
    );
  }
  const insert = rootEntry.insert;
  if (!Array.isArray(insert) || insert.length === 0) {
    fail(
      'PATCH-ROOT',
      [0, 'insert'],
      'insert 缺失或不是非空列表',
      '在 insert: 下写插件/preset 列表（每项至少含 id 与 name）',
    );
    return finish();
  }

  /* ---- 2) preset：恰有一个，id 与 config.id 非空 -------------------------- */

  const presetCandidates = insert.filter(
    (item) => isPlainObject(item) && isPlainObject(item.config) && Array.isArray(item.config.plugins),
  );
  if (presetCandidates.length === 0) {
    fail(
      'PATCH-PRESET',
      [0, 'insert'],
      'insert 内没有 preset 项（没有 config.plugins 的项）',
      '补一个 preset：- id: preset-<模式名> / name: @deepseek-ai/dsh-agent-preset / config: { id: <模式 id>, plugins: [...] }',
    );
  } else if (presetCandidates.length > 1) {
    const where = presetCandidates.map((item) => pathLabel(itemPathOf(insert, item))).join('、');
    fail(
      'PATCH-PRESET',
      [0, 'insert'],
      `insert 内出现 ${presetCandidates.length} 个 preset 项（${where}）`,
      '一个 bundle 只声明一个 preset：合并插件列表，或拆成两个 bundle 分别安装',
    );
  }
  const preset = presetCandidates[0] ?? insert[0];
  const presetPath = itemPathOf(insert, preset) ?? [0, 'insert', 0];
  if (isPlainObject(preset) && presetCandidates.includes(preset)) {
    if (!nonEmptyString(preset.id)) {
      fail(
        'PATCH-PRESET',
        presetPath,
        'preset 项缺少 id（或不是非空字符串）',
        '补 id: preset-<模式名>，如 id: preset-project-dev-flow；后续插件 id 的唯一性检查依赖它',
      );
    } else {
      summary.presetItemId = preset.id.trim();
    }
    const configId = isPlainObject(preset.config) ? preset.config.id : undefined;
    if (!nonEmptyString(configId)) {
      fail(
        'PATCH-PRESET',
        [...presetPath, 'config', 'id'],
        'preset 的 config.id 缺失或为空',
        '补 config.id: <kebab-case 模式 id>（如 project-dev-flow）；宿主按它注册/选择模式，空值会导致模式不可选',
      );
    } else {
      summary.presetId = configId.trim();
    }
  }

  /* ---- 3) 插件树：id 唯一、每项有 name ------------------------------------ */

  walkList(insert, [0, 'insert'], preset);
  if (items.filter((entry) => !entry.isPreset).length === 0) {
    warn(
      'PATCH-PLUGIN-ID',
      [0, 'insert'],
      'preset 下没有任何插件项',
      '检查 config.plugins 是否写成 [] 或缩进错误；空模式会让会话缺少工具',
    );
  }

  const seenIds = new Map();
  for (const entry of items) {
    if (entry.isPreset) continue; // preset 的 id 规则是 PATCH-PRESET，不与插件 id 混用
    if (!entry.id) {
      fail('PATCH-PLUGIN-ID', entry.path, `插件项缺少 id（name: ${entry.name || '(空)'}）`, '补 id: <kebab-case>；group 与子项都需要 id');
      continue;
    }
    if (seenIds.has(entry.id)) {
      const first = seenIds.get(entry.id);
      fail(
        'PATCH-PLUGIN-ID',
        entry.path,
        `插件 id 重复：${entry.id}（另一处在 ${pathLabel(first.path)}）`,
        '插件 id 必须全局唯一：改 id，或删除重复项；group isolate 会按 id 合并配置，重名会相互覆盖',
      );
      summary.duplicateIdCount += 1;
    } else {
      seenIds.set(entry.id, entry);
    }
  }
  summary.uniqueIdCount = seenIds.size;
  summary.pluginCount = items.filter((entry) => !entry.isPreset).length;

  /* ---- 4) skill-filesystem：customSkillDirs 指向 skills -------------------- */

  const skillFilesystem = findItem('skill-filesystem', '@deepseek-ai/dsh-skill-filesystem');
  if (!skillFilesystem) {
    fail(
      'PATCH-SKILL-DIRS',
      [0, 'insert'],
      '未找到 skill-filesystem 插件项',
      '补 - id: skill-filesystem / name: @deepseek-ai/dsh-skill-filesystem，否则包内 skills/ 不会被挂载',
    );
  } else {
    const config = isPlainObject(skillFilesystem.item.config) ? skillFilesystem.item.config : null;
    const dirs = config?.customSkillDirs;
    const dirsPath = [...skillFilesystem.path, 'config', 'customSkillDirs'];
    if (!config) {
      fail(
        'PATCH-SKILL-DIRS',
        skillFilesystem.path,
        'skill-filesystem 缺少 config 对象，因此没有 customSkillDirs',
        '补 config: { customSkillDirs: [ ... ] }，指向包内 skills/ 目录',
      );
    } else if (!Array.isArray(dirs) || dirs.length === 0) {
      fail(
        'PATCH-SKILL-DIRS',
        dirsPath,
        'customSkillDirs 缺失、不是列表或为空',
        '写成 customSkillDirs: [ !!js <解析到包内 skills/ 的表达式> ]；单元素也必须是列表',
      );
    } else {
      summary.customSkillDirs = dirs.length;
      const invalid = dirs.filter((dir) => !nonEmptyString(dir));
      if (invalid.length > 0) {
        fail(
          'PATCH-SKILL-DIRS',
          dirsPath,
          `customSkillDirs 有 ${invalid.length} 项不是非空字符串：${invalid.map((dir) => JSON.stringify(dir)).join('、')}`,
          '每一项都要是路径字符串（!!js 表达式会被解析器降级为字符串，同样必须是字符串）',
        );
      }
      if (!dirs.some(referencesSkills)) {
        fail(
          'PATCH-SKILL-DIRS',
          dirsPath,
          `customSkillDirs 没有任何一项指向 skills/：${dirs.map((dir) => JSON.stringify(dir)).join('、')}`,
          "指向包内技能目录，如 ...path.join(pkgRoot, 'skills')；指向别处会导致包内技能不被加载",
        );
      }
    }
  }

  /* ---- 5) plan-mode：section 非空 ----------------------------------------- */

  const planMode = findItem('plan-mode', '@deepseek-ai/dsh-plan-mode');
  if (!planMode) {
    fail(
      'PATCH-SECTION',
      [0, 'insert'],
      '未找到 plan-mode 插件项',
      '补 - id: plan-mode / name: @deepseek-ai/dsh-plan-mode，并在 config.section 写计划模式提示词',
    );
  } else {
    const config = isPlainObject(planMode.item.config) ? planMode.item.config : null;
    const section = config?.section;
    const sectionPath = [...planMode.path, 'config', 'section'];
    if (config == null) {
      fail(
        'PATCH-SECTION',
        planMode.path,
        'plan-mode 缺少 config 对象，因此没有 section',
        '补 config.section: | 段落；空的计划模式提示词会让计划模式形同没有约束',
      );
    } else if (typeof section !== 'string' || section.trim() === '') {
      fail(
        'PATCH-SECTION',
        sectionPath,
        typeof section === 'string'
          ? 'plan-mode.section 为空（只有空白字符）'
          : `plan-mode.section 不是字符串（实际 ${typeName(section)}）`,
        '补 config.section: | 多行段落，内容为该模式的系统提示词；不能留空或只写占位符',
      );
    } else {
      summary.sectionChars = section.trim().length;
    }
  }

  /* ---- 6) tool-subagent-control：interrupt false -------------------------- */

  const subagentControl = findItem('tool-subagent-control', '@deepseek-ai/dsh-tool-subagent-control');
  if (!subagentControl) {
    fail(
      'PATCH-SUBAGENT',
      [0, 'insert'],
      '未找到 tool-subagent-control 插件项',
      '补 - id: tool-subagent-control / name: @deepseek-ai/dsh-tool-subagent-control，并设 config.interrupt: false',
    );
  } else {
    const config = isPlainObject(subagentControl.item.config) ? subagentControl.item.config : null;
    const interruptPath = [...subagentControl.path, 'config', 'interrupt'];
    if (config == null || !Object.hasOwn(config, 'interrupt')) {
      fail(
        'PATCH-SUBAGENT',
        interruptPath,
        'tool-subagent-control 缺少 config.interrupt',
        '补 config.interrupt: false（契约值：允许打断会让子代理调用与工作流状态不一致）',
      );
      summary.interrupt = undefined;
    } else if (config.interrupt !== false) {
      fail(
        'PATCH-SUBAGENT',
        interruptPath,
        `tool-subagent-control 的 interrupt 应为 false，实际是 ${JSON.stringify(config.interrupt)}`,
        '把 interrupt 改成布尔值 false；写成 !!js 表达式会降级成字符串，无法通过本项校验',
      );
      summary.interrupt = config.interrupt;
    } else {
      summary.interrupt = false;
    }
  }

  return finish();

  /* ---- 内部辅助 ------------------------------------------------------------ */

  function walkList(list, basePath, presetItem) {
    if (!Array.isArray(list)) return;
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      const itemPath = [...basePath, index];
      if (!isPlainObject(item)) {
        fail(
          'PATCH-PLUGIN-ID',
          itemPath,
          `插件项是${typeName(item)}，不是映射对象`,
          '写成 - id: <id> / name: <插件包名>；列表项不能是裸字符串或嵌套列表',
        );
        continue;
      }
      const isPreset = item === presetItem;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      items.push({ id, name, item, path: itemPath, isPreset });
      if (!isPreset) {
        if (!id) {
          fail('PATCH-PLUGIN-ID', itemPath, '插件项缺少 id', '补 id: <kebab-case>；没有 id 的项无法被 group/isolate 引用');
        }
        if (!name) {
          fail('PATCH-PLUGIN-NAME', itemPath, `插件项 ${id || '(无 id)'} 缺少 name`, '补 name: <插件包名>，如 @deepseek-ai/dsh-tool-fs；没有 name 的项不会被加载');
        }
      }
      const config = item.config;
      if (Array.isArray(config)) {
        walkList(config, [...itemPath, 'config'], presetItem);
      } else if (isPlainObject(config) && Array.isArray(config.plugins)) {
        walkList(config.plugins, [...itemPath, 'config', 'plugins'], presetItem);
      }
    }
  }

  function itemPathOf(list, target) {
    if (!Array.isArray(list)) return null;
    for (let index = 0; index < list.length; index += 1) {
      if (list[index] === target) return [0, 'insert', index];
    }
    return null;
  }

  function findItem(id, fallbackName) {
    return items.find((entry) => !entry.isPreset && entry.id === id)
      ?? items.find((entry) => !entry.isPreset && entry.name === fallbackName)
      ?? null;
  }

  function finish() {
    return {
      errors: dedupeDiagnostics(errors.slice().sort(sortDiagnostics)),
      warnings: dedupeDiagnostics(warnings),
      notes,
      summary,
    };
  }
}

function dedupeTags(tags) {
  const seen = new Set();
  return (Array.isArray(tags) ? tags : []).filter((tag) => {
    const key = `${tag?.tag}|${tag?.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* YAML 解析器解析（可选依赖，绝不内置「正则假解析」）                 */
/* ------------------------------------------------------------------ */

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isDirectory(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isRegularFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * 列出可能包含 `yaml` 包的位置。顺序即优先级：
 *   1. DSH_FLOW_YAML_PARSER（显式配置，最高优先级）
 *   2. DSH_PROFILE_DIR/node_modules
 *   3. DSH_HOME/profiles/<profile>/node_modules（未给 DSH_PROFILE_DIR 时扫描各 profile）
 *   4. DSH_HOME/node_modules
 *   5. DSH_INSTALL_DIR
 *   6. <package root>/node_modules
 *
 * @returns {Array<{label:string, path:string, kind:'dir'|'package'|'file'|'missing', exists:boolean}>}
 */
export function listParserAnchors({ env = process.env, root } = {}) {
  const anchors = [];
  const seen = new Set();
  const add = (label, target, kind) => {
    const abs = path.resolve(target);
    const key = `${kind}|${abs.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    anchors.push({ label, path: abs, kind, exists: existsSync(abs) });
  };

  const explicit = env.DSH_FLOW_YAML_PARSER;
  if (explicit && String(explicit).trim() !== '') {
    const abs = path.resolve(explicit);
    if (isDirectory(abs)) {
      add('DSH_FLOW_YAML_PARSER（包目录）', abs, 'package');
      add('DSH_FLOW_YAML_PARSER（node_modules 目录）', abs, 'dir');
    } else if (isRegularFile(abs)) {
      add('DSH_FLOW_YAML_PARSER（模块文件）', abs, 'file');
    } else {
      add('DSH_FLOW_YAML_PARSER（路径不存在）', abs, 'missing');
    }
  }

  if (env.DSH_PROFILE_DIR) {
    add('DSH_PROFILE_DIR/node_modules', path.join(env.DSH_PROFILE_DIR, 'node_modules'), 'dir');
  } else if (env.DSH_HOME && env.DSH_PROFILE) {
    add(`DSH_HOME/profiles/${env.DSH_PROFILE}/node_modules`, path.join(env.DSH_HOME, 'profiles', env.DSH_PROFILE, 'node_modules'), 'dir');
  }

  if (env.DSH_HOME) {
    const profilesDir = path.join(env.DSH_HOME, 'profiles');
    if (isDirectory(profilesDir)) {
      try {
        for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const nodeModules = path.join(profilesDir, entry.name, 'node_modules');
          if (existsSync(nodeModules)) add(`DSH_HOME/profiles/${entry.name}/node_modules`, nodeModules, 'dir');
        }
      } catch {
        // 扫描失败不是错误：后面还有别的候选位置。
      }
    }
    add('DSH_HOME/node_modules', path.join(env.DSH_HOME, 'node_modules'), 'dir');
  }

  if (env.DSH_INSTALL_DIR) {
    add('DSH_INSTALL_DIR', env.DSH_INSTALL_DIR, 'dir');
  }

  if (root) add('package/node_modules', path.join(root, 'node_modules'), 'dir');

  return anchors;
}

function packageInfo(anchor, resolved) {
  const candidates = [];
  if (anchor.kind === 'package') candidates.push(path.join(anchor.path, 'package.json'));
  if (anchor.kind === 'dir') candidates.push(path.join(anchor.path, 'yaml', 'package.json'));
  if (resolved) candidates.push(path.join(path.dirname(resolved), 'package.json'));
  for (const candidate of candidates) {
    const json = readJsonFile(candidate);
    if (json && typeof json === 'object') {
      return { name: typeof json.name === 'string' ? json.name : 'yaml', version: typeof json.version === 'string' ? json.version : null, dir: path.dirname(candidate) };
    }
  }
  // 兜底：从模块文件向上最多找 4 层 package.json。
  let dir = resolved ? path.dirname(resolved) : null;
  for (let depth = 0; dir && depth < 4; depth += 1) {
    const json = readJsonFile(path.join(dir, 'package.json'));
    if (json && typeof json.name === 'string') return { name: json.name, version: json.version ?? null, dir };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { name: 'yaml', version: null, dir: resolved ? path.dirname(resolved) : null };
}

function loadFromAnchor(anchor) {
  try {
    let requireFromAnchor;
    let resolved;
    if (anchor.kind === 'file') {
      requireFromAnchor = createRequire(anchor.path);
      resolved = requireFromAnchor.resolve(anchor.path);
    } else if (anchor.kind === 'package') {
      requireFromAnchor = createRequire(path.join(anchor.path, '__dsh_flow_require__.cjs'));
      resolved = requireFromAnchor.resolve(anchor.path);
    } else {
      requireFromAnchor = createRequire(path.join(anchor.path, '__dsh_flow_require__.cjs'));
      resolved = requireFromAnchor.resolve('yaml');
    }
    const module = requireFromAnchor(resolved);
    if (!module || typeof module.parseDocument !== 'function' || typeof module.LineCounter !== 'function') {
      return { ok: false, status: 'load-error', error: '该模块不是可用的 yaml@2（缺少 parseDocument / LineCounter）' };
    }
    const info = packageInfo(anchor, resolved);
    return {
      ok: true,
      parser: {
        name: info.name === 'yaml' ? 'yaml' : info.name,
        version: info.version,
        resolved,
        packageDir: info.dir,
        source: anchor.label,
        module,
      },
    };
  } catch (error) {
    const message = String(error && error.message ? error.message.split('\n')[0] : error);
    const notFound = error?.code === 'MODULE_NOT_FOUND' || /Cannot find module/i.test(message);
    return { ok: false, status: notFound ? 'not-found' : 'load-error', error: message };
  }
}

/**
 * 查找可用的 YAML 解析器。找不到时返回 ok:false + 可读原因 + Fix，绝不返回「假解析器」。
 *
 * @returns {{ ok:true, parser:object, anchors:Array, attempts:Array, degradedAnchors:Array }
 *          | { ok:false, reason:'missing'|'load', message:string, fix:string, anchors:Array, attempts:Array }}
 */
export function resolveYamlParser({ env = process.env, root } = {}) {
  const anchors = listParserAnchors({ env, root });
  const attempts = [];
  const explicitAnchors = anchors.filter((anchor) => anchor.label.startsWith('DSH_FLOW_YAML_PARSER'));

  for (const anchor of anchors) {
    if (!anchor.exists) {
      attempts.push({ label: anchor.label, path: anchor.path, kind: anchor.kind, status: 'not-found', error: '路径不存在' });
      continue;
    }
    const attempt = loadFromAnchor(anchor);
    if (attempt.ok) {
      const failuresBefore = attempts.slice();
      const explicitFailed = explicitAnchors.length > 0
        && !anchor.label.startsWith('DSH_FLOW_YAML_PARSER')
        && explicitAnchors.every((explicit) => failuresBefore.some((failed) => failed.path === explicit.path));
      return {
        ok: true,
        parser: { ...attempt.parser, anchors },
        anchors,
        attempts,
        explicitFailed,
        degradedAnchors: explicitFailed
          ? [...new Map(explicitAnchors.map((anchor) => [anchor.path, { label: anchor.label, path: anchor.path }])).values()]
          : [],
      };
    }
    attempts.push({ label: anchor.label, path: anchor.path, kind: anchor.kind, status: attempt.status, error: attempt.error });
  }

  const hasLoadError = attempts.some((attempt) => attempt.status === 'load-error');
  const reason = hasLoadError ? 'load' : 'missing';
  const firstError = attempts.find((attempt) => attempt.status === 'load-error')?.error
    ?? attempts.find((attempt) => attempt.error !== '路径不存在')?.error;
  const searched = anchors.map((anchor) => `${anchor.label}: ${anchor.path}`);
  const message = reason === 'missing'
    ? `未找到可用的 YAML 解析器：已查找 ${anchors.length} 个位置，均没有可用的 yaml 包（--verbose 可看完整搜索路径）`
    : `找到 yaml 候选位置但加载失败：${firstError ?? '未知错误'}`;
  const fix = reason === 'missing'
    ? '安装 yaml 到 DSH profile（在 profile 目录下 npm i yaml），或设置 DSH_FLOW_YAML_PARSER 指向含 yaml 的 node_modules 目录；CI 请加 --require-yaml 让缺解析器直接失败'
    : '确认候选位置里是 yaml@2（需要 parseDocument/LineCounter）且目录可读；或把 DSH_FLOW_YAML_PARSER 指向另一个可用的 yaml 包';
  return { ok: false, reason, message, fix, anchors, attempts, searched };
}

/* ------------------------------------------------------------------ */
/* YAML 解析                                                          */
/* ------------------------------------------------------------------ */

/**
 * 用真实解析器解析 patch 文本，返回解析结果、语法错误与「降级标签」清单。
 *
 * @param {string} text
 * @param {{ module: object }} parser resolveYamlParser() 返回的 parser
 * @returns {{ ok:boolean, value:unknown, errors:Array, degradedTags:Array, otherWarnings:Array,
 *             locate:((path:number[])=>number|null)|null }}
 */
export function parsePatchYaml(text, { module }) {
  const lineCounter = new module.LineCounter();
  let doc;
  try {
    doc = module.parseDocument(text, { lineCounter, logLevel: 'silent' });
  } catch (error) {
    return {
      ok: false,
      value: null,
      errors: [syntaxError(String(error && error.message ? error.message : error), null, null)],
      degradedTags: [],
      otherWarnings: [],
      locate: null,
    };
  }

  const errors = [];
  const degradedTags = [];
  const otherWarnings = [];

  for (const parseError of doc.errors ?? []) {
    const line = parseError.linePos?.[0]?.line ?? null;
    const column = parseError.linePos?.[0]?.col ?? null;
    errors.push(syntaxError(firstLine(parseError.message), line, column, parseError.message));
  }

  for (const warning of doc.warnings ?? []) {
    const line = warning.linePos?.[0]?.line ?? null;
    const rawMessage = String(warning.message ?? '');
    const tagMatch = /Unresolved tag:\s*([^\s]+)/.exec(rawMessage);
    if (warning.code === 'TAG_RESOLVE_FAILED' || tagMatch) {
      const rawTag = tagMatch ? tagMatch[1] : 'unknown';
      degradedTags.push({
        tag: rawTag,
        label: friendlyTag(rawTag),
        line: line ?? lineFromMessage(rawMessage),
      });
      continue;
    }
    otherWarnings.push({
      severity: 'warning',
      rule: 'PATCH-YAML-WARNING',
      file: 'cordis.patch.yml',
      line,
      message: firstLine(rawMessage),
      fix: '按解析器提示核对这一行；该告警不阻断，但可能是拼写/重复键/锚点问题',
      detail: rawMessage,
    });
  }

  if (errors.length > 0) {
    return { ok: false, value: null, errors, degradedTags, otherWarnings, locate: null };
  }

  let value;
  try {
    value = doc.toJS();
  } catch (error) {
    return {
      ok: false,
      value: null,
      errors: [syntaxError(`解析结果转 JS 失败：${error && error.message}`, null, null)],
      degradedTags,
      otherWarnings,
      locate: null,
    };
  }

  const locate = (pathSegments) => {
    try {
      const node = doc.getIn(pathSegments, true);
      if (node && Array.isArray(node.range) && node.range.length > 0) {
        return lineCounter.linePos(node.range[0]).line;
      }
    } catch {
      // 语义路径可能没有对应的 YAML 节点（如合成/缺省值），行号留空即可。
    }
    return null;
  };

  return { ok: true, value, errors, degradedTags, otherWarnings, locate };
}

function syntaxError(message, line, column, detail = null) {
  return {
    severity: 'error',
    rule: 'PATCH-YAML-SYNTAX',
    file: 'cordis.patch.yml',
    line: line ?? null,
    column: column ?? null,
    message: detail ? firstLine(message) : message,
    fix: '修正该行的 YAML 语法（缩进、引号、冒号后空格、块标量缩进）；行号见左；修好后复跑本工具',
    detail: detail ?? message,
  };
}

function firstLine(text) {
  return String(text).split('\n')[0].trim();
}

function lineFromMessage(message) {
  const match = /\bat line (\d+)/.exec(String(message));
  return match ? Number(match[1]) : null;
}

function friendlyTag(tag) {
  if (!tag) return '!!?';
  if (tag === 'tag:yaml.org,2002:js') return '!!js';
  if (tag.startsWith('tag:yaml.org,2002:')) return `!!${tag.slice('tag:yaml.org,2002:'.length)}`;
  if (tag.startsWith('!')) return tag;
  return tag;
}

/* ------------------------------------------------------------------ */
/* 行级降级检查（仅在解析器不可用时使用，并明确标注未验证语义）        */
/* ------------------------------------------------------------------ */

async function runLineFallback(text, file) {
  // 动态导入：有解析器的常规路径不需要加载整套内容包校验器（保持启动快）。
  let validatePatchText;
  try {
    ({ validatePatchText } = await import('./validate-package.mjs'));
  } catch (error) {
    return {
      errors: [{ severity: 'error', rule: 'PATCH-YAML-MISSING', file, line: null, message: `加载行级降级检查失败：${error.message}`, fix: '检查 scripts/validate-package.mjs 是否完整；或改用 --require-yaml 直接失败' }],
      warnings: [],
      notes: [],
    };
  }
  const ctx = { errors: [], warnings: [], notes: [] };
  validatePatchText(ctx, text);
  // validatePatchText 固定写 cordis.patch.yml；这里统一成实际文件位置。
  for (const item of [...ctx.errors, ...ctx.warnings, ...ctx.notes]) item.file = file;
  return { errors: ctx.errors, warnings: ctx.warnings, notes: ctx.notes };
}

/* ------------------------------------------------------------------ */
/* 主检查                                                             */
/* ------------------------------------------------------------------ */

/**
 * 校验一个包里的 cordis.patch.yml。
 *
 * @param {{ root?: string, patch?: string|null, env?: Record<string,string|undefined>,
 *           requireYaml?: boolean }} options
 * @returns {Promise<object>} 见 formatReport / --json 的字段
 */
export async function checkPatch({ root, patch = null, env = process.env, requireYaml = false } = {}) {
  const rootAbs = path.resolve(root ?? defaultRoot());
  const patchAbs = patch
    ? (path.isAbsolute(patch) ? patch : path.resolve(rootAbs, patch))
    : path.join(rootAbs, 'cordis.patch.yml');
  const relRaw = path.relative(rootAbs, patchAbs).replace(/\\/g, '/');
  const rel = relRaw && !relRaw.startsWith('..') ? relRaw : patchAbs;

  const base = {
    root: rootAbs,
    patch: patchAbs,
    file: rel,
    requireYaml: Boolean(requireYaml),
    verified: false,
    degraded: false,
    errors: [],
    warnings: [],
    notes: [],
    summary: { presetId: null, presetItemId: null, pluginCount: 0, uniqueIdCount: 0, duplicateIdCount: 0, customSkillDirs: null, sectionChars: null, interrupt: undefined, degradedTags: 0 },
    parser: { ok: false, reason: 'missing', message: '', fix: '', name: null, version: null, resolved: null, source: null, searched: [] },
  };

  let text;
  try {
    text = await readFile(patchAbs, 'utf8');
  } catch (error) {
    const missing = error && error.code === 'ENOENT';
    base.errors.push({
      severity: 'error',
      rule: 'PATCH-FILE',
      file: rel,
      line: null,
      message: missing ? '找不到 patch 文件' : `读取失败：${error && error.message}`,
      fix: missing
        ? '创建 cordis.patch.yml（dsh.bundle.patch 指向的文件），或用 --patch 指定实际路径'
        : '检查文件权限与编码（UTF-8），或改用 --patch 指定实际路径',
    });
    return finish(base);
  }

  const resolution = resolveYamlParser({ env, root: rootAbs });
  if (resolution.ok) {
    base.parser = {
      ok: true,
      reason: null,
      name: resolution.parser.name,
      version: resolution.parser.version,
      resolved: resolution.parser.resolved,
      source: resolution.parser.source,
      searched: resolution.anchors.map((anchor) => `${anchor.label}: ${anchor.path}`),
      message: null,
      fix: null,
    };
    if (resolution.explicitFailed) {
      base.warnings.push({
        severity: 'warning',
        rule: 'PATCH-YAML-LOAD',
        file: rel,
        line: null,
        message: `DSH_FLOW_YAML_PARSER 指向的位置不可用（${resolution.degradedAnchors.map((anchor) => anchor.path).join('、')}）`,
        fix: `把 DSH_FLOW_YAML_PARSER 指到含 yaml 的 node_modules（或 yaml 包目录）；当前已回退使用 ${resolution.parser.source}`,
      });
    }
  } else {
    base.parser = {
      ok: false,
      reason: resolution.reason,
      name: null,
      version: null,
      resolved: null,
      source: null,
      message: resolution.message,
      fix: resolution.fix,
      searched: resolution.searched ?? [],
    };
    const rule = resolution.reason === 'missing' ? 'PATCH-YAML-MISSING' : 'PATCH-YAML-LOAD';
    const diagnostic = {
      severity: base.requireYaml ? 'error' : 'warning',
      rule,
      file: rel,
      line: null,
      message: resolution.message,
      fix: resolution.fix,
      detail: resolution.attempts.map((attempt) => `${attempt.label}: ${attempt.path}（${attempt.error}）`).join('\n'),
    };
    if (base.requireYaml) {
      base.errors.push(diagnostic);
      return finish(base);
    }
    base.warnings.push(diagnostic);
    base.degraded = true;
    const fallback = await runLineFallback(text, rel);
    base.errors.push(...fallback.errors);
    base.warnings.push(...fallback.warnings);
    base.notes.push(...fallback.notes);
    base.notes.push({
      severity: 'note',
      rule,
      file: rel,
      line: null,
      message: '已降级为行级结构检查：未验证 YAML 语义（顶层单条 insert / preset id / interrupt:false 等结构项）',
      fix: '安装 yaml 或设置 DSH_FLOW_YAML_PARSER 后复跑；需要强保证时用 --require-yaml',
    });
    return finish(base);
  }

  const parsed = parsePatchYaml(text, { module: resolution.parser.module });
  for (const item of parsed.errors) item.file = rel;
  for (const item of parsed.otherWarnings) item.file = rel;
  if (!parsed.ok) {
    base.errors.push(...parsed.errors);
    return finish(base);
  }
  base.verified = true;

  const structure = validatePatchStructure(parsed.value, {
    file: rel,
    locate: parsed.locate,
    degradedTags: parsed.degradedTags,
  });
  base.errors.push(...structure.errors);
  base.warnings.push(...parsed.otherWarnings, ...structure.warnings);
  base.notes.push(...structure.notes);
  base.summary = structure.summary;
  return finish(base);

  function finish(result) {
    result.errors = dedupeDiagnostics(result.errors.slice().sort(sortDiagnostics));
    result.warnings = dedupeDiagnostics(result.warnings);
    result.exitCode = result.errors.length > 0 ? 1 : 0;
    result.ok = result.errors.length === 0;
    return result;
  }
}

/* ------------------------------------------------------------------ */
/* 报告                                                               */
/* ------------------------------------------------------------------ */

export function formatReport(result, { color = false, verbose = false, quiet = false } = {}) {
  const painter = makePainter(color);
  const out = [];

  if (!quiet) {
    out.push(painter.bold('dsh-project-dev-flow · cordis.patch.yml YAML 校验'));
    out.push(`patch: ${result.patch}`);
    if (result.parser.ok) {
      out.push(`解析器: ${result.parser.name}@${result.parser.version ?? '?'}${verbose ? `（${result.parser.resolved}）` : ''}`);
    } else {
      out.push(painter.yellow(`解析器: 不可用 — ${result.parser.message}`));
      out.push(`   ${painter.dim(`Fix: ${result.parser.fix}`)}`);
      if (verbose) {
        for (const location of result.parser.searched) out.push(painter.dim(`· ${location}`));
      }
    }
    out.push('');
  }

  for (const item of result.errors) out.push(renderDiagnostic(item, painter));
  if (!quiet) {
    for (const item of result.warnings) out.push(renderDiagnostic(item, painter));
    if (verbose) {
      for (const item of result.notes) out.push(painter.dim(`ℹ [${item.rule}] ${item.message}`));
      for (const item of result.warnings) {
        if (item.detail) out.push(painter.dim(`   detail: ${item.detail.split('\n')[0]}`));
      }
    }
  }

  if (!quiet) {
    const summary = result.summary ?? {};
    const parts = [];
    if (result.degraded) {
      parts.push('行级结构检查（插件统计需 YAML 解析器）');
    } else {
      parts.push(`插件 ${summary.pluginCount ?? 0} 个`);
      if (summary.presetId) parts.push(`preset: ${summary.presetId}`);
      if (Number.isInteger(summary.customSkillDirs)) parts.push(`customSkillDirs ${summary.customSkillDirs} 项`);
      if (Number.isInteger(summary.sectionChars)) parts.push(`section ${summary.sectionChars} 字符`);
      if (summary.interrupt === false) parts.push('interrupt=false');
      if (summary.degradedTags > 0) parts.push(`!!js 降级 ${summary.degradedTags} 处（预期）`);
    }
    out.push('');
    out.push(`结构: ${parts.join(' / ')}`);
  }

  let verdict;
  if (result.errors.length > 0) {
    verdict = painter.red(`✗ 未通过：${result.errors.length} 个错误，${result.warnings.length} 个告警`);
  } else if (!result.verified) {
    verdict = painter.yellow('⚠ 未完全验证：YAML 解析器不可用，仅行级结构检查通过（YAML 语义未验证；--require-yaml 会让该状态失败）');
  } else {
    verdict = painter.green(
      `✔ 通过：YAML 语义与结构符合契约（${result.warnings.length} 个告警${result.summary.degradedTags > 0 ? '，其中 !!js 降级属预期' : ''}）`,
    );
  }

  if (quiet) {
    if (result.errors.length === 0) return `${verdict}\n`;
    out.push(verdict);
    return `${out.join('\n')}\n`;
  }
  out.push(verdict);
  return `${out.join('\n')}\n`;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

const HELP = `校验 cordis.patch.yml 的 YAML 语义与 bundle patch 结构契约。

用法:
  node scripts/check-patch-yaml.mjs [root] [选项]

参数:
  root               package 根目录（默认：脚本所在目录的上一级；也可用 --root）

选项:
  --root <dir>       package 根目录
  --patch <file>     patch 文件（默认：<root>/cordis.patch.yml；相对路径按 root 解析）
  --require-yaml     没有可用 YAML 解析器时直接失败（CI 用；默认降级为行级检查并明确告警「未验证」）
  --json             输出机器可读 JSON（自动关闭颜色）
  --quiet            只输出错误与结论
  --verbose          附带 notes 与解析器搜索位置（排查 DSH_FLOW_YAML_PARSER 时用）
  --no-color         强制纯文本（管道/重定向时已自动关闭颜色）
  -h, --help         显示本帮助

解析器:
  使用真实 YAML 解析器 yaml@2（parseDocument + LineCounter），不做正则模拟解析。
  !!js 这类未知标签会被解析器降级为字符串并告警——这是预期行为（运行时才求值），不算失败。
  查找顺序（createRequire 绝对路径）:
    1. DSH_FLOW_YAML_PARSER（可指向含 yaml 的 node_modules，或 yaml 包目录本身）
    2. DSH_PROFILE_DIR/node_modules（未给时扫描 DSH_HOME/profiles/*/node_modules）
    3. DSH_HOME/node_modules
    4. DSH_INSTALL_DIR
    5. <root>/node_modules
  全部找不到时默认降级为行级结构检查，并明确标注「YAML 语义未验证」；--require-yaml 则失败。

结构契约:
  1) 顶层只有一条 insert
  2) insert 内恰有一个 preset 项，preset id 与 config.id 非空
  3) 插件项（含 group 子项）id 全局唯一、每项都有 name
  4) skill-filesystem 的 customSkillDirs 非空且指向 skills/
  5) plan-mode 的 config.section 非空
  6) tool-subagent-control 含 interrupt: false

环境变量:
  DSH_FLOW_YAML_PARSER       指定 YAML 解析器位置（优先级最高）
  DSH_PROFILE_DIR / DSH_HOME / DSH_INSTALL_DIR  自动查找 yaml 的 DSH 安装位置
  NO_COLOR                   非空时禁用颜色

退出码:
  0  校验通过（告警不阻断）；降级模式下行级检查通过也算 0（除非 --require-yaml）
  1  存在错误，或 --require-yaml 下没有可用解析器
  2  用法错误（参数拼错/缺值）

示例:
  node scripts/check-patch-yaml.mjs
  node scripts/check-patch-yaml.mjs --json | jq '.errors[].rule'
  node scripts/check-patch-yaml.mjs --require-yaml
  DSH_FLOW_YAML_PARSER=/path/to/node_modules node scripts/check-patch-yaml.mjs --verbose
`;

function parseArgv(argv) {
  const opts = {
    root: null,
    patch: null,
    requireYaml: false,
    json: false,
    quiet: false,
    verbose: false,
    noColor: false,
    help: false,
    positional: [],
  };
  const takeValue = (index, flag) => {
    const value = argv[index];
    if (!value || value.startsWith('-')) throw usageError(`${flag} 需要一个路径参数`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--root': opts.root = takeValue((i += 1), '--root'); break;
      case '--patch': opts.patch = takeValue((i += 1), '--patch'); break;
      case '--require-yaml': opts.requireYaml = true; break;
      case '--json': opts.json = true; break;
      case '--quiet': opts.quiet = true; break;
      case '--verbose': opts.verbose = true; break;
      case '--no-color': opts.noColor = true; break;
      case '-h':
      case '--help': opts.help = true; break;
      default:
        if (arg.startsWith('-')) throw usageError(`未知参数：${arg}`);
        opts.positional.push(arg);
    }
  }
  if (opts.positional.length > 1) throw usageError(`多余的位置参数：${opts.positional.slice(1).join(', ')}`);
  return opts;
}

function usageError(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

function toJson(result) {
  return {
    ok: result.ok,
    exitCode: result.exitCode,
    verified: result.verified,
    degraded: result.degraded,
    requireYaml: result.requireYaml,
    root: result.root,
    patch: result.patch,
    file: result.file,
    parser: result.parser,
    summary: result.summary,
    errors: result.errors,
    warnings: result.warnings,
    notes: result.notes,
    rules: PATCH_RULES,
  };
}

export async function runCli(argv = process.argv.slice(2), io = process, env = process.env) {
  let opts;
  try {
    opts = parseArgv(argv);
  } catch (error) {
    io.stderr.write(`✗ ${error.message}\n  Fix: 运行 node scripts/check-patch-yaml.mjs --help 查看可用参数\n`);
    return 2;
  }
  if (opts.help) {
    io.stdout.write(HELP);
    return 0;
  }

  const rootAbs = opts.root ? path.resolve(opts.root) : opts.positional[0] ? path.resolve(opts.positional[0]) : defaultRoot();
  const color = !opts.noColor && colorEnabled(io.stdout, argv, env);
  const result = await checkPatch({ root: rootAbs, patch: opts.patch, env, requireYaml: opts.requireYaml });

  if (opts.json) {
    io.stdout.write(`${JSON.stringify(toJson(result), null, 2)}\n`);
  } else {
    io.stdout.write(formatReport(result, { color, verbose: opts.verbose, quiet: opts.quiet }));
  }

  return result.exitCode;
}

/* 仅直接执行时跑 CLI；被 import 时保持纯模块（tests 依赖这一点）。 */
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    process.stderr.write(`✗ 内部错误：${error.message}\n  Fix: 带 --json 反馈问题；需要堆栈时查看下面输出\n  Stack: ${error.stack}\n`);
    process.exitCode = 1;
  }
}
