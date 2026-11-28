import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT = fileURLToPath(new URL('../client/client.js', import.meta.url))

/**
 * 用一个最小 React 影子装载 client.js：槽位注册拿得到组件，组件可被调用一次。
 * 会话输入框入口新增了 useRef / useCallback 与模块装载期的 react-dom 依赖：
 * 影子必须补齐，否则 client.js 的新路径根本无法装进夹具（此处只保证可装载，不模拟 DOM）。
 */
function loadClient(injected) {
  const pick = (init) => (injected && Object.prototype.hasOwnProperty.call(injected, 'value') ? injected.value : init)
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (init) => [pick(init), () => {}],
    useEffect: () => {},
    useRef: (init) => ({ current: init }),
    useCallback: (fn) => fn
  }
  let captured
  const window = { innerWidth: 1280, innerHeight: 720, __ModuleLoader__: { load: (m) => { captured = m } } }
  new Function('window', readFileSync(CLIENT, 'utf8'))(window)
  assert.ok(captured, 'client.js 没有调用 __ModuleLoader__.load')
  assert.equal(captured.id, '@yitian951012/dsh-project-dev-flow')
  return captured.factory((name) => {
    if (name === 'react') return React
    // 入口面板在模块装载期就 require('react-dom')：影子 createPortal 就地返回节点。
    if (name === 'react-dom') return { createPortal: (node) => node }
    throw new Error(`未预期的模块依赖：${name}`)
  })
}

function mount(mod, props, services = {}) {
  const regs = []
  const effects = []
  const ctx = {
    effect: (fn) => { effects.push(fn()) },
    // locale 服务可能不存在：入口自身有本地回退字典，夹具保持 undefined 以走回退路径。
    get: (name) => (name === 'locale' ? services.locale : undefined),
    inject: (deps, cb) => {
      const scope = {
        layout: {
          panelInfo: { getSnapshot: () => ({ activePanelId: null }) },
          selectPanel() {}
        }
      }
      if (Array.isArray(deps) && deps.includes('uiWorkspace')) scope.uiWorkspace = services.uiWorkspace
      cb(scope)
    },
    slots: {
      register: (opts, comp) => { regs.push({ opts, comp }); return () => {} },
      // 新入口用 slots.inject 探测插槽是否存在：夹具视为存在，执行注册并返回可调用的 stop。
      inject: (name, cb) => {
        const dispose = typeof cb === 'function' ? cb() : undefined
        return () => { if (typeof dispose === 'function') dispose() }
      }
    }
  }
  mod.apply(ctx)
  const panel = regs.find((r) => r.opts.name === 'main')
  const row = regs.find((r) => r.opts.name === 'sidebar.panellist')
  assert.ok(panel, 'main 槽位没有注册')
  assert.ok(row, 'sidebar.panellist 没有注册')
  assert.equal(row.opts.id, panel.opts.key, '面板 key 与侧栏 id 必须同名')
  // 宿主 main 槽恒带 standardProps；夹具也始终提供，避免 hook 条件调用掩盖问题。
  return (extra) => panel.comp({ useWorkspaces: () => undefined, ...props, ...extra })
}

function texts(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) texts(child, out); return out }
  if (typeof node.type === 'function') return texts(node.type(node.props ?? {}), out)
  if (node.children) texts(node.children, out)
  if (node.props && node.props.children) texts(node.props.children, out)
  return out
}

/** 深度优先找“子节点文本包含 label”的最深元素（会执行函数组件）。 */
function findByText(node, label) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) { const hit = findByText(child, label); if (hit) return hit }
    return null
  }
  if (typeof node.type === 'function') return findByText(node.type(node.props ?? {}), label)
  for (const child of (node.children ?? [])) { const hit = findByText(child, label); if (hit) return hit }
  if (node.type && texts(node.children ?? []).join(' ').includes(label)) return node
  return null
}

