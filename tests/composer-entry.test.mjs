import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 会话输入框入口（conversation.input.left）的自动化测试。
 *
 * 夹具与边界（重要限制）：
 * - 用 `new Function` + 影子 React 装载 client/client.js；不启动浏览器、不联网、不挂真实 DOM。
 * - 影子 React 只实现 createElement / useState / useRef / useCallback / useEffect 的最小语义，
 *   并同步重渲染。影子 React 的断言只能证明「注册形状正确 + 给定 props 渲染不抛错」，
 *   以及事件回调在 props 层面的契约（点了哪个按钮、宿主接口收到什么参数）。
 * - 它不能证明真实浏览器里的点击命中、焦点与键盘圈定、createPortal 定位和视觉呈现；
 *   这些必须真机验收，本文件不做任何 DOM/像素断言。
 * - locale 与 react-dom 全部是桩；每个用例重新装载模块，测试之间零共享状态。
 */

const CLIENT = fileURLToPath(new URL('../client/client.js', import.meta.url))
const SOURCE = readFileSync(CLIENT, 'utf8')

const SLOT = 'conversation.input.left'
const NS = 'project-dev-flow.composer'
const PRESET = 'project-dev-flow'
const INTAKE = '/project-intake'

/* -------------------------------------------------------------------------- *
 * 影子 React：带真实 hook 槽与同步重渲染，足够驱动入口组件的状态机。
 * 不模拟调度、cleanup、DOM ref、portal；这些不在本文件的断言范围内。
 * -------------------------------------------------------------------------- */
function createShadowRuntime() {
  let currentInstance = null
  const instances = new Map()
  let phase = 'idle'
  let dirty = false
  let effectQueue = []
  let tree = null
  let rootComp = null
  let rootProps = null

  const requireInstance = () => {
    if (!currentInstance) throw new Error('hook 只能在组件渲染期间调用')
    return currentInstance
  }

  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (init) => {
      const instance = requireInstance()
      const index = instance.index++
      if (instance.hooks[index] === undefined) instance.hooks[index] = { value: init }
      const cell = instance.hooks[index]
      const set = (next) => {
        const value = typeof next === 'function' ? next(cell.value) : next
        if (Object.is(value, cell.value)) return
        cell.value = value
        requestRender()
      }
      return [cell.value, set]
    },
    useRef: (init) => {
      const instance = requireInstance()
      const index = instance.index++
      if (instance.hooks[index] === undefined) instance.hooks[index] = { current: init }
      return instance.hooks[index]
    },
    useCallback: (fn) => {
      const instance = requireInstance()
      instance.index += 1
      return fn
    },
    useEffect: (fn) => {
      const instance = requireInstance()
      instance.index += 1
      effectQueue.push(fn)
    }
  }

  function renderElement(element, path) {
    if (element === null || element === undefined || typeof element === 'boolean') return null
    if (typeof element === 'string' || typeof element === 'number') return element
    if (Array.isArray(element)) return element.map((child, i) => renderElement(child, `${path}[${i}]`))
    if (element.type === React.Fragment) return renderElement(element.children, `${path}#fragment`)
    if (typeof element.type === 'function') {
      const key = `${path}|${element.type.name || 'anonymous'}`
      let instance = instances.get(key)
      if (!instance) {
        instance = { hooks: [], index: 0 }
        instances.set(key, instance)
      }
      const previous = currentInstance
      currentInstance = instance
      instance.index = 0
      let rendered
      try {
        rendered = element.type(element.props || {})
      } finally {
        currentInstance = previous
      }
      return renderElement(rendered, `${key}>`)
    }
    const children = Array.isArray(element.children) && element.children.length > 0
      ? element.children
      : (element.props && element.props.children !== undefined ? [element.props.children] : [])
    return {
      type: element.type,
      props: element.props || {},
      children: children.map((child, i) => renderElement(child, `${path}/${i}`))
    }
  }

  function requestRender() {
    if (phase !== 'idle') { dirty = true; return }
    let passes = 0
    do {
      dirty = false
      effectQueue = []
      phase = 'render'
      tree = renderElement(React.createElement(rootComp, rootProps), 'root')
      phase = 'effects'
      for (const effect of effectQueue) effect()
      phase = 'idle'
      passes += 1
      if (passes > 25) throw new Error('影子 React 重渲染次数超出上限（疑似状态死循环）')
    } while (dirty)
  }

  return {
    react: React,
    renderRoot(comp, props) {
      rootComp = comp
      rootProps = props
      requestRender()
      return tree
    },
    getTree: () => tree
  }
}

