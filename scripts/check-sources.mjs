#!/usr/bin/env node
/**
 * check-sources.mjs — 「来源登记」比对器（AUTHORING §8）
 *
 * 唯一职责：核对 sources.lock.json 中登记的 sha256 与 docs/ 下源文档的实际哈希。
 * 它不做内容提炼评审——哈希漂移意味着「源文档变了，提炼内容需要人重新看一遍」，
 * 所以本工具只报警、不自动更新。更新一律走 gen-sources-lock.mjs，并留下 diff 供评审。
 *
 * 本文件同时是校验工具的基础模块：
 *   - validate-package.mjs 复用 verifySources() 做 lock 结构与覆盖校验；
 *   - gen-sources-lock.mjs 复用 findDocsRoot() / listDocs() / sha256File()。
 * 因此这里导出的函数必须保持无副作用、可被测试直接调用（不读 process.argv 之外的全局状态）。
 *
 * 用法、退出码与示例见 --help。
 */
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ------------------------------------------------------------------ */
/* 常量：枚举值与规则编号                                             */
/* ------------------------------------------------------------------ */

/** lifecycle 三态（AUTHORING §2 / §8）。 */
export const LIFECYCLES = Object.freeze(['active', 'historical', 'archive']);

/** disposition 五态（AUTHORING §8）。 */
export const DISPOSITIONS = Object.freeze([
  'method',
  'template',
  'case',
  'evidence',
  'not-migrate',
]);

/** lock 结构版本；不兼容变更时必须自增并写迁移说明。 */
export const LOCK_SCHEMA_VERSION = 1;

/**
 * 规则编号 → 一行说明。编号是 CI 与测试的稳定契约，改文案不得改编号。
 * SOURCE-* 规则由本文件产生，validate-package 直接合并输出。
 */
export const SOURCE_RULES = Object.freeze({
  'SOURCE-LOCK-MISSING': 'sources.lock.json 缺失',
  'SOURCE-LOCK-READ': 'sources.lock.json 不可读取或不是合法 JSON',
  'SOURCE-LOCK-SCHEMA': 'sources.lock.json 条目结构非法',
  'SOURCE-DOC-MISSING': 'lock 登记的源文档在 docs/ 下已不存在',
  'SOURCE-DOCS-UNRESOLVED': '未找到 docs/，跳过哈希比对',
  'SOURCE-HASH': '源文档 sha256 漂移',
  'SOURCE-UNREGISTERED': 'docs/ 下的文档未登记到 lock',
  'SOURCE-TARGET-MISSING': 'lock 目标文件尚不存在',
  'SOURCE-TARGET-ABSOLUTE': 'lock targets 写了绝对路径',
  'SOURCE-TARGET-ESCAPE': 'lock targets 解析后逃出了 package 根',
  'SOURCE-TARGET-SYNTAX': 'lock targets 含 . / .. / 空段或反斜杠',
  'SOURCE-TARGET-EMPTY': 'lock 声称提炼为模板/案例但没有目标文件',
  'SOURCE-TARGET-KIND': 'lock 声明的去向与目标目录类型不一致',
  'SOURCE-DOCS-REQUIRED': '调用方要求必须验证来源，但找不到 docs/',
});

/* ------------------------------------------------------------------ */
/* 路径与文件                                                          */
/* ------------------------------------------------------------------ */