test('绑定弹窗的“浏览…”调用宿主目录选择器并回填根目录', () => {
  let calls = 0
  const mod = loadClient(READY_STATE({
    bindOpen: true,
    bindPhase: 'idle',
    bindRoot: '',
    bindName: '',
    bindDocs: 'docs',
    bindResult: null,
    bindMessage: ''
  }))
  const render = mount(mod, {}, {
    uiWorkspace: { pickDirectory: () => { calls += 1; return Promise.resolve('E:/picked/project') } }
  })
  const tree = render({})
  const button = findByText(tree, '浏览…')
  assert.ok(button, '弹窗里必须有浏览按钮')
  assert.equal(button.props.disabled, false, '有选择器时按钮必须可用')
  button.props.onClick({ preventDefault() {} })
  assert.equal(calls, 1, '点击必须真的调用 pickDirectory')
})

test('宿主没有目录选择器时按钮保持禁用，不抛错', () => {
  const mod = loadClient(READY_STATE({ bindOpen: true, bindRoot: '', bindName: '', bindDocs: 'docs', bindResult: null }))
  const render = mount(mod, {})
  const button = findByText(render({}), '浏览…')
  assert.ok(button)
  assert.equal(button.props.disabled, true)
})

/** 深度优先收集满足条件的元素（会执行函数组件）。 */
function collect(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const child of node) collect(child, pred, out); return out }
  if (typeof node.type === 'function') { collect(node.type(node.props ?? {}), pred, out); return out }
  if (node.type && pred(node)) out.push(node)
  for (const child of (node.children ?? [])) collect(child, pred, out)
  return out
}

test('绑定弹窗默认勾选“缺目录时自动创建基础台账”', () => {
  const mod = loadClient(READY_STATE({
    bindOpen: true, bindRoot: '', bindName: '', bindDocs: 'docs', bindResult: null, bindMessage: ''
  }))
  const tree = mount(mod, {})({})
  const boxes = collect(tree, (el) => el.props && el.props.type === 'checkbox')
  assert.equal(boxes.length, 1, '绑定弹窗必须只有一个铺底勾选框')
  assert.equal(boxes[0].props.checked, true, '默认必须勾选（缺目录时自动建基础台账）')
  assert.match(String(boxes[0].props['aria-label']), /自动创建/)
})

test('矩阵只显示真实流程节点：不得出现「未归属阶段」兜底行', () => {
  const mod = loadClient(READY_STATE({
    board: {
      rev: 3,
      items: [
        { id: 'STAGE-1', kind: 'stage', title: '调研', derived: { status: 'done', lane: 'done' } },
        { id: 'A-1', kind: 'wbs', title: '无阶段卡片', derived: { lane: 'todo' }, anchor: { doc: 'docs/x.md', line: 1 } }
      ],
      groups: []
    }
  }))
  const out = texts(mount(mod, {})({})).join(' ')
  assert.equal(/未归属/.test(out), false, '未归属行是开发期产物，用户界面不应出现')
  assert.match(out, /调研/, '真实阶段仍要渲染')
})

const READY_STATE = (overrides = {}) => ({
  value: {
    phase: 'ready',
    projects: [{ id: 'a', name: '甲项目', root: 'E:/a', available: true, counts: { lanes: { todo: 1, decision: 0 } } }],
    currentId: 'a',
    errors: [],
    board: {
      rev: 2,
      items: [{ id: 'A-1', kind: 'wbs', title: '真实卡片', derived: { lane: 'todo' }, anchor: { doc: 'docs/31_x.md', line: 3 } }],
      groups: [{ id: 'FE', total: 2, done: 2 }]
    },
    boardError: null,
    ...overrides
  }
})

test('首帧（未注入状态）渲染标题与加载提示，而不是整页空白', () => {
  const mod = loadClient()
  const render = mount(mod, {})
  const out = texts(render({})).join(' ')
  assert.match(out, /项目进度看板/, '标题必须出现——空白页说明组件抛错了')
  assert.match(out, /读取项目列表/)
})

