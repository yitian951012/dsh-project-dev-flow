#!/usr/bin/env node
/**
 * validate-package.mjs — dsh-project-dev-flow 内容包校验器
 *
 * 把 AUTHORING.md 的规则从「靠人记」变成「靠脚本拦」：
 *   §2 文件头     必填字段 / 枚举 / id 前缀 / review_after
 *   §3 篇幅预算   超行数 → 告警（AUTHORING 明确不是硬错误）
 *   §4 技能文件   名字=目录名、description ≤120 字、历史技能禁模型调用、六段结构
 *   §5 占位符     模板必须有占位符、未知占位符、写死命令
 *   §6 内容红线   项目数字 / 绝对路径 / 凭据 / 真实作品 / 大段引用 / 历史当现状 / AI 代签 / 100% 断言
 *   §7 案例结构   七项必备结构 + 「来源项目」写法
 *   §8 来源登记   sources.lock.json 结构、覆盖与哈希（复用 check-sources.mjs）
 *   额外契约      cordis.patch.yml：禁 list-agents 子路径与 modelSelectionSettings；
 *                 必须有 plan-mode 的 section 与 customSkillDirs
 *
 * 输出面向两种使用者：终端里的彩色分组报告（人读）与 --json（脚本/CI 消费）。
 * 每条 error 都带 Fix；堆栈只在实现崩溃时出现，且提示带 --json 反馈。
 *
 * 用法、退出码与示例见 --help。
 */
import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SOURCE_RULES,
  defaultRoot,
  findDocsRoot,
  listDocs,
  makePainter,
  colorEnabled,
  verifySources,
  renderDiagnostic,
} from './check-sources.mjs';

/* ------------------------------------------------------------------ */
/* 规则表：编号是稳定契约，文案可改、编号不可改                         */
/* ------------------------------------------------------------------ */

export const RULES = Object.freeze({
  'PKG-JSON': 'package.json 缺失或不可解析',
  'PKG-FILES': 'files 列表与实际文件不一致',
  'ASSET-NONE': '未发现任何内容资产',
  'ASSET-UNCLASSIFIED': '未分类的 Markdown 资产',
  'ASSET-DUP-ID': 'frontmatter id 重复',
  'LINE-BUDGET': '篇幅超预算（告警，见 §3）',
  'FM-MISSING': 'frontmatter 缺失或格式错误',
  'FM-REQUIRED': '必填字段缺失或为空（§2）',
  'FM-ENUM': '枚举值非法（§2）',
  'FM-ID': 'id 格式或前缀非法（§2）',
  'FM-VERSION': 'version 不是语义化版本（§2）',
  'FM-REVIEW-AFTER': 'review_after 缺失/非法/超 12 个月/已过期（§2）',
  'FM-SOURCES': 'sources 引用格式不可解析（§2）',
  'FM-KIND': 'kind 与所在目录不一致（§2）',
  'SKILL-NAME': '技能名非法或与目录名不一致（§4）',
  'SKILL-DESC': 'description 缺失或超过 120 字（§4）',
  'SKILL-WHEN': 'whenToUse 缺失（§4，告警）',
  'SKILL-DISABLE': '历史证据类技能未禁用模型调用（§4）',
  'SKILL-STRUCTURE': 'SKILL.md 六段结构缺项（§4，告警）',
  'PLACEHOLDER': '占位符缺失/未知/写死命令（§5）',
  'LINK': '内部链接无法解析',
  'CASE-STRUCTURE': '案例必备结构缺项（§7）',
  'CASE-SOURCE': '案例未使用「来源项目（下称 P）」写法（§6.4）',
  'HIST-STATUS': '历史内容的 status 不是 closed/superseded（§2）',
  'HIST-SOURCE': '方法把历史案例当现状引用（§6.6，告警）',
  'REDLINE-NUMBER': '§6.1 出现当前项目数字',
  'REDLINE-PATH': '§6.2 出现绝对路径或主机信息',
  'REDLINE-CRED': '§6.3 出现凭据/密钥',
  'REDLINE-WORK': '§6.4 出现真实作品或可识别业务名',
  'REDLINE-QUOTE': '§6.5 疑似大段引用外部原文（告警）',
  'REDLINE-AI-SIGN': '§6.7 把 AI/代理代签当作默认流程',
  'REDLINE-100': '§6.8 「100% 完成」类断言',
  'PATCH-FILE': 'cordis.patch.yml 缺失或不可读',
  'PKG-ENGINE': 'engines.dsh 缺失或不覆盖目标运行时版本',
  'LOCALE': 'locale/ 展示元数据缺失或指向不存在的详情页',
  'PATCH-FORBIDDEN': 'patch 出现禁用项（list-agents 子路径 / modelSelectionSettings）',
  'PATCH-REQUIRED': 'patch 缺少必需项（plan-mode section / customSkillDirs）',
  'PATCH-STRUCTURE': 'patch 结构问题（重复 id / 插件项缺 name）',
  'DOCS-DIR': 'docs/ 目录无法解析',
});

export const ALL_RULES = Object.freeze({ ...RULES, ...SOURCE_RULES });

/* ------------------------------------------------------------------ */
/* 常量                                                               */
/* ------------------------------------------------------------------ */

const DOMAINS = ['governance', 'product', 'architecture', 'acceptance', 'history', 'operations'];
const AUTHORITIES = ['fallback', 'example', 'evidence-only'];
const STATUSES = ['draft', 'active', 'superseded', 'closed'];
const KIND_PREFIX = { method: 'method-', template: 'template-', case: 'case-', adapter: 'adapter-' };
const CASE_OUTCOMES = ['closed', 'superseded'];

const KNOWN_PLACEHOLDERS = Object.freeze([
  'project.name',
  'doc:root',
  'doc:index',
  'doc:decision-log',
  'doc:status',
  'command:verify',
  'command:test',
  'command:build',
  'command:e2e',
  'role:approver',
  'role:owner',
  'date:today',
  'commit:head',
  'evidence:ttl',
]);

const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g;
const FRONTMATTER_KEYS = ['id', 'title', 'kind', 'domain', 'authority', 'lifecycle', 'status', 'version', 'applies_when', 'not_for', 'sources', 'review_after'];

/** 篇幅预算（AUTHORING §3）。 */
const BUDGETS = { method: 110, template: 90, case: 100, skill: 75, reference: 70, adapter: null };

const REDLINE_NUMBER = [
  { re: /\b1952\b/, label: '1952' },
  { re: /\b1957\b/, label: '1957' },
  { re: /\b284\b/, label: '284' },
  { re: /\b110\s*\/\s*110\b/, label: '110/110' },
  { re: /\b\d{3,}\s*行/, label: '过百行数（如 1759 行）' },
  { re: /\b\d{1,3}\s*个\s*(?:route|handler|路由|处理函数|用例|测试)/i, label: '具体规模数字（如 66 个 route）' },
];