/** locale 桩：register 记录字典；bind 按 active=zh 返回，保证文案断言与开发机语言无关。 */
function createLocaleService() {
  const registers = []
  const service = {
    register(namespace, dict) {
      registers.push({ namespace, dict })
      return () => {}
    },
    bind(namespace) {
      const hit = registers.find((entry) => entry.namespace === namespace)
      return (key) => {
        if (!hit) return key
        const bucket = hit.dict[service.getSnapshot().active]
        return bucket && Object.hasOwn(bucket, key) ? bucket[key] : key
      }
    },
    getSnapshot() {
      return { active: 'zh' }
    }
  }
  return { service, registers }
}

/** 装载 client.js：影子 React + 桩 react-dom；不启动任何浏览器环境。 */
function loadClient(runtime) {
  let captured
  const window = {
    innerWidth: 1280,
    innerHeight: 720,
    __ModuleLoader__: { load: (mod) => { captured = mod } }
  }
  new Function('window', SOURCE)(window)
  assert.ok(captured, 'client.js 没有调用 __ModuleLoader__.load')
  assert.equal(captured.id, '@yitian951012/dsh-project-dev-flow')
  return captured.factory((name) => {
    if (name === 'react') return runtime.react
    // 模块装载期就 require('react-dom')：桩返回 identity createPortal（本夹具没有 document，不会真用）。
    if (name === 'react-dom') return { createPortal: (node) => node }
    throw new Error(`未预期的模块依赖：${name}`)
  })
}

/**
 * 装载并执行 apply。calls 汇总所有宿主接口调用：
 * insertText / submit / setDraft / startSession。测试结束时断言 submit/setDraft 恒为 0。
 */
function createHarness(options = {}) {
  const runtime = createShadowRuntime()
  const locale = createLocaleService()
  const mod = loadClient(runtime)
  const calls = { insertText: [], submit: [], setDraft: [], startSession: [], pickDirectory: [] }

  const workspaceService = options.workspaceService || {
    startSession: (workspaceId, opts) => {
      calls.startSession.push({ workspaceId, options: opts })
    },
    pickDirectory: () => {
      calls.pickDirectory.push(0)
      return Promise.resolve(null)
    }
  }

  const defaultHostProps = {
    useInput: (select) => select({ draft: options.draft ?? '', phase: options.phase ?? 'plain' }),
    useProjection: () => (Object.hasOwn(options, 'preset') ? options.preset : null),
    useWorkspaces: (select) => select({ workspaces: [{ workspaceId: options.workspaceId ?? 'w1' }] }),
    useSession: (select) => select({ blank: options.blank === true }),
    inputActions: {
      captureInsertion: () => ({ draftRev: options.draftRev ?? 7 }),
      insertText: (...args) => {
        calls.insertText.push(args)
        return typeof options.insertResult === 'function' ? options.insertResult(...args) : undefined
      },
      submit: (...args) => { calls.submit.push(args) },
      setDraft: (...args) => { calls.setDraft.push(args) }
    }
  }
  const hostProps = { ...defaultHostProps, ...(options.hostProps || {}) }

  const registrations = []
  const injects = []
  const effectCalls = []
  const registerReturns = []
  const injectReturns = []

  const ctx = {
    effect(fn, label) {
      const result = fn()
      effectCalls.push({ label, result })
      return result
    },
    inject(deps, cb) {
      const scope = {}
      if (Array.isArray(deps) && deps.includes('layout')) {
        scope.layout = {
          panelInfo: { getSnapshot: () => ({ activePanelId: null }) },
          selectPanel() {}
        }
      }
      if (Array.isArray(deps) && deps.includes('uiWorkspace')) scope.uiWorkspace = workspaceService
      cb(scope)
    },
    get(name) {
      return name === 'locale' ? locale.service : undefined
    },
    slots: {
      register(opts, comp) {
        const disposer = () => {}
        registrations.push({ opts, comp, disposer })
        registerReturns.push(disposer)
        return disposer
      },
      inject(name, cb) {
        injects.push({ name })
        const dispose = cb()
        const stop = () => { if (typeof dispose === 'function') dispose() }
        injectReturns.push(stop)
        return stop
      }
    }
  }

  mod.apply(ctx)

  const entry = registrations.find((item) => item.opts && item.opts.name === SLOT)
  assert.ok(entry, `apply 没有注册 ${SLOT}`)
  runtime.renderRoot(entry.comp, hostProps)

  return {
    mod,
    runtime,
    entry,
    registrations,
    injects,
    effectCalls,
    registerReturns,
    injectReturns,
    locale,
    ctx,
    workspaceService,
    calls,
    tree: () => runtime.getTree(),
    get dict() {
      return locale.registers[0] ? locale.registers[0].dict : null
    }
  }
}

