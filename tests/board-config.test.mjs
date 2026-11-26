import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeProjects, resolveProject, createProjectCatalog, createBoardRoutes, boardRouteHandler
} from '../index.js'

function makeProject(items = []) {
  const root = mkdtempSync(join(tmpdir(), 'proj-'))
  const dir = join(root, '.dsh', 'project-board')
  mkdirSync(dir, { recursive: true })
  if (items) {
    writeFileSync(join(dir, 'board.json'), JSON.stringify({
      schemaVersion: 1, rev: 1, project: { root }, source: { sha: 'x', docs: [] },
      items: items.length ? items : [{ id: 'A-1', kind: 'wbs', title: 't', anchor: { doc: 'd', line: 1, sha: 'x' }, derived: { status: 'missing', lane: 'todo' } }],
      groups: [{ id: 'FE', total: 2, done: 1 }]
    }))
  }
  return root
}

function fakeRes() {
  return { status: 0, body: '', writeHead(s) { this.status = s }, end(b) { this.body = b } }
}

test('normalizeProjects：id 可从目录名派生；相对路径与重复 id 变成可读错误', () => {
  const good = makeProject([])
  const base = good.split(/[\\/]/).pop()
  const out = normalizeProjects({
    projects: [
      { id: 'ok', root: good },
      { id: 'ok', root: good },
      { id: 'rel', root: './relative' },
      { root: good },
      { id: 'nodocs', root: good, docs: 'specs', board: 'out/board.json' }
    ]
  })
  assert.equal(out.projects.length, 3, 'ok、派生 id、nodocs 三条合法')
  assert.deepEqual(out.errors.map((e) => e.code).sort(), ['duplicate_id', 'relative_root'].sort())
  const ok = out.projects.find((p) => p.id === 'ok')
  assert.equal(ok.docs, resolve(good, 'docs'))
  assert.equal(ok.board, resolve(good, '.dsh', 'project-board', 'board.json'))
  assert.equal(ok.name, base)
  const derived = out.projects.find((p) => p.id === base)
  assert.ok(derived, '缺 id 时用目录名做 id')
  const custom = out.projects.find((p) => p.id === 'nodocs')
  assert.equal(custom.docs, resolve(good, 'specs'))
  assert.equal(custom.board, resolve(good, 'out/board.json'))
  assert.equal(out.fallbackToWorkspace, true, '未显式关闭时应回落工作空间')
})

test('resolveProject：按 id 或绝对路径命中，未知给结构化错误', () => {
  const root = makeProject([])
  const config = { projects: [{ id: 'p1', root }] }
  assert.equal(resolveProject(config, 'p1').ok, true)
  assert.equal(resolveProject(config, root).project.id, 'p1')
  const miss = resolveProject(config, 'nope')
  assert.equal(miss.code, 'unknown_project')
  assert.match(miss.hint, /绝对路径/)
  assert.equal(resolveProject(config, '').code, 'missing_project')
})

test('catalog：有 board 的项目 available=true 并带指标；缺 board 的给命令而非整块失败', () => {
  const withBoard = makeProject([])
  const empty = makeProject(null)
  const config = { projects: [{ id: 'a', root: withBoard }, { id: 'b', root: empty }] }
  const catalog = createProjectCatalog(config)
  const payload = catalog.projects()
  assert.equal(payload.ok, true)
  assert.equal(payload.projects.length, 2)
  assert.equal(payload.configured, 2)
  assert.equal(payload.configReceived, true, '传了配置就要如实标记已读到')
  const a = payload.projects.find((p) => p.id === 'a')
  const b = payload.projects.find((p) => p.id === 'b')
  assert.equal(a.available, true)
  assert.equal(a.counts.total, 1)
  assert.deepEqual(a.groups, [{ id: 'FE', total: 2, done: 1 }])
  assert.equal(b.available, false)
  assert.equal(b.code, 'no_board')
  assert.match(b.hint, /import-board\.mjs/)
})

