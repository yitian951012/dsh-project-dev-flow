import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { buildBoard } from './scripts/import-board.mjs'
import { scaffoldDocs } from './scripts/scaffold-docs.mjs'
import { mergeProjects, readRegistry, registryPath, uniqueProjectId, writeRegistry } from './scripts/project-registry.mjs'

export const name = '@yitian951012/dsh-project-dev-flow'
export const inject = ['tools']

const DEFAULT_DOCS = 'docs'
const DEFAULT_BOARD = join('.dsh', 'project-board', 'board.json')
const OPEN_LIMIT = 40

/** 项目注册表归一化：只认绝对路径；重复 id / 相对路径都变成可读错误，不抛。 */
export function normalizeProjects(config) {
  const raw = Array.isArray(config?.projects) ? config.projects : []
  const errors = []
  const seen = new Set()
  const projects = []

  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index]
    if (!entry || typeof entry !== 'object') {
      errors.push({ index, code: 'invalid_entry', message: '项目条目不是对象' })
      continue
    }
    const rawRoot = typeof entry.root === 'string' ? entry.root.trim() : ''
    if (!rawRoot) { errors.push({ index, code: 'missing_root', message: '缺少 root（项目绝对路径）' }); continue }
    if (!isAbsolute(rawRoot)) {
      errors.push({ index, code: 'relative_root', message: `root 不是绝对路径：${rawRoot}` })
      continue
    }

    const absRoot = resolve(rawRoot)
    // id 可从目录名派生：配置里就不必写 `- id:` 行（patch 校验器会把任意缩进的 `- id:` 当插件项）。
    const derived = absRoot.split(/[\\/]/).pop() || `project-${index}`
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : derived
    if (seen.has(id)) { errors.push({ index, code: 'duplicate_id', message: `项目 id 重复：${id}` }); continue }
    seen.add(id)

    const docs = typeof entry.docs === 'string' && entry.docs.trim()
      ? resolve(isAbsolute(entry.docs) ? entry.docs : join(absRoot, entry.docs))
      : resolve(absRoot, DEFAULT_DOCS)
    const board = typeof entry.board === 'string' && entry.board.trim()
      ? resolve(isAbsolute(entry.board) ? entry.board : join(absRoot, entry.board))
      : resolve(absRoot, DEFAULT_BOARD)

    projects.push({
      id,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : derived,
      root: absRoot,
      docs,
      board
    })
  }

  return { projects, errors, fallbackToWorkspace: config?.fallbackToWorkspace !== false }
}

export function resolveProject(config, idOrRoot) {
  const normalized = normalizeProjects(config)
  if (!idOrRoot) return { ok: false, code: 'missing_project', message: '缺少 project 参数' }
  const hit = normalized.projects.find((p) => p.id === idOrRoot)
    ?? normalized.projects.find((p) => resolve(p.root) === resolve(String(idOrRoot)))
  if (!hit) {
    return {
      ok: false,
      code: 'unknown_project',
      message: `没有配置这个项目：${idOrRoot}`,
      hint: '在插件设置的 projects 里加一条 { id, root }，root 用绝对路径'
    }
  }
  return { ok: true, project: hit }
}

function readBoardFile(file) {
  if (!existsSync(file)) return { ok: false, code: 'no_board', file }
  let board
  try {
    board = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { ok: false, code: 'schema_error', message: `board.json 无法解析：${String(error?.message ?? error)}`, file }
  }
  if (board?.schemaVersion !== 1 || !Array.isArray(board.items)) {
    return { ok: false, code: 'schema_error', message: 'board.json 的 schemaVersion 不是 1，或 items 缺失', file }
  }
  return { ok: true, board, file }
}

/** 兼容旧调用：按 root 推导默认 board 路径。 */
export function readBoard(root) {
  if (typeof root !== 'string' || root.length === 0) {
    return { ok: false, code: 'missing_root', message: 'workspace 必须是工作区根目录的绝对路径' }
  }
  const abs = resolve(root)
  const read = readBoardFile(join(abs, DEFAULT_BOARD))
  if (read.ok) return read
  if (read.code === 'no_board') {
    return { ...read, message: `没有看板数据：${DEFAULT_BOARD} 不存在`, hint: `先跑：node scripts/import-board.mjs --root "${abs}"` }
  }
  return read
}