test('有工作空间但注册表未返回时不得抛错', () => {
  const mod = loadClient()
  const render = mount(mod, {
    useWorkspaces: () => ({ items: [{ workspaceId: 'w1', path: 'E:/demo', title: '演示' }] })
  })
  const out = texts(render({})).join(' ')
  assert.match(out, /项目进度看板/)
  assert.match(out, /读取项目列表/)
})

test('ready 分支：渲染项目条目与选中项目看板，残缺数据不抛错', () => {
  const mod = loadClient(READY_STATE({
    board: {
      rev: 2,
      items: [
        { id: 'A-1', kind: 'wbs', title: '真实卡片', derived: { lane: 'todo' }, anchor: { doc: 'docs/31_x.md', line: 3 } },
        null
      ],
      groups: {}
    }
  }))
  const render = mount(mod, { useWorkspaces: () => ({ items: [{ path: 'E:/demo' }] }) })
  const out = texts(render({})).join(' ')
  assert.match(out, /甲项目/)
  assert.equal(/A-1/.test(out), false, '无 stage 的卡片不再进矩阵（已取消兜底行）')
  assert.match(out, /rev 2/)
})

test('多项目：不可用项目给出自己的原因，不拖垮其他项目', () => {
  const mod = loadClient(READY_STATE({
    projects: [
      { id: 'a', name: '甲项目', root: 'E:/a', available: true, counts: { lanes: { todo: 2 } } },
      { id: 'b', name: '乙项目', root: 'E:/b', available: false, code: 'no_board', message: '该项目还没有看板数据', hint: 'node scripts/import-board.mjs --root "E:/b"' }
    ],
    currentId: 'b',
    boardError: '该项目还没有看板数据',
    board: null
  }))
  const render = mount(mod, {})
  const out = texts(render({})).join(' ')
  assert.match(out, /甲项目/)
  assert.match(out, /乙项目/)
  assert.match(out, /未导入看板数据/, '列表里要标出不可用项目')
  assert.match(out, /该项目还没有看板数据/, '选中不可用项目时给出原因')
  assert.match(out, /import-board\.mjs/, '给出下一步命令')
})

/* -------------------------------------------------------------------------- *
 * 3.0.0 行模型回归：行集合由 kind=stage/gate 节点卡派生，缺卡才回退固定模板。
 *
 * 所有断言都钉在「渲染出来的行」上（pbp-no / pbp-nm / pbp-meta / 头部 / 图例），
 * 不读 client.js 里的 STAGE_ROWS 常量。只要退回固定 8 阶段行序，下面前 3 条
 * 必红：行数变 10、G2 跑到 04 之后、07/08 重新出现、STAGE-7 卡片会落进真实
 * 存在的 07 行；第 4 条则保证回退模板本身没被改坏。
 * -------------------------------------------------------------------------- */

const SCAFFOLD_DOC = 'docs/01_入口_项目状态看板.md'

const byClass = (className) => (el) =>
  Boolean(el && el.type && el.props && el.props.className === className)

function elementsByClass(node, className) {
  return collect(node, byClass(className))
}

function textOfClass(node, className) {
  const el = elementsByClass(node, className)[0]
  return el ? texts(el).join('') : ''
}

/**
 * 6 阶段 scaffold 的 8 张节点卡（6 阶段 + 2 门禁）。
 * 「1/2/G1/3/G2/4/5/6」是行号（由 id 末位数字派生），title 取状态表「名称」列。
 * 输入顺序故意打乱：行序只能由同一 anchor.doc 内的 anchor.line 升序决定。
 */
