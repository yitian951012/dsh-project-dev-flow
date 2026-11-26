/**
 * project-registry.mjs — 绑定项目的持久化注册表（单一事实源）。
 *
 * 位置：<profile>/plugin-data/yitian951012.dsh-project-dev-flow/projects.json
 * 约定：只写这个文件；config 里的 projects 视为“手写默认”，合并时优先。
 * 原子写：同目录 tmp → rename；进程内串行。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

const PACKAGE_DIR = 'yitian951012.dsh-project-dev-flow'
const FILE = 'projects.json'

/** 解析注册表路径：profileContext.dir > DSH_PROFILE_DIR > DSH_HOME/profiles/<DSH_PROFILE> > ~/.dsh。 */
export function registryPath(runtime = {}) {
  const ctx = runtime.ctx
  const profileDir = (ctx && typeof ctx.get === 'function' ? ctx.get('profileContext') : null)?.dir
    || process.env.DSH_PROFILE_DIR
  if (profileDir) return join(profileDir, 'plugin-data', PACKAGE_DIR, FILE)

  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const profile = process.env.DSH_PROFILE
  if (profile) return join(home, 'profiles', profile, 'plugin-data', PACKAGE_DIR, FILE)
  return join(home, 'plugin-data', PACKAGE_DIR, FILE)
}

export function readRegistry(file) {
  if (!file || !existsSync(file)) return { projects: [], error: null, mtimeMs: 0 }
  try {
    const text = readFileSync(file, 'utf8')
    const data = JSON.parse(text)
    const projects = Array.isArray(data?.projects) ? data.projects : []
    return { projects, error: null, mtimeMs: statSync(file).mtimeMs }
  } catch (error) {
    // 坏文件不静默覆盖：交给调用方决定是否重建。
    return { projects: [], error: `注册表无法解析：${String(error?.message ?? error)}`, mtimeMs: 0 }
  }
}

let queue = Promise.resolve()

/** 原子写；同一进程内串行，避免两个并发绑定互相覆盖。 */
export function writeRegistry(file, projects) {
  const run = () => {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, `${JSON.stringify({ schemaVersion: 1, projects }, null, 2)}\n`)
    renameSync(tmp, file)
  }
  queue = queue.then(run, run)
  return queue
}

/** 合并：config（手写默认）优先；按绝对路径去重。 */
export function mergeProjects(configProjects, registryProjects) {
  const seen = new Set()
  const out = []
  for (const p of [...configProjects, ...registryProjects]) {
    if (!p || typeof p !== 'object') continue
    const root = typeof p.root === 'string' ? resolve(p.root) : ''
    if (!root || seen.has(root)) continue
    seen.add(root)
    out.push(p)
  }
  return out
}

/** 生成不与现有 id 冲突的项目 id。 */
export function uniqueProjectId(projects, base) {
  const taken = new Set(projects.map((p) => String(p?.id ?? '')))
  const clean = String(base || 'project')
  if (!taken.has(clean)) return clean
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${clean}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${clean}-${Date.now()}`
}
