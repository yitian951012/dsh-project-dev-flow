#!/usr/bin/env node
/**
 * scaffold-docs.mjs — 给一个还没有台账的项目铺「插件能读」的基础文档。
 *
 * 只做一件事：在 <root>/<docs> 下生成 5 份最小台账（阶段/WBS/待裁决/剩余问题/下一步），
 * 表头与 import-board.mjs 的签名对齐。已存在的文件一律跳过，绝不覆盖。
 *
 * 用法：node scripts/scaffold-docs.mjs --root <绝对路径> [--docs docs] [--name 项目名] [--write]
 * 不带 --write 只打印将要创建什么（dry-run）；退出码 0 成功（含全部已存在），2 参数错误。
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const STATUS = `# 项目状态看板（脚手架）

> 由 dsh-project-dev-flow 生成：占位内容，请替换成项目实测值。本文件是「当前进度」的唯一口径。

| 阶段 | 名称 | 状态 | 交付物 | 关键说明 |
| :--- | :--- | :--- | :--- | :--- |
| **1** | 需求受理 | ❌ 未开始 | — | 占位：替换为真实交付物 |
| **2** | 设计定型 | ❌ 未开始 | — | 占位 |
| 🛑 **门禁 1** | 设计定稿确认 | ❌ 未通过 | — | 占位 |
| **3** | 实现 | ❌ 未开始 | — | 占位 |
| 🛑 **门禁 2** | 实现完成确认 | ❌ 未通过 | — | 占位 |
| **4** | 验证 | ❌ 未开始 | — | 占位 |
| **5** | 交付 | ❌ 未开始 | — | 占位 |
| **6** | 复盘 | ❌ 未开始 | — | 占位 |
`

const WBS = `# WBS 拆解明细（脚手架）

> 由 dsh-project-dev-flow 生成：三线（FE / BE / CONN）占位行，请替换为真实功能点与可失败断言。

| ID | 区域 | 功能点 | 验收标准（可失败） | 证据 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| FE-01 | 占位区域 | 占位功能点（请替换） | 占位断言：命令 + 期望输出 | 待填 | ❌ |
| FE-02 | 占位区域 | 占位功能点（请替换） | 占位断言 | 待填 | ❌ |
| BE-01 | 占位领域 | 占位接口（请替换） | 占位断言 | 待填 | ❌ |
| CONN-01 | 占位链路 | 占位环节（请替换） | 占位断言 | 待填 | ❌ |
`

const DECISIONS = `# 待裁决台账（脚手架）

> 由 dsh-project-dev-flow 生成：A 类需人拍板，B 类可先取证。

| # | 项 | 为什么需要人 | 关联 |
| :--- | :--- | :--- | :--- |
| A1 | 占位裁决项（请替换） | 占位：说明为什么必须由人决定 | — |

| # | 项 | 可能的复核方向 | 关联 |
| :--- | :--- | :--- | :--- |
| B1 | 占位取证项（请替换） | 占位：可先做取证、结论待人认 | — |
`

const ISSUES = `# 剩余问题（脚手架）

> 由 dsh-project-dev-flow 生成：已知缺口与限制，严重度用 🟡 / ❌。

| ID | 限制 | 用户侧影响 | 严重度 | 证据 / 现状 |
| :--- | :--- | :--- | :--- | :--- |
| P-1 | 占位限制（请替换） | 占位影响 | 🟡 | 待填 |
`

const NEXT = `# 下一步工作清单（脚手架）

> 由 dsh-project-dev-flow 生成：可执行事项与工作量。

| # | 事项 | 工作量 | 验收 |
| :--- | :--- | :--- | :--- |
| A1 | 占位下一步（请替换） | 0.5 天 | 占位验收口径 |
`

const FILES = [
  { name: '01_入口_项目状态看板.md', body: STATUS },
  { name: '31_验收_WBS拆解明细.md', body: WBS },
  { name: '04_入口_待裁决台账.md', body: DECISIONS },
  { name: '15_功能_剩余问题.md', body: ISSUES },
  { name: '17_功能_下一步工作清单.md', body: NEXT }
]

export function scaffoldDocs(root, options = {}) {
  const docsDir = options.docs ? resolve(root, options.docs) : resolve(root, 'docs')
  const plan = FILES.map((f) => ({ ...f, path: join(docsDir, f.name), exists: existsSync(join(docsDir, f.name)) }))
  const created = []
  const skipped = []
  if (options.write !== false) {
    mkdirSync(docsDir, { recursive: true })
    for (const item of plan) {
      if (item.exists) { skipped.push(item.name); continue }
      writeFileSync(item.path, item.body)
      created.push(item.name)
    }
  }
  return { docsDir, plan, created, skipped }
}

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

function main(argv) {
  const args = parseArgs(argv)
  if (args.error) { console.error(args.error); return 2 }
  if (args.help) {
    console.log('用法：node scripts/scaffold-docs.mjs --root <项目绝对路径> [--docs docs] [--write]')
    return 0
  }
  if (!isAbsolute(args.root)) { console.error('--root 必须是绝对路径'); return 2 }
  const result = scaffoldDocs(resolve(args.root), { docs: args.docs, write: args.write })
  const tag = args.write ? '' : '（dry-run）'
  console.log(`文档目录：${result.docsDir}${tag}`)
  for (const item of result.plan) {
    console.log(`  ${item.exists ? '已存在，跳过' : (args.write ? '已创建' : '将创建')}  ${item.name}`)
  }
  if (args.write) console.log(`创建 ${result.created.length} 份，跳过 ${result.skipped.length} 份`)
  else console.log('加 --write 才会落盘')
  return 0
}

const invoked = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(invoked)) process.exit(main(process.argv.slice(2)))