const SCAFFOLD_NODES = [
  { id: 'STAGE-4', kind: 'stage', title: '验证', line: 17, status: 'partial' },
  { id: 'GATE-2', kind: 'gate', title: '实现完成确认', line: 16, status: 'missing' },
  { id: 'STAGE-1', kind: 'stage', title: '需求受理', line: 12, status: 'done' },
  { id: 'STAGE-6', kind: 'stage', title: '复盘', line: 19, status: 'missing' },
  { id: 'GATE-1', kind: 'gate', title: '设计定稿确认', line: 14, status: 'done' },
  { id: 'STAGE-2', kind: 'stage', title: '设计定型', line: 13, status: 'done' },
  { id: 'STAGE-5', kind: 'stage', title: '交付', line: 18, status: 'missing' },
  { id: 'STAGE-3', kind: 'stage', title: '实现', line: 15, status: 'partial' }
]

/** 节点卡：派生行与行头状态，但本身永远不算「卡片」。 */
const nodeItem = (spec) => ({
  id: spec.id,
  kind: spec.kind,
  title: spec.title,
  anchor: { doc: SCAFFOLD_DOC, line: spec.line, sha: 'node-sha' },
  derived: {
    status: spec.status,
    lane: spec.status === 'done' ? 'done' : spec.status === 'partial' ? 'verify' : 'todo'
  }
})

/** 非节点卡：靠 derived.stage 找行，找不到就进未归属（未归属不渲染）。 */
function cardItem(id, title, stage, lane = 'todo') {
  return {
    id,
    kind: 'wbs',
    title,
    anchor: { doc: 'docs/31_验收_WBS拆解明细.md', line: 7, sha: 'card-sha' },
    derived: { lane, ...(stage ? { stage } : {}) }
  }
}

function renderBoard(items) {
  const mod = loadClient(READY_STATE({ board: { rev: 41, items, groups: [] } }))
  return mount(mod, {})({})
}

/** 行头三元组：编号 / 标题（去掉状态标签）/ meta（状态 · N 张卡）/ 状态标签。 */
function rowInfos(tree) {
  return elementsByClass(tree, 'pbp-row').map((row) => {
    const noEl = elementsByClass(row, 'pbp-no')[0]
    const nameEl = elementsByClass(row, 'pbp-nm')[0]
    const metaEl = elementsByClass(row, 'pbp-meta')[0]
    const nameTexts = nameEl ? texts(nameEl) : []
    return {
      row,
      no: noEl ? texts(noEl).join('') : '',
      // pbp-nm 的结构是「标题 span + 可选状态标签 span」；取第一个才是标题。
      title: String(nameTexts[0] ?? '').trim(),
      meta: metaEl ? texts(metaEl).join('') : '',
      tags: elementsByClass(row, 'pbp-tag').map((el) => texts(el).join('')),
      gate: row.props['data-gate'] === 'true',
      unassigned: row.props['data-unassigned'] === 'true'
    }
  })
}

/** 通用节点卡：可指定 doc / line（含显式 null），覆盖锚点、跨文档和大小写边界。 */
function rawNode(spec = {}) {
  return {
    id: spec.id ?? 'STAGE-1',
    kind: spec.kind ?? 'stage',
    title: spec.title ?? spec.id ?? '节点',
    anchor: {
      doc: spec.doc ?? SCAFFOLD_DOC,
      ...(Object.prototype.hasOwnProperty.call(spec, 'line') ? { line: spec.line } : {}),
      sha: 'node-sha'
    },
    derived: { status: spec.status ?? 'missing', lane: 'todo' }
  }
}