/** 本脚本所在目录的上一级 = package 根（未显式指定时使用）。 */
export function defaultRoot() {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

/**
 * 解析 docs/ 目录。
 *
 * 优先级：显式参数 > 环境变量 DSH_FLOW_DOCS_DIR > 从 root 逐级向上查找名为 docs 的目录。
 * 之所以允许向上查找：lock 里的路径固定写成 `docs/xx.md`，而 package 常常是项目里的一个子目录，
 * docs/ 位于仓库根。找不到时返回 dir=null，由调用方降级为「跳过哈希比对」而不是凭空失败。
 *
 * @param {{ root?: string, explicit?: string|null, env?: Record<string,string|undefined> }} opts
 * @returns {{ dir: string|null, source: 'flag'|'env'|'ancestor'|'missing'|'invalid', searched: string[] }}
 */
export function findDocsRoot({ root, explicit = null, env = process.env } = {}) {
  const rootAbs = path.resolve(root ?? defaultRoot());
  const searched = [];

  if (explicit) {
    // 相对路径按 package 根解析，避免受当前工作目录影响。
    const dir = path.isAbsolute(explicit) ? explicit : path.resolve(rootAbs, explicit);
    searched.push(dir);
    if (isDirectory(dir)) return { dir, source: 'flag', searched };
    return { dir: null, source: 'invalid', searched };
  }

  const fromEnv = env.DSH_FLOW_DOCS_DIR;
  if (fromEnv) {
    const dir = path.isAbsolute(fromEnv) ? fromEnv : path.resolve(rootAbs, fromEnv);
    searched.push(dir);
    if (isDirectory(dir)) return { dir, source: 'env', searched };
    return { dir: null, source: 'invalid', searched };
  }

  for (let dir = rootAbs; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'docs');
    searched.push(candidate);
    if (isDirectory(candidate)) return { dir: candidate, source: 'ancestor', searched };
    if (dir === path.dirname(dir)) break; // 到盘符根，停
  }
  return { dir: null, source: 'missing', searched };
}

function isDirectory(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 递归列出 docs/ 下的 .md，返回相对 docs/ 的 posix 路径（按码点排序，跨平台确定）。
 * 隐藏目录/文件（以 . 开头）跳过：它们不属于文档资产。
 */
export async function listDocs(docsRoot) {
  const out = [];
  async function walk(dir, prefix) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(rel);
    }
  }
  await walk(docsRoot, '');
  return out;
}

/** 文件内容的 sha256（对原始字节计算，不做换行归一化，避免跨平台假漂移）。 */
export async function sha256File(file) {
  const buf = await readFile(file);
  return createHash('sha256').update(buf).digest('hex');
}

/** lock 默认位置：<root>/sources.lock.json。 */
export function defaultLockPath(root) {
  return path.join(path.resolve(root ?? defaultRoot()), 'sources.lock.json');
}

/* ------------------------------------------------------------------ */
/* 诊断与渲染                                                          */
/* ------------------------------------------------------------------ */

export function makePainter(enabled) {
  const wrap = (code) => (text) => (enabled ? `\u001b[${code}m${text}\u001b[0m` : String(text));
  return { red: wrap(31), yellow: wrap(33), green: wrap(32), cyan: wrap(36), dim: wrap(2), bold: wrap(1) };
}

/** 颜色判定：管道/重定向/--json/--no-color/NO_COLOR 一律纯文本（尊重管道）。 */
export function colorEnabled(stream, argv = [], env = process.env) {
  if (argv.includes('--no-color') || argv.includes('--json')) return false;
  if (env.NO_COLOR && env.NO_COLOR.trim() !== '') return false;
  return Boolean(stream && stream.isTTY) && env.TERM !== 'dumb';
}

/**
 * 单条诊断的文本形式：「位置 + 现象 + 修复动作」。
 * 刻意不带堆栈：错误必须能被人直接行动（Critical Rule 1）。
 */
export function renderDiagnostic(diag, painter = makePainter(false)) {
  const { severity, rule, file, line, message, fix } = diag;
  const icon = severity === 'error' ? painter.red('✗') : painter.yellow('⚠');
  const where = file ? `${file}${line ? `:${line}` : ''}` : '(package)';
  const head = `${icon} [${rule}] ${where} — ${message}`;
  return fix ? `${head}\n   ${painter.dim(`${severity === 'error' ? 'Fix' : '建议'}: ${fix}`)}` : head;
}

/* ------------------------------------------------------------------ */
/* 目标路径安全                                                        */
/* ------------------------------------------------------------------ */

