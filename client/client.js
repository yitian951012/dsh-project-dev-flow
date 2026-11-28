window.__ModuleLoader__.load({
  id: '@yitian951012/dsh-project-dev-flow',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement

    const PANEL_KEY = 'project-board'
    const NS = 'project-dev-flow'

    // 选择器身份必须稳定：每次渲染新建 (s)=>s 会击穿宿主快照缓存（useSyncExternalStore 契约）。
    const SELECT_SNAPSHOT = (snapshot) => snapshot

    /* ------------------------------------------------------------------ *
     * 安全取值：面板任何一条数据都可能残缺，取值一律不抛。
     * ------------------------------------------------------------------ */
    const arr = (value) => (Array.isArray(value) ? value : [])
    const obj = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})
    const text = (value, fallback) => {
      if (typeof value === 'string') return value
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
      return typeof fallback === 'string' ? fallback : ''
    }
    const num = (value, fallback) => {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : (typeof fallback === 'number' ? fallback : 0)
    }

    const pathOf = (workspace) => text(workspace && (workspace.path || workspace.dir || workspace.root))

    function pickWorkspace(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return null
      const list = arr(snapshot.workspaces || snapshot.items)
      const activeId = snapshot.activeWorkspaceId || snapshot.activeId || snapshot.active
      if (activeId) {
        const hit = list.find((w) => w && (w.workspaceId === activeId || w.id === activeId))
        if (hit) return hit
      }
      return list.length === 1 ? list[0] : null
    }

    /* ------------------------------------------------------------------ *
     * 裸 fetch：路由相对 document.baseURI 解析，规避宿主 fetch 包装差异。
     * ------------------------------------------------------------------ */
    const baseUrl = (path, params) => {
      const url = new URL(String(path || '').replace(/^\/+/, ''), document.baseURI)
      for (const [key, value] of Object.entries(params || {})) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
      }
      return url.toString()
    }

    const getJson = async (url, signal) => {
      const res = await fetch(url, { signal, cache: 'no-store' })
      if (!res.ok) {
        const error = new Error(res.status === 401 || res.status === 403
          ? '宿主鉴权拒绝：当前页面不是已登录会话'
          : `取数失败：HTTP ${res.status}`)
        error.status = res.status
        throw error
      }
      try {
        return await res.json()
      } catch {
        throw new Error('响应不是 JSON（路由未注册，或返回了页面）')
      }
    }

    /** 一律返回解析后的 body：非 2xx 时也要能读到 errors / snippet。 */
    const postJson = async (path, payload) => {
      const res = await fetch(baseUrl(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
        cache: 'no-store'
      })
      let body = null
      try {
        body = await res.json()
      } catch {
        body = null
      }
      const parsed = obj(body)
      return {
        status: res.status,
        ok: Boolean(res.ok) && parsed.ok !== false,
        body: parsed
      }
    }

    /* ------------------------------------------------------------------ *
     * 数据词汇：动画/文案全部中文，颜色只用 --dsw-alias-* token。
     * ------------------------------------------------------------------ */
    const KIND_LABEL = { stage: '阶段', gate: '门禁', wbs: 'WBS', decision: '裁决', task: '任务', issue: '缺口', next: '下一步' }
    const ROLE_LABEL = { status: '状态', wbs: 'WBS', decisions: '裁决', issues: '缺口', next: '下一步' }
    const STATUS_LABEL = { done: '已完成', partial: '部分就绪', missing: '缺失', hold: '搁置', unknown: '待确认' }
    const STATUS_TAG = { done: '✅', partial: '🟡', missing: '⚠', hold: '⏸', unknown: '' }
    const LANE_COLUMNS = [
      { id: 'todo', label: '待办', note: '可开工' },
      { id: 'blocked', label: '阻塞', note: '等条件' },
      { id: 'decision', label: '待裁决', note: '等人拍板' }
    ]
    // 固定 8 阶段 + 2 门禁只是回退模板：看板带 kind=stage/gate 节点卡时，
    // 行集合、行序、行头标题都以卡片为准（见 deriveNodeRows）。
    const STAGE_ROWS = [
      { id: 'STAGE-1', no: '01', title: '市场与竞品调研' },
      { id: 'STAGE-2', no: '02', title: '需求规格 PRD' },
      { id: 'GATE-1', no: 'G1', title: '需求定稿确认', gate: true },
      { id: 'STAGE-3', no: '03', title: '产品与交互设计' },
      { id: 'STAGE-4', no: '04', title: '系统架构与技术选型' },
      { id: 'GATE-2', no: 'G2', title: '架构定稿确认', gate: true },
      { id: 'STAGE-5', no: '05', title: '模块化敏捷开发' },
      { id: 'STAGE-6', no: '06', title: '测试与质量验证' },
      { id: 'STAGE-7', no: '07', title: '打包部署与交付' },
      { id: 'STAGE-8', no: '08', title: '运维监控与知识沉淀' }
    ]
    const UNASSIGNED_ID = '__unassigned__'
    const DOT_TONES = {
      ok: 'var(--dsw-alias-state-success-primary)',
      err: 'var(--dsw-alias-state-error-primary)',
      blocked: 'var(--dsw-alias-state-error-primary)',
      decision: 'var(--dsw-alias-brand-primary)',
      brand: 'var(--dsw-alias-brand-primary)',
      todo: 'var(--dsw-alias-label-secondary)',
      mute: 'var(--dsw-alias-label-secondary)'
    }

    /** 行 = 流程节点（优先由节点卡派生，缺卡时回退固定模板）；列 = 三态；卡只进这三个列，done 只计入行内张数。 */
    function laneOf(item) {
      const raw = text(obj(item.overlay).lane) || text(obj(item.derived).lane) || text(item.lane) || 'todo'
      const lane = raw.trim().toLowerCase()
      if (lane === 'blocked' || lane === 'hold' || raw === '阻塞' || raw === '搁置') return 'blocked'
      if (lane === 'decision' || raw === '待裁决' || raw === '裁决') return 'decision'
      if (lane === 'done' || raw === '已完成' || raw === '完成') return 'done'
      return 'todo' // todo / doing / verify 都归“待办（含进行中）”，不另立列
    }

    function stageOf(item) {
      const raw = text(obj(item.derived).stage) || text(item.stage) || text(obj(item.extra).stage)
      return raw.trim().toUpperCase()
    }

    /** 节点卡锚点：同一份文档内 anchor.line 升序即流程顺序，跨文档的行号不可比。 */
    function anchorOf(item) {
      const anchor = obj(item.anchor)
      const raw = anchor.line
      const parsed = raw === null || raw === undefined || raw === '' ? NaN : Number(raw)
      return { doc: text(anchor.doc), line: Number.isFinite(parsed) ? parsed : null }
    }

    /** 行头编号（01…06 / G1…G2）：取 id 末位数字，缺失时退回占位符。 */
    function rowNoOf(id, gate) {
      const hit = /(\d+)\s*$/.exec(text(id))
      if (!hit) return gate ? 'G' : '—'
      const digits = String(Number(hit[1]))
      return gate ? `G${digits}` : digits.padStart(2, '0')
    }

    /**
     * 行集合优先从节点卡派生：id/title 用卡片，同一 anchor.doc 内按 anchor.line 升序。
     * 跨文档行号不可比，故以“节点最多的文档”为主序列，其余文档整体排在主文档之后。
     * 没有节点卡时返回 null，由调用方回退 STAGE_ROWS。
     */
    function deriveNodeRows(entries) {
      if (entries.length === 0) return null
      const docCount = new Map()
      for (const entry of entries) {
        const doc = entry.anchor.doc
        docCount.set(doc, (docCount.get(doc) || 0) + 1)
      }
      let primaryDoc = ''
      let primaryCount = -1
      for (const [doc, count] of docCount) {
        if (count > primaryCount) { primaryDoc = doc; primaryCount = count }
      }
      const docRank = new Map([[primaryDoc, 0]])
      for (const entry of entries) {
        const doc = entry.anchor.doc
        if (docRank.has(doc)) continue
        docRank.set(doc, docRank.size)
      }
      const ordered = entries.slice().sort((a, b) => {
        const rankA = docRank.get(a.anchor.doc) || 0
        const rankB = docRank.get(b.anchor.doc) || 0
        if (rankA !== rankB) return rankA - rankB
        const lineA = a.anchor.line === null ? Infinity : a.anchor.line
        const lineB = b.anchor.line === null ? Infinity : b.anchor.line
        if (lineA !== lineB) return lineA - lineB
        return a.index - b.index
      })
      return ordered.map((entry) => ({
        id: entry.id,
        no: rowNoOf(entry.id, entry.kind === 'gate'),
        title: text(entry.item.title) || entry.id,
        gate: entry.kind === 'gate'
      }))
    }

    function buildMatrix(items) {
      const bucket = () => ({ todo: [], blocked: [], decision: [], total: 0 })
      // 节点卡只贡献行与行头状态，不作为卡片计入任何列（原行为不变）。
      const nodeEntries = new Map()
      for (const raw of arr(items)) {
        const item = obj(raw)
        const kind = text(item.kind)
        if (kind !== 'stage' && kind !== 'gate') continue
        const id = text(item.id).trim().toUpperCase()
        if (!id) continue
        const existing = nodeEntries.get(id)
        if (existing) {
          // 同 id 重复时只保留一行：首次出现的 anchor 决定行序（位置稳定），
          // 最后一张卡只提供展示数据（item/kind → 标题、状态、门禁样式）。
          existing.item = item
          existing.kind = kind
          continue
        }
        nodeEntries.set(id, { id, kind, item, anchor: anchorOf(item), index: nodeEntries.size })
      }
      const derived = deriveNodeRows([...nodeEntries.values()])
      const rows = derived || STAGE_ROWS
      const nodes = new Map()
      for (const entry of nodeEntries.values()) nodes.set(entry.id, entry.item)
      const byRow = new Map()
      for (const row of rows) byRow.set(row.id, bucket())
      const unassigned = bucket()
      for (const raw of arr(items)) {
        const item = obj(raw)
        const kind = text(item.kind)
        if (kind === 'stage' || kind === 'gate') continue
        const stage = stageOf(item)
        const target = stage && byRow.has(stage) ? byRow.get(stage) : unassigned
        target.total += 1
        const lane = laneOf(item)
        if (lane === 'blocked') target.blocked.push(item)
        else if (lane === 'decision') target.decision.push(item)
        else if (lane === 'todo') target.todo.push(item)
      }
      const stageCount = rows.reduce((count, row) => count + (row.gate ? 0 : 1), 0)
      return { rows, nodes, byRow, unassigned, stageCount, gateCount: rows.length - stageCount }
    }

    /* ------------------------------------------------------------------ *
     * 样式：只用 --dsw-alias-* 语义 token，不写死色值。
     * ------------------------------------------------------------------ */
    const STYLES = [
      '.pbp-root{position:relative;height:100%;display:flex;flex-direction:column;gap:12px;padding:16px 20px 18px;',
      'background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);overflow:auto;',
      'font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}',
      '.pbp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}',
      '.pbp-h1{font-size:19px;font-weight:650;line-height:1.3}',
      '.pbp-h2{font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary)}',
      '.pbp-sub{margin-top:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.pbp-acts{display:flex;align-items:center;gap:8px;flex:none}',
      '.pbp-picker{position:relative}',
      '.pbp-pbtn{display:flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l2);',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;',
      'padding:6px 10px;font:inherit;font-size:12px;min-width:260px;max-width:min(440px,64vw);cursor:pointer}',
      '.pbp-pname{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pbp-ppath{margin-left:auto;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      'font:10.5px/1.2 ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-secondary)}',
      '.pbp-cv{color:var(--dsw-alias-label-secondary);font-size:10px}',
      '.pbp-dot{width:7px;height:7px;border-radius:50%;flex:none;display:inline-block}',
      '.pbp-menu{position:absolute;right:0;top:calc(100% + 6px);width:420px;max-width:min(420px,86vw);',
      'background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;',
      'overflow:hidden;z-index:5}',
      '.pbp-menu[data-open=false]{display:none}',
      '.pbp-mhead{padding:8px 12px 6px;font-size:10.5px;color:var(--dsw-alias-label-secondary);',
      'border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.pbp-mitem{display:flex;align-items:flex-start;gap:8px;width:100%;padding:9px 12px;text-align:left;',
      'background:transparent;border:0;border-top:1px solid var(--dsw-alias-border-l1);color:inherit;',
      'font:inherit;cursor:pointer}',
      '.pbp-mitem:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.pbp-mitem[data-on=true]{background:var(--dsw-alias-bg-layer-2)}',
      '.pbp-mbody{min-width:0;flex:1}',
      '.pbp-mname{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600}',
      '.pbp-tick{color:var(--dsw-alias-brand-primary);font-size:11px}',
      '.pbp-badge{font-size:9.5px;font-weight:500;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;',
      'padding:0 4px;color:var(--dsw-alias-state-error-primary)}',
      '.pbp-mpath{font:10px/1.3 ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-secondary);',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.pbp-mmetrics{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none}',
      '.pbp-mempty{padding:10px 12px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.pbp-newitem{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:10px 12px;',
      'border:0;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);',
      'color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer}',
      '.pbp-kbd{margin-left:auto;font-size:9.5px;color:var(--dsw-alias-label-secondary)}',
      '.pbp-vstack{display:flex;flex-direction:column;gap:8px;min-width:0}',
      '.pbp-matrix{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;',
      'background:var(--dsw-alias-bg-layer-1)}',
      '.pbp-mrowhead{display:grid;grid-template-columns:210px repeat(3,minmax(0,1fr));',
      'border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.pbp-ch{display:flex;align-items:center;gap:6px;padding:8px 12px;font-size:11.5px;',
      'color:var(--dsw-alias-label-secondary);border-left:1px solid var(--dsw-alias-border-l1);min-width:0}',
      '.pbp-ch[data-first=true]{border-left:0}',
      '.pbp-chnote{font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.pbp-row{display:grid;grid-template-columns:210px repeat(3,minmax(0,1fr));',
      'border-top:1px solid var(--dsw-alias-border-l1);min-height:74px}',
      '.pbp-row[data-gate=true]{background:var(--dsw-alias-bg-layer-2)}',
      '.pbp-row[data-unassigned=true]{border-top:1px dashed var(--dsw-alias-border-l2)}',
      '.pbp-node{display:flex;flex-direction:column;gap:3px;padding:9px 12px;min-width:0;',
      'border-right:1px solid var(--dsw-alias-border-l1)}',
      '.pbp-no{font:600 10px/1 ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-secondary)}',
      '.pbp-nm{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;line-height:1.3;min-width:0}',
      '.pbp-tag{font-size:9px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 4px;',
      'color:var(--dsw-alias-label-secondary);flex:none}',
      '.pbp-meta{font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.pbp-cell{display:flex;flex-direction:column;gap:6px;padding:7px 9px;min-width:0;',
      'border-left:1px solid var(--dsw-alias-border-l1)}',
      '.pbp-card{display:flex;flex-direction:column;gap:2px;padding:6px 8px;',
      'background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:7px}',
      '.pbp-card[data-tone=b]{border-left:2px solid var(--dsw-alias-state-error-primary)}',
      '.pbp-card[data-tone=v]{border-left:2px solid var(--dsw-alias-brand-primary)}',
      '.pbp-id{font:600 9.5px/1.4 ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-secondary);',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.pbp-ct{margin:0;font-size:11.5px;font-weight:600;line-height:1.32;display:-webkit-box;',
      '-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.pbp-more{align-self:flex-start;background:transparent;border:0;padding:1px 2px;font:inherit;',
      'font-size:10px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.pbp-none{padding:2px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.pbp-foot{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:10.5px;',
      'color:var(--dsw-alias-label-secondary)}',
      '.pbp-lg{display:inline-flex;align-items:center;gap:5px}',
      '.pbp-tip{margin-left:auto;flex:1;min-width:220px;text-align:right;font-size:10px}',
      '.pbp-groups{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:10.5px;',
      'color:var(--dsw-alias-label-secondary)}',
      '.pbp-gchip{border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:1px 6px;',
      'background:var(--dsw-alias-bg-layer-1)}',
      '.pbp-state{display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px 16px;',
      'border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;text-align:center}',
      '.pbp-empty{font-size:12.5px;font-weight:600}',
      '.pbp-hint{max-width:640px;font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.6}',
      '.pbp-note{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.pbp-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center}',
      '.pbp-btn{border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:5px 10px;',
      'font:inherit;font-size:11.5px;background:var(--dsw-alias-bg-layer-1);',
      'color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.pbp-btn[data-primary=true]{border-color:var(--dsw-alias-brand-primary);',
      'color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.pbp-btn:disabled{opacity:.55;cursor:not-allowed}',
      '.pbp-notice{font-size:11px;color:var(--dsw-alias-brand-primary)}',
      '.pbp-errs{font-size:10.5px;color:var(--dsw-alias-state-error-primary)}',
      '.pbp-overlay{position:absolute;inset:0;z-index:6;display:flex;align-items:flex-start;justify-content:center}',
      '.pbp-dim{position:absolute;inset:0;background:var(--dsw-alias-bg-base);opacity:.55}',
      '.pbp-modal{position:relative;margin-top:32px;width:min(560px,calc(100% - 24px));',
      'max-height:calc(100% - 64px);overflow:auto;background:var(--dsw-alias-bg-layer-1);',
      'border:1px solid var(--dsw-alias-border-l2);border-radius:12px;z-index:7}',
      '.pbp-mtop{padding:13px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.pbp-mtitle{font-size:15px;font-weight:650}',
      '.pbp-msub{margin-top:3px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.pbp-field{display:grid;grid-template-columns:96px minmax(0,1fr);gap:8px;align-items:center;',
      'padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.pbp-k{font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.pbp-k[data-req=true]{color:var(--dsw-alias-state-error-primary)}',
      '.pbp-rowin{display:flex;gap:6px;min-width:0}',
      '.pbp-inp{width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;',
      'background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);',
      'padding:6px 8px;font:11.5px/1.4 ui-monospace,Consolas,monospace}',
      '.pbp-inp:focus{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.pbp-tick{display:flex;align-items:center;gap:6px;font-size:11px;line-height:1.4;',
      'color:var(--dsw-alias-label-secondary)}',
      '.pbp-check{padding:9px 16px;display:flex;flex-direction:column;gap:5px;',
      'background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.pbp-checkline{display:flex;align-items:flex-start;gap:7px;font-size:11px;line-height:1.5;',
      'color:var(--dsw-alias-label-secondary)}',
      '.pbp-ok{color:var(--dsw-alias-state-success-primary)}',
      '.pbp-bad{color:var(--dsw-alias-state-error-primary)}',
      '.pbp-mute{color:var(--dsw-alias-label-secondary)}',
      '.pbp-snip{margin:0;padding:8px 16px;max-height:180px;overflow:auto;',
      'background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);',
      'font:10.5px/1.5 ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-secondary);',
      'white-space:pre-wrap;word-break:break-all}',
      '.pbp-mfoot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:11px 16px}',
      '.pbp-mnote{flex:1;min-width:180px;font-size:10px;line-height:1.5;color:var(--dsw-alias-label-secondary)}'
    ].join('')

    /* ------------------------------------------------------------------ *
     * 原子组件：全部无 hooks、无副作用，任何 props 都不抛。
     * ------------------------------------------------------------------ */
    function Dot(props) {
      const input = props || {}
      const color = DOT_TONES[text(input.tone, 'mute')] || DOT_TONES.mute
      return h('span', { className: 'pbp-dot', style: { background: color }, 'aria-hidden': 'true' })
    }

    function Card(props) {
      const input = obj(props)
      const item = obj(input.item)
      const kind = text(item.kind)
      const id = text(item.id, '—')
      const label = KIND_LABEL[kind] || kind || '记录'
      const lane = text(input.lane)
      const tone = lane === 'blocked' ? 'b' : (lane === 'decision' ? 'v' : '')
      const title = text(item.title) || text(obj(item.extra).note) || '（无标题）'
      return h('article', { className: 'pbp-card', 'data-tone': tone },
        h('span', { className: 'pbp-id' }, `${id} · ${label}`),
        h('h4', { className: 'pbp-ct' }, title))
    }

    function Cell(props) {
      const input = props || {}
      const list = arr(input.items)
      const expanded = obj(input.expanded)
      const cellKey = text(input.cellKey)
      const open = expanded[cellKey] === true
      const shown = open ? list : list.slice(0, 2)
      const hidden = Math.max(list.length - shown.length, 0)
      const onToggle = typeof input.onToggle === 'function' ? input.onToggle : null
      return h('div', { className: 'pbp-cell', role: 'cell' },
        shown.length === 0 ? h('span', { className: 'pbp-none' }, '无事项') : null,
        shown.map((it, index) => h(Card, { key: `${cellKey}-${index}`, item: it, lane: text(input.lane) })),
        list.length > 2
          ? h('button', {
              key: 'more',
              className: 'pbp-more',
              type: 'button',
              onClick: () => { if (onToggle) onToggle(cellKey) }
            }, open ? '收起' : `＋ ${hidden} 展开`)
          : null)
    }

    function StageRow(props) {
      const input = props || {}
      const row = obj(input.row)
      const node = input.node ? obj(input.node) : null
      const bucket = obj(input.bucket)
      const statusKey = node ? (text(obj(node.derived).status) || text(node.status) || 'unknown') : ''
      const title = (node && text(node.title)) || text(row.title, '未命名节点')
      // 手工 board 的派生状态可能是原型键（如 "__proto__"）：STATUS_TAG / STATUS_LABEL
      // 都只认自有键，避免把 Object.prototype 对象当 React 子节点或插进文案。
      const tag = Object.hasOwn(STATUS_TAG, statusKey) ? STATUS_TAG[statusKey] : ''
      const statusLabel = node
        ? (Object.hasOwn(STATUS_LABEL, statusKey) ? STATUS_LABEL[statusKey] : STATUS_LABEL.unknown)
        : '节点未建'
      const meta = row.unassigned
        ? `缺 stage 证据 · ${num(bucket.total)} 张卡`
        : `${statusLabel} · ${num(bucket.total)} 张卡`
      return h('div', {
        className: 'pbp-row',
        role: 'row',
        'data-gate': row.gate ? 'true' : 'false',
        'data-unassigned': row.unassigned ? 'true' : 'false'
      },
        h('div', { className: 'pbp-node' },
          h('span', { className: 'pbp-no' }, text(row.no, '—')),
          h('span', { className: 'pbp-nm' },
            h('span', null, title),
            tag ? h('span', { className: 'pbp-tag' }, tag) : null),
          h('span', { className: 'pbp-meta' }, meta)),
        LANE_COLUMNS.map((column) => h(Cell, {
          key: column.id,
          cellKey: `${text(row.id, 'row')}|${column.id}`,
          lane: column.id,
          items: arr(bucket[column.id]),
          expanded: input.expanded,
          onToggle: input.onToggle
        })))
    }

    function Matrix(props) {
      const input = props || {}
      const grid = obj(input.matrix)
      const nodes = grid.nodes instanceof Map ? grid.nodes : new Map()
      const byRow = grid.byRow instanceof Map ? grid.byRow : new Map()
      const unassigned = obj(grid.unassigned)
      const head = h('div', { className: 'pbp-mrowhead', role: 'row' },
        h('div', { className: 'pbp-ch', 'data-first': 'true', role: 'columnheader' }, '流程节点'),
        LANE_COLUMNS.map((column) => h('div', {
          className: 'pbp-ch',
          key: column.id,
          role: 'columnheader'
        },
          h(Dot, { tone: column.id }),
          h('span', null, column.label),
          h('span', { className: 'pbp-chnote' }, column.note))))
      const rowDefs = Array.isArray(grid.rows) && grid.rows.length > 0 ? grid.rows : STAGE_ROWS
      const rows = rowDefs.map((row) => h(StageRow, {
        key: row.id,
        row,
        node: nodes.get(row.id) || null,
        bucket: byRow.get(row.id) || {},
        expanded: input.expanded,
        onToggle: input.onToggle
      }))
      return h('div', { className: 'pbp-matrix', role: 'table', 'aria-label': '按流程节点的项目看板矩阵' },
        head, rows)
    }

    function Legend(props) {
      const input = props || {}
      const stages = num(input.stageCount, 8)
      const gates = num(input.gateCount, 2)
      return h('div', { className: 'pbp-foot' },
        h('span', { className: 'pbp-lg' }, h(Dot, { tone: 'todo' }), '待办（含进行中）'),
        h('span', { className: 'pbp-lg' }, h(Dot, { tone: 'blocked' }), '阻塞（等条件）'),
        h('span', { className: 'pbp-lg' }, h(Dot, { tone: 'decision' }), '待裁决（等人拍板）'),
        h('span', { className: 'pbp-tip' }, `行 = 流程节点（${stages} 阶段 + ${gates} 门禁）· 格内上限 2 张`))
    }

    function GroupsLine(props) {
      const groups = arr(obj(props).groups)
      if (groups.length === 0) return null
      return h('div', { className: 'pbp-groups' },
        h('span', null, '分线进度'),
        groups.map((raw, index) => {
          const group = obj(raw)
          return h('span', { className: 'pbp-gchip', key: text(group.id) || String(index) },
            `${text(group.id, '—')} ${num(group.done)}/${num(group.total)}`)
        }))
    }

    function StateBox(props) {
      const input = props || {}
      const actions = arr(input.actions)
      return h('div', { className: 'pbp-state' },
        h('div', { className: 'pbp-empty' }, text(input.title, '暂无数据')),
        text(input.hint) ? h('div', { className: 'pbp-hint' }, text(input.hint)) : null,
        text(input.note) ? h('div', { className: 'pbp-note' }, text(input.note)) : null,
        actions.length > 0 ? h('div', { className: 'pbp-actions' }, actions) : null)
    }

    function MenuItem(props) {
      const input = props || {}
      const project = obj(input.project)
      const available = project.available !== false
      const lanes = obj(obj(project.counts).lanes)
      const name = text(project.name) || text(project.id) || '未命名项目'
      const metrics = available
        ? `待办 ${num(lanes.todo)} · 阻塞 ${num(lanes.blocked)} · 裁决 ${num(lanes.decision)}`
        : '—'
      const badge = available
        ? ''
        : (text(project.code) === 'no_board' ? '未导入看板数据' : '不可用')
      const onSelect = typeof input.onSelect === 'function' ? input.onSelect : null
      return h('button', {
        type: 'button',
        className: 'pbp-mitem',
        'data-on': input.active ? 'true' : 'false',
        role: 'menuitem',
        onClick: () => { if (onSelect) onSelect(text(project.id)) }
      },
        h(Dot, { tone: available ? 'ok' : 'err' }),
        h('div', { className: 'pbp-mbody' },
          h('div', { className: 'pbp-mname' },
            h('span', null, name),
            input.active ? h('span', { className: 'pbp-tick' }, '✓') : null,
            badge ? h('span', { className: 'pbp-badge' }, badge) : null),
          text(project.root) ? h('div', { className: 'pbp-mpath' }, text(project.root)) : null),
        h('div', { className: 'pbp-mmetrics' }, metrics))
    }

    /** 绑定弹窗两态：校验前（idle/busy）与校验后（ok / 错误清单 + snippet）。 */
    function BindModal(props) {
      const input = props || {}
      const draft = obj(input.draft)
      const result = obj(input.result)
      const phase = text(input.phase, 'idle')
      const busy = input.busy === true || phase === 'checking' || phase === 'binding'
      const errors = arr(result.errors)
        .map((entry) => (typeof entry === 'string' ? entry : text(obj(entry).message)))
        .filter(Boolean)
      const preview = obj(result.preview)
      const roles = arr(preview.roles).map((role) => ROLE_LABEL[text(role)] || text(role)).filter(Boolean)
      const call = (fn) => () => { if (typeof fn === 'function') fn() }
      const change = (field, event) => {
        if (typeof input.onChange !== 'function') return
        const target = event && event.target
        if (!target) return
        if (target.type === 'checkbox') { input.onChange(field, target.checked === true); return }
        input.onChange(field, typeof target.value === 'string' ? target.value : '')
      }
      const line = (key, tone, prefix, message) => h('div', { className: 'pbp-checkline', key },
        h('span', { className: tone }, prefix),
        h('span', null, message))

      const lines = []
      if (errors.length > 0) {
        errors.forEach((message, index) => lines.push(line(`err-${index}`, 'pbp-bad', '✗', message)))
      } else if (busy) {
        lines.push(line('busy', 'pbp-mute', '…', phase === 'binding' ? '正在写入配置并导入…' : '正在校验目录与文档…'))
      } else if (phase === 'idle') {
        lines.push(line('idle', 'pbp-mute', '·', '填好项目根目录后点“仅校验”试跑，或直接“绑定并导入”。'))
      } else if (result.ok === true) {
        lines.push(line('ok-path', 'pbp-ok', '✓', '路径存在且可读'))
        lines.push(line('ok-preview', 'pbp-ok', '✓',
          `识别 ${num(preview.items)} 条记录${roles.length ? ` · 角色 ${roles.join('/')}` : ''}`))
        if (num(preview.items) === 0) lines.push(line('ok-zero', 'pbp-mute', '⚠', '尚未派生出条目：绑定后可先导入，再回看目标项目。'))
        if (result.docsMissing === true) lines.push(line('ok-scaffold', 'pbp-mute', '·', '文档目录缺失：绑定时会先创建 5 份基础台账（已存在的不覆盖）。'))
      } else {
        lines.push(line('pending', 'pbp-mute', '·', '尚未校验。'))
      }
      if (text(input.message)) lines.push(line('message', 'pbp-mute', '·', text(input.message)))
      lines.push(line('where', 'pbp-mute', '·', '写入位置：<profile>/plugin-data/yitian951012.dsh-project-dev-flow/projects.json（不写项目目录、不改 patch）'))

      return h('div', { className: 'pbp-overlay' },
        h('div', { className: 'pbp-dim', onClick: call(input.onClose) }),
        h('div', {
          className: 'pbp-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '绑定项目'
        },
          h('div', { className: 'pbp-mtop' },
            h('div', { className: 'pbp-mtitle' }, '绑定项目'),
            h('div', { className: 'pbp-msub' }, '登记一个已存在的项目目录；只读接入，不改动该项目任何文件。')),
          h('div', { className: 'pbp-field' },
            h('span', { className: 'pbp-k', 'data-req': 'true' }, '项目根目录 *'),
            h('div', { className: 'pbp-rowin' },
              h('input', {
                className: 'pbp-inp',
                value: text(draft.root),
                placeholder: '项目根目录绝对路径（如 E:/dsh-workspace/项目管理）',
                'aria-label': '项目根目录',
                onChange: (event) => change('bindRoot', event)
              }),
              h('button', {
                type: 'button',
                className: 'pbp-btn',
                disabled: typeof input.onPick !== 'function',
                title: typeof input.onPick === 'function' ? '选择项目文件夹' : '宿主未提供目录选择器，请粘贴绝对路径',
                onClick: (event) => {
                  if (event && typeof event.preventDefault === 'function') event.preventDefault()
                  if (typeof input.onPick === 'function') input.onPick()
                }
              }, '浏览…'))),
          h('div', { className: 'pbp-field' },
            h('span', { className: 'pbp-k' }, '显示名'),
            h('input', {
              className: 'pbp-inp',
              value: text(draft.name),
              placeholder: '缺省取目录名',
              'aria-label': '显示名',
              onChange: (event) => change('bindName', event)
            })),
          h('div', { className: 'pbp-field' },
            h('span', { className: 'pbp-k' }, '文档目录'),
            h('div', { className: 'pbp-rowin' },
              h('input', {
                className: 'pbp-inp',
                value: text(draft.docs),
                placeholder: 'docs',
                'aria-label': '文档目录',
                onChange: (event) => change('bindDocs', event)
              }),
              h('button', {
                type: 'button',
                className: 'pbp-btn',
                disabled: busy,
                onClick: call(input.onValidate)
              }, '检测'))),
          h('div', { className: 'pbp-field' },
            h('span', { className: 'pbp-k' }, '缺目录时'),
            h('label', { className: 'pbp-tick' },
              h('input', {
                type: 'checkbox',
                checked: draft.scaffold !== false,
                'aria-label': '缺少文档目录时自动创建基础台账',
                onChange: (event) => change('bindScaffold', event)
              }),
              '自动创建 5 份基础台账（已存在的不覆盖）')),
          h('div', { className: 'pbp-check' }, lines),
          text(input.snippet) ? h('pre', { className: 'pbp-snip' }, text(input.snippet)) : null,
          h('div', { className: 'pbp-mfoot' },
            h('div', { className: 'pbp-mnote' },
              '重复路径或同名 id 会被拒绝；取消不产生任何写入。'),
            h('button', { type: 'button', className: 'pbp-btn', onClick: call(input.onClose) }, '取消'),
            h('button', { type: 'button', className: 'pbp-btn', disabled: busy, onClick: call(input.onValidate) }, '仅校验'),
            h('button', {
              type: 'button',
              className: 'pbp-btn',
              'data-primary': 'true',
              disabled: busy,
              onClick: call(input.onBind)
            }, busy ? '处理中…' : '绑定并导入'))))
    }

    /* ------------------------------------------------------------------ *
     * 页面状态：整块面板只有一个 useState，夹具注入该对象即可渲染任意态。
     * ------------------------------------------------------------------ */
    function makePageState() {
      return {
        phase: 'loading',        // loading | ready | empty | error
        projects: [],
        errors: [],
        configured: 0,
        configReceived: true,
        currentId: null,
        board: null,
        boardLoading: false,
        boardError: null,
        reloadTick: 0,
        pickerOpen: false,
        expanded: {},
        bindOpen: false,
        bindRoot: '',
        bindName: '',
        bindDocs: 'docs',
        bindScaffold: true,
        bindPhase: 'idle',       // idle | checking | binding | checked
        bindResult: null,
        bindMessage: '',
        bindSnippet: '',
        importBusy: false,
        importMessage: '',
        notice: ''
      }
    }

    function BoardPanel(props) {
      const [state, setState] = React.useState(makePageState())
      const page = obj(state)

      // 顶层无条件调用：owner 是否携带该 prop 不应改变 hooks 顺序（宿主 main 槽恒带 standardProps）。
      let snapshot = null
      try {
        snapshot = props.useWorkspaces(SELECT_SNAPSHOT)
      } catch {
        snapshot = null // 夹具/宿主未提供时退化为无工作空间，绝不让整页空白
      }
      const workspace = pickWorkspace(snapshot)
      const fallbackRoot = pathOf(workspace)
      const reloadTick = num(page.reloadTick)

      // 1) 项目注册表：GET /project-board/projects
      React.useEffect(() => {
        let live = true
        const controller = new AbortController()
        getJson(baseUrl('/project-board/projects'), controller.signal)
          .then((body) => {
            if (!live) return
            const payload = obj(body)
            if (payload.ok === false) {
              setState((prev) => ({ ...prev, phase: 'error', boardError: text(payload.message, '读取项目注册表失败') }))
              return
            }
            const projects = arr(payload.projects).filter((entry) => entry && typeof entry === 'object')
            const errors = arr(payload.errors)
            const meta = {
              configReceived: payload.configReceived !== false,
              configured: Number.isFinite(Number(payload.configured)) ? Number(payload.configured) : projects.length,
              projects,
              errors
            }
            if (projects.length > 0) {
              setState((prev) => {
                // 绑定后新项目还没进列表时不要回退到第一个：保留待出现的 id，避免“一闪而过”。
                const keepId = projects.some((entry) => text(entry.id) === text(prev.currentId))
                  ? prev.currentId
                  : (text(prev.currentId) || text(projects[0].id))
                if (keepId === prev.currentId && prev.board) {
                  return { ...prev, ...meta, phase: 'ready', boardLoading: false }
                }
                return {
                  ...prev, ...meta, phase: 'ready', currentId: keepId,
                  board: null, boardError: null, boardLoading: true, expanded: {}
                }
              })
              return
            }
            if (payload.fallbackToWorkspace && fallbackRoot) {
              setState((prev) => ({
                ...prev,
                ...meta,
                phase: 'ready',
                projects: [{
                  id: '__workspace__',
                  name: '当前工作空间',
                  root: fallbackRoot,
                  available: true,
                  workspaceFallback: true
                }],
                currentId: '__workspace__',
                board: null,
                boardError: null,
                boardLoading: true
              }))
              return
            }
            setState((prev) => ({ ...prev, ...meta, phase: 'empty' }))
          })
          .catch((error) => {
            if (!live) return
            setState((prev) => ({
              ...prev,
              phase: 'error',
              boardError: text(error && error.message, '读取项目列表失败')
            }))
          })
        return () => {
          live = false
          try { controller.abort() } catch { /* 忽略 */ }
        }
      }, [reloadTick, fallbackRoot])

      // 2) 选中项目的看板：GET /project-board/board?project=|root=
      const currentId = text(page.currentId)
      React.useEffect(() => {
        if (!currentId) return undefined
        const hit = arr(page.projects).find((entry) => text(obj(entry).id) === currentId)
        if (!hit || obj(hit).available === false) return undefined
        let live = true
        const controller = new AbortController()
        setState((prev) => ({ ...prev, boardLoading: true, boardError: null }))
        const params = obj(hit).workspaceFallback ? { root: text(obj(hit).root) } : { project: currentId }
        getJson(baseUrl('/project-board/board', params), controller.signal)
          .then((body) => {
            if (!live) return
            const payload = obj(body)
            if (payload.ok === false) {
              setState((prev) => ({
                ...prev,
                board: null,
                boardLoading: false,
                boardError: text(payload.message, '读取看板失败')
              }))
              return
            }
            setState((prev) => ({ ...prev, board: obj(payload.board), boardLoading: false, boardError: null }))
          })
          .catch((error) => {
            if (!live) return
            setState((prev) => ({
              ...prev,
              board: null,
              boardLoading: false,
              boardError: text(error && error.message, '读取看板失败')
            }))
          })
        return () => {
          live = false
          try { controller.abort() } catch { /* 忽略 */ }
        }
      }, [currentId, page.projects])

      /* ------------------------------ 交互 ------------------------------ */
      const selectProject = (id) => {
        if (!text(id)) return
        setState((prev) => {
          if (text(id) === text(prev.currentId) && prev.board) return { ...prev, pickerOpen: false }
          return {
            ...prev,
            currentId: id,
            pickerOpen: false,
            board: null,
            boardError: null,
            boardLoading: true,
            expanded: {}
          }
        })
      }

      const refresh = () => setState((prev) => ({
        ...prev,
        reloadTick: num(prev.reloadTick) + 1,
        pickerOpen: false,
        notice: '',
        importMessage: ''
      }))

      const toggleCell = (cellKey) => {
        if (!text(cellKey)) return
        setState((prev) => {
          const expanded = { ...obj(prev.expanded) }
          expanded[cellKey] = expanded[cellKey] !== true
          return { ...prev, expanded }
        })
      }

      const togglePicker = () => setState((prev) => ({ ...prev, pickerOpen: prev.pickerOpen !== true, notice: '' }))
      const closePicker = () => setState((prev) => ({ ...prev, pickerOpen: false }))

      const openBind = () => setState((prev) => ({
        ...prev,
        pickerOpen: false,
        bindOpen: true,
        bindPhase: 'idle',
        bindResult: null,
        bindMessage: '',
        bindSnippet: '',
        bindRoot: text(prev.bindRoot) || fallbackRoot,
        bindName: text(prev.bindName),
        bindDocs: text(prev.bindDocs) || 'docs'
      }))

      const closeBind = () => setState((prev) => ({
        ...prev,
        bindOpen: false,
        bindPhase: 'idle',
        bindResult: null,
        bindMessage: '',
        bindSnippet: ''
      }))

      const changeDraft = (field, value) => {
        if (!text(field)) return
        setState((prev) => ({
          ...prev,
          [field]: typeof value === 'boolean' ? value : (typeof value === 'string' ? value : '')
        }))
      }

      const submitBind = async (mode) => {
        const isBind = mode === 'bind'
        const draft = {
          root: text(page.bindRoot).trim(),
          docs: text(page.bindDocs).trim() || 'docs',
          name: text(page.bindName).trim()
        }
        if (!draft.root) {
          setState((prev) => ({
            ...prev,
            bindPhase: 'checked',
            bindResult: { ok: false, errors: ['项目根目录必填'] }
          }))
          return
        }
        setState((prev) => ({
          ...prev,
          bindPhase: isBind ? 'binding' : 'checking',
          bindMessage: '',
          bindSnippet: ''
        }))

        let check
        try {
          check = await postJson('/project-board/validate', draft)
        } catch (error) {
          setState((prev) => ({
            ...prev,
            bindPhase: 'checked',
            bindResult: { ok: false, errors: [text(error && error.message, '校验请求失败')] }
          }))
          return
        }
        const checked = obj(check.body)
        const checkOk = check.ok === true && checked.ok !== false
        if (!isBind || !checkOk) {
          const explicit = arr(checked.errors).length > 0 || text(checked.message)
          setState((prev) => ({
            ...prev,
            bindPhase: 'checked',
            bindResult: checkOk || explicit
              ? (checkOk ? checked : { ...checked, ok: false })
              : { ...checked, ok: false, errors: ['校验未通过：宿主没有返回具体原因（可能路由未注册或响应不是 JSON）'] },
            bindMessage: checkOk
              ? '校验通过：可以绑定并导入。'
              : text(checked.message, '校验未通过，按下面清单修正后再试。')
          }))
          return
        }

        let bound
        try {
          bound = await postJson('/project-board/bind', draft)
        } catch (error) {
          setState((prev) => ({
            ...prev,
            bindPhase: 'checked',
            bindResult: { ok: false, errors: [text(error && error.message, '绑定请求失败')] },
            bindMessage: '绑定请求失败'
          }))
          return
        }
        const bindBody = obj(bound.body)
        if (bound.ok !== true || bindBody.ok !== true) {
          setState((prev) => ({
            ...prev,
            bindPhase: 'checked',
            bindMessage: text(bindBody.message, '绑定失败'),
            bindSnippet: text(bindBody.snippet),
            bindResult: { ...bindBody, ok: false }
          }))
          return
        }

        const created = obj(bindBody.project)
        const checkedProject = obj(checked.project)
        const newId = text(created.id) || text(checkedProject.id)
        const newName = text(created.name) || text(checkedProject.name) || draft.name
        let imported = null
        try {
          imported = await postJson('/project-board/import', newId ? { project: newId } : { root: draft.root })
        } catch {
          imported = null
        }
        const importBody = obj(imported && imported.body)
        const importOk = Boolean(imported && imported.ok === true && importBody.ok === true)
        setState((prev) => ({
          ...prev,
          bindOpen: false,
          bindPhase: 'idle',
          bindResult: null,
          bindMessage: '',
          bindSnippet: '',
          currentId: newId || prev.currentId,
          board: null,
          boardLoading: true,
          boardError: null,
          notice: `已绑定「${newName || '新项目'}」${importOk
            ? `，已导入 ${num(importBody.items)} 条看板记录`
            : '；导入未完成，可在空态里点“导入看板数据”'}；若列表里还没有它，等宿主重载插件配置后点“刷新”`,
          reloadTick: num(prev.reloadTick) + 1
        }))
      }

      const importBoard = async (id, root) => {
        setState((prev) => ({ ...prev, importBusy: true, importMessage: '' }))
        let result
        try {
          result = await postJson('/project-board/import', id ? { project: id } : { root })
        } catch (error) {
          setState((prev) => ({
            ...prev,
            importBusy: false,
            importMessage: text(error && error.message, '导入请求失败')
          }))
          return
        }
        const payload = obj(result.body)
        if (result.ok !== true || payload.ok !== true) {
          setState((prev) => ({
            ...prev,
            importBusy: false,
            importMessage: text(payload.message, '导入失败')
          }))
          return
        }
        setState((prev) => ({
          ...prev,
          importBusy: false,
          importMessage: `已导入 ${num(payload.items)} 条看板记录`,
          reloadTick: num(prev.reloadTick) + 1
        }))
      }

      const onKeyDown = (event) => {
        if (!event || event.key !== 'Escape') return
        if (page.bindOpen === true) closeBind()
        else if (page.pickerOpen === true) closePicker()
      }

      /* ------------------------------ 渲染 ------------------------------ */
      const phase = text(page.phase, 'loading')
      const projects = arr(page.projects).filter((entry) => entry && typeof entry === 'object')
      const current = projects.find((entry) => text(obj(entry).id) === text(page.currentId)) || null
      const board = page.board && typeof page.board === 'object' ? page.board : null
      const items = board ? arr(board.items).filter((entry) => entry && typeof entry === 'object') : []
      const matrix = buildMatrix(items)
      const groups = board ? arr(board.groups).filter((entry) => entry && typeof entry === 'object') : []
      const errors = arr(page.errors)
      const notice = text(page.notice)

      const act = (label, onClick, extra, key) => h('button', {
        key,
        type: 'button',
        className: 'pbp-btn',
        onClick,
        ...(extra || {})
      }, label)

      const onImportCurrent = () => {
        const project = obj(current)
        const id = project.workspaceFallback ? '' : text(project.id)
        importBoard(id, text(project.root))
      }

      const subParts = []
      if (current) subParts.push(text(obj(current).name) || text(obj(current).id))
      if (board) {
        subParts.push(`rev ${num(board.rev)}`)
        subParts.push(`${items.length} 条记录`)
        subParts.push(`阶段 ${num(matrix.stageCount)} / 门禁 ${num(matrix.gateCount)}`)
        subParts.push('每行三态：待办 / 阻塞 / 待裁决')
      }
      if (!current) subParts.push(phase === 'loading' ? '正在读取项目注册表…' : '还没有选中项目')
      const subText = subParts.filter(Boolean).join(' · ')

      const picker = h('div', { className: 'pbp-picker' },
        h('button', {
          type: 'button',
          className: 'pbp-pbtn',
          onClick: togglePicker,
          'aria-haspopup': 'menu',
          'aria-expanded': page.pickerOpen === true ? 'true' : 'false'
        },
          h(Dot, { tone: current && obj(current).available !== false ? 'ok' : 'mute' }),
          h('span', { className: 'pbp-pname' },
            current ? (text(obj(current).name) || text(obj(current).id) || '未命名项目') : '选择项目'),
          h('span', { className: 'pbp-ppath' }, current ? text(obj(current).root) : ''),
          h('span', { className: 'pbp-cv' }, '▾')),
        h('div', { className: 'pbp-menu', 'data-open': page.pickerOpen === true ? 'true' : 'false', role: 'menu' },
          h('div', { className: 'pbp-mhead' }, `已绑定项目 · ${projects.length}`),
          projects.length === 0
            ? h('div', { className: 'pbp-mempty' }, phase === 'loading' ? '读取项目列表…' : '还没有已绑定项目')
            : projects.map((entry, index) => h(MenuItem, {
                key: text(obj(entry).id) || `project-${index}`,
                project: entry,
                active: text(obj(entry).id) === text(page.currentId),
                onSelect: selectProject
              })),
          h('button', { type: 'button', className: 'pbp-newitem', onClick: openBind },
            '＋ 绑定项目…',
            h('span', { className: 'pbp-kbd' }, page.pickerOpen === true ? 'Esc 关闭' : ''))))

      const buildPane = () => {
        if (phase === 'error') {
          return h(StateBox, {
            title: '读取项目列表失败',
            hint: text(page.boardError, '宿主没有回应 /project-board/projects（路由未注册或未登录）。'),
            actions: [act('重试', refresh, null, 'retry')]
          })
        }
        if (phase === 'empty') {
          return h(StateBox, {
            title: '还没有配置项目',
            hint: '还没有项目：用下面的「绑定项目…」登记一个绝对路径，会写入 profile 的 plugin-data 注册表（刷新即生效，不需重装）。',
            actions: [act('绑定项目…', openBind, { 'data-primary': 'true' }, 'bind-empty')]
          })
        }
        if (phase === 'loading') {
          return h(StateBox, {
            title: '读取项目列表…',
            hint: '正在向宿主读取已绑定的项目注册表。'
          })
        }
        if (!current) {
          return h(StateBox, {
            title: '还没有选中项目',
            hint: '在顶部项目切换里选择一个已绑定项目；列表为空就先点“绑定项目…”。'
          })
        }
        if (obj(current).available === false) {
          return h(StateBox, {
            title: text(obj(current).message) || text(page.boardError) || '该项目还没有看板数据',
            hint: text(obj(current).hint, '先在项目目录里生成 .dsh/project-board/board.json，再点“导入看板数据”。'),
            note: text(page.importMessage) || (page.importBusy === true ? '正在导入…' : ''),
            actions: [
              act(page.importBusy === true ? '导入中…' : '导入看板数据', onImportCurrent,
                { 'data-primary': 'true', disabled: page.importBusy === true }, 'import'),
              act('刷新', refresh, null, 'refresh')
            ]
          })
        }
        if (page.boardLoading === true) {
          return h(StateBox, { title: '读取中…', hint: '正在读取该项目的 board.json。' })
        }
        if (text(page.boardError)) {
          return h(StateBox, {
            title: '读取看板失败',
            hint: text(page.boardError),
            actions: [act('重试', refresh, null, 'retry-board')]
          })
        }
        if (!board) {
          return h(StateBox, {
            title: '还没有可显示的看板数据',
            hint: '该项目未导入 board.json，或宿主的 /project-board/board 路由未注册。',
            note: text(page.importMessage) || (page.importBusy === true ? '正在导入…' : ''),
            actions: [
              act('刷新', refresh, null, 'refresh-none'),
              act(page.importBusy === true ? '导入中…' : '导入看板数据', onImportCurrent,
                { 'data-primary': 'true', disabled: page.importBusy === true }, 'import-none')
            ]
          })
        }
        return h('div', { className: 'pbp-vstack' },
          h(Matrix, { matrix, expanded: page.expanded, onToggle: toggleCell }),
          h(GroupsLine, { groups }),
          h(Legend, { stageCount: matrix.stageCount, gateCount: matrix.gateCount }))
      }

      let pane
      try {
        pane = buildPane()
      } catch (error) {
        pane = h(StateBox, {
          title: '看板数据残缺，已降级为空态',
          hint: text(error && error.message, '渲染异常被捕获，不影响其他面板；可点“刷新”重试。'),
          actions: [act('重试', refresh, null, 'retry-crash')]
        })
      }

      return h('div', { className: 'pbp-root', tabIndex: -1, onKeyDown },
        h('style', null, STYLES),
        h('div', { className: 'pbp-head' },
          h('div', null,
            h('div', { className: 'pbp-h1' }, '项目进度看板', h('span', { className: 'pbp-h2' }, ' · 按流程节点')),
            h('div', { className: 'pbp-sub' }, subText)),
          h('div', { className: 'pbp-acts' },
            picker,
            h('button', { type: 'button', className: 'pbp-btn', onClick: refresh }, '刷新'))),
        notice ? h('div', { className: 'pbp-notice' }, notice) : null,
        errors.length > 0
          ? h('div', {
              className: 'pbp-errs'
            }, `配置里有 ${errors.length} 条无效项：${errors.map((entry) => text(obj(entry).message, '未知错误')).join('；')}`)
          : null,
        pane,
        page.bindOpen === true
          ? h(BindModal, {
              draft: { root: page.bindRoot, name: page.bindName, docs: page.bindDocs },
              phase: page.bindPhase,
              busy: page.bindPhase === 'checking' || page.bindPhase === 'binding',
              result: page.bindResult,
              message: page.bindMessage,
              snippet: page.bindSnippet,
              onChange: changeDraft,
              onValidate: () => submitBind('validate'),
              onBind: () => submitBind('bind'),
              onPick: typeof props.pickDirectory === 'function'
                ? () => {
                    Promise.resolve(props.pickDirectory())
                      .then((picked) => { if (typeof picked === 'string' && picked) changeDraft('bindRoot', picked) })
                      .catch(() => { /* 选择器取消或不可用：保持当前输入 */ })
                  }
                : undefined,
              onClose: closeBind
            })
          : null)
    }

    /* ------------------------------------------------------------------ *
     * 会话输入框入口（conversation.input.left）
     * 28×28 图标按钮 + 360px 非模态面板（createPortal 到 body + position:fixed）。
     * 只做两件事：把阶段技能命令插到草稿首行；新建 preset 会话前预置草稿。
     * 绝不 submit / setDraft / agentPresets.select，也不读别人的 DOM。
     * ------------------------------------------------------------------ */
    const COMPOSER_NS = 'project-dev-flow.composer'
    const COMPOSER_SLOT = 'conversation.input.left'
    const COMPOSER_STYLE_ID = 'pdflow-composer-styles'
    const COMPOSER_PRESET = 'project-dev-flow'
    const PANEL_WIDTH = 360
    // 提交/发送中必须收起面板：这两个阶段编辑器是只读的，面板再开就是死按钮。
    const COMPOSER_CLOSE_PHASES = ['submitting', 'sending']

    // 选择器身份必须稳定：每次渲染新建箭头函数会击穿宿主快照缓存。
    const SELECT_INPUT_STATE = (state) => state || null
    // 会话快照的 blank 位：blank 会话会被 connectWorkspace 解析复用，新建流程会话时要按它分支。
    const SELECT_SESSION_BLANK = (session) => Boolean(session && session.blank === true)

    // 五个阶段技能：命令只在消息首行生效，所以插入手势见 insertStage。
    const COMPOSER_STAGES = [
      { id: 'intake', key: 'stage.intake', command: '/project-intake', manual: false },
      { id: 'flow', key: 'stage.flow', command: '/project-dev-flow', manual: false },
      { id: 'docs', key: 'stage.docs', command: '/project-docs', manual: false },
      { id: 'acceptance', key: 'stage.acceptance', command: '/project-acceptance', manual: true },
      { id: 'distill', key: 'stage.distill', command: '/project-case-distill', manual: true }
    ]

    // 本地回退字典：locale 服务可用时以注册进 COMPOSER_NS 的同一份为准。
    const COMPOSER_DICT = {
      zh: {
        'entry': '项目开发流程',
        'a11y.open': '打开项目开发流程入口',
        'a11y.panel': '项目开发流程面板',
        'title': '项目开发流程',
        'close': '关闭',
        'status.on': '本会话已启用',
        'status.off': '未启用 · 模式在会话创建时绑定',
        'status.unknown': '正在读取…',
        'new.row': '新建流程会话',
        'new.row.keep': '在当前空白会话启用流程',
        'new.note.keep': '当前草稿会保留：这个空白会话原地切换 preset，不会把草稿再写一遍。',
        'new.note.copy': '当前输入会复制到新会话，附件留在原会话；只预置，不发送。',
        'new.confirm': '新建并预置当前草稿？',
        'new.confirm.keep': '把当前空白会话切换为「项目开发流程」？',
        'new.cancel': '取消',
        'new.create': '新建',
        'new.create.keep': '启用',
        'stages.title': '阶段技能',
        'stages.manual': '仅手动',
        'stages.disabled': '未绑定 project-dev-flow preset：技能只挂在 preset 内，插进去也是死 token。',
        'footer.default': '阶段技能只插入命令，不自动发送',
        'footer.inserted': '已插入 {cmd}（未发送）· Ctrl/⌘+Z 撤销',
        'footer.hasCommand': '输入框已有命令，请先清空',
        'footer.noInput': '宿主没有提供插入接口，无法写入草稿',
        'footer.failed': '插入被拒绝（草稿版本已变），请再点一次',
        'footer.newFail': '新建会话失败：{message}',
        'footer.noWorkspace': '宿主没有提供会话创建接口',
        'common.unknownError': '未知错误',
        'stage.intake': '需求受理',
        'stage.flow': '设计定型',
        'stage.docs': '文档治理',
        'stage.acceptance': '验收',
        'stage.distill': '案例蒸馏'
      },
      en: {
        'entry': 'Project dev flow',
        'a11y.open': 'Open the project dev flow entry',
        'a11y.panel': 'Project dev flow panel',
        'title': 'Project dev flow',
        'close': 'Close',
        'status.on': 'Enabled for this session',
        'status.off': 'Not enabled · the mode binds at session creation',
        'status.unknown': 'Reading…',
        'new.row': 'New flow session',
        'new.row.keep': 'Enable the flow in this blank session',
        'new.note.keep': 'The current draft stays here: this blank session switches preset in place, so nothing is written twice.',
        'new.note.copy': 'The current input is copied into the new session and attachments stay here; seed only, never send.',
        'new.confirm': 'Create it and seed the current draft?',
        'new.confirm.keep': 'Switch this blank session to the project dev flow?',
        'new.cancel': 'Cancel',
        'new.create': 'Create',
        'new.create.keep': 'Enable',
        'stages.title': 'Stage skills',
        'stages.manual': 'Manual only',
        'stages.disabled': 'The project-dev-flow preset is not bound here: its skills ship inside that preset, so an inserted token is dead.',
        'footer.default': 'Stage skills only insert the command; nothing is sent',
        'footer.inserted': 'Inserted {cmd} (not sent) · Ctrl/⌘+Z to undo',
        'footer.hasCommand': 'The input already starts with a command; clear it first',
        'footer.noInput': 'The Host exposes no insertion actions, so nothing can be written',
        'footer.failed': 'Insert refused (the draft revision moved); click again',
        'footer.newFail': 'Could not create the session: {message}',
        'footer.noWorkspace': 'The Host exposes no session-creation action',
        'common.unknownError': 'Unknown error',
        'stage.intake': 'Demand intake',
        'stage.flow': 'Design lock-in',
        'stage.docs': 'Document governance',
        'stage.acceptance': 'Acceptance',
        'stage.distill': 'Case distillation'
      }
    }

    /* ------------------------------------------------------------------ *
     * 样式：只用 --dsw-alias-* 语义 token，选择器统一 pdflow- 前缀。
     * ------------------------------------------------------------------ */
    const COMPOSER_STYLES = [
      '.pdflow-entry{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;',
      'padding:0;flex:none;border:0;border-radius:6px;background:transparent;cursor:pointer;',
      'color:var(--dsw-alias-label-secondary);transition:background .12s ease,color .12s ease}',
      '.pdflow-entry:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.pdflow-entry[data-on=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}',
      '.pdflow-entry:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.pdflow-anchor{display:inline-flex;flex:none}',
      '.pdflow-panel{position:fixed;z-index:60;box-sizing:border-box;display:flex;flex-direction:column;',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);',
      'border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden;',
      'font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}',
      '.pdflow-head{display:flex;align-items:flex-start;gap:8px;padding:11px 13px 9px;flex:none;',
      'border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.pdflow-htext{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
      '.pdflow-title{font-size:13.5px;font-weight:650;line-height:1.35}',
      '.pdflow-status{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary)}',
      '.pdflow-status[data-on=true]{color:var(--dsw-alias-state-success-primary)}',
      '.pdflow-x{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;',
      'border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);',
      'font:inherit;font-size:13px;line-height:1;cursor:pointer}',
      '.pdflow-x:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.pdflow-body{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:auto}',
      '.pdflow-sec{padding:9px 13px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.pdflow-sechead{margin-bottom:5px;font-size:10.5px;line-height:1.4;',
      'color:var(--dsw-alias-label-secondary)}',
      '.pdflow-newbt{display:flex;align-items:center;gap:6px;width:100%;padding:6px 9px;text-align:left;',
      'border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;background:transparent;',
      'color:inherit;font:inherit;font-size:12px;cursor:pointer}',
      '.pdflow-newbt:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.pdflow-note{margin-top:5px;font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.pdflow-note[data-warn=true]{color:var(--dsw-alias-state-error-primary)}',
      '.pdflow-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 0 0}',
      '.pdflow-confirm-q{flex:1;min-width:150px;font-size:11.5px;line-height:1.45}',
      '.pdflow-btn{border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:4px 9px;',
      'font:inherit;font-size:11.5px;background:var(--dsw-alias-bg-layer-1);',
      'color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.pdflow-btn[data-primary=true]{border-color:var(--dsw-alias-brand-primary);',
      'color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.pdflow-btn:disabled{opacity:.55;cursor:not-allowed}',
      '.pdflow-row{display:flex;align-items:center;gap:8px;width:100%;padding:6px 9px;margin-top:4px;',
      'text-align:left;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;',
      'background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12px;cursor:pointer}',
      '.pdflow-row:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}',
      '.pdflow-row:disabled{opacity:.5;cursor:not-allowed}',
      '.pdflow-rowname{flex:1;min-width:0;line-height:1.35}',
      '.pdflow-rowtag{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 4px;',
      'font-size:9.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.pdflow-cmd{flex:none;font:11px/1.2 ui-monospace,Consolas,monospace;',
      'color:var(--dsw-alias-label-secondary)}',
      '.pdflow-foot{flex:none;padding:8px 13px;border-top:1px solid var(--dsw-alias-border-l1);',
      'font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.pdflow-foot[data-kind=ok]{color:var(--dsw-alias-brand-primary)}',
      '.pdflow-foot[data-kind=warn]{color:var(--dsw-alias-state-error-primary)}'
    ].join('')

    /** 16px 单色流程图标：三节点汇成一条主线，颜色跟随按钮的 currentColor。 */
    function FlowGlyph(props) {
      const size = num(obj(props).size, 16)
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', 'aria-hidden': 'true'
      },
        h('circle', { cx: 3, cy: 3.2, r: 1.6 }),
        h('circle', { cx: 3, cy: 12.8, r: 1.6 }),
        h('circle', { cx: 12.6, cy: 8, r: 1.6 }),
        h('path', { d: 'M3 4.8v6.4' }),
        h('path', { d: 'M4.6 3.2h4.4a2.4 2.4 0 0 1 2.4 2.4v.8' }),
        h('path', { d: 'M4.6 12.8h4.4a2.4 2.4 0 0 0 2.4-2.4v-.8' }))
    }

    /** 指针按下即 preventDefault：按钮不抢输入框焦点，草稿选区与引用芯片都留在编辑器里。 */
    function keepPointerFocus(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
    }

    /** locale 服务缺失时的回退语言：浏览器主语言是中文就用中文，其余英文。 */
    function composerFallbackLocale() {
      try {
        const lang = typeof navigator === 'undefined' || !navigator ? '' : text(navigator.language)
        if (/^zh/i.test(lang)) return 'zh'
        if (lang) return 'en'
      } catch { /* 忽略 */ }
      return 'zh'
    }

    /** 模板占位符 {name}：只替换已知键，缺键时原样保留。 */
    function composerFill(template, vars) {
      const values = obj(vars)
      return String(text(template)).replace(/\{(\w+)\}/g, (whole, key) => (
        Object.hasOwn(values, key) ? text(values[key]) : whole
      ))
    }

    /**
     * 取文案：优先宿主 locale（字典已注册到 COMPOSER_NS），服务不可用或键缺失时
     * 回退本地字典；两条路都取不到就显示键名。全程不抛。
     */
    function makeComposerTranslator(ctx) {
      let cachedService = null
      let cachedBind = null
      const resolve = () => {
        let service = null
        try { service = ctx.get('locale') || null } catch { service = null }
        if (!service || typeof service.bind !== 'function') return { service, bind: null }
        if (service !== cachedService) {
          cachedService = service
          try { cachedBind = service.bind(COMPOSER_NS) } catch { cachedBind = null }
        }
        return { service, bind: cachedBind }
      }
      return function t(key, vars) {
        const name = text(key)
        if (!name) return ''
        const found = resolve()
        let value = ''
        if (found.bind) {
          try { value = text(found.bind(name)) } catch { value = '' }
          // 宿主查不到键时会原样回键名，这种“命中”不算翻译成功。
          if (value && value !== name) return composerFill(value, vars)
        }
        let active = ''
        try {
          const snapshot = found.service && typeof found.service.getSnapshot === 'function'
            ? obj(found.service.getSnapshot())
            : {}
          active = text(snapshot.active)
        } catch { active = '' }
        const bucket = Object.hasOwn(COMPOSER_DICT, active) ? COMPOSER_DICT[active] : COMPOSER_DICT[composerFallbackLocale()]
        const local = bucket && Object.hasOwn(bucket, name) ? bucket[name] : ''
        return composerFill(text(local, name), vars)
      }
    }

    /**
     * 面板位置：输入条在页面底部，默认向上开；上方空间不足就向下翻转。
     * 水平夹在视口内，可用高度一并返回，由面板自己 maxHeight + body overflow 裁剪。
     */
    function composerPlacement(rect) {
      const viewportWidth = num(typeof window === 'undefined' ? 0 : window.innerWidth, PANEL_WIDTH + 16) || PANEL_WIDTH + 16
      const viewportHeight = num(typeof window === 'undefined' ? 0 : window.innerHeight, 720) || 720
      const width = Math.max(240, Math.min(PANEL_WIDTH, viewportWidth - 16))
      const gap = 8
      const edge = 8
      const anchor = obj(rect)
      const anchorTop = Number.isFinite(Number(anchor.top)) ? Number(anchor.top) : viewportHeight - 48
      const anchorBottom = Number.isFinite(Number(anchor.bottom)) ? Number(anchor.bottom) : anchorTop + 28
      const anchorLeft = Number.isFinite(Number(anchor.left)) ? Number(anchor.left) : edge
      const spaceAbove = Math.max(anchorTop - gap - edge, 0)
      const spaceBelow = Math.max(viewportHeight - anchorBottom - gap - edge, 0)
      const above = spaceAbove >= 300 || spaceAbove >= spaceBelow
      const height = Math.max(140, above ? spaceAbove : spaceBelow)
      const left = Math.max(edge, Math.min(anchorLeft, Math.max(edge, viewportWidth - width - edge)))
      const style = {
        left: `${Math.round(left)}px`,
        width: `${Math.round(width)}px`,
        maxHeight: `${Math.round(height)}px`
      }
      if (above) style.bottom = `${Math.round(viewportHeight - anchorTop + gap)}px`
      else style.top = `${Math.round(anchorBottom + gap)}px`
      return style
    }

    /** portal：面板必须脱离输入条的 overflow 裁剪；拿不到 react-dom 时退化就地渲染。 */
    function loadCreatePortal() {
      try {
        const dom = require('react-dom')
        return dom && typeof dom.createPortal === 'function' ? dom.createPortal : null
      } catch {
        return null
      }
    }
    const CREATE_PORTAL = loadCreatePortal()

    /**
     * 入口组件：28×28 图标按钮 + 非模态面板。
     * owner 自带标准 props（useInput / inputActions / useProjection / useWorkspaces …），
     * apply 再补 pdflowT / pdflowStartSession / pdflowPortal 三个闭包。
     */
    function PdFlowComposer(props) {
      const input = props || {}
      const t = typeof input.pdflowT === 'function' ? input.pdflowT : (key) => text(key)
      const startSession = typeof input.pdflowStartSession === 'function' ? input.pdflowStartSession : null
      const portal = typeof input.pdflowPortal === 'function' ? input.pdflowPortal : null

      const [open, setOpen] = React.useState(false)
      const [confirmOpen, setConfirmOpen] = React.useState(false)
      const [placement, setPlacement] = React.useState(null)
      const [footer, setFooter] = React.useState(null)
      // 本次打开是否由键盘触发：只有键盘打开才抢焦点并做焦点圈定，鼠标打开保持原语义。
      const [openedByKeyboard, setOpenedByKeyboard] = React.useState(false)
      const buttonRef = React.useRef(null)
      const panelRef = React.useRef(null)

      // 顶层无条件调用：宿主缺 hook 时退化为无草稿，绝不让入口崩掉（崩溃会清空整个 slot）。
      let inputState = null
      try {
        inputState = typeof input.useInput === 'function' ? input.useInput(SELECT_INPUT_STATE) : null
      } catch {
        inputState = null
      }
      const draft = text(obj(inputState).draft)
      const phase = text(obj(inputState).phase, 'plain')
      const actions = obj(input.inputActions)

      // 绑定判定：agentPreset 投影取不到就按 unknown 处理，绝不冒充已启用。
      let preset
      let presetKnown = false
      try {
        if (typeof input.useProjection === 'function') {
          preset = input.useProjection('agentPreset')
          presetKnown = typeof preset === 'string' || preset === null
        }
      } catch {
        preset = undefined
        presetKnown = false
      }
      const bound = presetKnown === true && text(preset) === COMPOSER_PRESET

      let workspaceId = ''
      try {
        const snapshot = typeof input.useWorkspaces === 'function' ? input.useWorkspaces(SELECT_SNAPSHOT) : null
        const hit = pickWorkspace(snapshot)
        workspaceId = text(hit && (hit.workspaceId || hit.id))
      } catch {
        workspaceId = ''
      }

      // 当前会话是否仍是“没跑过 turn 的空白会话”：blank 会被 connectWorkspace 解析复用。
      // 新建流程会话必须按它分支，否则宿主换 preset 保留的原草稿会被 append 再写一遍。
      // useSession 缺失（旧宿主）时按非 blank 处理，保持原有 append 行为。
      let isBlank = false
      try {
        isBlank = typeof input.useSession === 'function' ? input.useSession(SELECT_SESSION_BLANK) === true : false
      } catch {
        isBlank = false
      }

      const place = React.useCallback(() => {
        let rect = null
        try {
          const node = buttonRef.current
          rect = node && typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null
        } catch { rect = null }
        try {
          setPlacement(composerPlacement(rect))
        } catch { /* 位置算不出来就保持上一次的 */ }
      }, [])

      const close = React.useCallback((refocus) => {
        setConfirmOpen(false)
        setOpen(false)
        setFooter(null)
        if (refocus === true) {
          try {
            const node = buttonRef.current
            if (node && typeof node.focus === 'function') node.focus()
          } catch { /* 忽略 */ }
        }
      }, [])

      // 打开期间跟随视口重算位置，并监听 Esc / 点外部 / Tab。
      React.useEffect(() => {
        if (open !== true) return undefined
        if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
        place()
        const onViewport = () => place()
        const onPointerDown = (event) => {
          const target = event && event.target
          const panel = panelRef.current
          const button = buttonRef.current
          if (panel && typeof panel.contains === 'function' && panel.contains(target)) return
          if (button && typeof button.contains === 'function' && button.contains(target)) return
          // 点外部只关闭不回焦：回焦等于把焦点从编辑器手里抢走，下一次插入就失效。
          close(false)
        }
        const onKeyDown = (event) => {
          if (!event) return
          if (event.key === 'Escape') { close(true); return }
          if (event.key !== 'Tab') return
          // 鼠标打开的面板不拦 Tab：焦点本来就在输入框，用户随时可以离开。
          if (openedByKeyboard !== true) return
          const panel = panelRef.current
          if (!panel || typeof panel.querySelectorAll !== 'function') return
          // 键盘打开后面板是焦点圈：Tab / Shift+Tab 只在首个与末个可获得焦点元素之间循环。
          const nodes = panel.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
          const list = Array.prototype.slice.call(nodes)
          if (list.length === 0) return
          const first = list[0]
          const last = list[list.length - 1]
          let active = null
          try { active = typeof document === 'undefined' ? null : document.activeElement } catch { active = null }
          const inside = active && typeof panel.contains === 'function' ? panel.contains(active) : false
          if (event.shiftKey === true) {
            // 在第一个上反向 Tab，或焦点已漏到面板外：从最后一个接上。
            if (inside !== true || active === first) {
              if (typeof event.preventDefault === 'function') event.preventDefault()
              if (typeof last.focus === 'function') last.focus()
            }
            return
          }
          // 在最后一个上正向 Tab，或焦点已漏到面板外：从第一个接上。
          if (inside !== true || active === last) {
            if (typeof event.preventDefault === 'function') event.preventDefault()
            if (typeof first.focus === 'function') first.focus()
          }
        }
        window.addEventListener('resize', onViewport)
        document.addEventListener('scroll', onViewport, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          window.removeEventListener('resize', onViewport)
          document.removeEventListener('scroll', onViewport, true)
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [open, place, close, openedByKeyboard])

      // 键盘打开后把焦点送进面板（DOM 顺序第一个 button，即右上角关闭键）。
      // 鼠标打开不动焦点：草稿选区、引用芯片都留在编辑器里。
      React.useEffect(() => {
        if (open !== true || openedByKeyboard !== true) return
        const panel = panelRef.current
        if (!panel || typeof panel.querySelector !== 'function') return
        const target = panel.querySelector('button')
        if (target && typeof target.focus === 'function') {
          try { target.focus() } catch { /* 忽略：焦点失败不影响面板可用 */ }
        }
      }, [open, openedByKeyboard])

      // 面板打开时一旦进入提交/发送就静默收起（不回焦，避开提交瞬间）。
      React.useEffect(() => {
        if (open !== true) return
        if (COMPOSER_CLOSE_PHASES.includes(phase)) close(false)
      }, [open, phase, close])

      const setFooterText = (kind, value) => {
        try { setFooter({ kind, text: text(value) }) } catch { /* 忽略 */ }
      }

      /**
       * 插入阶段命令：技能命令必须落在“消息首行且以 / 开头”。
       * 空草稿 → 首行插 `/stage `；非空且不以 / 开头 → 0 处插 `/stage\n`，原文本整体后移；
       * 已以 / 开头 → 不插，只提示清空。只用 captureInsertion / insertText，非空草稿绝不 setDraft。
       */
      const insertStage = (command) => {
        const name = text(command)
        if (!name) return
        const capture = typeof actions.captureInsertion === 'function' ? actions.captureInsertion : null
        const insert = typeof actions.insertText === 'function' ? actions.insertText : null
        if (!capture || !insert) { setFooterText('warn', t('footer.noInput')); return }
        const body = text(draft)
        if (body.trimStart().startsWith('/')) { setFooterText('warn', t('footer.hasCommand')); return }
        let span = null
        try { span = obj(capture()) } catch { span = null }
        // insertText 是 CAS：span 必须带上当前 draftRev，否则宿主直接拒绝。
        if (typeof span.draftRev !== 'number') { setFooterText('warn', t('footer.failed')); return }
        const injected = body.trim() === '' ? `${name} ` : `${name}\n`
        const target = { start: 0, end: 0, draftRev: span.draftRev }
        const settle = (outcome) => {
          if (outcome === false) setFooterText('warn', t('footer.failed'))
          else setFooterText('ok', t('footer.inserted', { cmd: name }))
        }
        let outcome
        try { outcome = insert(injected, target) } catch { outcome = false }
        if (outcome && typeof outcome.then === 'function') {
          // 异步插入：拒绝结果留成 footer 提示，等用户自己再点。
          outcome.then(settle).catch(() => settle(false))
          return
        }
        settle(outcome)
      }

      /**
       * 新建会话：只在“非 blank 且草稿非空”时把草稿预置进新会话（whenDraftExists=append）。
       * blank 会话会被 connectWorkspace 解析回当前会话：宿主换 preset 时会保留原草稿，
       * 再传 prompt 就是同一段文字接一遍，用户会看到草稿重复。因此 blank（以及草稿为空）
       * 只传 agentPreset。全程绝不 submit。
       */
      const createSession = () => {
        setConfirmOpen(false)
        if (!startSession) { setFooterText('warn', t('footer.newFail', { message: t('footer.noWorkspace') })); return }
        const fail = (error) => setFooterText('warn', t('footer.newFail', { message: text(error && error.message, t('common.unknownError')) }))
        // 成功才收面板：失败要留在原地，否则 footer 的失败原因谁也看不到。
        const done = () => setOpen(false)
        const body = text(draft)
        const options = { agentPreset: COMPOSER_PRESET }
        if (isBlank !== true && body !== '') {
          options.prompt = body
          options.whenDraftExists = 'append'
        }
        let outcome
        try {
          outcome = startSession(workspaceId || undefined, options)
        } catch (error) {
          fail(error)
          return
        }
        if (outcome && typeof outcome.then === 'function') {
          outcome.then(done, fail)
          return
        }
        done()
      }

      const statusKey = presetKnown !== true ? 'status.unknown' : (bound ? 'status.on' : 'status.off')
      const stageDisabled = bound !== true

      const stageRows = COMPOSER_STAGES.map((stage) => h('button', {
        key: stage.id,
        type: 'button',
        className: 'pdflow-row',
        disabled: stageDisabled,
        'data-stage': stage.id,
        title: stageDisabled ? t('stages.disabled') : stage.command,
        onPointerDown: keepPointerFocus,
        onClick: () => { if (!stageDisabled) insertStage(stage.command) }
      },
        h('span', { className: 'pdflow-rowname' }, t(stage.key)),
        stage.manual ? h('span', { className: 'pdflow-rowtag' }, t('stages.manual')) : null,
        h('span', { className: 'pdflow-cmd' }, stage.command)))

      const panel = h('div', {
        className: 'pdflow-panel',
        ref: panelRef,
        role: 'dialog',
        'aria-modal': 'false',
        'aria-label': t('a11y.panel'),
        style: placement || composerPlacement(null)
      },
        h('div', { className: 'pdflow-head' },
          h('div', { className: 'pdflow-htext' },
            h('div', { className: 'pdflow-title' }, t('title')),
            h('div', {
              className: 'pdflow-status',
              'data-on': bound ? 'true' : 'false',
              'data-unknown': presetKnown === true ? 'false' : 'true'
            }, t(statusKey))),
          h('button', {
            type: 'button',
            className: 'pdflow-x',
            'aria-label': t('close'),
            title: t('close'),
            onPointerDown: keepPointerFocus,
            onClick: () => close(true)
          }, '✕')),
        h('div', { className: 'pdflow-body' },
          h('div', { className: 'pdflow-sec' },
            h('button', {
              type: 'button',
              className: 'pdflow-newbt',
              'aria-expanded': confirmOpen ? 'true' : 'false',
              onPointerDown: keepPointerFocus,
              onClick: () => setConfirmOpen(confirmOpen !== true)
            }, t(isBlank === true ? 'new.row.keep' : 'new.row')),
            h('div', { className: 'pdflow-note' }, t(isBlank === true ? 'new.note.keep' : 'new.note.copy')),
            confirmOpen === true
              ? h('div', { className: 'pdflow-confirm' },
                  h('span', { className: 'pdflow-confirm-q' }, t(isBlank === true ? 'new.confirm.keep' : 'new.confirm')),
                  h('button', {
                    type: 'button',
                    className: 'pdflow-btn',
                    onPointerDown: keepPointerFocus,
                    onClick: () => setConfirmOpen(false)
                  }, t('new.cancel')),
                  h('button', {
                    type: 'button',
                    className: 'pdflow-btn',
                    'data-primary': 'true',
                    onPointerDown: keepPointerFocus,
                    onClick: createSession
                  }, t(isBlank === true ? 'new.create.keep' : 'new.create')))
              : null),
          h('div', { className: 'pdflow-sec' },
            h('div', { className: 'pdflow-sechead' }, t('stages.title')),
            stageRows,
            stageDisabled
              ? h('div', { className: 'pdflow-note', 'data-warn': 'true' }, t('stages.disabled'))
              : null)),
        h('div', {
          className: 'pdflow-foot',
          'data-kind': footer ? text(footer.kind) : 'hint'
        }, footer ? text(footer.text) : t('footer.default')))

      return h('div', { className: 'pdflow-anchor' },
        h('button', {
          ref: buttonRef,
          type: 'button',
          className: 'pdflow-entry',
          'data-on': open ? 'true' : 'false',
          'aria-haspopup': 'dialog',
          'aria-expanded': open ? 'true' : 'false',
          'aria-label': t('a11y.open'),
          title: t('entry'),
          onPointerDown: keepPointerFocus,
          onClick: (event) => {
            if (open === true) { close(false); return }
            // 键盘（Enter / Space）触发的 click 其 detail 为 0；只有这种打开才抢焦点并做焦点圈定。
            const byKeyboard = Boolean(event && event.detail === 0)
            place()
            setFooter(null)
            setOpenedByKeyboard(byKeyboard)
            setOpen(true)
          }
        }, h(FlowGlyph, { size: 16 })),
        open === true
          ? (portal && typeof document !== 'undefined' && document.body ? portal(panel, document.body) : panel)
          : null)
    }

    function RowIcon(owner) {
      const size = (owner && owner.size) || 16
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('rect', { x: 1.5, y: 2.5, width: 3.5, height: 11, rx: 1, fill: 'var(--dsw-alias-label-secondary)' }),
        h('rect', { x: 6.25, y: 2.5, width: 3.5, height: 7, rx: 1, fill: 'var(--dsw-alias-label-secondary)' }),
        h('rect', { x: 11, y: 2.5, width: 3.5, height: 9, rx: 1, fill: 'var(--dsw-alias-label-secondary)' })
      )
    }

    function apply(ctx) {
      let layout
      ctx.inject(['layout'], (scoped) => { layout = (scoped && scoped.layout) || null })

      // 宿主自带的目录选择器：uiWorkspace.pickDirectory()（Service 目录实测存在）。
      // 同一份 Service 也用于 startSession：新建流程会话时只预置草稿，不发送。
      let pickDirectory = null
      let workspaceService = null
      ctx.inject(['uiWorkspace'], (scoped) => {
        const workspace = scoped && scoped.uiWorkspace
        workspaceService = workspace || null
        if (workspace && typeof workspace.pickDirectory === 'function') pickDirectory = () => workspace.pickDirectory()
      })

      // 注册必须是 ctx.effect 拥有的资源：卸载/禁用时由宿主调用清理。
      ctx.effect(() => {
        // owner 里带着 useWorkspaces 等标准 props：转发它们，面板才拿得到工作空间快照。
        const offPanel = ctx.slots.register({ name: 'main', key: PANEL_KEY }, (owner) => h(BoardPanel, { ...(owner || {}), pickDirectory }))
        const offRow = ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_KEY, order: 2, label: () => '项目看板' },
          (owner) => h(RowIcon, owner || {})
        )

        return () => {
          try {
            if (layout && layout.panelInfo.getSnapshot().activePanelId === PANEL_KEY) layout.selectPanel(null)
          } catch { /* 宿主无 layout 时忽略 */ }
          if (typeof offRow === 'function') offRow()
          if (typeof offPanel === 'function') offPanel()
        }
      })

      /* ---------------------- 会话输入框入口 ---------------------- */
      const composerT = makeComposerTranslator(ctx)

      // 字典：locale 服务不在就什么都不注册，组件自动走本地回退字典。
      ctx.effect(() => {
        try {
          const locale = ctx.get('locale')
          if (locale && typeof locale.register === 'function') {
            return locale.register(COMPOSER_NS, COMPOSER_DICT)
          }
        } catch { /* 忽略：回退本地字典 */ }
        return undefined
      }, 'project-dev-flow: composer copy')

      // 样式：幂等注入（同 id 已存在就复用），卸载只清理自己创建的那一份。
      ctx.effect(() => {
        let node = null
        let created = false
        try {
          if (typeof document !== 'undefined' && document && document.head) {
            const existing = typeof document.getElementById === 'function' ? document.getElementById(COMPOSER_STYLE_ID) : null
            if (existing) {
              node = existing
            } else {
              node = document.createElement('style')
              node.id = COMPOSER_STYLE_ID
              node.textContent = COMPOSER_STYLES
              document.head.appendChild(node)
              created = true
            }
          }
        } catch { node = null; created = false }
        return () => {
          try {
            if (created && node && node.parentNode) node.parentNode.removeChild(node)
          } catch { /* 忽略 */ }
        }
      }, 'project-dev-flow: composer styles')

      // 入口注册：插槽可能不存在（旧宿主），inject 与 register 全部 try/catch。
      ctx.effect(() => {
        const startSession = (targetWorkspaceId, options) => {
          const service = workspaceService
          // 抛出的消息走 locale 键，footer 翻译后再展示，组件里不留中文。
          if (!service || typeof service.startSession !== 'function') throw new Error(composerT('footer.noWorkspace'))
          return service.startSession(targetWorkspaceId, options)
        }
        let stop = null
        try {
          stop = ctx.slots.inject(COMPOSER_SLOT, () => ctx.slots.register({
            name: COMPOSER_SLOT,
            id: 'project-dev-flow',
            order: 20,
            // label 用 thunk：每次投影重读，语言切换后不必重新注册。
            label: () => composerT('entry')
          }, (owner) => h(PdFlowComposer, {
            ...(owner || {}),
            pdflowT: composerT,
            pdflowStartSession: startSession,
            pdflowPortal: CREATE_PORTAL
          })))
        } catch { stop = null }
        return () => {
          try {
            if (typeof stop === 'function') stop()
          } catch { /* 忽略 */ }
        }
      }, 'project-dev-flow: composer entry')
    }

    exports.apply = apply
    exports.inject = ['slots']
    exports.name = NS
    return module.exports
  }
})
