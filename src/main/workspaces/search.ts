// 工作区/知识库全文检索。
//
// 主路径：zg（zvec-grep）混合检索（ripgrep + BM25 + 向量，本地无 AI）——
//   每个 root（工作区根 / 各 knowledge 绑定的资源池）并行一次 `zg query`，
//   按相关性排序返回。zg 不可用、索引未就绪或查询失败时，对该 root 回退
//   legacy 子串扫描（legacy-text-scan），并在后台触发 `zg index` 构建，
//   下次搜索即可用上索引。
// 输出契约：结果带 engine/matchedBy，并附 trace（zg 根数 vs 回退根数）。
import { basename } from 'node:path'
import type {
  ExternalRef,
  ExternalRefBinding,
  WorkspaceSearchEngine,
  WorkspaceSearchTrace,
  WorkspaceTextSearchResultItem
} from '@shared/types'
import { UIClientError } from '../ipc/errors'
import { externalPoolStore } from '../external-pool/store'
import { WorkspacesStore } from './store'
import { readRefs } from './refs'
import { legacyScanRoot } from './legacy-text-scan'
import { ensureZgIndex, zgIndexError, zgQuery, type ZgHit } from '../zg/zg-search'
import { isZgAvailable, resolveZgScript } from '../zg/zg-runtime'

const MAX_RESULTS = 80
const ZG_RESULTS_PER_ROOT = 25

// 工作区根检索时跳过的应用私有/生成目录（zg 默认只跳过常规噪声，
// 这里在结果侧再做一层过滤，零 glob 语义风险）
const WORKSPACE_EXCLUDED_PREFIXES = [
  '.git/',
  '.ui-client/',
  '.workspace/',
  '.claude/',
  '.external/',
  'node_modules/',
  '.zvec-grep/'
]

type SearchHitDraft = Omit<WorkspaceTextSearchResultItem, 'engine' | 'matchedBy'>

type RootSpec = {
  // zg query / legacy scan 的 cwd
  root: string
  // 结果 relPath 过滤（visibleDirs 白名单 / 工作区私有目录黑名单）
  pathFilter?: (relPath: string) => boolean
  makeItem: (relPath: string, title: string, snippet: string) => SearchHitDraft
}

type RootSearchOutcome = {
  engine: WorkspaceSearchEngine
  items: WorkspaceTextSearchResultItem[]
}

function attachEngine(
  draft: SearchHitDraft,
  engine: WorkspaceSearchEngine,
  matchedBy?: string
): WorkspaceTextSearchResultItem {
  return matchedBy
    ? { ...draft, engine, matchedBy } as WorkspaceTextSearchResultItem
    : { ...draft, engine } as WorkspaceTextSearchResultItem
}

const store = new WorkspacesStore()

async function resolveProjectWorkspace(workspaceId: string): Promise<{ path: string }> {
  const workspace = await store.findById(workspaceId)
  if (!workspace) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
  if (workspace.kind !== 'project') {
    throw new UIClientError('VALIDATION', '仅普通项目支持全项目文本搜索')
  }
  return { path: workspace.path }
}

async function listKnowledgeRefs(workspacePath: string): Promise<Array<{ binding: ExternalRefBinding; ref: ExternalRef }>> {
  const [bindings, refs] = await Promise.all([
    readRefs(workspacePath),
    externalPoolStore.list()
  ])
  const byId = new Map(refs.map((ref) => [ref.id, ref]))
  return bindings.flatMap((binding) => {
    const ref = byId.get(binding.externalRefId)
    if (!ref || ref.category !== 'knowledge') return []
    return [{ binding, ref }]
  })
}

function hitTitle(hit: ZgHit): string {
  // md 命中带 heading（zg 抽取的小节标题），比文件名更有辨识度
  return hit.heading || basename(hit.relPath)
}

function hitSnippet(hit: ZgHit): string {
  const text = hit.lines.join('\n').trim()
  if (text.length <= 180) return text
  return `${text.slice(0, 180)}...`
}

