import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const IMPORT = fileURLToPath(new URL('../scripts/import-board.mjs', import.meta.url))
const ADAPT = fileURLToPath(new URL('../scripts/adapt-project.mjs', import.meta.url))

// 文件名故意不匹配框架命名：靠表头签名识别，再由清单钉死角色。
const STATUS = `# 状态

| 阶段 | 名称 | 状态 | 交付物 | 关键说明 |
| :--- | :--- | :--- | :--- | :--- |
| **1** | 调研 | ✅ | - | 完成 |
| **2** | PRD | 🟡 | - | 进行 |
`
const TASKS = `# 任务

| ID | 区域 | 功能点 | 验收标准（可失败） | 证据 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| FE-01 | 壳 | 四区并列 | 断言一 | e2e/a.spec.ts | ✅ |
| FE-02 | 壳 | 次栏互斥 | 断言二 | e2e/b.spec.ts | 🟡 |
`

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'adapt-'))
  const docs = join(root, 'docs')
  mkdirSync(docs, { recursive: true })
  writeFileSync(join(docs, 'STATUS.md'), STATUS)
  writeFileSync(join(docs, 'TASKS.md'), TASKS)
  return root
}

test('适配脚本：识别非框架命名的表，缺角色时退出 1 并写出清单', () => {
  const root = fixture()
  const run = spawnSync(process.execPath, [ADAPT, '--root', root, '--write'], { encoding: 'utf8' })
  assert.equal(run.status, 1, '只找到 2 个角色，应报缺口')
  assert.match(run.stdout, /status@L/, '要打印识别到的角色与行号')
  assert.match(run.stdout, /缺 3 个角色/)

  const manifestPath = join(root, '.dsh', 'project-board', 'manifest.json')
  assert.equal(existsSync(manifestPath), true, '--write 必须落清单')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.docsRoot, 'docs')
  assert.deepEqual(manifest.tables.map((t) => t.role).sort(), ['status', 'wbs'])
  assert.deepEqual(manifest.tables.map((t) => t.file).sort(), ['STATUS.md', 'TASKS.md'])
})

test('清单生效：导入器按清单钉角色，文件名不匹配也能派生卡片', () => {
  const root = fixture()
  spawnSync(process.execPath, [ADAPT, '--root', root, '--write'], { encoding: 'utf8' })
  const run = spawnSync(process.execPath, [IMPORT, '--root', root], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)

  const board = JSON.parse(readFileSync(join(root, '.dsh', 'project-board', 'board.json'), 'utf8'))
  assert.ok(board.items.length >= 4, `应派生出阶段与 WBS 卡片，实际 ${board.items.length}`)
  assert.ok(board.items.some((i) => i.id === 'STAGE-1' && i.kind === 'stage'))
  assert.ok(board.items.some((i) => i.id === 'FE-01' && i.derived.status === 'done'))
  assert.deepEqual(board.groups.map((g) => g.id), ['FE'])
})

test('清单角色与表头不符时不乱解析：跳过并计数', () => {
  const root = fixture()
  // 把 STATUS.md 钉成 wbs：表头是阶段表，必须被拒绝
  mkdirSync(join(root, '.dsh', 'project-board'), { recursive: true })
  writeFileSync(join(root, '.dsh', 'project-board', 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    docsRoot: 'docs',
    tables: [{ role: 'wbs', file: 'STATUS.md' }]
  }))
  const built = spawnSync(process.execPath, [IMPORT, '--root', root], { encoding: 'utf8' })
  assert.equal(built.status, 0, built.stderr)
  const board = JSON.parse(readFileSync(join(root, '.dsh', 'project-board', 'board.json'), 'utf8'))
  assert.equal(board.items.length, 0, '不匹配的表不得产出卡片')
  assert.ok(built.stdout.includes('跳过') || built.stdout.includes('认不出'), '要给出跳过诊断')
})

test('适配脚本：单行台账也算角色（脚手架刚生出来的 1 条记录不能被判缺失）', () => {
  const root = fixture()
  const docs = join(root, 'docs')
  // 与 scaffold-docs.mjs 同构：每张台账只有一条占位记录
  writeFileSync(join(docs, 'DECISIONS.md'), `# 待裁决

| # | 项 | 为什么需要人 | 关联 |
| :--- | :--- | :--- | :--- |
| A1 | 选技术栈 | 影响维护成本 | — |
`)
  writeFileSync(join(docs, 'ISSUES.md'), `# 剩余问题

| ID | 限制 | 用户侧影响 | 严重度 | 证据 |
| :--- | :--- | :--- | :--- | :--- |
| P-1 | 无持久化 | 刷新丢历史 | 🟡 | 待补 |
`)
  writeFileSync(join(docs, 'NEXT.md'), `# 下一步

| # | 事项 | 工作量 | 验收 |
| :--- | :--- | :--- | :--- |
| N1 | 接入导入 | 0.5 天 | board 可导出 |
`)

  const run = spawnSync(process.execPath, [ADAPT, '--root', root], { encoding: 'utf8' })
  assert.equal(run.status, 0, `五个角色都该被认出，实际退出 ${run.status}\n${run.stdout}\n${run.stderr}`)
  assert.match(run.stdout, /decisions@L/, '单行待裁决表必须计入 decisions 角色')
  assert.match(run.stdout, /issues@L/, '单行剩余问题表必须计入 issues 角色')
  assert.match(run.stdout, /next@L/, '单行下一步清单必须计入 next 角色')
})