export function summarizeBoard(board) {
  const items = board.items
  const open = items.filter((i) => (i.overlay?.lane ?? i.derived?.lane) !== 'done' && i.kind !== 'stage' && i.kind !== 'gate')
  const lanes = {}
  for (const it of items) {
    const lane = it.overlay?.lane ?? it.derived?.lane ?? 'todo'
    lanes[lane] = (lanes[lane] ?? 0) + 1
  }
  return {
    schemaVersion: board.schemaVersion,
    rev: board.rev ?? 0,
    sourceSha: board.source?.sha ?? '',
    counts: { total: items.length, lanes },
    groups: board.groups ?? [],
    open: open.slice(0, OPEN_LIMIT).map((it) => ({
      id: it.id,
      kind: it.kind,
      title: it.title,
      lane: it.overlay?.lane ?? it.derived?.lane,
      status: it.derived?.status,
      anchor: it.anchor
    })),
    truncated: open.length > OPEN_LIMIT
  }
}

/** 每个项目的轻量汇总：只读 board 头，按 (mtime, size) 缓存，避免 N 个项目反复读盘。 */
export function createProjectCatalog(config) {
  // config 可以是对象，也可以是“每次现算”的 provider：绑定成功后新项目要立刻可见，不依赖宿主重载。
  const configOf = typeof config === 'function' ? config : () => config
  const cache = new Map()
  const snapshot = () => normalizeProjects(configOf())

  const summaryOf = (project) => {
    let stamp = '0:0'
    try {
      const st = statSync(project.board)
      stamp = `${st.mtimeMs}:${st.size}`
    } catch { /* 文件不存在，走可用性判断 */ }
    const hit = cache.get(project.board)
    if (hit && hit.stamp === stamp) return hit.value

    const read = readBoardFile(project.board)
    const value = read.ok
      ? {
          id: project.id,
          name: project.name,
          root: project.root,
          available: true,
          rev: read.board.rev ?? 0,
          counts: summarizeBoard(read.board).counts,
          groups: read.board.groups ?? []
        }
      : {
          id: project.id,
          name: project.name,
          root: project.root,
          available: false,
          code: read.code,
          message: read.code === 'no_board'
            ? `该项目还没有看板数据（${DEFAULT_BOARD}）`
            : read.message,
          hint: `node scripts/import-board.mjs --root "${project.root}"`
        }
    cache.set(project.board, { stamp, value })
    return value
  }

  const projects = () => {
    const normalized = snapshot()
    const raw = configOf()
    return {
      ok: true,
      fallbackToWorkspace: normalized.fallbackToWorkspace,
      configured: normalized.projects.length,
      // 宿主是否真的把 patch 行的 config 传进来了：0 个项目时要能区分「没配」和「没读到」。
      configReceived: Boolean(raw && typeof raw === 'object' && Object.keys(raw).length > 0),
      projects: normalized.projects.map(summaryOf),
      errors: normalized.errors
    }
  }

  const find = (id) => snapshot().projects.find((p) => p.id === id)

  return {
    get normalized() { return snapshot() },
    projects,
    find,
    summaryOf,
    cache
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(payload))
}