/**
 * 把 targets 里的相对路径归一化；不安全则返回 null。
 *
 * 拒绝：绝对路径、Windows 盘符、反斜杠（避免「看起来像目录别名」的写法）、
 * 空段、'.' 与 '..'。调用方据此在结构校验阶段就失败，而不是等到
 * 存在性检查时被 `path.resolve` 悄悄解析到 package 根之外。
 *
 * @param {unknown} value
 * @returns {string|null} 形如 'methods/xx.md'；不安全返回 null
 */
export function normalizeRelTarget(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (text.includes('\\')) return null;
  if (path.isAbsolute(text) || /^[A-Za-z]:/.test(text)) return null;
  const segments = text.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return null;
  }
  return segments.join('/');
}

/** 目标解析后是否仍在 package 根内（防 .. 与符号链接式逃逸的第一道闸）。 */
export function isInsideRoot(rootAbs, resolvedAbs) {
  const rel = path.relative(path.resolve(rootAbs), path.resolve(resolvedAbs));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/* ------------------------------------------------------------------ */
/* lock 结构校验                                                       */
/* ------------------------------------------------------------------ */

/**
 * 校验 lock 结构并归一化条目。返回的 entries 只含结构合法的条目，
 * 让后续覆盖/哈希比对不会被坏数据带崩。
 *
 * @param {unknown} lock 已 JSON.parse 的对象
 * @returns {{ entries: Array, errors: Array, warnings: Array }}
 */
export function validateLockShape(lock) {
  const errors = [];
  const warnings = [];
  const entries = [];
  const lockFile = 'sources.lock.json';
  const fail = (message, fix, extra = {}) =>
    errors.push({ severity: 'error', rule: 'SOURCE-LOCK-SCHEMA', file: lockFile, line: null, message, fix, ...extra });

  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    fail('lock 根节点必须是对象', '按 AUTHORING §8 的结构重生成：node scripts/gen-sources-lock.mjs');
    return { entries, errors, warnings };
  }
  if (lock.schemaVersion !== LOCK_SCHEMA_VERSION) {
    fail(
      `schemaVersion 必须是 ${LOCK_SCHEMA_VERSION}，实际是 ${JSON.stringify(lock.schemaVersion)}`,
      '删除旧 lock 后运行 node scripts/gen-sources-lock.mjs（不要手改版本号）',
    );
  }
  if (!Array.isArray(lock.files)) {
    fail('files 必须是数组', '运行 node scripts/gen-sources-lock.mjs 重生成');
    return { entries, errors, warnings };
  }

  const seen = new Map();
  lock.files.forEach((raw, index) => {
    const where = `files[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail(`${where} 不是对象`, '按 {path, sha256, lifecycle, disposition, targets, note} 结构重写该条');
      return;
    }

    const entry = { ...raw, targets: Array.isArray(raw.targets) ? raw.targets : [] };

    if (typeof entry.path !== 'string' || !/^docs\/.+\.[mM][dD]$/.test(entry.path.replace(/\\/g, '/'))) {
      fail(
        `${where}.path 必须是相对 docs/ 的路径，形如 docs/xx.md，实际是 ${JSON.stringify(entry.path)}`,
        '改成 docs/<文件名>.md（不得写绝对路径、不得写 docs 之外的位置）',
      );
      return;
    }
    entry.path = entry.path.replace(/\\/g, '/');

    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      fail(
        `${where}.sha256 必须是 64 位小写十六进制，实际是 ${JSON.stringify(entry.sha256)}`,
        '哈希不手写：运行 node scripts/gen-sources-lock.mjs 生成',
      );
    }
    if (!LIFECYCLES.includes(entry.lifecycle)) {
      fail(
        `${where}.lifecycle 非法：${JSON.stringify(entry.lifecycle)}`,
        `lifecycle 只能是 ${LIFECYCLES.join(' / ')}；按 docs 索引「性质」列填写`,
      );
    }
    if (!DISPOSITIONS.includes(entry.disposition)) {
      fail(
        `${where}.disposition 非法：${JSON.stringify(entry.disposition)}`,
        `disposition 只能是 ${DISPOSITIONS.join(' / ')}；说明见 AUTHORING §8`,
      );
    }
    if (!Array.isArray(entry.targets) || entry.targets.some((t) => typeof t !== 'string')) {
      fail(`${where}.targets 必须是字符串数组`, '没有落地资产时写 []，不要写 null');
    } else if (entry.targets.some((t) => normalizeRelTarget(t) === null)) {
      const bad = entry.targets.filter((t) => normalizeRelTarget(t) === null);
      fail(
        `${where}.targets 含不安全相对路径：${bad.map((t) => JSON.stringify(t)).join('、')}`,
        'targets 只能是包内相对路径：正斜杠、不含 . 或 .. 段、不以 / 或盘符开头、不得含反斜杠，如 methods/xx.md',
      );
    } else if (['template', 'case'].includes(entry.disposition) && entry.targets.length === 0) {
      // 声称「提炼为模板/案例」却没有任何落点：要么补目标文件，要么改成 evidence / not-migrate
      fail(
        `${where} 的 disposition=${entry.disposition} 但 targets 为空`,
        '补 targets 指向实际资产，或把 disposition 改为 evidence / not-migrate 并在 note 写清「未入包」',
      );
    }

    // disposition 与目标目录类型必须一致：method→methods/，template→templates/，case→cases/
    const kindDir = { method: 'methods/', template: 'templates/', case: 'cases/' }[entry.disposition];
    if (kindDir && entry.targets.length > 0) {
      // 已经过 normalizeRelTarget：这里只可能是安全路径，startsWith 不会因 .. 逃逸而误判。
      const ok = entry.targets.some((t) => normalizeRelTarget(t)?.startsWith(kindDir));
      if (!ok) {
        fail(
          `${where} 的 disposition=${entry.disposition}，但 targets 没有 ${kindDir} 下的落点`,
          `补 ${kindDir}... 目标；若该文档实际只沉淀为其它类型，请改成对应 disposition`,
        );
      }
    }
    if (typeof entry.note !== 'string' || entry.note.trim() === '') {
      fail(`${where}.note 缺失`, '补一句话：为什么不迁移，或提炼到哪个资产（AUTHORING §8）');
    }

    if (seen.has(entry.path)) {
      fail(
        `${entry.path} 重复登记（另见 files[${seen.get(entry.path)}]）`,
        '同一份源文档只登记一次；合并两条的 disposition 与 note',
      );
    } else {
      seen.set(entry.path, index);
      entries.push(entry);
    }
  });

  return { entries, errors, warnings };
}

/* ------------------------------------------------------------------ */
/* 主校验：lock ⇄ docs                                                */
/* ------------------------------------------------------------------ */

/**
 * 核对 sources.lock.json 与 docs/。
 *
 * @param {{
 *   root?: string,
 *   docsRoot?: string|null,
 *   lockPath?: string|null,
 *   lockText?: string|null,
 * }} opts
 * @returns {Promise<{ ok: boolean, errors: Array, warnings: Array, notes: Array,
 *   summary: object, root: string, docsRoot: string|null, lockPath: string }>}
 */
export async function verifySources({ root, docsRoot = null, lockPath = null, lockText = null, requireDocs = false } = {}) {
  const rootAbs = path.resolve(root ?? defaultRoot());
  const lockAbs = lockPath ? path.resolve(rootAbs, lockPath) : defaultLockPath(rootAbs);
  const lockRel = path.relative(rootAbs, lockAbs).replace(/\\/g, '/') || 'sources.lock.json';
  const errors = [];
  const warnings = [];
  const notes = [];
  // 三态：passed（真的比对了）/ skipped（没有可比的源文档）/ failed（有错误）。
  // 「跳过」与「一致」必须分开，否则错 root 或漏挂载会输出 green。
  let verified = false;
  let status = 'failed';
  // 必须在任何 return 之前声明：finish() 会引用它（早期返回也能安全收尾）。
  let docsAbs = docsRoot;
  const summary = {
    docs: null,
    lockEntries: 0,
    hashChecked: 0,
    hashMismatch: 0,
    missingInLock: 0,
    missingOnDisk: 0,
    targetsMissing: 0,
  };

  // 1) docs 可用性：没有 docs/ 就没有可比的哈希，lock 也不该成为失败项
  //    （安装后的 bundle、纯内容仓库都没有 docs/，那里只该给 note）
  if (!docsAbs) {
    const found = findDocsRoot({ root: rootAbs });
    if (found.dir) docsAbs = found.dir;
    else if (requireDocs) {
      // 作者 / CI 场景：没有源文档就等于没有验证，绝不能输出「一致」。
      errors.push({
        severity: 'error',
        rule: 'SOURCE-DOCS-REQUIRED',
        file: lockRel,
        line: null,
        message: '未找到 docs/：来源登记无法比对，而本次调用要求必须验证',
        fix: '用 --docs <dir> 或环境变量 DSH_FLOW_DOCS_DIR 指定 docs/；安装态确实没有源文档时改用 check:sources:portable，并明确标注「未验证」',
      });
      status = 'failed';
      return finish();
    } else {
      notes.push({
        severity: 'note',
        rule: 'SOURCE-DOCS-UNRESOLVED',
        file: lockRel,
        line: null,
        message: '未找到 docs/，未执行哈希比对（这是「未验证」，不是「一致」）',
        fix: '用 --docs <dir> 或环境变量 DSH_FLOW_DOCS_DIR 指定 docs/ 后再跑；作者与 CI 请用 --require-docs',
      });
      status = 'skipped';
      return finish();
    }
  }

  // 2) 读 lock
  let raw = lockText;
  if (raw == null) {
    try {
      raw = await readFile(lockAbs, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        errors.push({
          severity: 'error',
          rule: 'SOURCE-LOCK-MISSING',
          file: lockRel,
          line: null,
          message: '找不到来源登记文件',
          fix: '运行 node scripts/gen-sources-lock.mjs 生成（sha256 必须由脚本生成，不手写）',
        });
        return finish();
      }
      errors.push({
        severity: 'error',
        rule: 'SOURCE-LOCK-READ',
        file: lockRel,
        line: null,
        message: `读取失败：${error && error.message}`,
        fix: '检查文件权限与编码（UTF-8），或重跑 node scripts/gen-sources-lock.mjs',
      });
      return finish();
    }
  }

  let lock;
  try {
    lock = JSON.parse(raw);
  } catch (error) {
    errors.push({
      severity: 'error',
      rule: 'SOURCE-LOCK-READ',
      file: lockRel,
      line: null,
      message: `不是合法 JSON：${error.message}`,
      fix: '重跑 node scripts/gen-sources-lock.mjs（lock 由脚本生成，不应手改到语法错误）',
    });
    return finish();
  }

  // 3) 结构
  const shape = validateLockShape(lock);
  errors.push(...shape.errors);
  summary.lockEntries = Array.isArray(lock && lock.files) ? lock.files.length : 0;

  // 4) 覆盖 + 哈希
  const docs = await listDocs(docsAbs);
  const expected = new Map(docs.map((rel) => [`docs/${rel}`, rel]));
  const locked = new Set(shape.entries.map((e) => e.path));
  summary.docs = docs.length;

  for (const entry of shape.entries) {
    const rel = entry.path.slice('docs/'.length);
    if (!expected.has(entry.path)) {
      summary.missingOnDisk += 1;
      errors.push({
        severity: 'error',
        rule: 'SOURCE-DOC-MISSING',
        file: lockRel,
        line: null,
        message: `${entry.path} 已登记，但 docs/ 下不存在该文件`,
        fix: '源文档被删除或改名：先评审提炼内容是否失效，再重跑 gen-sources-lock 移除该条',
      });
      continue;
    }
    const actual = await sha256File(path.join(docsAbs, rel));
    summary.hashChecked += 1;
    if (actual !== entry.sha256) {
      summary.hashMismatch += 1;
      errors.push({
        severity: 'error',
        rule: 'SOURCE-HASH',
        file: lockRel,
        line: null,
        message: `${entry.path} sha256 漂移（登记 ${entry.sha256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）`,
        fix: '源文档已变更：重新评审提炼内容，确认后运行 node scripts/gen-sources-lock.mjs（禁止静默改哈希）',
      });
    }
  }

  for (const rel of docs) {
    if (!locked.has(`docs/${rel}`)) {
      summary.missingInLock += 1;
      errors.push({
        severity: 'error',
        rule: 'SOURCE-UNREGISTERED',
        file: lockRel,
        line: null,
        message: `docs/${rel} 未登记（共 ${docs.length} 份文档，lock 只登记 ${shape.entries.length} 条）`,
        fix: '运行 node scripts/gen-sources-lock.mjs 生成条目，并在映射表中补 disposition 与 note',
      });
    }
  }

  // 5) targets 存在性（聚合告警，避免脚手架阶段刷屏）
  const missingTargets = [];
  for (const entry of shape.entries) {
    for (const target of entry.targets) {
      const normalized = target.replace(/\\/g, '/');
      if (path.isAbsolute(target) || /^[A-Za-z]:\//.test(normalized)) {
        errors.push({
          severity: 'error',
          rule: 'SOURCE-TARGET-ABSOLUTE',
          file: lockRel,
          line: null,
          message: `${entry.path} 的 targets 写了绝对路径：${target}`,
          fix: 'targets 只写 package 内相对路径，如 methods/xx.md',
        });
        continue;
      }
      const resolvedTarget = path.resolve(rootAbs, target);
      if (!isInsideRoot(rootAbs, resolvedTarget)) {
        errors.push({
          severity: 'error',
          rule: 'SOURCE-TARGET-ESCAPE',
          file: lockRel,
          line: null,
          message: `${entry.path} 的 target 解析后逃出 package 根：${target}`,
          fix: 'targets 只写 package 内相对路径；禁止 .. 或盘符，避免指向包外文件',
        });
        continue;
      }
      if (!existsSync(resolvedTarget)) missingTargets.push({ path: entry.path, target });
    }
  }
  summary.targetsMissing = missingTargets.length;
  if (missingTargets.length > 0) {
    const sample = missingTargets.slice(0, 3).map((m) => m.target).join('、');
    warnings.push({
      severity: 'warning',
      rule: 'SOURCE-TARGET-MISSING',
      file: lockRel,
      line: null,
      message: `${missingTargets.length} 个 lock 目标文件尚不存在（示例：${sample}）`,
      fix: '资产落地后让 targets 指向实际文件；脚手架阶段把 targets 留空即可（entries 见 --verbose）',
    });
  }

  verified = true;
  status = 'passed';
  return finish();

  function finish() {
    return {
      ok: errors.length === 0,
      verified,
      status,
      errors,
      warnings,
      notes,
      summary: { ...summary, verified, status },
      root: rootAbs,
      docsRoot: docsAbs ?? null,
      lockPath: lockAbs,
    };
  }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

const HELP = `核对 sources.lock.json 与 docs/ 的 sha256 是否一致（AUTHORING §8）。

用法:
  node scripts/check-sources.mjs [选项]

选项:
  --root <dir>      package 根目录（默认：脚本所在目录的上一级）
  --docs <dir>      docs/ 目录（默认：从 package 根向上查找最近的 docs/）
  --lock <file>     lock 文件（默认：<root>/sources.lock.json）
  --require-docs    找不到 docs/ 时直接失败（作者 / CI 用；默认降级为「未验证」）
  --json            输出机器可读 JSON（自动关闭颜色与进度符号）
  --quiet           只输出结论与错误
  --no-color        强制纯文本（管道/重定向时已自动关闭颜色）
  -h, --help        显示本帮助

环境变量:
  DSH_FLOW_DOCS_DIR  指定 docs/（优先级低于 --docs）
  NO_COLOR           非空时禁用颜色

退出码:
  0  已比对且一致（或未加 --require-docs 时的「未验证」跳过）
  1  漂移、未登记、结构错误，或 --require-docs 下找不到 docs/
  2  用法错误（参数拼错/缺值）

示例:
  node scripts/check-sources.mjs
  node scripts/check-sources.mjs --docs /path/to/docs --json | jq .summary
  node scripts/check-sources.mjs --root . --quiet && echo "sources ok"

注意: 哈希漂移不是「跑一下就别管」的事——它意味着源文档变了，
      对应的提炼内容必须重新评审，再运行 gen-sources-lock.mjs 更新登记。
`;

function parseArgv(argv) {
  const opts = {
    root: null,
    docs: null,
    lock: null,
    json: false,
    quiet: false,
    noColor: false,
    help: false,
    requireDocs: false,
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
      case '--docs': opts.docs = takeValue((i += 1), '--docs'); break;
      case '--lock': opts.lock = takeValue((i += 1), '--lock'); break;
      case '--require-docs': opts.requireDocs = true; break;
      case '--json': opts.json = true; break;
      case '--quiet': opts.quiet = true; break;
      case '--no-color': opts.noColor = true; break;
      case '-h':
      case '--help': opts.help = true; break;
      default: throw usageError(`未知参数：${arg}`);
    }
  }
  return opts;
}

function usageError(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

export async function runCli(argv = process.argv.slice(2), io = process) {
  let opts;
  try {
    opts = parseArgv(argv);
  } catch (error) {
    io.stderr.write(`✗ ${error.message}\n  Fix: 运行 node scripts/check-sources.mjs --help 查看可用参数\n`);
    return 2;
  }
  if (opts.help) {
    io.stdout.write(HELP);
    return 0;
  }

  const painter = makePainter(!opts.noColor && colorEnabled(io.stdout, argv));
  const result = await verifySources({
    root: opts.root ?? defaultRoot(),
    docsRoot: opts.docs,
    lockPath: opts.lock,
    requireDocs: opts.requireDocs,
  });

  if (opts.json) {
    const { root, docsRoot, lockPath, ok, verified, status, errors, warnings, notes, summary } = result;
    io.stdout.write(`${JSON.stringify({ ok, verified, status, root, docsRoot, lockPath, errors, warnings, notes, summary }, null, 2)}\n`);
  } else {
    const diags = opts.quiet ? result.errors : [...result.errors, ...result.warnings];
    for (const diag of diags) io.stdout.write(`${renderDiagnostic(diag, painter)}\n`);
    if (!opts.quiet) {
      for (const note of result.notes) io.stdout.write(`${painter.dim(`ℹ [${note.rule}] ${note.message}`)}\n`);
    }
    // 「跳过」必须显式说成「未验证」：否则错 root / 漏挂载会输出一行绿色的「一致」。
    const line = result.status === 'skipped'
      ? painter.yellow(`⚠ 未验证：没有可比的 docs/，未执行来源哈希比对（lock 登记 ${result.summary.lockEntries} 条未校验）`)
      : result.status === 'passed'
        ? painter.green(`✔ sources 一致：${result.summary.docs ?? 0} 份文档 / ${result.summary.lockEntries} 条登记`)
        : painter.red(`✗ sources 漂移：${result.errors.length} 个错误，${result.summary.hashMismatch} 处哈希不一致`);
    if (!opts.quiet) io.stdout.write(`\n${line}\n`);
    else if (!result.ok) io.stdout.write(`${line}\n`);
  }

  return result.ok ? 0 : 1;
}

/* 仅直接执行时跑 CLI；被 import 时保持纯模块（tests 依赖这一点）。 */
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    process.stderr.write(`✗ 内部错误：${error.message}\n  Fix: 加 --json 或查看堆栈后反馈\n  Stack: ${error.stack}\n`);
    process.exitCode = 1;
  }
}