test('行模型：6 阶段 scaffold 节点卡派生 8 行，G2 在 03 与 04 之间，无 07/08', () => {
  const tree = renderBoard(SCAFFOLD_NODES.map(nodeItem))
  const rows = rowInfos(tree)
  assert.equal(rows.length, 8,
    `应只渲染节点卡派生的 8 行（6 阶段 + 2 门禁），实际 ${rows.length} 行：${rows.map((row) => row.no).join(',')}`)
  assert.deepEqual(rows.map((row) => row.no), ['01', '02', 'G1', '03', 'G2', '04', '05', '06'])
  assert.deepEqual(rows.map((row) => row.title), [
    '需求受理', '设计定型', '设计定稿确认', '实现', '实现完成确认', '验证', '交付', '复盘'
  ])
  assert.deepEqual(rows.map((row) => row.gate), [false, false, true, false, true, false, false, false])

  // G2 的真实位置：紧跟 03 实现，且在 04 验证之前——退回固定模板时这里必红。
  const at03 = rows.findIndex((row) => row.no === '03')
  const atG2 = rows.findIndex((row) => row.no === 'G2')
  const at04 = rows.findIndex((row) => row.no === '04')
  assert.equal(atG2, at03 + 1, 'G2 必须紧跟在 03 实现之后')
  assert.equal(at04, atG2 + 1, '04 验证必须紧随 G2，不能被固定模板挤到后面')

  assert.equal(rows.some((row) => row.no === '07' || row.no === '08'), false,
    '6 阶段数据不得渲染固定模板的 07/08 行')
  assert.equal(rows.some((row) => /打包部署|运维监控/.test(row.title)), false,
    '6 阶段数据不得渲染固定模板第 7/8 阶段的标题')

  assert.match(textOfClass(tree, 'pbp-sub'), /阶段 6 \/ 门禁 2/,
    '头部计数必须由行集合派生，而不是写死 8/2')
  assert.equal(textOfClass(tree, 'pbp-tip'), '行 = 流程节点（6 阶段 + 2 门禁）· 格内上限 2 张')
})

test('行模型：节点卡只造行不计数，每行 meta 都是 0 张卡', () => {
  const tree = renderBoard(SCAFFOLD_NODES.map(nodeItem))
  const rows = rowInfos(tree)
  assert.equal(rows.length, 8,
    `节点卡应派生 8 行，实际 ${rows.length} 行：${rows.map((row) => row.no).join(',')}`)
  assert.match(textOfClass(tree, 'pbp-sub'), /8 条记录/,
    '夹具里确实有 8 条节点卡记录')
  assert.equal(elementsByClass(tree, 'pbp-card').length, 0,
    '节点卡是行头，不应作为矩阵卡片渲染')
  for (const row of rows) {
    assert.match(row.meta, /· 0 张卡$/,
      `${row.no} 行不得把节点卡计入张数，实际 meta：${row.meta}`)
  }
})

test('行模型：非节点卡按 derived.stage 进对应行，STAGE-7 不造幽灵 07 行', () => {
  const tree = renderBoard([
    ...SCAFFOLD_NODES.map(nodeItem),
    cardItem('FE-01', '落 04 的验收卡', 'STAGE-4'),
    cardItem('BE-01', '落 01 的接口卡', 'STAGE-1'),
    cardItem('CONN-01', '幽灵 07 卡', 'STAGE-7'),
    cardItem('A-1', '无阶段归属卡')
  ])
  const rows = rowInfos(tree)
  assert.equal(rows.length, 8,
    `节点卡应派生 8 行，实际 ${rows.length} 行：${rows.map((row) => row.no).join(',')}`)
  assert.equal(rows.some((row) => row.no === '07'), false,
    'derived.stage=STAGE-7 的非节点卡不得造出 07 行')

  const row01 = rows.find((row) => row.no === '01')
  const row03 = rows.find((row) => row.no === '03')
  const row04 = rows.find((row) => row.no === '04')
  assert.ok(row01 && row03 && row04, `缺行：01=${Boolean(row01)} 03=${Boolean(row03)} 04=${Boolean(row04)}`)
  assert.match(texts(row01.row).join(' '), /落 01 的接口卡/, 'STAGE-1 的卡必须落在 01 行')
  assert.match(texts(row04.row).join(' '), /落 04 的验收卡/, 'STAGE-4 的卡必须落在 04 行')
  assert.equal(/落 01 的接口卡/.test(texts(row03.row).join(' ')), false,
    'STAGE-1 的卡不得被行序变化挤到 03 行')
  assert.equal(/落 04 的验收卡/.test(texts(row03.row).join(' ')), false,
    'STAGE-4 的卡不得被行序变化挤到 03 行')
  assert.match(row01.meta, /· 1 张卡$/)
  assert.match(row04.meta, /· 1 张卡$/)

  const all = texts(tree).join(' ')
  assert.equal(all.includes('幽灵 07 卡'), false,
    'STAGE-7 的卡应进未归属，且未归属不渲染')
  assert.equal(all.includes('无阶段归属卡'), false,
    '无 derived.stage 的卡应进未归属，且未归属不渲染')
  assert.equal(all.includes('未归属'), false, '界面不得出现未归属兜底行')
  assert.equal(rows.some((row) => row.unassigned), false, '渲染出的行里不得有未归属行')
})

