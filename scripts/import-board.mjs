#!/usr/bin/env node
/**
 * import-board.mjs — 把项目 docs 里的台账派生为 board.json。
 *
 * 三条纪律：
 *   1. 只写 derived：overlay 只保留、不修改（3.1.0 起才允许看板写 overlay）。
 *   2. 确定性：同一输入两次输出字节一致；无变更不写盘（no-op）。
 *   3. 不猜：表头签名认不出的表一律跳过并记诊断，不编造条目。
 *
 * 用法：
 *   node scripts/import-board.mjs [--root <工作区根>] [--out <board.json>] [--check]
 * 退出码：0 成功/一致；1 --check 发现漂移；2 参数错误。
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE_ROLES = [
  { role: 'status', re: /_入口_项目状态看板\.md/ },
  { role: 'wbs', re: /_验收_WBS拆解明细\.md/ },
  { role: 'decisions', re: /_入口_待裁决台账\.md/ },
  { role: 'issues', re: /_功能_剩余问题\.md/ },
  { role: 'next', re: /_功能_下一步工作清单\.md/ }
]

const LANE_BY = {
  'stage:done': 'done', 'stage:partial': 'doing', 'stage:missing': 'todo', 'stage:hold': 'blocked', 'stage:unknown': 'todo',
  'gate:done': 'done', 'gate:partial': 'verify', 'gate:missing': 'todo', 'gate:hold': 'blocked', 'gate:unknown': 'todo',
  'wbs:done': 'done', 'wbs:partial': 'verify', 'wbs:missing': 'todo', 'wbs:hold': 'blocked', 'wbs:unknown': 'todo',
  'decision:unknown': 'decision',
  'issue:done': 'done', 'issue:partial': 'todo', 'issue:missing': 'todo', 'issue:unknown': 'todo',
  'next:done': 'done', 'next:partial': 'doing', 'next:missing': 'todo', 'next:hold': 'blocked', 'next:unknown': 'todo'
}

export function roleOf(name) {
  for (const f of FILE_ROLES) if (f.re.test(name)) return f.role
  return null
}

/** 按未转义的 | 切分：docs 的命令列里有 `\|` 转义。 */
export function splitRow(line) {
  let body = line.trim()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1)
  const cells = []
  let cur = ''
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (ch === '\\' && body[i + 1] === '|') { cur += '|'; i += 1; continue }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  cells.push(cur.trim())
  return cells
}

export function tables(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  let cur = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line.startsWith('|') || !line.endsWith('|')) { cur = null; continue }
    const cells = splitRow(line)
    if (!cur) { cur = { line: i + 1, header: cells, rows: [] }; out.push(cur); continue }
    const sep = cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')))
    if (sep) continue
    cur.rows.push({ line: i + 1, cells })
  }
  return out
}