/* ---------------------------- 树遍历与交互 ---------------------------- */

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  visit(node)
  if (Array.isArray(node.children)) for (const child of node.children) walk(child, visit)
}

function findAll(tree, predicate) {
  const out = []
  walk(tree, (node) => { if (predicate(node)) out.push(node) })
  return out
}

function byClass(tree, className) {
  return findAll(tree, (node) => node.props && node.props.className === className)[0] || null
}

function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (Array.isArray(node.children) ? node.children : []).map(textOf).join('')
}

/** 只调用元素自带的 onClick：证明 props 层面的契约，不模拟浏览器命中。 */
function click(node, event = {}) {
  assert.ok(node, '点击目标不存在')
  assert.equal(typeof node.props.onClick, 'function', '点击目标没有 onClick')
  node.props.onClick({ preventDefault() {}, stopPropagation() {}, detail: 1, ...event })
}

function openPanel(harness) {
  const button = byClass(harness.tree(), 'pdflow-entry')
  assert.ok(button, '影子渲染没有产出入口按钮')
  click(button)
  const panel = byClass(harness.tree(), 'pdflow-panel')
  assert.ok(panel, '点击入口后面板必须出现')
  // composerPlacement 的产物：宽度受 360px 上限约束，默认从输入条向上展开（bottom 定位）。
  assert.equal(panel.props.style.width, '360px', '面板宽度必须按 360px 上限计算')
  assert.ok(panel.props.style.bottom, '输入条在底部时面板默认向上展开')
  return harness.tree()
}

function stageRows(tree) {
  return findAll(tree, (node) => node.type === 'button' && node.props && node.props.className === 'pdflow-row')
}

function stageRow(tree, id) {
  return stageRows(tree).find((node) => node.props['data-stage'] === id) || null
}

function footerOf(tree) {
  return byClass(tree, 'pdflow-foot')
}

function assertNeverSubmits(harness) {
  assert.deepEqual(harness.calls.submit, [], '入口不得调用宿主 submit')
  assert.deepEqual(harness.calls.setDraft, [], '入口不得调用宿主 setDraft')
}

/** 新建会话的两步确认：点“新建” → 点主按钮。 */
function confirmCreate(harness) {
  const newButton = byClass(harness.tree(), 'pdflow-newbt')
  assert.ok(newButton, '新建会话按钮不存在')
  click(newButton)
  const primary = findAll(harness.tree(), (node) =>
    node.type === 'button'
    && node.props
    && node.props.className === 'pdflow-btn'
    && node.props['data-primary'] === 'true')[0]
  assert.ok(primary, '确认新建按钮不存在')
  click(primary)
}

/* -------------------------------- 用例 -------------------------------- */

test('注册形状：inject 键为 conversation.input.left，register 的 name/id/order/label 符合契约', () => {
  const harness = createHarness({ preset: PRESET })
  assert.deepEqual(harness.injects.map((item) => item.name), [SLOT],
    '入口必须只 inject conversation.input.left 这一个插槽')
  const opts = harness.entry.opts
  assert.equal(opts.name, SLOT)
  assert.equal(opts.id, PRESET)
  assert.equal(opts.order, 20)
  assert.equal(typeof opts.label, 'function', 'label 必须是 thunk（语言切换后重读）')
  assert.equal(harness.entry.comp instanceof Function, true, 'register 必须拿到可渲染的组件')
  assert.equal(opts.label(), harness.dict.zh.entry, 'label() 必须解析出已注册的入口文案')

  const button = byClass(harness.tree(), 'pdflow-entry')
  assert.ok(button, '影子渲染必须产出入口按钮')
  assert.equal(button.props.type, 'button')
  assert.equal(button.props['aria-haspopup'], 'dialog')
})