const REDLINE_PATH = [
  { re: /(?:^|[\s"'`(（\[，,、：:=])([A-Za-z]:[\\/])/, label: 'Windows 绝对路径' },
  { re: /\/Users\/[^\s/]+/, label: 'Unix/macOS 用户目录' },
  { re: /\/home\/[^\s/]+/, label: 'Unix 家目录' },
  { re: /\b[A-Za-z]:\\Users\b/i, label: 'Windows 用户目录' },
  { re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, label: '内网/公网 IP' },
  { re: /\blocalhost:\d+/, label: 'localhost 端口' },
  { re: /\\\\[A-Za-z0-9._-]+\\/, label: 'UNC 网络路径' },
];

const REDLINE_CRED = [
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/, label: 'API Key（sk-…）' },
  { re: /\bAIza[0-9A-Za-z_-]{20,}\b/, label: 'Google API Key' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS Access Key ID' },
  { re: /\bghp_[A-Za-z0-9]{20,}\b/, label: 'GitHub Token' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY/, label: '私钥块' },
  { re: /(?:api[_-]?key|access[_-]?token|secret[_-]?key|password|passwd)\s*[:=]\s*["'][^"']{8,}["']/i, label: '明文凭据赋值' },
  { re: /(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*=\s*[A-Za-z0-9][A-Za-z0-9._+-]{7,}/, label: '.env 风格明文赋值' },
  { re: /(?:账号|账户)\s*(?:ID|id)\s*[:：]\s*\S{4,}/, label: '账号 ID' },
];

const REDLINE_WORK = [
  // 真实产品名按片段拼接，避免校验器自身把产品名写进发布包
  { re: new RegExp('story' + 'forge|story-' + 'forge', 'i'), label: '参考项目的真实产品名' },
];

const REDLINE_AI_SIGN = [
  { re: /AI\s*代签/, label: '「AI 代签」' },
  { re: /代理\s*签认\s*(?:作为|默认|即可|直接)/, label: '「代理签认」作为默认流程' },
  { re: /(?:允许|可以|默认|应当|建议|直接)\s*[^。\n]{0,16}(?:AI|agent|代理|模型)\s*(?:代签|签认|自动通过)/, label: '允许 agent 代签验收/决策' },
];

const REDLINE_100 = [{ re: /100\s*%\s*(?:完成|通过|覆盖|done|ready|complete)?/i, label: '「100% 完成/通过」类断言' }];

const HARDCODED_COMMANDS = [
  { re: /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[A-Za-z][\w:-]*/, label: '包管理器脚本命令' },
  { re: /\bpytest\b/, label: 'pytest' },
  { re: /\bcargo\s+(?:test|build)\b/, label: 'cargo 命令' },
  { re: /\bgo\s+test\b/, label: 'go test' },
  { re: /\bmvn\s+\w+/, label: 'mvn 命令' },
  { re: /\bdocker\s+(?:compose|build)\b/, label: 'docker 命令' },
  { re: /\bcurl\s+https?:\/\//, label: 'curl 到具体 URL' },
];

const CASE_SECTIONS = [
  { key: '背景与约束', re: /(?:背景|约束)/ },
  { key: '当时的错误判断', re: /(?:错误(?:的)?判断|当时(?:的)?错误|错判|误判)/ },
  { key: '候选方案与实际取舍', re: /(?:候选|取舍|备选|替代方案)/ },
  { key: '可观察证据', re: /(?:可观察|证据|实测|命令输出|留痕)/ },
  { key: '修复后仍未解决的风险', re: /(?:残余风险|仍未解决|剩余风险|风险)/ },
  { key: '能提炼的方法与不可外推边界', re: /(?:提炼|可迁移|不可外推|边界)/ },
  { key: '与插件内方法的链接', re: /(?:链接|参见|延伸阅读|引用|methods\/)/ },
];

/* ------------------------------------------------------------------ */
/* 基础工具                                                           */
/* ------------------------------------------------------------------ */

function splitLines(text) {
  return String(text).split(/\r\n|\n|\r/);
}

/** 行数：末尾换行不计一行（与编辑器/`wc -l` 直觉一致）。 */
export function lineCount(text) {
  const lines = splitLines(text);
  return lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

function lineAt(text, index) {
  return text.slice(0, index).split(/\r\n|\n|\r/).length;
}

function unquote(raw) {
  const value = raw.trim();
  const doubleQuoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
  const singleQuoted = value.length >= 2 && value.startsWith("'") && value.endsWith("'");
  if (doubleQuoted || singleQuoted) return value.slice(1, -1);
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function stripInlineComment(value) {
  if (value.startsWith('"') || value.startsWith("'")) return value;
  const idx = value.indexOf(' #');
  return idx === -1 ? value : value.slice(0, idx).trim();
}

/* ------------------------------------------------------------------ */
/* frontmatter 解析（YAML 子集，零依赖）                              */
/* ------------------------------------------------------------------ */

/**
 * 解析 frontmatter。只支持 AUTHORING 实际用到的 YAML 子集：
 *   key: scalar / key: "quoted" / key: 后接 "- item" 列表 / key: [a, b] / key: | 块文本
 * 任何超出子集的行都会变成带行号、带 Fix 的错误——而不是让后面对 undefined 做判断。
 *
 * @param {string} text
 * @returns {{ present: boolean, ok: boolean, data: object|null, body: string, lines: string[],
 *             errors: Array<{line:number,message:string,fix:string}>, startLine: number, endLine: number }}
 */
export function parseFrontmatter(text) {
  const lines = splitLines(text);
  const first = lines[0] ? lines[0].replace(/^\uFEFF/, '').trim() : '';
  if (first !== '---') {
    return {
      present: false,
      ok: false,
      data: null,
      body: text,
      lines,
      startLine: 0,
      endLine: 0,
      errors: [{ line: 1, message: '缺少 frontmatter 起始行 ---', fix: '在第 1 行写 ---，随后写 §2 要求的字段，再写一行 ---' }],
    };
  }

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return {
      present: true,
      ok: false,
      data: null,
      body: text,
      lines,
      startLine: 1,
      endLine: 0,
      errors: [{ line: 1, message: 'frontmatter 没有结束行 ---', fix: '补一行 ---（独占一行）结束 frontmatter' }],
    };
  }

  const parsed = parseYamlSubset(lines.slice(1, end), 2);
  return {
    present: true,
    ok: parsed.errors.length === 0,
    data: parsed.data,
    body: lines.slice(end + 1).join('\n'),
    lines,
    startLine: 1,
    endLine: end + 1,
    errors: parsed.errors,
  };
}

function parseYamlSubset(rawLines, firstLineNo) {
  const data = {};
  const errors = [];
  let currentKey = null;
  let currentIndent = 0;

  const fail = (line, message, fix) => errors.push({ line, message, fix });

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    const lineNo = firstLineNo + i;
    if (!raw.trim() || raw.trim().startsWith('#')) continue;

    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();

    // 列表项
    if (trimmed === '-' || trimmed.startsWith('- ')) {
      if (!currentKey) {
        fail(lineNo, '列表项没有所属键', '在列表上方写 key: 再缩进写 - 项');
        continue;
      }
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(unquote(stripInlineComment(trimmed.slice(1).trim())));
      continue;
    }

    // key: value
    const match = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(trimmed);
    if (!match) {
      fail(lineNo, `无法解析的行：${trimmed.slice(0, 48)}`, 'frontmatter 只接受 key: value、- 列表项、或 key: | 块文本');
      continue;
    }

    const key = match[1];
    let value = stripInlineComment((match[2] ?? '').trim());
    currentKey = key;
    currentIndent = indent;

    if (value === '') {
      data[key] = '';
      continue;
    }

    // 块文本（| / |- / > / >-）
    if (/^[|>][-+]?$/.test(value)) {
      const blockLines = [];
      let j = i + 1;
      for (; j < rawLines.length; j += 1) {
        const next = rawLines[j];
        if (!next.trim()) {
          blockLines.push('');
          continue;
        }
        const nextIndent = next.length - next.trimStart().length;
        if (nextIndent <= indent) break;
        blockLines.push(next);
      }
      i = j - 1;
      const nonEmpty = blockLines.filter((l) => l.trim());
      const minIndent = nonEmpty.length ? Math.min(...nonEmpty.map((l) => l.length - l.trimStart().length)) : 0;
      const block = blockLines
        .map((l) => (l.trim() ? l.slice(minIndent) : ''))
        .join('\n')
        .replace(/\n+$/, '');
      data[key] = value.startsWith('>') ? block.replace(/\n/g, ' ').trim() : block;
      continue;
    }

    // 行内列表
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => unquote(stripInlineComment(item.trim())))
        .filter((item) => item !== '');
      continue;
    }

    data[key] = unquote(value);
  }

  return { data, errors };
}

/* ------------------------------------------------------------------ */
/* 资产分类                                                           */
/* ------------------------------------------------------------------ */

/**
 * 路径 → 资产类型 + 预算。只认 AUTHORING 声明的五类路径；
 * 其他 Markdown 一律标 unknown 并告警，避免「偷偷放进来一份没人管的文档」。
 */
export function classifyAsset(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (/^methods\/[^/]+\.md$/.test(norm)) return { kind: 'method', maxLines: BUDGETS.method, frontmatter: 'required' };
  if (/^templates\/[^/]+\.md$/.test(norm)) return { kind: 'template', maxLines: BUDGETS.template, frontmatter: 'required' };
  const caseMatch = /^cases\/([^/]+)\/case\.md$/.exec(norm);
  if (caseMatch) return { kind: 'case', maxLines: BUDGETS.case, frontmatter: 'required', caseId: caseMatch[1] };
  const skillMatch = /^skills\/([^/]+)\/SKILL\.md$/.exec(norm);
  if (skillMatch) return { kind: 'skill', maxLines: BUDGETS.skill, frontmatter: 'required', skillDir: skillMatch[1] };
  const refMatch = /^skills\/([^/]+)\/references\/[^/]+\.md$/.exec(norm);
  if (refMatch) return { kind: 'reference', maxLines: BUDGETS.reference, frontmatter: 'optional', skillDir: refMatch[1] };
  const adapterMatch = /^references\/adapters\/[^/]+\.md$/.exec(norm);
  if (adapterMatch) return { kind: 'adapter', maxLines: BUDGETS.adapter, frontmatter: 'required' };
  return { kind: 'unknown', maxLines: null, frontmatter: 'optional' };
}

/* ------------------------------------------------------------------ */
/* 收集 / 诊断                                                        */
/* ------------------------------------------------------------------ */

function createContext() {
  return { errors: [], warnings: [], notes: [] };
}

function push(ctx, severity, rule, file, line, message, fix) {
  const list = severity === 'error' ? ctx.errors : ctx.warnings;
  list.push({ severity, rule, file, line: line ?? null, message, fix });
}

function error(ctx, rule, file, line, message, fix) {
  push(ctx, 'error', rule, file, line, message, fix);
}

function warn(ctx, rule, file, line, message, fix) {
  push(ctx, 'warning', rule, file, line, message, fix);
}

function note(ctx, rule, message, fix = null) {
  ctx.notes.push({ severity: 'note', rule, file: null, line: null, message, fix });
}

function isNegated(line, index) {
  const before = line.slice(Math.max(0, index - 14), index);
  return /禁止|不得|不可|严禁|不该|勿|避免|不能|不应|避免/.test(before);
}

/**
 * 命中位置是否落在引号内（「」『』“”`）。引号里的「100% 完成」是对该说法的引用，
 * 例如「常见错误：写「100% 完成」」——这类写法正是规范要求的反面示范，不该被判违规。
 */
function insideQuotes(line, index) {
  const pairs = [
    ['「', '」'],
    ['『', '』'],
    ['“', '”'],
    ['`', '`'],
  ];
  for (const [open, close] of pairs) {
    let depth = 0;
    for (let i = 0; i < line.length; i += 1) {
      if (i === index) return depth > 0;
      if (line[i] === open) depth += 1;
      else if (line[i] === close) depth = Math.max(0, depth - 1);
    }
  }
  return false;
}

function scanLines(ctx, { rel, text, patterns, severity, rule, fix, noun }) {
  const lines = splitLines(text);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pattern of patterns) {
      const match = pattern.re.exec(line);
      if (!match) continue;
      const index = match.index ?? 0;
      if (isNegated(line, index)) continue;
      // 引号内的写法是「在谈论这个说法」，不是断言；否则「常见错误：写「100% 完成」」会被误报。
      if (insideQuotes(line, index)) continue;
      if (severity === 'error') {
        error(ctx, rule, rel, i + 1, `${noun}：${pattern.label}`, fix(pattern));
      } else {
        warn(ctx, rule, rel, i + 1, `${noun}：${pattern.label}`, fix(pattern));
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* package.json                                                        */
/* ------------------------------------------------------------------ */

function compareSemver(a, b) {
  const split = (v) => {
    const [core, pre = ''] = String(v).trim().split('-');
    const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return { nums, pre: pre ? pre.split('.') : [] };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i += 1) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1;
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1;
  if (y.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pa = /^\d+$/.test(p);
    const qa = /^\d+$/.test(q);
    if (pa && qa) {
      const delta = Number(p) - Number(q);
      if (delta !== 0) return delta > 0 ? 1 : -1;
    } else if (pa !== qa) {
      return pa ? -1 : 1;
    } else if (p !== q) {
      return p > q ? 1 : -1;
    }
  }
  return 0;
}

/** 极简 engines 判定：支持精确版本、>=x 与 >=x <y；其它写法按不满足处理（宁可报红也不假绿）。 */
export function engineSatisfies(declared, target) {
  const d = String(declared).trim();
  const t = String(target).trim();
  if (!d || !t) return false;
  if (d === t) return true;
  const parts = d.split(/\s+/);
  if (parts.length === 2 && parts[0].startsWith('>=') && parts[1].startsWith('<')) {
    return compareSemver(t, parts[0].slice(2)) >= 0 && compareSemver(t, parts[1].slice(1)) < 0;
  }
  if (parts.length === 1 && parts[0].startsWith('>=')) return compareSemver(t, parts[0].slice(2)) >= 0;
  return false;
}

/** 校验 locale/*.json 的展示元数据：title/description 必填，detail 若声明必须真实存在。 */
export function checkLocaleMetadata({ rootAbs, entries, exists = (p) => existsSync(p) }) {
  const problems = [];
  for (const rel of entries) {
    let data;
    try {
      data = JSON.parse(readFileSync(path.join(rootAbs, rel), 'utf8'));
    } catch (parseError) {
      problems.push({ rel, message: `JSON 解析失败：${parseError.message}`, fix: '修好 JSON 语法后重跑；无效 locale 会让面板回退到包名与默认图形' });
      continue;
    }
    const meta = data?.meta ?? {};
    if (typeof meta.title !== 'string' || meta.title.trim() === '') {
      problems.push({ rel, message: '缺少 meta.title', fix: '补本地化标题；面板据此显示插件名' });
    }
    if (typeof meta.description !== 'string' || meta.description.trim() === '') {
      problems.push({ rel, message: '缺少 meta.description', fix: '补一句话能力描述；面板据此显示插件说明' });
    }
    if (typeof meta.detail === 'string' && meta.detail.trim() !== '') {
      const detailAbs = path.resolve(rootAbs, meta.detail);
      if (!detailAbs.startsWith(path.resolve(rootAbs) + path.sep) && detailAbs !== path.resolve(rootAbs)) {
        problems.push({ rel, message: `meta.detail 指向包外：${meta.detail}`, fix: '改成包内相对路径（如 detail/DETAIL.md）' });
      } else if (!exists(detailAbs)) {
        problems.push({ rel, message: `meta.detail 指向的文件不存在：${meta.detail}`, fix: '创建详情文档，或删掉 meta.detail 回退到 README' });
      }
    }
  }
  return problems;
}

async function checkLocaleFiles(ctx, rootAbs) {
  const localeDir = path.join(rootAbs, 'locale');
  if (!existsSync(localeDir)) return;
  let entries = [];
  try {
    entries = (await readdir(localeDir)).filter((name) => name.endsWith('.json')).map((name) => path.join('locale', name));
  } catch {
    return;
  }
  for (const p of checkLocaleMetadata({ rootAbs, entries })) {
    error(ctx, 'LOCALE', p.rel, null, p.message, p.fix);
  }
}

async function checkPackageJson(ctx, rootAbs) {
  const rel = 'package.json';
  let text;
  try {
    text = await readFile(path.join(rootAbs, 'package.json'), 'utf8');
  } catch {
    warn(ctx, 'PKG-JSON', rel, null, '未找到 package.json', '补 package.json（name/version/dsh.bundle.patch），否则 plugin_manager 无法安装本包');
    return null;
  }

  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch (parseError) {
    error(ctx, 'PKG-JSON', rel, null, `JSON 解析失败：${parseError.message}`, '修好语法；可用 node -e "JSON.parse(require(\'fs\').readFileSync(\'package.json\',\'utf8\'))" 定位');
    return null;
  }

  if (typeof pkg.name !== 'string' || !pkg.name) {
    error(ctx, 'PKG-JSON', rel, null, '缺少 name', '补 name（bundle 包名，如 @local/dsh-project-dev-flow）');
  }
  if (typeof pkg.version !== 'string' || !pkg.version) {
    error(ctx, 'PKG-JSON', rel, null, '缺少 version', '补语义化 version（如 2.0.0）');
  }
  const engine = pkg.engines?.dsh;
  const expected = ctx.expectedDshVersion ?? null;
  if (typeof engine !== 'string' || engine.trim() === '') {
    error(ctx, 'PKG-ENGINE', rel, null, '缺少 engines.dsh 声明', '写实际验证过的 DSH 版本，如 "0.2.2-rc.3"；否则安装时无法判断兼容性');
  } else if (expected && !engineSatisfies(engine, expected)) {
    error(
      ctx,
      'PKG-ENGINE',
      rel,
      null,
      `engines.dsh=${engine} 不覆盖目标运行时 ${expected}`,
      '先按目标版本完成 patch 对齐与验证，再写精确版本；不要用宽泛范围掩盖未验证兼容性',
    );
  }

  if (!pkg.dsh?.bundle?.patch) {
    warn(ctx, 'PKG-JSON', rel, null, '缺少 dsh.bundle.patch 声明', '补 "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }，否则不会被当作 bundle');
  } else {
    const patchPath = path.resolve(rootAbs, pkg.dsh.bundle.patch);
    if (!existsSync(patchPath)) {
      error(ctx, 'PKG-FILES', rel, null, `dsh.bundle.patch 指向的文件不存在：${pkg.dsh.bundle.patch}`, '创建该文件或修正路径');
    }
  }

  if (Array.isArray(pkg.files)) {
    for (const entry of pkg.files) {
      if (typeof entry !== 'string') {
        error(ctx, 'PKG-FILES', rel, null, `files 含非字符串项：${JSON.stringify(entry)}`, 'files 只写相对路径字符串');
        continue;
      }
      if (!existsSync(path.resolve(rootAbs, entry))) {
        warn(ctx, 'PKG-FILES', rel, null, `files 列出了不存在的 ${entry}（发布时会缺文件）`, `补 ${entry} 或从 files 移除`);
      }
    }
  }
  return pkg;
}

/* ------------------------------------------------------------------ */
/* cordis.patch.yml                                                   */
/* ------------------------------------------------------------------ */

/**
 * 扫描 patch 文本找 `- id: <value>` 插件项，返回 { ids, blocks }。
 * blocks 记录缩进与行号，后续按「缩进 <= 起始缩进」截断，得到该插件项的局部块。
 */
function scanPatchItems(lines) {
  const items = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)-\s+id:\s*(['"]?)([^\s'"]+)\2\s*$/.exec(lines[i]);
    if (!match) continue;
    const indent = match[1].length;
    const id = match[3];
    const blockEnd = findBlockEnd(lines, i, indent);
    items.push({ id, line: i + 1, indent, start: i, end: blockEnd, block: lines.slice(i, blockEnd) });
  }
  return items;
}

function findBlockEnd(lines, start, indent) {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent <= indent) {
      end = i;
      break;
    }
  }
  return end;
}

function blockHasNonEmptySection(block) {
  for (let i = 0; i < block.length; i += 1) {
    if (!/^\s*section:\s*(?:[|>][-+]?)\s*$/.test(block[i])) continue;
    const sectionIndent = block[i].length - block[i].trimStart().length;
    const content = [];
    for (let j = i + 1; j < block.length; j += 1) {
      const line = block[j];
      if (!line.trim()) continue;
      const lineIndent = line.length - line.trimStart().length;
      if (lineIndent <= sectionIndent) break;
      content.push(line.trim());
    }
    if (content.join(' ').trim().length > 20) return true;
  }
  return false;
}

export function validatePatchText(ctx, text) {
  const rel = 'cordis.patch.yml';
  const lines = splitLines(text);
  const items = scanPatchItems(lines);

  // 禁用项：list-agents 子路径、modelSelectionSettings
  for (let i = 0; i < lines.length; i += 1) {
    if (/list-agents/i.test(lines[i])) {
      error(ctx, 'PATCH-FORBIDDEN', rel, i + 1, '出现 list-agents 子路径（该工具不随本模式安装）', '删掉该插件项或改回不带子路径的 name；本模式的 agent 清单不通过 patch 暴露');
    }
    if (/modelSelectionSettings/.test(lines[i])) {
      error(ctx, 'PATCH-FORBIDDEN', rel, i + 1, '出现 modelSelectionSettings 配置', '删除该键；模型选择设置由宿主/用户管理，模式不得固化');
    }
  }

  // 必需项：plan-mode 的 section
  const planMode = items.find((item) => item.id === 'plan-mode');
  if (!planMode) {
    error(ctx, 'PATCH-REQUIRED', rel, null, '缺少 plan-mode 插件项', '在 planning group 内加 - id: plan-mode（name: @deepseek-ai/dsh-plan-mode）并写 config.section');
  } else if (!blockHasNonEmptySection(planMode.block)) {
    error(ctx, 'PATCH-REQUIRED', rel, planMode.line, 'plan-mode 缺少非空的 config.section', '补 config.section: | 段落（计划模式的系统提示词），不能留空或只写一两句');
  }

  // 必需项：customSkillDirs
  const hasCustomSkillDirs = /customSkillDirs\s*:/.test(text);
  if (!hasCustomSkillDirs) {
    error(ctx, 'PATCH-REQUIRED', rel, null, '缺少 customSkillDirs', '在 skill-filesystem 的 config 里加 customSkillDirs，指向包内 skills/ 目录');
  } else {
    const skillFilesystem = items.find((item) => item.id === 'skill-filesystem');
    if (skillFilesystem && !/customSkillDirs\s*:/.test(skillFilesystem.block.join('\n'))) {
      warn(ctx, 'PATCH-REQUIRED', rel, skillFilesystem.line, 'customSkillDirs 不在 skill-filesystem 的配置块内', '把 customSkillDirs 移到 skill-filesystem 的 config 下，否则包内技能不会被挂载');
    }
    if (!/['"]skills['"]|\/skills\b/.test(text)) {
      error(ctx, 'PATCH-REQUIRED', rel, null, 'customSkillDirs 没有指向 skills 目录', 'customSkillDirs 的值必须解析到包内 skills/，如 ...join(pkgRoot, \'skills\')');
    }
  }

  // 结构：id 唯一 + 每个插件项必须有 name
  const ids = new Map();
  for (const item of items) {
    if (ids.has(item.id)) {
      error(ctx, 'PATCH-STRUCTURE', rel, item.line, `插件 id 重复：${item.id}（另一处在第 ${ids.get(item.id)} 行）`, '插件 id 必须唯一，否则 group isolate 会相互覆盖');
    } else {
      ids.set(item.id, item.line);
    }
    if (!/^\s*name:\s*\S+/m.test(item.block.slice(1).join('\n'))) {
      error(ctx, 'PATCH-STRUCTURE', rel, item.line, `插件项 ${item.id} 缺少 name`, '补 name: <插件包名>，没有 name 的项不会被加载');
    }
  }
}

/* ------------------------------------------------------------------ */
/* 占位符与写死命令                                                   */
/* ------------------------------------------------------------------ */

function checkPlaceholders(ctx, { rel, text, kind }) {
  const seen = new Set();
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    const name = match[1].trim();
    seen.add(name);
    if (!KNOWN_PLACEHOLDERS.includes(name)) {
      warn(
        ctx,
        'PLACEHOLDER',
        rel,
        lineAt(text, match.index),
        `未知占位符 {{${name}}}`,
        `只用 AUTHORING §5 的占位符：${KNOWN_PLACEHOLDERS.join('、')}；自定义占位符请先登记规范`,
      );
    }
  }

  if (kind === 'template' && seen.size === 0) {
    error(ctx, 'PLACEHOLDER', rel, null, '模板没有任何 {{...}} 占位符（等于写死了某个项目）', '把项目名/路径/命令换成 {{project.name}}、{{doc:root}}、{{command:test}} 等（AUTHORING §5）');
  }

  if (kind === 'template' || kind === 'skill') {
    const lines = splitLines(text);
    for (let i = 0; i < lines.length; i += 1) {
      for (const pattern of HARDCODED_COMMANDS) {
        if (!pattern.re.test(lines[i])) continue;
        error(
          ctx,
          'PLACEHOLDER',
          rel,
          i + 1,
          `写死具体命令：${pattern.label}`,
          '改用占位符（{{command:verify}}、{{command:test}}、{{command:build}}、{{command:e2e}}）；找不到值就写「未配置」',
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 内部链接                                                           */
/* ------------------------------------------------------------------ */

function checkLinks(ctx, { rootAbs, rel, text }) {
  for (const match of text.matchAll(LINK_RE)) {
    const raw = match[1].trim();
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue; // http(s)、mailto、tel 等外链
    if (raw.startsWith('#')) continue; // 同文件锚点
    if (raw.includes('{{')) continue; // 占位符链接，运行时才解析

    const target = raw.replace(/^<|>$/g, '').split('#')[0].split('?')[0];
    if (!target) continue;

    const decoded = safeDecode(target);
    const baseDir = path.dirname(path.join(rootAbs, rel));
    const abs = path.resolve(baseDir, decoded);
    const inside = abs === rootAbs || abs.startsWith(`${rootAbs}${path.sep}`);
    const line = lineAt(text, match.index);

    if (!inside) {
      error(ctx, 'LINK', rel, line, `链接指向包外：${raw}`, '包发布后该目标不存在；改用包内相对路径，或用 {{doc:root}} 等占位符在运行时解析');
      continue;
    }
    if (!existsSync(abs)) {
      error(ctx, 'LINK', rel, line, `内部链接目标不存在：${raw}`, `改成实际存在的文件（相对本文件目录），或删掉该链接；当前解析到 ${path.relative(rootAbs, abs).replace(/\\/g, '/')}`);
    }
  }
}

function safeDecode(value) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/* ------------------------------------------------------------------ */
/* frontmatter 字段校验                                               */
/* ------------------------------------------------------------------ */

function checkFrontmatterFields(ctx, { rel, spec, fm, knownDocs, docsRoot, now, rootAbs }) {
  const data = fm.data ?? {};
  const required = spec.frontmatter === 'required';

  for (const key of FRONTMATTER_KEYS) {
    if (!required && typeof data[key] === 'undefined') continue;
    const value = data[key];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)) {
      error(ctx, 'FM-REQUIRED', rel, fm.startLine || 1, `缺少必填字段 ${key}`, `按 AUTHORING §2 补 ${key}；示例见 AUTHORING.md 第 25 行的样板`);
    }
  }

  if (typeof data.kind === 'string' && spec.kind !== 'unknown' && data.kind !== spec.kind) {
    error(ctx, 'FM-KIND', rel, fm.startLine || 1, `kind 为 ${data.kind}，但文件位于 ${spec.kind} 资产路径`, `把 kind 改成 ${spec.kind}，或把文件移到对应目录（§1 的分工）`);
  }

  if (typeof data.id === 'string' && data.id) {
    const prefix = KIND_PREFIX[spec.kind];
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(data.id)) {
      error(ctx, 'FM-ID', rel, fm.startLine || 1, `id 不是 kebab-case：${data.id}`, 'id 只允许小写字母/数字/连字符，且全局唯一');
    } else if (prefix && !data.id.startsWith(prefix)) {
      error(ctx, 'FM-ID', rel, fm.startLine || 1, `id 前缀应为 ${prefix}，实际是 ${data.id}`, `改成 ${prefix}…（前缀=kind，§2）`);
    }
  }

  if (typeof data.version === 'string' && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(data.version)) {
    error(ctx, 'FM-VERSION', rel, fm.startLine || 1, `version 不是语义化版本：${data.version}`, '写成 1.0.0 / 1.0.0-rc.1 这类 semver');
  }

  if (typeof data.domain === 'string' && !DOMAINS.includes(data.domain)) {
    error(ctx, 'FM-ENUM', rel, fm.startLine || 1, `domain 非法：${data.domain}`, `domain 只能是 ${DOMAINS.join(' / ')}`);
  }
  if (typeof data.authority === 'string' && !AUTHORITIES.includes(data.authority)) {
    error(ctx, 'FM-ENUM', rel, fm.startLine || 1, `authority 非法：${data.authority}`, `authority 只能是 ${AUTHORITIES.join(' / ')}（fallback=缺省方法 / example=示例 / evidence-only=只作证据）`);
  }
  if (typeof data.lifecycle === 'string' && !['active', 'historical', 'archive'].includes(data.lifecycle)) {
    error(ctx, 'FM-ENUM', rel, fm.startLine || 1, `lifecycle 非法：${data.lifecycle}`, 'lifecycle 只能是 active / historical / archive');
  }
  if (typeof data.status === 'string' && !STATUSES.includes(data.status)) {
    error(ctx, 'FM-ENUM', rel, fm.startLine || 1, `status 非法：${data.status}`, `status 只能是 ${STATUSES.join(' / ')}`);
  }

  // 历史内容不得自称当前生效（§6.6 的结构部分）
  if ((data.lifecycle === 'historical' || data.lifecycle === 'archive') && typeof data.status === 'string' && !CASE_OUTCOMES.includes(data.status)) {
    error(ctx, 'HIST-STATUS', rel, fm.startLine || 1, `lifecycle=${data.lifecycle} 但 status=${data.status}`, '历史/归档内容 status 只能是 closed 或 superseded；仍生效的决策请用 lifecycle: active + status: active');
  }

  // review_after：必填、合法、≤12 个月、过期告警
  if (typeof data.review_after === 'string' && data.review_after) {
    const iso = parseIsoDate(data.review_after);
    if (!iso) {
      error(ctx, 'FM-REVIEW-AFTER', rel, fm.startLine || 1, `review_after 不是合法日期：${data.review_after}`, '写成 YYYY-MM-DD（如 2027-05-01）');
    } else {
      const today = isoDate(now ?? new Date());
      const limit = isoDate(new Date((now ?? new Date()).getFullYear() + 1, (now ?? new Date()).getMonth(), (now ?? new Date()).getDate()));
      if (iso > limit) {
        error(ctx, 'FM-REVIEW-AFTER', rel, fm.startLine || 1, `review_after 超出 12 个月上限：${iso} > ${limit}`, `把复核日期压到 ${limit} 之内；方法类内容每季度复核（§2/§9）`);
      } else if (iso < today) {
        warn(ctx, 'FM-REVIEW-AFTER', rel, fm.startLine || 1, `review_after 已过期：${iso}（今天 ${today}）`, '复核内容后更新 review_after；过期视为待复核（§9）');
      }
    }
  }

  // sources：doc:<stem> / case:<id>，不得绝对路径
  if (Array.isArray(data.sources)) {
    for (const source of data.sources) {
      const text = String(source);
      const match = /^(doc|case):(.+)$/.exec(text);
      if (!match) {
        error(ctx, 'FM-SOURCES', rel, fm.startLine || 1, `sources 格式非法：${text}`, '只能写 doc:<docs 文件名去扩展名> 或 case:<case-id>（§2，禁止绝对路径）');
        continue;
      }
      const kind = match[1];
      const value = match[2].trim();
      if (/[/\\]/.test(value) || /^[A-Za-z]:/.test(value)) {
        error(ctx, 'FM-SOURCES', rel, fm.startLine || 1, `sources 不得写路径：${text}`, '去掉目录与盘符，只写文件名或 case-id；绝对路径见 §6.2');
        continue;
      }
      if (kind === 'doc') {
        if (knownDocs) {
          if (!knownDocs.has(value)) {
            error(ctx, 'FM-SOURCES', rel, fm.startLine || 1, `doc:${value} 在 docs/ 下找不到 ${value}.md`, '核对 docs/ 文件名（不含扩展名；含中文与下划线），或先补 docs/ 文件');
          }
        } else {
          noteOnce(ctx, 'FM-SOURCES', 'docs/ 不可用，已跳过 doc:<stem> 的存在性校验', '用 --docs 指定 docs/ 后再跑本校验');
        }
      }
      if (kind === 'case' && !existsSync(path.join(rootAbs, 'cases', value, 'case.md'))) {
        error(ctx, 'FM-SOURCES', rel, fm.startLine || 1, `case:${value} 找不到对应案例`, `在 cases/${value}/case.md 建案例，或改成已存在的 case-id`);
      }
    }
  } else if (required) {
    // 空数组已在必填检查里报过，这里避免重复
  }
}

/** 同一批校验里同一条 note 只出现一次（例如「docs 不可用跳过解析」）。 */
function noteOnce(ctx, rule, message, fix) {
  ctx.noted ??= new Set();
  const key = `${rule}|${message}`;
  if (ctx.noted.has(key)) return;
  ctx.noted.add(key);
  note(ctx, rule, message, fix);
}

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* ------------------------------------------------------------------ */
/* 技能 / 案例 / 模板                                                 */
/* ------------------------------------------------------------------ */

function checkSkill(ctx, { rel, spec, fm }) {
  const dir = spec.skillDir;
  const data = fm.data ?? {};
  const name = typeof data.name === 'string' ? data.name : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';

  if (!name) {
    error(ctx, 'SKILL-NAME', rel, fm.startLine || 1, '缺少 name', `name 必须等于目录名「${dir}」`);
  } else {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      error(ctx, 'SKILL-NAME', rel, fm.startLine || 1, `name「${name}」不是 kebab-case`, 'name 只允许小写字母、数字、连字符（§4）');
    }
    if (name !== dir) {
      error(ctx, 'SKILL-NAME', rel, fm.startLine || 1, `name「${name}」与目录名「${dir}」不一致`, '要么改 name，要么重命名目录——两者必须相同（§4）');
    }
  }

  if (!description) {
    error(ctx, 'SKILL-DESC', rel, fm.startLine || 1, '缺少 description', '用一句话写「什么时候用」，≤120 字（§4）');
  } else {
    const length = [...description].length;
    if (length > 120) {
      error(ctx, 'SKILL-DESC', rel, fm.startLine || 1, `description ${length} 字，超过 120 字上限`, '压成一句话说明触发场景；细节移到 references/ 或 methods/');
    }
  }

  if (typeof data.whenToUse !== 'string' || data.whenToUse.trim() === '') {
    warn(ctx, 'SKILL-WHEN', rel, fm.startLine || 1, '缺少 whenToUse', '补 whenToUse：用户说出什么时该用这个技能（与 description 互补）');
  }

  const disable = data['disable-model-invocation'];
  if (typeof disable !== 'undefined' && typeof disable !== 'boolean') {
    error(ctx, 'SKILL-DISABLE', rel, fm.startLine || 1, `disable-model-invocation 必须是 true/false，实际是 ${JSON.stringify(disable)}`, '改成 true 或 false');
  }
  // 历史/证据类技能：路径名匹配 + 显式白名单（验收与案例蒸馏不靠目录名，必须逐个列出）
  const EVIDENCE_SKILLS = ['project-acceptance', 'project-case-distill'];
  if ((/(?:history|evidence|archive)/i.test(dir) || EVIDENCE_SKILLS.includes(dir)) && disable !== true) {
    error(ctx, 'SKILL-DISABLE', rel, fm.startLine || 1, '历史证据类技能必须 disable-model-invocation: true', '补 disable-model-invocation: true，让该技能只能被用户显式调用（§4）');
  }

  const headings = splitLines(fm.body).filter((line) => /^#{2,6}\s+/.test(line));
  const expected = [
    { key: '何时使用', re: /何时使用|什么时候用/ },
    { key: '输入', re: /输入|前提/ },
    { key: '步骤', re: /步骤|流程/ },
    { key: '输出', re: /输出|产出/ },
    { key: '停止条件', re: /停止条件|何时停止|停止/ },
    { key: '常见错误', re: /常见错误|常见坑|易错/ },
  ];
  const missing = expected.filter((item) => !headings.some((heading) => item.re.test(heading))).map((item) => item.key);
  if (missing.length > 0) {
    warn(ctx, 'SKILL-STRUCTURE', rel, null, `缺少段落：${missing.join('、')}`, '按「何时使用 → 输入 → 步骤 → 输出 → 停止条件 → 常见错误」组织正文（§4）');
  }
}

function checkCase(ctx, { rel, text, fm, spec }) {
  const body = fm.body || text;
  // 结构检查按「标题行」判定，而不是全文词面：词面命中会让只有一句「证据」的案例蒙混过关
  const headings = splitLines(body).filter((line) => /^#{2,6}\s+/.test(line));
  const missing = CASE_SECTIONS.filter((section) => !headings.some((heading) => section.re.test(heading))).map((section) => section.key);
  if (missing.length > 0) {
    error(
      ctx,
      'CASE-STRUCTURE',
      rel,
      null,
      `案例结构缺项：${missing.join('、')}`,
      '按 §7 补齐七项标题：背景与约束 / 当时的错误判断（必须写）/ 候选方案与取舍 / 可观察证据 / 残余风险 / 可提炼方法与边界 / 与方法链接',
    );
  }
  if (!/来源项目/.test(body)) {
    error(ctx, 'CASE-SOURCE', rel, null, '缺少「来源项目（下称 P）」写法', '顶部写「来源：来源项目（下称 P）<时间><事项>（脱敏，原文不随包发布）」（§6.4）');
  }
  if (spec.caseId && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.caseId)) {
    warn(ctx, 'CASE-STRUCTURE', rel, null, `案例目录名不是 kebab-case：${spec.caseId}`, '重命名为 kebab-case，便于以 case:<case-id> 引用');
  }
}

/* ------------------------------------------------------------------ */
/* 单文件主检查                                                       */
/* ------------------------------------------------------------------ */

async function inspectAsset(ctx, { rootAbs, rel, text, docsRoot, knownDocs, now }) {
  const spec = classifyAsset(rel);
  const lines = lineCount(text);
  const fm = parseFrontmatter(text);

  if (spec.kind === 'unknown') {    warn(ctx, 'ASSET-UNCLASSIFIED', rel, null, '不属于 methods/templates/cases/skills/references 的受管路径', '移到受管目录或从包内删除；未分类文档不会被任何技能加载');
  }

  if (spec.maxLines && lines > spec.maxLines) {
    warn(
      ctx,
      'LINE-BUDGET',
      rel,
      null,
      `${lines} 行，超出 ${spec.kind} 预算 ${spec.maxLines} 行（+${lines - spec.maxLines}）`,
      '把细节移入 references/，或压缩正文；连续两次告警视为缺陷（§3）',
    );
  }

  // frontmatter 存在性
  if (spec.frontmatter === 'required' && !fm.present) {
    error(ctx, 'FM-MISSING', rel, 1, '缺少 frontmatter', '文件第 1 行写 --- 与 §2 必填字段，再写一行 ---（method/template/case/adapter 必须有）');
    return { rel, spec, fm, id: null, lifecycle: null, sources: [] };
  }
  if (fm.present && !fm.ok) {
    for (const item of fm.errors) {
      error(ctx, 'FM-MISSING', rel, item.line, item.message, item.fix);
    }
  }
  if (fm.present && fm.ok) {
    // SKILL.md 走 §4 的字段集（name/description/whenToUse/disable-model-invocation），不是 §2。
    if (spec.kind === 'skill') {
      checkSkill(ctx, { rel, spec, fm });
    } else {
      checkFrontmatterFields(ctx, { rel, spec, fm, knownDocs, docsRoot, now, rootAbs });
      if (spec.kind === 'case') checkCase(ctx, { rel, text, fm, spec });
    }
  }

  checkPlaceholders(ctx, { rel, text, kind: spec.kind });
  checkLinks(ctx, { rootAbs, rel, text });

  // §6 红线
  const numbersInScope = ['method', 'template', 'skill', 'reference', 'adapter'].includes(spec.kind);
  if (numbersInScope) {
    scanLines(ctx, {
      rel,
      text,
      patterns: REDLINE_NUMBER,
      severity: 'error',
      rule: 'REDLINE-NUMBER',
      noun: '命中禁止的当前项目数字',
      fix: () => '删掉具体数字，改写为「按项目实测」或给出量级区间（§6.1）',
    });
  }
  scanLines(ctx, {
    rel,
    text,
    patterns: REDLINE_PATH,
    severity: 'error',
    rule: 'REDLINE-PATH',
    noun: '命中绝对路径/主机信息',
    fix: () => '删除盘符、用户名、IP、端口；用 {{doc:root}} 等占位符或相对路径（§6.2）',
  });
  scanLines(ctx, {
    rel,
    text,
    patterns: REDLINE_CRED,
    severity: 'error',
    rule: 'REDLINE-CRED',
    noun: '命中疑似凭据',
    fix: () => '删除密钥/账号 ID；用 {{env:...}} 或「见项目 profile」代替，凭据不得进包（§6.3）',
  });
  scanLines(ctx, {
    rel,
    text,
    patterns: REDLINE_WORK,
    severity: 'error',
    rule: 'REDLINE-WORK',
    noun: '命中真实作品/业务名',
    fix: () => '改为「来源项目（下称 P）」，删除真实产品、客户、书名（§6.4）',
  });
  scanLines(ctx, {
    rel,
    text,
    patterns: REDLINE_AI_SIGN,
    severity: 'error',
    rule: 'REDLINE-AI-SIGN',
    noun: '命中「AI 代签」默认流程',
    fix: () => '改成「agent 起草、人类签认」；代理签认只能作为项目级显式策略案例（§6.7）',
  });
  scanLines(ctx, {
    rel,
    text,
    patterns: REDLINE_100,
    severity: 'error',
    rule: 'REDLINE-100',
    noun: '命中「100% 完成」断言',
    fix: () => '改成「候选完成 + 证据链 + 剩余风险」（§6.8）',
  });

  // §6.5 大段引用（启发式，告警）
  const quoteRun = largestQuoteRun(splitLines(text));
  if (quoteRun >= 300) {
    warn(ctx, 'REDLINE-QUOTE', rel, null, `连续引用块约 ${quoteRun} 字符，疑似大段外部作品原文`, '核对授权；超过合理引用范围的一律删掉或改为要点转述（§6.5）');
  }

  return {
    rel,
    spec,
    fm,
    id: typeof fm.data?.id === 'string' ? fm.data.id : null,
    lifecycle: typeof fm.data?.lifecycle === 'string' ? fm.data.lifecycle : null,
    sources: Array.isArray(fm.data?.sources) ? fm.data.sources : [],
  };
}

function largestQuoteRun(lines) {
  let best = 0;
  let current = 0;
  for (const line of lines) {
    if (/^\s*>/.test(line)) current += line.length;
    else {
      best = Math.max(best, current);
      current = 0;
    }
  }
  return Math.max(best, current);
}

/* ------------------------------------------------------------------ */
/* 目录遍历                                                           */
/* ------------------------------------------------------------------ */

const CONTENT_DIRS = ['methods', 'templates', 'cases', 'skills', 'references'];

async function listContentFiles(rootAbs) {
  const out = [];
  for (const dirName of CONTENT_DIRS) {
    const dirAbs = path.join(rootAbs, dirName);
    if (!existsSync(dirAbs)) continue;
    await walkDir(dirAbs, dirName, out);
  }
  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return out;
}

async function walkDir(dirAbs, prefix, out) {
  const entries = await readdir(dirAbs, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await walkDir(path.join(dirAbs, entry.name), rel, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(rel);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 主校验                                                             */
/* ------------------------------------------------------------------ */

/**
 * 校验整个内容包。
 *
 * @param {{ root?: string, docsRoot?: string|false|null, lockPath?: string|null, now?: Date,
 *           env?: Record<string,string|undefined>, strict?: boolean }} options
 * @returns {Promise<{ ok: boolean, errors: Array, warnings: Array, notes: Array,
 *   summary: object, root: string, docsRoot: string|null, strict: boolean, exitCode: number }>}
 */
export async function validatePackage(options = {}) {
  const rootAbs = path.resolve(options.root ?? defaultRoot());
  const ctx = createContext();
  const strict = Boolean(options.strict);
  const now = options.now ?? new Date();
  ctx.expectedDshVersion = options.dshVersion ?? process.env.DSH_FLOW_TARGET_DSH ?? null;

  // docs/ 解析
  let docsRoot = null;
  let docsSource = 'none';
  if (options.docsRoot === false) {
    docsSource = 'disabled';
  } else if (typeof options.docsRoot === 'string') {
    const candidate = path.isAbsolute(options.docsRoot) ? options.docsRoot : path.resolve(rootAbs, options.docsRoot);
    if (existsSync(candidate)) {
      docsRoot = candidate;
      docsSource = 'flag';
    } else {
      error(ctx, 'DOCS-DIR', null, null, `--docs 指向的目录不存在：${options.docsRoot}`, '改成真实存在的 docs/ 路径，或去掉 --docs 让脚本自动查找');
    }
  } else {
    const found = findDocsRoot({ root: rootAbs, env: options.env ?? process.env });
    if (found.dir) {
      docsRoot = found.dir;
      docsSource = found.source;
    }
  }

  let knownDocs = null;
  if (docsRoot) {
    try {
      // sources 写 doc:<文件名去扩展名>，因此这里只保留 stem，避免把 .md 比进 key。
      knownDocs = new Set((await listDocs(docsRoot)).map((rel) => rel.replace(/\.md$/i, '')));
    } catch {
      knownDocs = new Set();
    }
  }

  // 1) package.json
  const pkg = await checkPackageJson(ctx, rootAbs);
  await checkLocaleFiles(ctx, rootAbs);

  // 2) patch
  const patchPath = path.join(rootAbs, 'cordis.patch.yml');
  if (!existsSync(patchPath)) {
    error(ctx, 'PATCH-FILE', 'cordis.patch.yml', null, '缺少 cordis.patch.yml', '创建 bundle patch（见 package.json 的 dsh.bundle.patch 声明）');
  } else {
    const patchText = await readFile(patchPath, 'utf8');
    validatePatchText(ctx, patchText);
  }

  // 3) 内容资产
  const files = await listContentFiles(rootAbs);
  const assets = [];
  for (const rel of files) {
    const text = await readFile(path.join(rootAbs, rel), 'utf8');
    assets.push(await inspectAsset(ctx, { rootAbs, rel, text, docsRoot, knownDocs, now }));
  }

  if (files.length === 0) {
    note(ctx, 'ASSET-NONE', '未发现任何内容资产（methods/templates/cases/skills 均为空）', '按 AUTHORING §1 落地资产；校验器只校验存在的东西，不会替你补内容');
  }

  // 4) id 唯一
  const idMap = new Map();
  for (const asset of assets) {
    if (!asset.id) continue;
    if (idMap.has(asset.id)) {
      error(ctx, 'ASSET-DUP-ID', asset.rel, asset.fm.startLine || 1, `id 重复：${asset.id}（已在 ${idMap.get(asset.id)} 使用）`, 'frontmatter id 必须全局唯一；改 id 或合并文件');
    } else {
      idMap.set(asset.id, asset.rel);
    }
  }

  // 5) 方法引用历史案例（§6.6 语义部分，只能启发式告警）
  const caseLifecycles = new Map();
  for (const asset of assets) {
    if (asset.spec.kind === 'case' && asset.spec.caseId && asset.lifecycle) caseLifecycles.set(asset.spec.caseId, asset.lifecycle);
  }
  for (const asset of assets) {
    if (asset.spec.kind !== 'method') continue;
    for (const source of asset.sources) {
      const match = /^case:(.+)$/.exec(String(source));
      if (!match) continue;
      const target = caseLifecycles.get(match[1]);
      if (target && target !== 'active') {
        warn(ctx, 'HIST-SOURCE', asset.rel, null, `引用历史案例 case:${match[1]}（lifecycle=${target}）`, '只能以「当时」口径引用，不得写成当前事实；必要时注明「历史案例」（§6.6）');
      }
    }
  }

  // 6) sources.lock.json（docsRoot: false 表示明确不校验来源登记）
  let lockResult = {
    ok: true,
    errors: [],
    warnings: [],
    notes: [],
    summary: { docs: null, lockEntries: 0, hashChecked: 0, hashMismatch: 0, missingInLock: 0, missingOnDisk: 0, targetsMissing: 0 },
  };
  if (docsSource !== 'disabled') {
    lockResult = await verifySources({ root: rootAbs, docsRoot, lockPath: options.lockPath ?? null });
    ctx.errors.push(...lockResult.errors);
    ctx.warnings.push(...lockResult.warnings);
    for (const item of lockResult.notes) {
      if (!ctx.notes.some((existing) => existing.rule === item.rule && existing.message === item.message)) ctx.notes.push(item);
    }
  }

  // 7) 汇总
  const byKind = {};
  for (const asset of assets) byKind[asset.spec.kind] = (byKind[asset.spec.kind] ?? 0) + 1;
  const summary = {
    assets: assets.length,
    byKind,
    docs: lockResult.summary.docs ?? (knownDocs ? knownDocs.size : null),
    lockEntries: lockResult.summary.lockEntries,
    docsSource,
  };

  const errors = ctx.errors.slice().sort(sortDiagnostics);
  const warnings = ctx.warnings.slice().sort(sortDiagnostics);
  const notes = ctx.notes.slice();
  const exitCode = errors.length > 0 ? 1 : strict && warnings.length > 0 ? 1 : 0;

  return { ok: errors.length === 0, errors, warnings, notes, summary, root: rootAbs, docsRoot, strict, exitCode };
}

function sortDiagnostics(a, b) {
  const fileA = a.file ?? '';
  const fileB = b.file ?? '';
  if (fileA !== fileB) return fileA < fileB ? -1 : 1;
  const lineA = a.line ?? 0;
  const lineB = b.line ?? 0;
  if (lineA !== lineB) return lineA - lineB;
  const ruleA = a.rule ?? '';
  const ruleB = b.rule ?? '';
  return ruleA < ruleB ? -1 : ruleA > ruleB ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* 报告                                                               */
/* ------------------------------------------------------------------ */

export function formatReport(result, { color = false, verbose = false, quiet = false } = {}) {
  const painter = makePainter(color);
  const out = [];
  out.push(painter.bold('dsh-project-dev-flow · 内容包校验'));
  out.push(`root: ${result.root}`);
  out.push(`docs: ${result.docsRoot ?? '未解析（跳过 docs 相关校验）'}${result.summary.docsSource ? `（${result.summary.docsSource}）` : ''}`);

  if (!quiet) out.push('');

  for (const item of result.errors) out.push(renderDiagnostic(item, painter));
  if (!quiet) {
    for (const item of result.warnings) out.push(renderDiagnostic(item, painter));
    if (verbose) for (const item of result.notes) out.push(painter.dim(`ℹ [${item.rule}] ${item.message}`));
  }

  const kindText = Object.entries(result.summary.byKind)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(' / ');
  if (!quiet) {
    out.push('');
    out.push(
      `资产 ${result.summary.assets} 个${kindText ? `（${kindText}）` : ''} · docs ${result.summary.docs ?? '未解析'} 份 · lock ${result.summary.lockEntries} 条`,
    );
  }
  const verdict =
    result.errors.length > 0
      ? painter.red(`✗ 未通过：${result.errors.length} 个错误，${result.warnings.length} 个告警`)
      : result.strict && result.warnings.length > 0
        ? painter.yellow(`✗ --strict 未通过：${result.warnings.length} 个告警`)
        : painter.green(`✔ 通过：${result.warnings.length} 个告警（不阻断）`);
  if (quiet && result.errors.length === 0) return `${verdict}\n`;
  out.push(verdict);
  return `${out.join('\n')}\n`;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

const HELP = `校验 dsh-project-dev-flow 内容包是否满足 AUTHORING.md。

用法:
  node scripts/validate-package.mjs [root] [选项]

参数:
  root               package 根目录（默认：脚本所在目录的上一级；也可用 --root）

选项:
  --root <dir>       package 根目录
  --docs <dir>       docs/ 目录（默认：从 package 根向上查找最近的 docs/）
  --lock <file>      sources.lock.json 路径（默认：<root>/sources.lock.json）
  --strict           告警也按失败处理（CI 用；日常开发建议不加）
  --json             输出机器可读 JSON（自动关闭颜色）
  --quiet            只输出错误与结论
  --verbose          附带 notes（如 docs 解析来源、跳过原因）
  --no-color         强制纯文本（管道/重定向时已自动关闭颜色）
  --rules            列出全部规则编号与含义后退出
  -h, --help         显示本帮助

环境变量:
  DSH_FLOW_DOCS_DIR  指定 docs/（优先级低于 --docs）
  NO_COLOR           非空时禁用颜色

退出码:
  0  通过（告警不阻断，除非 --strict）
  1  存在错误（或 --strict 下存在告警）
  2  用法错误（参数拼错/缺值）

示例:
  node scripts/validate-package.mjs
  node scripts/validate-package.mjs --json | jq '.errors[].rule'
  node scripts/validate-package.mjs --docs ../../docs --strict

规则覆盖（详见 AUTHORING.md）:
  §2 文件头 / §3 篇幅 / §4 技能 / §5 占位符 / §6 内容红线 / §7 案例结构 / §8 来源登记
  额外契约: cordis.patch.yml 禁 list-agents 子路径与 modelSelectionSettings；
            必须含 plan-mode 的 section 与 customSkillDirs。
`;

function parseArgv(argv) {
  const opts = {
    root: null,
    docs: null,
    lock: null,
    strict: false,
    json: false,
    quiet: false,
    verbose: false,
    noColor: false,
    rules: false,
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
      case '--docs': opts.docs = takeValue((i += 1), '--docs'); break;
      case '--lock': opts.lock = takeValue((i += 1), '--lock'); break;
      case '--strict': opts.strict = true; break;
      case '--json': opts.json = true; break;
      case '--quiet': opts.quiet = true; break;
      case '--verbose': opts.verbose = true; break;
      case '--no-color': opts.noColor = true; break;
      case '--rules': opts.rules = true; break;
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

export async function runCli(argv = process.argv.slice(2), io = process) {
  let opts;
  try {
    opts = parseArgv(argv);
  } catch (error) {
    io.stderr.write(`✗ ${error.message}\n  Fix: 运行 node scripts/validate-package.mjs --help 查看可用参数\n`);
    return 2;
  }
  if (opts.help) {
    io.stdout.write(HELP);
    return 0;
  }
  if (opts.rules) {
    for (const [id, description] of Object.entries(ALL_RULES)) io.stdout.write(`${id.padEnd(22)} ${description}\n`);
    return 0;
  }

  const rootArg = opts.root ?? opts.positional[0] ?? null;
  if (opts.docs) {
    const resolved = path.isAbsolute(opts.docs) ? opts.docs : path.resolve(rootArg ? path.resolve(rootArg) : defaultRoot(), opts.docs);
    if (!existsSync(resolved)) {
      io.stderr.write(`✗ --docs 指向的目录不存在：${opts.docs}\n  Fix: 改成真实路径，或去掉 --docs 让脚本从 package 根向上查找 docs/\n`);
      return 2;
    }
  }

  const color = !opts.noColor && colorEnabled(io.stdout, argv);
  const result = await validatePackage({
    root: rootArg ? path.resolve(rootArg) : defaultRoot(),
    docsRoot: opts.docs ? path.resolve(rootArg ? path.resolve(rootArg) : defaultRoot(), opts.docs) : null,
    lockPath: opts.lock,
    strict: opts.strict,
  });

  if (opts.json) {
    const { ok, root, docsRoot, strict, exitCode, errors, warnings, notes, summary } = result;
    io.stdout.write(`${JSON.stringify({ ok, root, docsRoot, strict, exitCode, errors, warnings, notes, summary, rules: ALL_RULES }, null, 2)}\n`);
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