const deBold = (s) => String(s ?? '').replace(/\*\*/g, '').replace(/~~/g, '').replace(/`/g, '').trim()
const linkText = (s) => {
  const m = String(s ?? '').match(/\[([^\]]+)\]\(([^)]+)\)/)
  return m ? deBold(m[1]) : deBold(s)
}
export const statusOf = (s) => {
  if (/🟡/.test(s)) return 'partial'
  if (/❌/.test(s)) return 'missing'
  if (/⏸️/.test(s)) return 'hold'
  if (/✅|✓/.test(s)) return 'done'
  return 'unknown'
}
const struck = (s) => /~~/.test(String(s ?? ''))

/** 表头签名优先于文件名：项目换了文件名也能认出表。 */
export function tableRole(header) {
  const h = header.map(deBold)
  const has = (k) => h.includes(k)
  if (has('阶段') && has('状态') && has('名称')) return 'stage'
  if (h[0] === 'ID' && has('验收标准（可失败）') && has('状态')) return 'wbs'
  if (h[0] === '#' && has('项') && (has('为什么需要人') || has('可能的复核方向'))) return 'decision'
  if (has('ID') && has('严重度')) return 'issue'
  if (h[0] === '#' && has('事项') && (has('工作量') || has('说明'))) return 'next'
  return null
}

const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12)
const posix = (p) => p.split('\\').join('/')

/**
 * 纯函数：给定工作区根，产出不依赖时间与环境的 board 主体。
 * 排序、键序、哈希全部确定，同一输入必得同一字节。
 */
const MANIFEST_REL = join('.dsh', 'project-board', 'manifest.json')

/** 读取项目清单（可选）：只看 JSON，不引 YAML 依赖。 */
export function loadManifest(root) {
  const file = join(root, MANIFEST_REL)
  if (!existsSync(file)) return null
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    return manifest?.schemaVersion === 1 ? manifest : null
  } catch {
    return null
  }
}

/** 清单角色（对外词表）→ 表解析角色（内部词表）。两套词必须显式映射，否则清单钉不住。 */
export const TABLE_ROLE_FOR_MANIFEST = {
  status: 'stage', wbs: 'wbs', decisions: 'decision', issues: 'issue', next: 'next'
}

/** 强制角色必须与表头签名相容，否则清单就是错的——宁可报诊断也不乱解析。 */
export function headerMatchesRole(role, header) {
  const h = header.map(deBold)
  const has = (k) => h.includes(k)
  if (role === 'status') return has('阶段') && has('状态') && has('名称')
  if (role === 'wbs') return h[0] === 'ID' && has('验收标准（可失败）') && has('状态')
  if (role === 'decisions') return h[0] === '#' && has('项')
  if (role === 'issues') return has('ID') && has('严重度')
  if (role === 'next') return h[0] === '#' && has('事项')
  return false
}

export function buildBoard(root, options = {}) {
  const manifest = options.manifest === undefined ? loadManifest(root) : options.manifest
  const docsDir = options.docs
    ? resolve(root, options.docs)
    : manifest?.docsRoot
      ? resolve(root, manifest.docsRoot)
      : join(root, 'docs')

  const items = []
  const groups = new Map()
  const docs = []
  const skipped = []
  const warnings = []

  if (!existsSync(docsDir)) {
    return { body: null, skipped, warnings, docs, error: `docs 目录不存在：${docsDir}` }
  }

  const files = manifest?.tables
    ? [...new Set(manifest.tables.map((t) => t.file).filter(Boolean))].map((f) => f.split(/[\\/]/).pop())
    : readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort()
  const forcedRoles = new Map()
  if (manifest?.tables) {
    for (const t of manifest.tables) {
      if (!t?.file || !t?.role) continue
      forcedRoles.set(String(t.file).split(/[\\/]/).pop(), t.role)
    }
  }

  for (const f of files) {
    const abs = join(docsDir, f)
    if (!existsSync(abs)) { warnings.push(`清单列出的文件不存在：${f}`); continue }
    const text = readFileSync(abs, 'utf8')
    const docSha = sha(text)
    const docPath = posix(relative(root, abs))
    docs.push({ role: forcedRoles.get(f) ?? roleOf(f) ?? 'unmapped', path: docPath, sha: docSha })

    for (const t of tables(text)) {
      const forced = forcedRoles.get(f)
      const tr = forced
        ? (headerMatchesRole(forced, t.header) ? (TABLE_ROLE_FOR_MANIFEST[forced] ?? null) : null)
        : tableRole(t.header)
      if (!tr) {
        if (t.rows.length >= 2) skipped.push({ file: f, line: t.line, forced: forced ?? null })
        continue
      }
      for (const row of t.rows) {
        const c = row.cells.map(deBold)
        if (struck(row.cells[0]) || struck(row.cells[1])) continue

        let id = null; let kind = tr; let title = ''; let status = 'unknown'; let lane = null; const extra = {}

        if (tr === 'stage') {
          const gate = row.cells[0].match(/门禁\s*(\d+)/)
          const n = (row.cells[0].match(/(\d+)/) || [])[1]
          kind = gate ? 'gate' : 'stage'
          id = gate ? `GATE-${gate[1]}` : `STAGE-${n}`
          title = c[1]; status = statusOf(row.cells[2])
          extra.note = c[4] || ''
        } else if (tr === 'wbs') {
          const line = (/^(FE|BE|CONN)/.exec(c[0]) || [])[1] || c[1]
          id = c[0]; title = c[2]; status = statusOf(row.cells[5])
          extra.area = c[1]; extra.criteria = c[3]; extra.evidence = c[4]
          if (!groups.has(line)) groups.set(line, { id: line, total: 0, done: 0, partial: 0, missing: 0 })
          const g = groups.get(line)
          g.total += 1
          if (status === 'done') g.done += 1
          else if (status === 'partial') g.partial += 1
          else if (status === 'missing') g.missing += 1
        } else if (tr === 'decision') {
          const human = t.header.map(deBold).includes('为什么需要人')
          id = c[0]; kind = human ? 'decision' : 'task'; title = c[1]
          extra.why = c[2]; extra.related = c[3] || ''
        } else if (tr === 'issue') {
          id = c[0]; title = c[1]; extra.severity = row.cells[3]; extra.evidence = c[4] || ''
        } else if (tr === 'next') {
          id = c[0]; title = c[1]; status = statusOf(row.cells[2] || row.cells[3] || '')
          extra.cost = t.header.map(deBold).includes('工作量') ? c[2] : ''
        }

        if (!id) { warnings.push(`${docPath}:${row.line} 无稳定 ID`); continue }
        if (!title) title = c[1] || id
        if (!lane) lane = LANE_BY[`${kind}:${status}`] || 'todo'
        // 阶段归属只认清单：前缀（FE/A/B/P）或完整 id 命中才写，没命中就不写——不猜。
        const stage = manifest?.stageMap
          ? (manifest.stageMap[id] ?? manifest.stageMap[String(id).split('-')[0]] ?? undefined)
          : undefined
        if (stage) extra.stage = String(stage)
        items.push({
          id, kind, title: title.trim(), anchor: { doc: docPath, line: row.line, sha: docSha },
          derived: { status, lane, ...extra }
        })
      }
    }
  }

  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const body = {
    schemaVersion: 1,
    project: { root: posix(resolve(root)) },
    source: { sha: sha(docs.map((d) => `${d.role}:${d.sha}`).join('|')), docs },
    items,
    groups: [...groups.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
  }
  return { body, skipped, warnings, docs, error: null }
}

/** 把 overlay 原样贴回新主体：按 id 索引，缺失的 id 丢弃并计入 dropped。 */
export function mergeOverlay(body, previous) {
  const keep = new Map()
  for (const it of previous?.items ?? []) if (it.overlay) keep.set(it.id, it.overlay)
  const dropped = []
  for (const item of body.items) {
    const ov = keep.get(item.id)
    if (ov) item.overlay = ov
  }
  for (const id of keep.keys()) if (!body.items.some((i) => i.id === id)) dropped.push(id)
  return { body, dropped }
}

/** 主体内容是否等价（不含 rev / journal / overlay 之外的字段顺序敏感）。 */
export function sameBody(a, b) {
  if (!a || !b) return false
  return stableStringify(a) === stableStringify(b)
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** 只取主体字段：rev/journal 属于写通道，不参与一致性比较。 */
export function bodyOf(board) {
  if (!board) return null
  return {
    schemaVersion: board.schemaVersion,
    project: board.project,
    source: board.source,
    items: board.items,
    groups: board.groups
  }
}

function parseArgs(argv) {
  const out = { root: process.cwd(), out: null, check: false, docs: null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--check') out.check = true
    else if (a === '--root') out.root = argv[++i]
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--docs') out.docs = argv[++i]
    else if (a === '--help') out.help = true
    else return { error: `未知参数：${a}` }
  }
  return out
}

function main(argv) {
  const args = parseArgs(argv)
  if (args.error) { console.error(args.error); return 2 }
  if (args.help) { console.log('用法：node scripts/import-board.mjs [--root <工作区根>] [--out <board.json>] [--check]'); return 0 }

  const built = buildBoard(args.root, { docs: args.docs })
  if (built.error) { console.error(built.error); return 1 }

  if (!args.out) {
    const manifest = loadManifest(args.root)
    args.out = manifest?.boardPath
      ? resolve(args.root, manifest.boardPath)
      : join(args.root, '.dsh', 'project-board', 'board.json')
  }

  const prevText = existsSync(args.out) ? readFileSync(args.out, 'utf8') : null
  let prev = null
  if (prevText) { try { prev = JSON.parse(prevText) } catch { prev = null } }

  const merged = mergeOverlay(built.body, prev)
  const unchanged = sameBody(merged.body, bodyOf(prev))

  if (args.check) {
    if (!prevText) { console.error(`✘ 没有可对照的 ${args.out}；先跑一次导入`); return 1 }
    if (unchanged) { console.log(`✔ board.json 与 docs 一致（${merged.body.items.length} 条）`); return 0 }
    const prevIds = new Set((prev?.items ?? []).map((i) => i.id))
    const nextIds = new Set(merged.body.items.map((i) => i.id))
    const added = [...nextIds].filter((id) => !prevIds.has(id)).slice(0, 8)
    const removed = [...prevIds].filter((id) => !nextIds.has(id)).slice(0, 8)
    console.error('✘ 发现漂移：board.json 与 docs 不一致')
    if (added.length) console.error(`  新增：${added.join(', ')}`)
    if (removed.length) console.error(`  消失：${removed.join(', ')}`)
    console.error('  修复：node scripts/import-board.mjs --root <工作区根>')
    return 1
  }

  if (unchanged) { console.log(`= no-op：内容未变，不写盘（${merged.body.items.length} 条，rev ${prev?.rev ?? 0}）`); return 0 }

  const rev = (prev?.rev ?? 0) + 1
  const journal = Array.isArray(prev?.journal) ? prev.journal.slice(-19) : []
  journal.push({ rev, op: 'import', at: new Date().toISOString(), items: merged.body.items.length })
  const next = { ...merged.body, rev, journal }

  mkdirSync(dirname(args.out), { recursive: true })
  const tmp = `${args.out}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
  renameSync(tmp, args.out)

  console.log(`✔ 已写入 ${args.out}（rev ${rev}，${next.items.length} 条，overlay 保留 ${next.items.filter((i) => i.overlay).length} 条）`)
  if (merged.dropped.length) console.log(`  overlay 丢弃 ${merged.dropped.length} 条（对应卡已不存在）：${merged.dropped.slice(0, 5).join(', ')}`)
  if (built.skipped.length) console.log(`  跳过 ${built.skipped.length} 张认不出的表（不猜）`)
  return 0
}

const invoked = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(invoked)) {
  process.exit(main(process.argv.slice(2)))
}
