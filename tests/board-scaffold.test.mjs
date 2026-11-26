import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { scaffoldDocs } from '../scripts/scaffold-docs.mjs'
import { buildBoard } from '../scripts/import-board.mjs'
import { mergeProjects, readRegistry, registryPath, uniqueProjectId, writeRegistry } from '../scripts/project-registry.mjs'
import { createBoardRoutes } from '../index.js'

const expectFiles = [
  '01_入口_项目状态看板.md',
  '31_验收_WBS拆解明细.md',
  '04_入口_待裁决台账.md',
  '15_功能_剩余问题.md',
  '17_功能_下一步工作清单.md'
]

/** 给路由提供一个隔离的 profile 目录，注册表就落在它下面。 */
const runtimeIn = (dir) => ({ ctx: { get: (name) => (name === 'profileContext' ? { dir } : undefined) } })

const request = (body) => ({
  on(event, cb) {
    if (event === 'data') cb(JSON.stringify(body))
    if (event === 'end') setImmediate(cb)
  }
})

const capture = () => {
  const box = { payload: null }
  box.res = { writeHead() {}, end(text) { box.payload = JSON.parse(text) } }
  return box
}

test('脚手架：dry-run 不落盘，--write 才创建 5 份，二次运行零覆盖', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-'))
  const dry = scaffoldDocs(root, { write: false })
  assert.equal(dry.created.length, 0)
  assert.equal(existsSync(dry.docsDir), false, 'dry-run 不能建目录')

  const made = scaffoldDocs(root, { write: true })
  assert.equal(made.created.length, 5)
  assert.deepEqual(made.created.sort(), expectFiles.slice().sort())

  const again = scaffoldDocs(root, { write: true })
  assert.equal(again.created.length, 0, '已存在的一律跳过')
  assert.equal(again.skipped.length, 5)
})

test('脚手架产物能被导入器识别：表头签名对齐 5 类角色', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-import-'))
  scaffoldDocs(root, { write: true })
  const built = buildBoard(root)
  assert.ok(built.body, built.error || '应能派生')
  assert.ok(built.body.items.length >= 10, `应派生阶段/门禁/WBS/裁决/缺口/下一步，实际 ${built.body.items?.length}`)
  assert.deepEqual(built.docs.map((d) => d.role).sort(), ['decisions', 'issues', 'next', 'status', 'wbs'])
  assert.equal(built.skipped.length, 0, '脚手架生成的表不应被跳过')
})

test('脚手架不覆盖项目已有文档', () => {
  const root = mkdtempSync(join(tmpdir(), 'scaffold-keep-'))
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'docs', '01_入口_项目状态看板.md'), '# 项目自己的看板\n\n| 阶段 | 名称 | 状态 | 交付物 | 关键说明 |\n| --- | --- | --- | --- | --- |\n| **1** | 自有阶段 | ✅ | - | 保留 |\n')
  const made = scaffoldDocs(root, { write: true })
  assert.equal(made.created.length, 4, '只补缺的 4 份')
  assert.match(readFileSync(join(root, 'docs', '01_入口_项目状态看板.md'), 'utf8'), /自有阶段/)
})

test('注册表：合并按绝对路径去重，config 优先；id 冲突自动加后缀', () => {
  const config = [{ id: 'a', root: 'E:\\demo\\x' }]
  const reg = [{ id: 'a', root: 'E:\\demo\\x', name: '来自注册表' }, { id: 'b', root: 'E:\\demo\\y' }]
  const merged = mergeProjects(config, reg)
  assert.equal(merged.length, 2)
  assert.equal(merged[0].id, 'a', 'config 优先保留')
  assert.equal(merged[1].id, 'b')

  assert.equal(uniqueProjectId([{ id: 'proj' }], 'proj'), 'proj-2')
  assert.equal(uniqueProjectId([], 'proj'), 'proj')
})

test('注册表：原子写后能读回；坏文件不静默覆盖', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'registry-'))
  const file = join(dir, 'plugin-data', 'x', 'projects.json')
  await writeRegistry(file, [{ id: 'p1', root: 'E:\\demo\\p1' }])
  const read = readRegistry(file)
  assert.equal(read.error, null)
  assert.equal(read.projects.length, 1)

  writeFileSync(file, '{ not json')
  const broken = readRegistry(file)
  assert.match(broken.error, /无法解析/)
  assert.equal(broken.projects.length, 0)
})

test('绑定校验：缺文档目录默认允许铺底，scaffold=false 才拒绝', () => {
  const root = mkdtempSync(join(tmpdir(), 'bind-scaffold-'))
  const routes = createBoardRoutes({}, runtimeIn(mkdtempSync(join(tmpdir(), 'profile-')))
  )
  const auto = routes.validateBind({ root })
  assert.equal(auto.ok, true)
  assert.equal(auto.docsMissing, true)
  assert.equal(routes.validateBind({ root, scaffold: false }).ok, false)
})

test('bind：写入注册表、铺底 5 份文档，并且“插件重载”后项目仍在', async () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'profile-'))
  const root = mkdtempSync(join(tmpdir(), 'bind-persist-'))
  const routes = createBoardRoutes({}, runtimeIn(profileDir))

  const box = capture()
  await routes.bindHandler(request({ root, scaffold: true }), box.res)
  assert.equal(box.payload.ok, true, JSON.stringify(box.payload))
  assert.equal(box.payload.via, 'registry')
  assert.equal(box.payload.scaffolded.length, 5)

  const file = registryPath(runtimeIn(profileDir))
  const saved = readRegistry(file)
  assert.equal(saved.projects.length, 1, '注册表必须落盘')
  assert.equal(saved.projects[0].root, resolve(root))

  // 模拟插件重载：全新的 routes 实例、同一 profile，项目仍应在列表里。
  const reloaded = createBoardRoutes({}, runtimeIn(profileDir))
  const listed = reloaded.catalog.projects().projects
  assert.ok(listed.some((p) => p.root === resolve(root)), '重载后不得丢项目')
})

test('bind → import：导入后 available=true，未归属阶段也不影响列表', async () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'profile-'))
  const root = mkdtempSync(join(tmpdir(), 'bind-import-'))
  const routes = createBoardRoutes({}, runtimeIn(profileDir))

  const box = capture()
  await routes.bindHandler(request({ root, scaffold: true }), box.res)
  assert.equal(box.payload.ok, true, JSON.stringify(box.payload))

  const imported = capture()
  await routes.importHandler(request({ project: box.payload.project.id }), imported.res)
  assert.equal(imported.payload.ok, true, JSON.stringify(imported.payload))

  const after = createBoardRoutes({}, runtimeIn(profileDir)).catalog.projects().projects
  const hit = after.find((p) => p.root === resolve(root))
  assert.equal(hit.available, true, '导入后应可用')
})

test('bind：注册表损坏时明确报错，不覆盖现场', async () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'profile-'))
  const file = registryPath(runtimeIn(profileDir))
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, '{ broken')

  const root = mkdtempSync(join(tmpdir(), 'bind-broken-'))
  const routes = createBoardRoutes({}, runtimeIn(profileDir))
  const box = capture()
  await routes.bindHandler(request({ root, scaffold: true }), box.res)
  assert.equal(box.payload.ok, false)
  assert.equal(box.payload.code, 'registry_corrupt')
  assert.equal(readFileSync(file, 'utf8'), '{ broken', '损坏文件不得被覆盖')
})