test('路由：projects 列表与 board?project= 解析；未知项目 404', () => {
  const root = makeProject([])
  const routes = createBoardRoutes({ projects: [{ id: 'p1', root }] })

  const res1 = fakeRes()
  routes.projectsHandler({ url: '/project-board/projects' }, res1)
  assert.equal(res1.status, 200)
  assert.equal(JSON.parse(res1.body).projects[0].id, 'p1')

  const res2 = fakeRes()
  routes.boardHandler({ url: '/project-board/board?project=p1' }, res2)
  assert.equal(res2.status, 200)
  assert.equal(JSON.parse(res2.body).ok, true)

  const res3 = fakeRes()
  routes.boardHandler({ url: '/project-board/board?project=ghost' }, res3)
  assert.equal(res3.status, 404)
  assert.equal(JSON.parse(res3.body).code, 'unknown_project')

  const res4 = fakeRes()
  routes.boardHandler({ url: '/project-board/board' }, res4)
  assert.equal(res4.status, 400)
  assert.equal(JSON.parse(res4.body).code, 'missing_project')
})

test('「没配」与「没读到配置」必须可区分', () => {
  const none = createProjectCatalog().projects()
  assert.equal(none.configured, 0)
  assert.equal(none.configReceived, false, '完全没传配置时不能谎报已读到')

  const emptyList = createProjectCatalog({ projects: [] }).projects()
  assert.equal(emptyList.configured, 0)
  assert.equal(emptyList.configReceived, true, '传了空 projects 也属于已读到配置')
})

test('包内 patch 不得内嵌本机项目路径：项目配置属于用户 profile 层', () => {
  const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
  assert.equal(/projects:/.test(patch), false, '包内 patch 不应带 projects 配置（重装即丢，且会把本机路径带进发布物）')
  assert.equal(/[A-Za-z]:[\\/]/.test(patch), false, '包内 patch 不应出现本机绝对路径')
})

test('绑定校验：相对路径 / 不存在 / 已绑定 / id 冲突 全部拒绝；合法项给预览', () => {
  const root = mkdtempSync(join(tmpdir(), 'bind-'))
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'docs', '01_入口_项目状态看板.md'),
    '| 阶段 | 名称 | 状态 | 交付物 | 关键说明 |\n| --- | --- | --- | --- | --- |\n| **1** | 调研 | ✅ | - | x |\n')
  const routes = createBoardRoutes({})

  const rel = routes.validateBind({ root: './nope' })
  assert.equal(rel.ok, false)
  assert.match(rel.errors.join('；'), /绝对路径/)

  const missing = routes.validateBind({ root: join(root, 'no-such-dir') })
  assert.equal(missing.ok, false)
  assert.match(missing.errors.join('；'), /不存在/)

  const good = routes.validateBind({ root })
  assert.equal(good.ok, true)
  assert.equal(good.project.id, root.split(/[\\/]/).pop())
  assert.ok(good.preview.items >= 1, '合法项要给可派生条数预览')

  const bound = createBoardRoutes({ projects: [{ root }] }).validateBind({ root })
  assert.equal(bound.ok, false)
  assert.match(bound.errors.join('；'), /已绑定/)

  const dupId = createBoardRoutes({ projects: [{ id: 'x', root: makeProject([]) }] })
    .validateBind({ root, id: 'x' })
  assert.equal(dupId.ok, false)
  assert.match(dupId.errors.join('；'), /id 冲突/)
})

test('降级片段可直接贴进 profile patch，且路径用正斜杠', () => {
  const routes = createBoardRoutes({})
  const snippet = routes.snippetFor({ root: 'E:\\demo\\proj', name: '演示' })
  assert.match(snippet, /- id: project-dev-flow-board/)
  assert.match(snippet, /root: E:\/demo\/proj/, 'Windows 路径要转成正斜杠')
  assert.match(snippet, /name: 演示/)
})

test('旧入口 boardRouteHandler 仍按 root 解析（向后兼容）', () => {
  const root = makeProject([])
  const res = fakeRes()
  boardRouteHandler({ url: `/project-board/board?root=${encodeURIComponent(root)}` }, res)
  assert.equal(res.status, 200)
})
