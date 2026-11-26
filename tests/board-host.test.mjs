import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBoard, summarizeBoard, apply, boardRouteHandler } from '../index.js'

function boardAt(items) {
  const root = mkdtempSync(join(tmpdir(), 'pb-'))
  const dir = join(root, '.dsh', 'project-board')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'board.json'), JSON.stringify({
    schemaVersion: 1, rev: 3, project: { root }, source: { sha: 'abc123', docs: [] }, items, groups: []
  }))
  return root
}

const ITEM = (id, lane, kind = 'wbs', status = 'missing') => ({
  id, kind, title: id, anchor: { doc: 'docs/31_x.md', line: 9, sha: 'abc123' }, derived: { status, lane }
})

function fakeRes() {
  return {
    status: 0,
    body: '',
    headers: null,
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body }
  }
}

test('readBoard：缺参数 / 无数据 / schema 不符 三类都给出可读错误码', () => {
  assert.equal(readBoard(undefined).code, 'missing_root')

  const empty = mkdtempSync(join(tmpdir(), 'pb-empty-'))
  assert.equal(readBoard(empty).code, 'no_board')
  assert.match(readBoard(empty).hint ?? '', /import-board\.mjs/)

  const bad = mkdtempSync(join(tmpdir(), 'pb-bad-'))
  mkdirSync(join(bad, '.dsh', 'project-board'), { recursive: true })
  writeFileSync(join(bad, '.dsh', 'project-board', 'board.json'), '{"schemaVersion":2,"items":[]}')
  assert.equal(readBoard(bad).code, 'schema_error')
})

test('summarizeBoard：分列计数、排除阶段/门禁、摘要上限 40 条', () => {
  const items = [
    ITEM('STAGE-1', 'done', 'stage', 'done'),
    ITEM('GATE-1', 'done', 'gate', 'done'),
    ITEM('A-1', 'todo'),
    ITEM('A-2', 'todo'),
    ITEM('B-1', 'decision'),
    ITEM('C-1', 'done')
  ]
  const board = { schemaVersion: 1, rev: 7, items, groups: [{ id: 'FE', total: 1, done: 0 }], source: { sha: 'abc123' } }
  const s = summarizeBoard(board)
  assert.equal(s.counts.total, 6)
  assert.deepEqual(s.counts.lanes, { done: 3, todo: 2, decision: 1 })
  assert.equal(s.open.length, 3, '阶段与门禁不进未完成摘要')
  assert.deepEqual(s.open.map((x) => x.id), ['A-1', 'A-2', 'B-1'])
  assert.equal(s.groups[0].id, 'FE')
})

test('路由处理器：200 带数据 / 404 无数据 / 400 坏参数', () => {
  const okRoot = boardAt([ITEM('A-1', 'todo')])
  const res1 = fakeRes()
  boardRouteHandler({ url: `/project-board/board?root=${encodeURIComponent(okRoot)}` }, res1)
  assert.equal(res1.status, 200)
  assert.equal(JSON.parse(res1.body).ok, true)
  assert.equal(res1.headers['cache-control'], 'no-store')

  const empty = mkdtempSync(join(tmpdir(), 'pb-404-'))
  const res2 = fakeRes()
  boardRouteHandler({ url: `/project-board/board?root=${encodeURIComponent(empty)}` }, res2)
  assert.equal(res2.status, 404)
  assert.equal(JSON.parse(res2.body).code, 'no_board')

  const res3 = fakeRes()
  boardRouteHandler({ url: '/project-board/board' }, res3)
  assert.equal(res3.status, 400)
  assert.equal(JSON.parse(res3.body).code, 'missing_project', '无 project/root 参数时按新语义报 missing_project')
})

test('工具 execute：只接受 action=list，且原样返回失败原因；effect 可清理注册', async () => {
  let registered
  const disposers = []
  const ctx = {
    effect: (fn) => { const off = fn(); if (typeof off === 'function') disposers.push(off) },
    tools: { register: (def) => { registered = def; return () => { registered = null } } },
    inject: () => () => {}
  }
  apply(ctx)
  assert.equal(registered.name, 'project_board')

  const bad = await registered.execute({ action: 'move', workspace: 'C:/x' })
  assert.equal(bad.code, 'unsupported_action')

  const empty = mkdtempSync(join(tmpdir(), 'pb-tool-'))
  const none = await registered.execute({ action: 'list', workspace: empty })
  assert.equal(none.ok, false)
  assert.equal(none.code, 'no_board')

  const root = boardAt([ITEM('A-1', 'todo')])
  const hit = await registered.execute({ action: 'list', workspace: root })
  assert.equal(hit.ok, true)
  assert.equal(hit.counts.total, 1)

  for (const off of disposers.reverse()) off?.()
  assert.equal(registered, null, '卸载后工具必须注销')
})