test('注册形状：apply 返回的 disposer 全部可调用且不抛', () => {
  const harness = createHarness()
  const composerLabels = harness.effectCalls.map((item) => item.label).filter(Boolean)
  assert.deepEqual(composerLabels, [
    'project-dev-flow: composer copy',
    'project-dev-flow: composer styles',
    'project-dev-flow: composer entry'
  ], '入口的三条资源必须各自拥有独立的 ctx.effect')

  const disposers = []
  for (const item of harness.effectCalls) {
    assert.equal(typeof item.result, 'function',
      `${item.label || '看板'} effect 必须返回可调用 disposer`)
    disposers.push(item.result)
  }
  for (const fn of harness.registerReturns) {
    assert.equal(typeof fn, 'function', 'slots.register 必须返回 disposer')
    disposers.push(fn)
  }
  for (const fn of harness.injectReturns) {
    assert.equal(typeof fn, 'function', 'slots.inject 必须返回 stop')
    disposers.push(fn)
  }
  assert.ok(disposers.length >= 8, `应收集到全部 disposer，实际 ${disposers.length} 个`)
  for (const fn of disposers) assert.doesNotThrow(() => fn(), 'disposer 调用不得抛错')
})

test('locale：register 只调一次，命名空间正确且 zh/en 键集一致', () => {
  const harness = createHarness()
  assert.equal(harness.locale.registers.length, 1, 'locale.register 必须只调用一次')
  const { namespace, dict } = harness.locale.registers[0]
  assert.equal(namespace, NS)
  assert.deepEqual(Object.keys(dict).sort(), ['en', 'zh'])
  assert.deepEqual(Object.keys(dict.en).sort(), Object.keys(dict.zh).sort(),
    'zh 与 en 的键集必须完全一致')
  for (const bucket of ['zh', 'en']) {
    for (const [key, value] of Object.entries(dict[bucket])) {
      assert.equal(typeof value, 'string', `${bucket}.${key} 必须是字符串`)
      assert.ok(value.length > 0, `${bucket}.${key} 不得为空`)
    }
  }
})

test('渲染降级：宿主缺少输入/投影/工作空间 hook 时入口仍渲染且不抛', () => {
  const harness = createHarness({
    hostProps: {
      useInput: undefined,
      useProjection: undefined,
      useWorkspaces: undefined,
      useSession: undefined,
      inputActions: undefined
    }
  })
  const button = byClass(harness.tree(), 'pdflow-entry')
  assert.ok(button, '缺宿主 hook 时入口按钮仍必须渲染')
  click(button)
  assert.ok(byClass(harness.tree(), 'pdflow-panel'), '缺宿主 hook 时面板仍必须能打开')
  // 投影缺失按 unknown 处理：阶段行必须禁用，绝不冒充已绑定。
  for (const row of stageRows(harness.tree())) {
    assert.equal(row.props.disabled, true, `${row.props['data-stage']} 行在投影缺失时必须禁用`)
  }
})

test('绑定态：project-dev-flow 投影下阶段行可点且插入首行命令', () => {
  const harness = createHarness({ preset: PRESET })
  const tree = openPanel(harness)
  const rows = stageRows(tree)
  assert.equal(rows.length, 5, '必须渲染五个阶段技能行')
  for (const row of rows) {
    assert.equal(row.props.disabled, false, `${row.props['data-stage']} 行在绑定态必须可点`)
  }
  click(stageRow(tree, 'intake'))
  assert.deepEqual(harness.calls.insertText,
    [[`${INTAKE} `, { start: 0, end: 0, draftRev: 7 }]],
    '绑定态点击 intake 必须写入首行命令')
  const footer = footerOf(harness.tree())
  assert.equal(footer.props['data-kind'], 'ok')
  assert.equal(textOf(footer), harness.dict.zh['footer.inserted'].replace('{cmd}', INTAKE))
  assertNeverSubmits(harness)
})

test('绑定态：投影为 null 或 undefined 时阶段行 disabled 且不插入', () => {
  for (const [name, useProjection] of [['null', () => null], ['undefined', () => undefined]]) {
    const harness = createHarness({ hostProps: { useProjection } })
    const tree = openPanel(harness)
    const rows = stageRows(tree)
    assert.equal(rows.length, 5)
    for (const row of rows) {
      assert.equal(row.props.disabled, true, `${name} 投影下 ${row.props['data-stage']} 行必须 disabled`)
    }
    // 即使把 click 直接交给处理器（真实浏览器不会派发给 disabled 按钮），内部守卫也必须拒绝插入。
    click(stageRow(tree, 'intake'))
    assert.equal(harness.calls.insertText.length, 0, `${name} 投影下不得调用 insertText`)
    assertNeverSubmits(harness)
  }
})