test('行模型：无节点卡回退固定 10 行模板，头部/图例回到 8 阶段 2 门禁', () => {
  const tree = renderBoard([cardItem('FE-01', '回退模板里的卡', 'STAGE-3')])
  const rows = rowInfos(tree)
  assert.equal(rows.length, 10, '没有任何 stage/gate 节点卡时必须回退固定模板')
  assert.deepEqual(rows.map((row) => row.no), ['01', '02', 'G1', '03', '04', 'G2', '05', '06', '07', '08'])
  assert.deepEqual(rows.map((row) => row.gate),
    [false, false, true, false, false, true, false, false, false, false])
  assert.match(textOfClass(tree, 'pbp-sub'), /阶段 8 \/ 门禁 2/)
  assert.equal(textOfClass(tree, 'pbp-tip'), '行 = 流程节点（8 阶段 + 2 门禁）· 格内上限 2 张')
  const row03 = rows.find((row) => row.no === '03')
  assert.ok(row03, '回退模板必须包含 03 行')
  assert.match(texts(row03.row).join(' '), /回退模板里的卡/,
    '回退模板下非节点卡仍须按 derived.stage 落位')
  assert.match(row03.meta, /· 1 张卡$/)
})

test('行模型边界：anchor.line 优先于 id（02@10、G1@15、01@20 渲染为 02,G1,01）', () => {
  const tree = renderBoard([
    rawNode({ id: 'STAGE-2', title: '需求规格 PRD', line: 10 }),
    rawNode({ id: 'GATE-1', kind: 'gate', title: '需求定稿确认', line: 15 }),
    rawNode({ id: 'STAGE-1', title: '市场与竞品调研', line: 20 })
  ])
  const rows = rowInfos(tree)
  assert.equal(rows.length, 3,
    `3 张节点卡应派生 3 行，实际 ${rows.length} 行：${rows.map((row) => row.no).join(',')}`)
  assert.deepEqual(rows.map((row) => row.no), ['02', 'G1', '01'],
    '行序必须按 anchor.line 升序；按 id 会变成 01,02,G1')
  assert.deepEqual(rows.map((row) => row.title),
    ['需求规格 PRD', '需求定稿确认', '市场与竞品调研'])
  assert.deepEqual(rows.map((row) => row.gate), [false, true, false])
  assert.match(textOfClass(tree, 'pbp-sub'), /阶段 2 \/ 门禁 1/)
})

