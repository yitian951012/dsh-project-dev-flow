#!/usr/bin/env node
/**
 * adapt-project.mjs — 让一个新项目接进项目看板。
 *
 * 只读探测：找出 docs 里哪些表能被识别、哪些角色缺、清单该怎么写。
 * 只有 --write 才落 `.dsh/project-board/manifest.json`；不写 board.json（导入是另一条命令）。
 *
 * 用法：node scripts/adapt-project.mjs --root <项目绝对路径> [--docs <相对/绝对目录>] [--write]
 * 退出码：0 五个角色齐；1 有缺口（仍会打印建议）；2 参数错误。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadManifest, tableRole, tables } from './import-board.mjs'

const ROLES = [
  { role: 'status', label: '阶段/门禁（状态看板）' },
  { role: 'wbs', label: 'WBS 明细' },
  { role: 'decisions', label: '待裁决台账' },
  { role: 'issues', label: '剩余问题' },
  { role: 'next', label: '下一步清单' }
]

/** 表解析角色 → 清单角色：清单对外只用 status/wbs/decisions/issues/next。 */
const MANIFEST_ROLE = { stage: 'status', wbs: 'wbs', decision: 'decisions', issue: 'issues', next: 'next' }

function parseArgs(argv) {
  const out = { root: null, docs: null, write: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--root') out.root = argv[++i]
    else if (a === '--docs') out.docs = argv[++i]
    else if (a === '--write') out.write = true
    else if (a === '--help') out.help = true
    else return { error: `未知参数：${a}` }
  }
  if (!out.help && !out.root) return { error: '缺少 --root <项目绝对路径>' }
  return out
}

function scan(docsDir) {
  const found = []
  const fileReport = []
  if (!existsSync(docsDir)) return { found, fileReport, error: `文档目录不存在：${docsDir}` }

  const files = readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort()
  for (const file of files) {
    const parsed = tables(readFileSync(join(docsDir, file), 'utf8'))
    const roles = []
    for (const t of parsed) {
      const tableRole_ = tableRole(t.header)
      // 一条记录就是一条：脚手架刚生出的台账每张只有 1 行，不能判「角色缺失」。
      if (!tableRole_ || t.rows.length < 1) continue
      const role = MANIFEST_ROLE[tableRole_] ?? tableRole_
      roles.push({ role, line: t.line, rows: t.rows.length })
      if (!found.some((f) => f.role === role)) found.push({ role, file, line: t.line, rows: t.rows.length })
    }
    if (roles.length > 0) fileReport.push({ file, roles })
  }
  return { found, fileReport, error: null }
}

function main(argv) {
  const args = parseArgs(argv)
  if (args.error) { console.error(args.error); return 2 }
  if (args.help) {
    console.log('用法：node scripts/adapt-project.mjs --root <项目绝对路径> [--docs <目录>] [--write]')
    return 0
  }
  if (!isAbsolute(args.root)) { console.error('--root 必须是绝对路径'); return 2 }

  const root = resolve(args.root)
  const manifest = loadManifest(root)
  const docsDir = args.docs
    ? resolve(root, args.docs)
    : manifest?.docsRoot
      ? resolve(root, manifest.docsRoot)
      : join(root, 'docs')

  const { found, fileReport, error } = scan(docsDir)
  if (error) { console.error(error); return 2 }

  console.log(`项目：${root}`)
  console.log(`文档目录：${relative(root, docsDir) || '.'}（${fileReport.length} 个文件含可识别表）`)
  for (const f of fileReport) {
    console.log(`  ${f.file}: ${f.roles.map((r) => `${r.role}@L${r.line}(${r.rows}行)`).join(', ')}`)
  }

  const missing = ROLES.filter((r) => !found.some((f) => f.role === r.role))
  console.log('')
  if (missing.length === 0) {
    console.log('✔ 五个角色都找到了，可直接导出：')
    console.log(`   node scripts/import-board.mjs --root "${root}"`)
  } else {
    console.log(`⚠ 缺 ${missing.length} 个角色：${missing.map((m) => `${m.role}（${m.label}）`).join('、')}`)
    console.log('  缺的角色不会自动建卡；要么把该表加进文档，要么在清单里钉到已有文件（表头仍须相容）。')
  }

  if (args.write) {
    if (found.length === 0) { console.error('没有可写进清单的表，未写盘'); return 1 }
    const docsRel = relative(root, docsDir).split('\\').join('/')
    const payload = {
      schemaVersion: 1,
      docsRoot: docsRel || 'docs',
      boardPath: '.dsh/project-board/board.json',
      tables: found.map((f) => ({ role: f.role, file: f.file }))
    }
    const out = join(root, '.dsh', 'project-board', 'manifest.json')
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`)
    console.log('')
    console.log(`✔ 已写入清单：${relative(root, out)}（${payload.tables.length} 条）`)
    console.log(`  然后：node scripts/import-board.mjs --root "${root}"`)
  }

  return missing.length === 0 ? 0 : 1
}

const invoked = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(invoked)) process.exit(main(process.argv.slice(2)))
