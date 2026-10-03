// zg 查询与索引管理。
//
// 输出格式（zg 0.2.2 默认 agent markdown，spike 实测样本）：
//   query groups (1):
//   Q1 [primary]: <query>
//   hits: 5
//
//   #1 matchedBy=fts+vector src/paths.ts:4-6
//   heading: xxx            ← 可选（md 命中才有）
//   heading_level: 3        ← 可选
//   scope: aaa::bbb         ← 可选
//   4\tfunction foo() {     ← 内容行：行号 + TAB + 文本
//
//   无索引时：退出码非 0，stderr 首行含 `Code: ZVEC_GREP...`（156ms 快速失败）
import { isZgAvailable, runZg, runZgStream, type ZgRunResult } from './zg-runtime'
import { chmodSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'

export type ZgHit = {
  relPath: string
  lineStart: number
  lineEnd: number
  matchedBy: string
  heading?: string
  scope?: string
  // 内容行（已去掉行号前缀）
  lines: string[]
}

const QUERY_TIMEOUT_MS = 8_000
const INDEX_BUILD_TIMEOUT_MS = 10 * 60_000
const STATUS_TIMEOUT_MS = 10_000
const ZG_UNAVAILABLE_ERROR = '未找到 zg 运行文件，请重新安装完整的应用安装包'

// ── 输出解析 ──

const HIT_LINE = /^#(\d+)\s+matchedBy=(\S+)\s+(.+?):(\d+)(?:-(\d+))?\s*$/
const HEADING_LINE = /^heading:\s*(.*)$/
const SCOPE_LINE = /^scope:\s*(.*)$/
const CONTENT_LINE = /^\s*(\d+)\t(.*)$/

export function parseZgOutput(stdout: string): ZgHit[] {
  const hits: ZgHit[] = []
  let current: ZgHit | null = null
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const hitMatch = HIT_LINE.exec(line)
    if (hitMatch) {
      if (current) hits.push(current)
      current = {
        relPath: hitMatch[3],
        lineStart: Number(hitMatch[4]),
        lineEnd: hitMatch[5] ? Number(hitMatch[5]) : Number(hitMatch[4]),
        matchedBy: hitMatch[2],
        lines: []
      }
      continue
    }
    if (!current) continue
    const heading = HEADING_LINE.exec(line)
    if (heading) {
      current.heading = heading[1] || undefined
      continue
    }
    const scope = SCOPE_LINE.exec(line)
    if (scope) {
      current.scope = scope[1] || undefined
      continue
    }
    const content = CONTENT_LINE.exec(line)
    if (content) {
      current.lines.push(content[2])
      continue
    }
    // 空行 / 其他元数据行：hit 结束的信号交给下一个 hit 行或最终 flush
  }
  if (current) hits.push(current)
  return hits
}

// stderr 里的结构化错误码（如 ZVEC_GREP.ENGINE.SERVICE.WORKSPACE_INDEX_NOT_FOUND）
export function zgErrorCode(stderr: string): string | null {
  const match = /^Code:\s*(\S+)/m.exec(stderr)
  return match?.[1] ?? null
}

// ── 查询 ──

export type ZgQueryOptions = {
  limit?: number
  // -g glob 白名单（rg 语义，多个 = OR）。用于 visibleDirs 过滤
  globs?: string[]
  timeoutMs?: number
}

// 返回 null = zg 不可用/未就绪/超时等不可用态（调用方回退 legacy 扫描）；
// 返回数组（可能为空）= 查询成功。
export async function zgQuery(root: string, query: string, opts: ZgQueryOptions = {}): Promise<ZgHit[] | null> {
  if (!isZgAvailable()) return null
  const args = ['query', query, '--limit', String(opts.limit ?? 20)]
  for (const glob of opts.globs ?? []) args.push('-g', glob)
  const result = await runZg(args, { cwd: root, timeoutMs: opts.timeoutMs ?? QUERY_TIMEOUT_MS })
  if (result.killed) {
    console.warn('[zg] query timeout', { cwd: root })
    return null
  }
  if (result.code !== 0) {
    console.warn('[zg] query unavailable', {
      cwd: root,
      code: result.code,
      error: zgErrorCode(result.stderr) ?? clipLog(result.stderr)
    })
    return null
  }
  const hits = parseZgOutput(result.stdout)
  console.info('[zg] query hits', {
    cwd: root,
    hits: hits.length,
    matchedBy: countMatchedBy(hits)
  })
  return hits
}