test('行模型边界：同 id 两卡由首次 anchor 定行位，末卡只提供标题/状态', () => {
  const tree = renderBoard([
    rawNode({ id: 'STAGE-1', title: '首行卡', line: 10 }),
    rawNode({ id: 'STAGE-2', title: '初始标题', line: 30, status: 'missing' }),
    // 同 id 的末卡 anchor 更靠前（5），但它只能改标题/状态，不能把 02 挪到 01 前面。
    rawNode({ id: 'STAGE-2', title: '末卡标题', line: 5, status: 'done' })
  ])
  const rows = rowInfos(tree)
  assert.equal(rows.length, 2,
    `同 id 必须合并为一行，实际 ${rows.length} 行：${rows.map((row) => row.no).join(',')}`)
  assert.deepEqual(rows.map((row) => row.no), ['01', '02'],
    '首次 anchor(30) 决定 02 在 01 之后；若用末卡 anchor(5)，行序会变成 02,01')
  assert.equal(rows[1].title, '末卡标题', '末卡必须提供标题')
  assert.equal(rows[1].meta, '已完成 · 0 张卡', '末卡必须提供状态')
  assert.equal(rows.filter((row) => row.no === '02').length, 1, '同 id 只能有一行')
})

test('行模型边界：跨文档以节点最多的文档为主序列，先输入的少量文档整体追加', () => {
  const tree = renderBoard([
    rawNode({ id: 'STAGE-4', title: 'A 四', doc: 'docs/a.md', line: 10 }),
    rawNode({ id: 'STAGE-5', title: 'A 五', doc: 'docs/a.md', line: 20 }),
    rawNode({ id: 'STAGE-1', title: 'B 一', doc: 'docs/b.md', line: 10 }),
    rawNode({ id: 'STAGE-2', title: 'B 二', doc: 'docs/b.md', line: 20 }),
    rawNode({ id: 'STAGE-3', title: 'B 三', doc: 'docs/b.md', line: 30 })
  ])
  const rows = rowInfos(tree)
  assert.equal(rows.length, 5,
    `5 张节点卡应派生 5 行，实际 ${rows.length} 行：${rows.map((row) => row.no).join(',')}`)
  assert.deepEqual(rows.map((row) => row.no), ['01', '02', '03', '04', '05'],
    'doc B 有 3 个节点，应作为主序列在前；按输入顺序会变成 04,05,01,02,03')
  assert.deepEqual(rows.map((row) => row.title), ['B 一', 'B 二', 'B 三', 'A 四', 'A 五'])
})

test('行模型边界：null 行号排在同文档末尾（STAGE-1 无行号 → 02,01）', () => {
  const tree = renderBoard([
    rawNode({ id: 'STAGE-1', title: '无行号卡', line: null }),
    rawNode({ id: 'STAGE-2', title: '有行号卡', line: 5 })
  ])
  const rows = rowInfos(tree)
  assert.equal(rows.length, 2,
    `2 张节点卡应派生 2 行，实际 ${rows.length} 行：${rows.map((row) => row.no).join(',')}`)
  assert.deepEqual(rows.map((row) => row.no), ['02', '01'],
    'null 行号视为不可比，必须排在同文档有行号的节点之后')
  assert.deepEqual(rows.map((row) => row.title), ['有行号卡', '无行号卡'])

  // “无 line 字段”与显式 null 同义：不能被当成 0 排到最前。
  const omittedTree = renderBoard([
    rawNode({ id: 'STAGE-1', title: '缺省行号卡' }),
    rawNode({ id: 'STAGE-2', title: '显式行号卡', line: 5 })
  ])
  const omittedRows = rowInfos(omittedTree)
  assert.deepEqual(omittedRows.map((row) => row.no), ['02', '01'],
    '省略 anchor.line 字段也必须排在有行号的节点之后')
})