/** 只读路由：/project-board/projects 与 /project-board/board?project=|root= */
export function createBoardRoutes(config, runtime = {}) {
  // 单一事实源：注册表文件；config.projects 只当“手写默认”，合并时优先。
  const base = config && typeof config === 'object' ? config : {}
  const configNow = () => {
    const reg = readRegistry(registryPath(runtime))
    return {
      ...base,
      projects: mergeProjects(Array.isArray(base.projects) ? base.projects : [], reg.projects)
    }
  }
  const catalog = createProjectCatalog(configNow)

  const boardHandler = (request, response) => {
    const url = new URL(request?.url ?? '/', 'http://127.0.0.1')
    const projectId = url.searchParams.get('project')
    const root = url.searchParams.get('root')

    let project = null
    if (projectId) {
      project = catalog.find(projectId)
      if (!project) {
        sendJson(response, 404, { ok: false, code: 'unknown_project', message: `没有配置这个项目：${projectId}` })
        return
      }
    } else if (!root) {
      sendJson(response, 400, { ok: false, code: 'missing_project', message: '需要 project 或 root 参数' })
      return
    }

    const read = project ? readBoardFile(project.board) : readBoard(root)
    if (!read.ok) {
      sendJson(response, read.code === 'no_board' ? 404 : 400, read.ok ? read : { ok: false, ...read })
      return
    }
    sendJson(response, 200, { ok: true, board: read.board })
  }

  const projectsHandler = (request, response) => sendJson(response, 200, catalog.projects())

  /** 绑定前校验：纯函数，路由与单测共用。 */
  const validateBind = (input) => {
    const errors = []
    const root = typeof input?.root === 'string' ? input.root.trim() : ''
    if (!root) errors.push('项目根目录必填')
    else if (!isAbsolute(root)) errors.push('项目根目录必须是绝对路径')
    const absRoot = root && isAbsolute(root) ? resolve(root) : ''
    let isDir = false
    if (absRoot) { try { isDir = statSync(absRoot).isDirectory() } catch { isDir = false } }
    if (absRoot && !isDir) errors.push(`路径不存在或不是目录：${absRoot}`)

    const docs = absRoot ? resolve(absRoot, input?.docs ? String(input.docs) : DEFAULT_DOCS) : ''
    const docsOk = isDir && docs !== '' && existsSync(docs)
    const scaffold = input?.scaffold !== false
    // 允许铺底稿时，“目录不存在”不是错误而是待创建：UI 会显示将创建几份文档。
    if (isDir && !docsOk && !scaffold) errors.push(`文档目录不存在：${docs}`)

    const existing = catalog.normalized.projects
    if (absRoot && existing.some((p) => resolve(p.root) === absRoot)) errors.push('该路径已绑定')
    const derivedName = absRoot ? (absRoot.split(/[\\/]/).pop() || '') : ''
    const name = typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : derivedName
    const id = typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : derivedName
    if (id && existing.some((p) => p.id === id)) errors.push(`项目 id 冲突：${id}`)

    let preview = null
    if (docsOk) {
      const built = buildBoard(absRoot, { docs })
      preview = built.body
        ? { items: built.body.items.length, roles: built.docs.map((d) => d.role), skippedTables: built.skipped.length }
        : { items: 0, error: built.error }
    }

    return {
      ok: errors.length === 0,
      errors,
      docsMissing: isDir && !docsOk,
      scaffold,
      project: errors.length === 0 ? { id, name, root: absRoot, docs, board: resolve(absRoot, DEFAULT_BOARD) } : null,
      preview
    }
  }

  const snippetFor = (project) => [
    '# 可选：手写默认（面板绑定会自动写入 profile 的 plugin-data 注册表）',
    '- id: project-dev-flow-board',
    "  name: '@yitian951012/dsh-project-dev-flow'",
    '  config:',
    '    projects:',
    `      - root: ${project.root.replace(/\\/g, '/')}`,
    `        name: ${project.name}`
  ].join('\n')

  const readBody = (request) => new Promise((resolveBody) => {
    if (typeof request?.on !== 'function') { resolveBody(null); return }
    let raw = ''
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      try { resolveBody(JSON.parse(raw || '{}')) } catch { resolveBody(null) }
    })
  })

  const validateHandler = async (request, response) => {
    const body = await readBody(request)
    if (!body) { sendJson(response, 400, { ok: false, code: 'bad_body', message: '请求体不是合法 JSON' }); return }
    const result = validateBind(body)
    sendJson(response, result.ok ? 200 : 422, result)
  }

  const bindHandler = async (request, response) => {
    const body = await readBody(request)
    if (!body) { sendJson(response, 400, { ok: false, code: 'bad_body', message: '请求体不是合法 JSON' }); return }
    const result = validateBind(body)
    if (!result.ok) { sendJson(response, 422, result); return }

    // 缺文档目录且允许铺底：先建 5 份基础台账（不覆盖已有），再按真实文件重算预览。
    let scaffolded = []
    if (result.docsMissing) {
      const made = scaffoldDocs(result.project.root, { docs: result.project.docs, write: true })
      scaffolded = made.created
      const again = validateBind({ ...body, docs: result.project.docs, scaffold: false })
      if (!again.ok) { sendJson(response, 422, { ok: false, errors: again.errors, scaffolded }); return }
      result.preview = again.preview
    }

    const snippet = snippetFor(result.project)
    const file = registryPath(runtime)
    const reg = readRegistry(file)
    if (reg.error) {
      sendJson(response, 500, { ok: false, code: 'registry_corrupt', message: reg.error, snippet })
      return
    }
    const merged = mergeProjects(Array.isArray(base.projects) ? base.projects : [], reg.projects)
    if (merged.some((p) => resolve(p.root) === result.project.root)) {
      sendJson(response, 409, { ok: false, code: 'already_bound', message: '该路径已在注册表中', snippet })
      return
    }
    const entry = {
      id: uniqueProjectId(merged, result.project.id),
      name: result.project.name,
      root: result.project.root,
      docs: result.project.docs
    }
    try {
      await writeRegistry(file, [...reg.projects, entry])
    } catch (error) {
      sendJson(response, 500, { ok: false, code: 'persist_failed', message: String(error?.message ?? error), snippet })
      return
    }
    const after = catalog.projects().projects.find((p) => p.root === result.project.root)
    sendJson(response, 200, {
      ok: true,
      via: 'registry',
      registryPath: file,
      project: { ...result.project, id: after ? after.id : entry.id },
      preview: result.preview,
      scaffolded
    })
  }

  /** 绑定后的“导入”：只在项目侧写 .dsh/project-board/board.json，不动 docs。 */
  const importHandler = async (request, response) => {
    const body = await readBody(request)
    if (!body) { sendJson(response, 400, { ok: false, code: 'bad_body', message: '请求体不是合法 JSON' }); return }
    const project = body.project ? catalog.find(body.project) : null
    const root = project ? project.root : (typeof body.root === 'string' ? body.root : '')
    if (!root || !isAbsolute(root)) { sendJson(response, 400, { ok: false, code: 'missing_root', message: '需要项目根目录绝对路径' }); return }
    const built = buildBoard(resolve(root), { docs: project?.docs })
    if (!built.body) { sendJson(response, 422, { ok: false, code: 'no_docs', message: built.error || '无法派生' }); return }
    const out = project?.board ?? resolve(root, DEFAULT_BOARD)
    try {
      mkdirSync(dirname(out), { recursive: true })
      const tmp = `${out}.tmp`
      writeFileSync(tmp, `${JSON.stringify({ ...built.body, rev: 1, journal: [] }, null, 2)}\n`)
      renameSync(tmp, out)
    } catch (error) {
      sendJson(response, 500, { ok: false, code: 'write_failed', message: String(error?.message ?? error) })
      return
    }
    sendJson(response, 200, { ok: true, items: built.body.items.length, path: out })
  }

  return {
    catalog,
    get normalized() { return catalog.normalized },
    boardHandler, projectsHandler, validateHandler, bindHandler, importHandler, validateBind, snippetFor
  }
}