export function countMatchedBy(hits: ZgHit[]): string {
  const counts = new Map<string, number>()
  for (const hit of hits) {
    counts.set(hit.matchedBy, (counts.get(hit.matchedBy) ?? 0) + 1)
  }
  return [...counts.entries()].map(([key, value]) => `${key}=${value}`).join(',')
}

function clipLog(text: string, max = 200): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`
}

// Node startup failures end with stack frames/version numbers. Preserve the
// actual module/process error instead of showing only the last two lines.
export function summarizeZgIndexError(text: string, exitCode: number, killed = false): string {
  if (killed) return '索引构建超时，进程已停止，可重新构建'
  const lines = text.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const code = zgErrorCode(lines.join('\n'))
  const error = lines.find(line => /^(?:Error(?:\s*\[[^\]]+\])?:|(?:Type|Syntax|Range|Reference)Error:|(?:EACCES|ENOENT):)/.test(line))
  const moduleDetail = lines.find(line => /Cannot find (?:package|module)/.test(line))
  if (!moduleDetail && /ERR_INTERNAL_ASSERTION/.test(text) && /ERR_MODULE_NOT_FOUND/.test(text)) {
    return 'zg 启动失败：依赖模块缺失（ERR_MODULE_NOT_FOUND），请检查或重新安装应用依赖'
  }
  const summary = moduleDetail ?? error ?? (code ? `Code: ${code}` : lines.slice(-2).join(' | '))
  return clipLog(summary || `zg index exited ${exitCode}`, 600)
}

// ── 就绪探测 ──

export async function zgCheckReady(root: string): Promise<boolean> {
  if (!isZgAvailable()) return false
  const result = await runZg(['status', '--check-ready'], { cwd: root, timeoutMs: STATUS_TIMEOUT_MS })
  return result.code === 0
}

export type ZgIndexStats = {
  filesIndexed: number
  filesTotal: number
  entities: number
  embedding?: string
  // 后台向量增强队列（daemon 补齐 embedding 中）
  queuePending?: number
  // 索引标记为失败（如 ZVEC_GREP.ENGINE.LOCK.BUSY 并发锁冲突）
  failed?: boolean
  errorCode?: string
}

// 解析 `zg status` 的人类可读输出（spike 实测样例）：
//   Coverage    ████████████████████ 100%  68 / 68 files
//   Entities    1,078
//   Queue       0 pending · 0 failed
//   Embedding   local/potion-code-16m-v2
//   Error       ZVEC_GREP.ENGINE.LOCK.BUSY        ← 失败时才有
export function parseZgStatus(stdout: string): ZgIndexStats | null {
  // 数字带千分位逗号（如 2,323 / 2,323 files）
  const coverage = /([\d,]+)\s*\/\s*([\d,]+)\s*files/.exec(stdout)
  if (!coverage) return null
  const entities = /Entities\s+([\d,]+)/.exec(stdout)
  const embedding = /Embedding\s+(\S+)/.exec(stdout)
  const queue = /Queue\s+([\d,]+)\s+pending/.exec(stdout)
  const errorCode = /^\s*Error\s+(ZVEC_GREP\.\S+)/m.exec(stdout)
  return {
    filesIndexed: Number(coverage[1].replace(/,/g, '')),
    filesTotal: Number(coverage[2].replace(/,/g, '')),
    entities: entities ? Number(entities[1].replace(/,/g, '')) : 0,
    ...(embedding ? { embedding: embedding[1] } : {}),
    ...(queue ? { queuePending: Number(queue[1].replace(/,/g, '')) } : {}),
    ...(errorCode ? { failed: true, errorCode: errorCode[1] } : {})
  }
}

// `zg status` 封装：失败/锁忙自动重试（daemon 后台增强持锁时 CLI 会拿到
// 瞬时 LOCK.BUSY，而非真实故障）
async function zgStatusWithRetry(root: string, attempts = 3): Promise<ZgRunResult> {
  let last: ZgRunResult = { code: -1, stdout: '', stderr: '', killed: false }
  for (let i = 0; i < attempts; i++) {
    last = await runZg(['status'], { cwd: root, timeoutMs: STATUS_TIMEOUT_MS })
    const busy = /LOCK\.BUSY/.test(last.stdout) || /LOCK\.BUSY/.test(last.stderr)
    if (last.code === 0 && !busy) return last
    if (!busy) break
    await new Promise((resolve) => setTimeout(resolve, 1_500 * (i + 1)))
  }
  return last
}

export async function zgIndexStats(root: string): Promise<ZgIndexStats | null> {
  if (!isZgAvailable()) return null
  const result = await zgStatusWithRetry(root)
  if (result.code !== 0) return null
  const stats = parseZgStatus(result.stdout)
  if (stats) {
    console.info('[zg] status', {
      cwd: root,
      files: `${stats.filesIndexed}/${stats.filesTotal}`,
      entities: stats.entities,
      embedding: stats.embedding,
      queuePending: stats.queuePending ?? 0,
      failed: stats.failed ?? false,
      errorCode: stats.errorCode
    })
  }
  return stats
}

// 进程存活探测（ESRCH = 不存在）
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 陈旧状态自愈（用户中途关闭/强杀应用后的残留）：
//   1. locks/daemon.json（daemon 租约）记录的 pid 已死 → 租约 + 读写锁残留，
//      后续 index 全部 DAEMON_LEASE_ACTIVE / LOCK.BUSY → 清除
//   2. Git 池 clone 后源码是 555，zg 索引写在 <root>/.zvec-grep。写入前恢复
//      本用户对 root（以便首次 mkdir）和 .zvec-grep 的写权限，否则 EACCES。
// 尽力而为：任何一步失败都由后续 index 错误路径兜底。
export function prepareZgIndexWorkspace(root: string): void {
  try {
    const stats = statSync(root)
    if (stats.isDirectory()) chmodSync(root, (stats.mode & 0o777) | 0o700)
  } catch (error) {
    console.warn('[zg] 无法恢复索引根目录写权限:', root, error instanceof Error ? error.message : error)
  }
  const zgDir = join(root, '.zvec-grep')
  const locksDir = join(zgDir, 'locks')
  try {
    const leasePath = join(locksDir, 'daemon.json')
    const leaseRaw = readFileSync(leasePath, 'utf-8')
    const lease = JSON.parse(leaseRaw) as { pid?: number; hostname?: string }
    // 仅清理本机死进程的租约；远端主机 / 活进程的租约不动
    if (typeof lease.pid === 'number' && lease.hostname === hostname() && !pidAlive(lease.pid)) {
      rmSync(leasePath, { force: true })
      rmSync(join(locksDir, 'home.write'), { recursive: true, force: true })
      rmSync(join(locksDir, 'home.readers'), { recursive: true, force: true })
      console.warn('[zg] 清除陈旧 daemon 租约（pid 已死）:', lease.pid, root)
    }
  } catch {
    // 无租约 / 解析失败 → 无需处理
  }
  try {
    chmodRecursive(zgDir)
  } catch {
    // 权限恢复失败 → index 报错路径兜底
  }
}

function chmodRecursive(dir: string): void {
  let stats
  try {
    stats = statSync(dir)
  } catch {
    return
  }
  if (!stats.isDirectory()) {
    try { chmodSync(dir, 0o644) } catch (error) {
      console.warn('[zg] chmod file failed:', dir, error instanceof Error ? error.message : error)
    }
    return
  }
  try { chmodSync(dir, 0o755) } catch (error) {
    console.warn('[zg] chmod dir failed:', dir, error instanceof Error ? error.message : error)
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    chmodRecursive(join(dir, entry.name))
  }
}

// ── 构建进度解析（zg index 流式输出，spike 实测样例）──
//   Scanning files...                                → phase=scan
//   Preparing local/potion-code-16m-v2              → phase=model（仅首次）
//   Downloading local/... · 42% · 13 MiB/32 MiB      → phase=model percent=42（\r 刷新）
//   Indexing complete                                → phase=index
//   files\t2,323 scanned, 12 added, ...              → filesTotal
//   entities\t27,406                                 → entities
export type ZgIndexProgress = {
  phase: 'scan' | 'model' | 'index' | 'done'
  percent?: number
  filesTotal?: number
  entities?: number
  detail?: string
}

export function deriveZgIndexProgress(text: string): ZgIndexProgress {
  const progress: ZgIndexProgress = { phase: 'scan' }
  const preparing = /Preparing\s+(\S+)/.exec(text)
  const downloading = /Downloading\s+(\S+)/.exec(text)
  if (preparing || downloading) {
    progress.phase = 'model'
    progress.detail = preparing?.[1] ?? downloading?.[1]
  }
  const percent = /(\d+)%/.exec(text.slice(-400))
  if (progress.phase === 'model' && percent) {
    progress.percent = Number(percent[1])
  }
  if (/Indexing complete/.test(text)) {
    progress.phase = 'index'
  }
  const files = /files\s+([\d,]+)\s+scanned/.exec(text)
  if (files) {
    progress.phase = 'done'
    progress.filesTotal = Number(files[1].replace(/,/g, ''))
  }
  const entities = /entities\s+([\d,]+)/i.exec(text)
  if (entities) progress.entities = Number(entities[1].replace(/,/g, ''))
  return progress
}

// 索引构建封装：
//   - 构建前做陈旧租约/权限自愈（覆盖"解析一半关闭应用"场景）
//   - 流式解析阶段/百分比，经 onProgress 实时上报（参照 zg TUI 的分步进度）
//   - LOCK.BUSY：区分"死进程陈旧锁"（自愈后立即重试）与"daemon 正在做索引"
//     （活进程持锁，退避等待——它完成后我们的增量即可进行）
export async function zgIndexBuild(
  root: string,
  timeoutMs = INDEX_BUILD_TIMEOUT_MS,
  onProgress?: (progress: ZgIndexProgress) => void
): Promise<boolean> {
  if (!isZgAvailable()) {
    lastError.set(root, ZG_UNAVAILABLE_ERROR)
    return false
  }
  const attempts = 5
  console.info('[zg] index start', { cwd: root, timeoutMs, attempts })
  for (let attempt = 0; attempt < attempts; attempt++) {
    prepareZgIndexWorkspace(root)
    let combined = ''
    let lastEmit = 0
    const emit = (force = false): void => {
      const now = Date.now()
      if (!force && now - lastEmit < 400) return
      lastEmit = now
      try {
        onProgress?.(deriveZgIndexProgress(combined))
      } catch { /* 回调异常不影响构建 */ }
    }
    const result = await runZgStream(['index'], { cwd: root, timeoutMs }, (stream, text) => {
      combined += text
      emit()
    })
    emit(true)
    if (result.code === 0 && !result.killed) {
      const summary = deriveZgIndexProgress(combined)
      console.info('[zg] index ok', {
        cwd: root,
        attempt: attempt + 1,
        filesTotal: summary.filesTotal,
        entities: summary.entities,
        phase: summary.phase
      })
      return true
    }
    combined += result.stderr
    const busy = /LOCK\.BUSY|DAEMON_LEASE_ACTIVE/.test(combined)
    if (!busy) {
      const detail = summarizeZgIndexError(combined, result.code, result.killed)
      lastError.set(root, detail || `zg index exited ${result.code}`)
      console.warn('[zg] index fail', { cwd: root, code: result.code, killed: result.killed, detail })
      return false
    }
    console.warn('[zg] index lock busy, retry', { cwd: root, attempt: attempt + 1 })
    await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)))
  }
  lastError.set(root, 'zg index 锁忙（daemon 正在索引或租约未释放），已重试 5 次')
  console.warn('[zg] index fail', { cwd: root, detail: lastError.get(root) })
  return false
}

// ── 索引构建（进程级串行 + 冷却） ──

export type ZgIndexState = 'idle' | 'building' | 'ready' | 'error'

const INDEX_REBUILD_COOLDOWN_MS = 5 * 60_000
const building = new Map<string, Promise<boolean>>()
const lastBuiltAt = new Map<string, number>()
const lastError = new Map<string, string>()

export function zgIndexState(root: string): ZgIndexState {
  if (building.has(root)) return 'building'
  return lastError.get(root) ? 'error' : 'idle'
}

export function zgIndexError(root: string): string | undefined {
  return lastError.get(root)
}

// 后台确保索引存在/刷新。并发去重；成功后 5 分钟冷却内不重复构建。
// 返回 true = 索引已就绪（含刚建完）。onProgress 实时上报构建阶段。
export async function ensureZgIndex(
  root: string,
  opts: { force?: boolean; onProgress?: (progress: ZgIndexProgress) => void } = {}
): Promise<boolean> {
  if (!isZgAvailable()) {
    lastError.set(root, ZG_UNAVAILABLE_ERROR)
    return false
  }
  const inflight = building.get(root)
  if (inflight) return inflight

  const builtAt = lastBuiltAt.get(root)
  if (!opts.force && builtAt && Date.now() - builtAt < INDEX_REBUILD_COOLDOWN_MS) {
    return await zgCheckReady(root)
  }

  const task = (async (): Promise<boolean> => {
    const ok = await zgIndexBuild(root, INDEX_BUILD_TIMEOUT_MS, opts.onProgress)
    if (ok) {
      lastBuiltAt.set(root, Date.now())
      lastError.delete(root)
      return true
    }
    return false
  })()
  building.set(root, task)
  try {
    return await task
  } finally {
    building.delete(root)
  }
}

// 测试用：清运行状态（生产代码不要调用）
export function resetZgSearchStateForTests(): void {
  building.clear()
  lastBuiltAt.clear()
  lastError.clear()
}