function relPathAllowed(relPath: string, prefixes: string[] | null): boolean {
  const normalized = relPath.replace(/\\/g, '/')
  if (prefixes === null) {
    return !WORKSPACE_EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  }
  return prefixes.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`))
}

// 单 root 检索：zg 优先，失败回退 legacy 并后台建索引。
// 引擎选择记 info 日志（dev 终端/主进程日志可见），便于确认真实走了 zg。
async function searchRoot(spec: RootSpec, query: string): Promise<RootSearchOutcome> {
  if (isZgAvailable()) {
    const hits = await zgQuery(spec.root, query, { limit: ZG_RESULTS_PER_ROOT })
    if (hits !== null) {
      const items = hits
        .filter((hit) => !spec.pathFilter || spec.pathFilter(hit.relPath))
        .map((hit) => attachEngine(spec.makeItem(hit.relPath, hitTitle(hit), hitSnippet(hit)), 'zg', hit.matchedBy))
      console.info(`[workspace-search] engine=zg hits=${items.length} matchedBy=${countMatchedByLog(items)} root=${spec.root}`)
      return { engine: 'zg', items }
    }
    // 索引未就绪/失败：后台构建（冷却去重），本轮走 legacy
    console.warn(`[workspace-search] engine=legacy(fallback:${zgIndexError(spec.root) ?? 'no-index'}) root=${spec.root}`)
    void ensureZgIndex(spec.root).catch(() => undefined)
  }
  const scanHits = await legacyScanRoot(spec.root, query, {
    maxResults: ZG_RESULTS_PER_ROOT,
    pathFilter: spec.pathFilter
  })
  return {
    engine: 'legacy',
    items: scanHits.map((hit) => attachEngine(spec.makeItem(hit.relPath, basename(hit.relPath), hit.snippet), 'legacy'))
  }
}

function countMatchedByLog(items: WorkspaceTextSearchResultItem[]): string {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = item.matchedBy ?? item.engine
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].map(([key, value]) => `${key}=${value}`).join(',')
}

export async function searchWorkspaceText(
  workspaceId: string,
  query: string
): Promise<{ query: string; results: WorkspaceTextSearchResultItem[]; trace: WorkspaceSearchTrace }> {
  const emptyTrace = (): WorkspaceSearchTrace => ({
    zgAvailable: isZgAvailable(),
    zgScript: resolveZgScript(),
    zgRoots: 0,
    legacyRoots: 0,
    durationMs: 0
  })
  const trimmed = query.trim()
  if (!trimmed) return { query: trimmed, results: [], trace: emptyTrace() }

  const startedAt = Date.now()
  const workspace = await resolveProjectWorkspace(workspaceId)
  const specs: RootSpec[] = [
    {
      root: workspace.path,
      makeItem: (relPath, title, snippet) => ({
        source: 'workspace',
        relPath,
        title,
        snippet
      })
    }
  ]

  for (const { binding, ref } of await listKnowledgeRefs(workspace.path)) {
    const visibleDirs = (binding.visibleDirs ?? []).map((dir) => dir.replace(/^\/+|\/+$/g, '')).filter(Boolean)
    const refId = ref.id
    const alias = binding.alias
    const poolPath = ref.poolPath
    const category = ref.category
    specs.push({
      root: poolPath,
      pathFilter: visibleDirs.length > 0
        ? (relPath) => relPathAllowed(relPath, visibleDirs)
        : undefined,
      makeItem: (relPath, title, snippet) => ({
        source: 'external',
        externalRefId: refId,
        externalAlias: alias,
        externalCategory: category,
        relPath,
        title,
        snippet
      })
    })
  }

  // 各 root 并行；单 root 失败不影响其他（searchRoot 内部已兜底，这里再兜一层）
  const settled = await Promise.allSettled(specs.map((spec) => searchRoot(spec, trimmed)))
  const results: WorkspaceTextSearchResultItem[] = []
  let zgRoots = 0
  let legacyRoots = 0
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]
    if (outcome.status === 'fulfilled') {
      if (outcome.value.engine === 'zg') zgRoots += 1
      else legacyRoots += 1
      results.push(...outcome.value.items)
    } else {
      console.warn('[workspace-search] root search failed:', specs[i].root, outcome.reason)
    }
  }

  if (results.length < MAX_RESULTS) {
    // 有 zg 索引报错时便于诊断（不抛错，搜索始终有 legacy 兜底）
    for (const spec of specs) {
      const error = zgIndexError(spec.root)
      if (error) console.warn('[workspace-search] zg index error:', spec.root, error)
    }
  }

  const trace: WorkspaceSearchTrace = {
    zgAvailable: isZgAvailable(),
    zgScript: resolveZgScript(),
    zgRoots,
    legacyRoots,
    durationMs: Date.now() - startedAt
  }
  console.info('[workspace-search] done', {
    query: trimmed.slice(0, 80),
    results: results.slice(0, MAX_RESULTS).length,
    ...trace
  })

  return {
    query: trimmed,
    results: results.slice(0, MAX_RESULTS),
    trace
  }
}

// 供外部（如需要触发索引预建）使用
export function ensureWorkspaceSearchIndexes(workspacePath: string): void {
  void ensureZgIndex(workspacePath).catch(() => undefined)
}
