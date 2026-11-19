#!/usr/bin/env node
/**
 * 按节读取包内方法文件：只输出指定小节，避免把整份方法读进上下文。
 *
 * 用法:
 *   node scripts/section.mjs <名称|路径> <起始节> [结束节]
 *
 * - 名称不带扩展名且不含路径分隔符时，按包根 `methods/<名称>.md` 解析；
 *   含分隔符或绝对路径时按文件路径解析。
 * - 节号对应 Markdown 的 `## <n>.` 二级标题；省略结束节时只输出该节。
 *
 * 退出码: 0 打印成功；1 文件或小节不存在；2 参数错误。
 */
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const usage = '用法: node scripts/section.mjs <名称|路径> <起始节> [结束节]'
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 解析目标文件：裸名称指向包内 methods/，其余按路径处理。 */
function resolveTarget(target) {
  const looksLikePath = isAbsolute(target) || target.includes('/') || target.includes('\\')
  if (looksLikePath) return resolve(target)
  const name = target.endsWith('.md') ? target : `${target}.md`
  return join(packageRoot, 'methods', name)
}

/** 返回该节二级标题所在的行下标，找不到返回 -1。 */
function sectionStart(lines, number) {
  for (let index = 0; index < lines.length; index += 1) {
    if (new RegExp(`^##\\s+${number}\\.(?:\\s|$)`).test(lines[index])) return index
  }
  return -1
}

/** 返回该节之后第一个二级标题的行下标，没有返回文件长度。 */
function sectionEnd(lines, start, number) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (new RegExp(`^##\\s+${number}\\.(?:\\s|$)`).test(lines[index])) return index
    if (/^##\s/.test(lines[index])) return index
  }
  return lines.length
}

const [target, fromArg, toArg] = process.argv.slice(2)
if (target === undefined || fromArg === undefined) {
  console.error(usage)
  process.exit(2)
}

const from = Number.parseInt(fromArg, 10)
const to = toArg === undefined ? from : Number.parseInt(toArg, 10)
if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
  console.error('section: 节号必须是正整数，且起始节不大于结束节')
  process.exit(2)
}

let lines
try {
  lines = readFileSync(resolveTarget(target), 'utf8').split(/\r?\n/)
} catch (error) {
  console.error(`section: 读不到文件 ${target}（${error.code ?? error.message}）`)
  process.exit(1)
}

const start = sectionStart(lines, from)
if (start < 0) {
  console.error(`section: 文件里没有 §${from}`)
  process.exit(1)
}
let end
if (to === from) {
  end = sectionEnd(lines, start, to)
} else {
  const last = sectionStart(lines, to)
  if (last < 0) {
    console.error(`section: 文件里没有 §${to}`)
    process.exit(1)
  }
  end = sectionEnd(lines, last, to)
}

console.log(lines.slice(start, end).join('\n').trimEnd())