test('行模型边界：id 大小写/空白归一后合并，小写 derived.stage 仍落对应行', () => {
  const tree = renderBoard([
    rawNode({ id: 'STAGE-1', title: '首卡标题', line: 10, status: 'missing' }),
    rawNode({ id: ' stage-1 ', title: '末卡标题', line: 20, status: 'done' }),
    rawNode({ id: 'stage-3', title: '小写节点', line: 30, status: 'missing' }),
    cardItem('FE-01', '小写 stage 落位卡', 'stage-3')
  ])
  const rows = rowInfos(tree)
  assert.equal(rows.length, 2,
    `大小写/空白应合并，缩放后应只有 01、03 两行，实际 ${rows.length} 行：${rows.map((row) => row.no).join(',')}`)
  assert.deepEqual(rows.map((row) => row.no), ['01', '03'])
  assert.equal(rows.filter((row) => row.no === '01').length, 1, 'STAGE-1 与 " stage-1 " 只能有一行')
  assert.equal(rows[0].title, '末卡标题', '合并后末卡提供标题')
  assert.equal(rows[0].meta, '已完成 · 0 张卡', '合并后末卡提供状态')

  const row03 = rows[1]
  assert.match(texts(row03.row).join(' '), /小写 stage 落位卡/,
    'derived.stage 大小写归一后，非节点卡必须落进小写 id 的节点行')
  assert.equal(row03.meta, '缺失 · 1 张卡')
})

test('行模型边界：原型键/非法状态降级为待确认，正常五态文案不变', () => {
  const illegalTree = renderBoard([
    rawNode({ id: 'STAGE-1', title: '原型键', line: 10, status: '__proto__' }),
    rawNode({ id: 'STAGE-2', title: '构造键', line: 20, status: 'constructor' }),
    rawNode({ id: 'STAGE-3', title: '未知态', line: 30, status: 'doing' })
  ])
  const illegalRows = rowInfos(illegalTree)
  assert.equal(illegalRows.length, 3)
  for (const row of illegalRows) {
    assert.equal(row.meta, '待确认 · 0 张卡',
      `${row.no} 行的非法状态必须降级为待确认，实际 ${row.meta}`)
    assert.deepEqual(row.tags, [], `${row.no} 行不得渲染状态标签`)
  }
  assert.equal(texts(illegalTree).join(' ').includes('[object Object]'), false,
    '原型键不能被当成 React 子节点或插进文案')

  const normalTree = renderBoard([
    rawNode({ id: 'STAGE-1', title: '完成', line: 10, status: 'done' }),
    rawNode({ id: 'STAGE-2', title: '部分', line: 20, status: 'partial' }),
    rawNode({ id: 'STAGE-3', title: '缺失', line: 30, status: 'missing' }),
    rawNode({ id: 'STAGE-4', title: '搁置', line: 40, status: 'hold' }),
    rawNode({ id: 'STAGE-5', title: '待确认', line: 50, status: 'unknown' })
  ])
  const normalRows = rowInfos(normalTree)
  assert.deepEqual(normalRows.map((row) => row.meta), [
    '已完成 · 0 张卡',
    '部分就绪 · 0 张卡',
    '缺失 · 0 张卡',
    '搁置 · 0 张卡',
    '待确认 · 0 张卡'
  ], '正常五态文案不得被降级守卫误伤')
  assert.deepEqual(normalRows.map((row) => row.tags.length), [1, 1, 1, 1, 0],
    'done/partial/missing/hold 保留状态标签；unknown 本就没有标签')
})

test('行模型边界：回退模板 STAGE-1 固定标题与 07/08 空行 meta 不被改坏', () => {
  const tree = renderBoard([cardItem('FE-01', '回退卡', 'STAGE-3')])
  const rows = rowInfos(tree)
  assert.equal(rows.length, 10)
  const row01 = rows.find((row) => row.no === '01')
  const row07 = rows.find((row) => row.no === '07')
  const row08 = rows.find((row) => row.no === '08')
  assert.ok(row01 && row07 && row08, '回退模板必须包含 01/07/08 行')
  assert.equal(row01.title, '市场与竞品调研', 'STAGE-1 的固定标题被改坏')
  assert.equal(row01.meta, '节点未建 · 0 张卡')
  assert.equal(row07.meta, '节点未建 · 0 张卡')
  assert.equal(row08.meta, '节点未建 · 0 张卡')
  assert.equal(row07.title, '打包部署与交付')
  assert.equal(row08.title, '运维监控与知识沉淀')
})