test('插入手势：空草稿（含纯空白）在首行插入 “/project-intake ”', () => {
  for (const draft of ['', '   ']) {
    const harness = createHarness({ draft, preset: PRESET })
    const tree = openPanel(harness)
    click(stageRow(tree, 'intake'))
    assert.deepEqual(harness.calls.insertText,
      [[`${INTAKE} `, { start: 0, end: 0, draftRev: 7 }]],
      `草稿 ${JSON.stringify(draft)} 必须插入带尾随空格的命令`)
    assertNeverSubmits(harness)
  }
})

test('插入手势：非空草稿插入命令后换行，原文整体后移', () => {
  const draft = '请按阶段推进'
  const harness = createHarness({ draft, preset: PRESET })
  const tree = openPanel(harness)
  click(stageRow(tree, 'intake'))
  assert.deepEqual(harness.calls.insertText,
    [[`${INTAKE}\n`, { start: 0, end: 0, draftRev: 7 }]],
    '非空草稿必须在 0 处插入命令 + 换行，原文本整体后移')
  assertNeverSubmits(harness)
})

test('插入手势：草稿已以 / 开头时不插入并在 footer 报错', () => {
  for (const draft of ['/project-docs 写文档', '   /project-docs 写文档']) {
    const harness = createHarness({ draft, preset: PRESET })
    const tree = openPanel(harness)
    click(stageRow(tree, 'intake'))
    assert.equal(harness.calls.insertText.length, 0, '草稿已有命令时不得调用 insertText')
    const footer = footerOf(harness.tree())
    assert.ok(footer, '拒绝插入后必须有 footer 提示')
    assert.equal(footer.props['data-kind'], 'warn')
    assert.equal(textOf(footer), harness.dict.zh['footer.hasCommand'], 'footer 必须提示先清空输入框')
    assertNeverSubmits(harness)
  }
})

test('新建会话：blank 会话草稿非空时 options 只含 agentPreset', () => {
  const draft = '把本次需求落成流程'
  const harness = createHarness({ draft, blank: true, preset: PRESET })
  const tree = openPanel(harness)
  assert.equal(textOf(byClass(tree, 'pdflow-newbt')), harness.dict.zh['new.row.keep'],
    'blank 会话必须提供“原地启用”入口')
  confirmCreate(harness)
  assert.equal(harness.calls.startSession.length, 1)
  const [call] = harness.calls.startSession
  assert.equal(call.workspaceId, 'w1')
  assert.deepEqual(Object.keys(call.options), ['agentPreset'], 'blank 会话不得把草稿再写一遍')
  assert.equal(call.options.agentPreset, PRESET)
  assertNeverSubmits(harness)
})

test('新建会话：非 blank 且草稿非空时传 prompt 与 whenDraftExists=append', () => {
  const draft = '把本次需求落成流程'
  const harness = createHarness({ draft, blank: false, preset: PRESET })
  openPanel(harness)
  confirmCreate(harness)
  assert.equal(harness.calls.startSession.length, 1)
  const [call] = harness.calls.startSession
  assert.equal(call.workspaceId, 'w1')
  assert.deepEqual(call.options, {
    agentPreset: PRESET,
    prompt: draft,
    whenDraftExists: 'append'
  }, '非 blank 会话必须带 prompt，并声明 whenDraftExists=append')
  assertNeverSubmits(harness)
})

test('新建会话：草稿为空时不传 prompt', () => {
  const harness = createHarness({ draft: '', blank: false, preset: PRESET })
  openPanel(harness)
  confirmCreate(harness)
  assert.equal(harness.calls.startSession.length, 1)
  const options = harness.calls.startSession[0].options
  assert.deepEqual(Object.keys(options), ['agentPreset'], '空草稿只传 agentPreset')
  assert.equal(Object.hasOwn(options, 'prompt'), false)
  assert.equal(Object.hasOwn(options, 'whenDraftExists'), false)
  assertNeverSubmits(harness)
})

test('硬约束：client.js 没有 .submit( / .setDraft( / agentPresets 调用', () => {
  assert.equal(/\.submit\s*\(/.test(SOURCE), false, 'client.js 不得调用 .submit(')
  assert.equal(/\.setDraft\s*\(/.test(SOURCE), false, 'client.js 不得调用 .setDraft(')

  // 注释里允许出现这些字样：先剥掉块注释，再对代码区做更精确的断言。
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.equal(/agentPresets/.test(code), false, '代码区不得出现 agentPresets')
  assert.equal(/agentPresets\s*(?:\?\.|\.|\[)/.test(code), false,
    '代码区不得通过属性/索引访问 agentPresets')
  assert.equal(/\.submit\s*\(/.test(code), false)
  assert.equal(/\.setDraft\s*\(/.test(code), false)
})
