import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildBoard, mergeOverlay, sameBody, splitRow, tableRole, statusOf, roleOf } from '../scripts/import-board.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/import-board.mjs', import.meta.url))

const STATUS_DOC = `# 状态

| 阶段 | 名称 | 状态 | 交付物 | 关键说明 |
| :--- | :--- | :--- | :--- | :--- |
| **1** | 调研 | ✅ | — | 完成 |
| 🛑 **门禁 1** | 需求定稿 | ✅ 通过 | — | 通过 |
| **2** | PRD | 🟡 部分就绪 | — | 进行 |
`

const WBS_DOC = `# WBS

| ID | 区域 | 功能点 | 验收标准（可失败） | 证据 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| FE-01 | 壳 | 四区并列 | \`[a\\|b]\` 各一 | e2e/x.spec.ts | ✅ |
| BE-01 | 项目 | 建项目 | 返回 200 | tests/y.test.ts | 🟡 |
| BE-02 | 项目 | 删项目 | 404 | tests/z.test.ts | ❌ |
`

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'board-'))
  const docs = join(root, 'docs')
  mkdirSync(docs, { recursive: true })
  writeFileSync(join(docs, '01_入口_项目状态看板.md'), STATUS_DOC)
  writeFileSync(join(docs, '31_验收_WBS拆解明细.md'), WBS_DOC)
  return root
}

test('splitRow 不把转义管道当分隔符', () => {
  const cells = splitRow('| A | `[a\\|b]` 各一 | ✅ |')
  assert.equal(cells.length, 3)
  assert.equal(cells[1], '`[a|b]` 各一')
})

test('表头签名识别四类表', () => {
  assert.equal(tableRole(['阶段', '名称', '状态', '交付物', '关键说明']), 'stage')
  assert.equal(tableRole(['ID', '区域', '功能点', '验收标准（可失败）', '证据', '状态']), 'wbs')
  assert.equal(tableRole(['ID', '限制', '影响', '严重度', '证据']), 'issue')
  assert.equal(tableRole(['#', '项', '为什么需要人', '关联']), 'decision')
  assert.equal(tableRole(['文档', '性质', '一句话']), null)
})

test('状态与文件名映射', () => {
  assert.equal(statusOf('✅ 通过'), 'done')
  assert.equal(statusOf('🟡 部分就绪'), 'partial')
  assert.equal(statusOf('❌ 未实现'), 'missing')
  assert.equal(statusOf('⏸️ 屏蔽'), 'hold')
  assert.equal(roleOf('01_入口_项目状态看板.md'), 'status')
  assert.equal(roleOf('41_历史_交付日志.md'), null)
})

test('派生结果确定：同一输入两次相同', () => {
  const root = fixture()
  const a = buildBoard(root)
  const b = buildBoard(root)
  assert.equal(a.body.items.length, 6)
  assert.equal(sameBody(a.body, b.body), true)
  assert.deepEqual(a.body.groups.map((g) => `${g.id}:${g.done}/${g.total}`), ['BE:0/2', 'FE:1/1'])
})

test('overlay 保留、卡消失则丢弃', () => {
  const root = fixture()
  const body = buildBoard(root).body
  const prev = { items: [{ id: 'FE-01', overlay: { lane: 'doing', order: 2 } }, { id: 'GONE-1', overlay: { lane: 'todo' } }] }
  const merged = mergeOverlay(body, prev)
  const fe = merged.body.items.find((i) => i.id === 'FE-01')
  assert.deepEqual(fe.overlay, { lane: 'doing', order: 2 })
  assert.equal(merged.dropped.length, 1)
})

test('no-op 与 --check：内容未变不写盘，改动后 exit 1', () => {
  const root = fixture()
  const out = join(root, '.dsh', 'project-board', 'board.json')
  const first = spawnSync(process.execPath, [SCRIPT, '--root', root, '--out', out], { encoding: 'utf8' })
  assert.equal(first.status, 0, first.stderr)
  const rev1 = JSON.parse(readFileSync(out, 'utf8')).rev
  assert.equal(rev1, 1)

  const second = spawnSync(process.execPath, [SCRIPT, '--root', root, '--out', out], { encoding: 'utf8' })
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /no-op/)
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).rev, rev1, 'no-op 不得递增 rev')

  const checkOk = spawnSync(process.execPath, [SCRIPT, '--root', root, '--out', out, '--check'], { encoding: 'utf8' })
  assert.equal(checkOk.status, 0, checkOk.stderr)

  writeFileSync(join(root, 'docs', '31_验收_WBS拆解明细.md'), WBS_DOC.replace('| ❌ |', '| ✅ |'))
  const checkDrift = spawnSync(process.execPath, [SCRIPT, '--root', root, '--out', out, '--check'], { encoding: 'utf8' })
  assert.equal(checkDrift.status, 1)
  assert.match(checkDrift.stderr, /发现漂移/)
})

const SCHEMA = fileURLToPath(new URL('../schema/board.schema.json', import.meta.url))

test('清单 stageMap：前缀命中才写 stage，未命中不猜', () => {
  const root = fixture()
  mkdirSync(join(root, '.dsh', 'project-board'), { recursive: true })
  writeFileSync(join(root, '.dsh', 'project-board', 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    docsRoot: 'docs',
    tables: [{ role: 'wbs', file: '31_验收_WBS拆解明细.md' }],
    stageMap: { FE: 'STAGE-5', 'BE-01': 'STAGE-4' }
  }))
  const body = buildBoard(root).body
  const fe = body.items.find((i) => i.id === 'FE-01')
  const be1 = body.items.find((i) => i.id === 'BE-01')
  const be2 = body.items.find((i) => i.id === 'BE-02')
  assert.equal(fe.derived.stage, 'STAGE-5', '前缀命中')
  assert.equal(be1.derived.stage, 'STAGE-4', '完整 id 优先')
  assert.equal(be2.derived.stage, undefined, '未命中不得编造阶段')
})

test('派生结果符合冻结契约 schemaVersion 1', () => {
  const root = fixture()
  const out = join(root, '.dsh', 'project-board', 'board.json')
  const run = spawnSync(process.execPath, [SCRIPT, '--root', root, '--out', out], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const body = JSON.parse(readFileSync(out, 'utf8'))
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'))

  for (const key of schema.required) assert.ok(key in body, `缺少顶层字段 ${key}`)
  assert.equal(body.schemaVersion, schema.properties.schemaVersion.const)

  const itemProps = schema.properties.items.items
  const allowedKind = itemProps.properties.kind.enum
  const derivedProps = itemProps.properties.derived
  const allowedStatus = derivedProps.properties.status.enum
  const allowedLane = derivedProps.properties.lane.enum

  for (const item of body.items) {
    for (const key of itemProps.required) assert.ok(item[key] !== undefined, `${item.id} 缺少 ${key}`)
    assert.ok(allowedKind.includes(item.kind), `${item.id} kind 越界：${item.kind}`)
    assert.ok(allowedStatus.includes(item.derived.status), `${item.id} status 越界：${item.derived.status}`)
    assert.ok(allowedLane.includes(item.derived.lane), `${item.id} lane 越界：${item.derived.lane}`)
    assert.equal(typeof item.anchor.line, 'number')
    assert.ok(item.anchor.line >= 1, `${item.id} 锚点行号非法`)
  }

  for (const g of body.groups) {
    assert.equal(typeof g.total, 'number')
    assert.ok(g.done <= g.total, `${g.id} done 超过 total`)
  }
})