/** 兼容旧测试与旧调用：只按 root 解析。 */
export function boardRouteHandler(request, response) {
  return createBoardRoutes({}).boardHandler(request, response)
}

export function apply(ctx, config) {
  const runtime = {}
  const routes = createBoardRoutes(config, runtime)

  ctx.effect(() => {
    const offTool = ctx.tools.register({
      name: 'project_board',
      description: '只读项目进度看板：按配置好的项目列出指标与任务。不写盘、不改 docs。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['list', 'projects'], description: 'projects 列出已配置项目；list 返回某个项目的摘要' },
          project: { type: 'string', description: '项目 id（在插件配置 projects[].id 里定义）' },
          workspace: { type: 'string', description: '绝对路径；未配置项目时可直接指定工作区根目录' }
        }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: { ok: { type: 'boolean' }, code: { type: 'string' }, message: { type: 'string' } }
        },
        render(_args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        }
      },
      async execute(args) {
        if (args?.action === 'projects') return routes.catalog.projects()
        if (args?.action !== 'list') {
          return { ok: false, code: 'unsupported_action', message: '3.0.0 支持 action=list|projects' }
        }
        if (args?.project) {
          const project = routes.catalog.find(args.project)
          if (!project) return { ok: false, code: 'unknown_project', message: `没有配置这个项目：${args.project}` }
          const read = readBoardFile(project.board)
          if (!read.ok) return { ok: false, projectId: project.id, ...read }
          return { ok: true, projectId: project.id, ...summarizeBoard(read.board) }
        }
        if (args?.workspace) {
          const read = readBoard(args.workspace)
          if (!read.ok) return read
          return { ok: true, ...summarizeBoard(read.board) }
        }
        const first = routes.normalized.projects[0]
        if (!first) {
          return { ok: false, code: 'no_projects', message: '还没有配置项目', hint: '在插件配置里加 projects: [{ id, root }]，root 用绝对路径' }
        }
        const read = readBoardFile(first.board)
        if (!read.ok) return { ok: false, projectId: first.id, ...read }
        return { ok: true, projectId: first.id, ...summarizeBoard(read.board) }
      }
    })
    return () => { try { offTool?.() } catch { /* 卸载期忽略 */ } }
  })

  ctx.inject(['webServer'], (hostCtx) => {
    runtime.ctx = hostCtx
    hostCtx.effect(() => {
      const disposers = []
      const mount = (path, handler) => {
        try {
          const off = hostCtx.webServer.register({ kind: 'exact', path, handler })
          if (typeof off === 'function') disposers.push(off)
        } catch { /* 单个路由失败不影响其他 */ }
      }
      mount('/project-board/projects', routes.projectsHandler)
      mount('/project-board/board', routes.boardHandler)
      mount('/project-board/validate', routes.validateHandler)
      mount('/project-board/bind', routes.bindHandler)
      mount('/project-board/import', routes.importHandler)
      return () => { for (const off of disposers.reverse()) { try { off?.() } catch { /* 卸载期忽略 */ } } }
    })
  })
}
