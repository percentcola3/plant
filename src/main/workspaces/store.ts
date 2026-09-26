import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { Workspace } from '@shared/types'
import { workspacesJsonPath } from './paths'

// userData/workspaces.json 持久化。与 projects.json 并存（双轨期）。
// 风格仿 ProjectsStore：模块级 sharedCache 防止多 IPC handler 实例缓存不一致。
//
// schemaVersion:
//   v1: hidden?: boolean（AI task 唯一用途）
//   v2: hidden?: 'space' | 'ai-task'；新增 parentWorkspaceId / spaceSlug
//
// 老版本 App 若读到 v2 数据，未识别的 hidden 字符串会被 sidebar 的 !w.hidden 当"有值 = 隐藏"处理，
// 不会崩溃但可能看到 AI task 混进 workspace 列表。反过来（新版读 v1）由下面 normalize 兜底。

const SCHEMA_VERSION = 2

type WorkspacesFile = {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  schemaVersion: typeof SCHEMA_VERSION
}

const EMPTY: WorkspacesFile = { workspaces: [], activeWorkspaceId: null, schemaVersion: SCHEMA_VERSION }

let sharedCache: WorkspacesFile | null = null

export function _testOnlyResetSharedCache(): void {
  sharedCache = null
}

// v1 → v2 迁移：hidden: true 是 AI task 唯一遗留形态，归一到 hidden: 'ai-task'。
// 顺带补齐 parentWorkspaceId（从 baseWorkspaceId 抄），让新代码分支统一读 parentWorkspaceId。
function normalizeWorkspace(raw: unknown): Workspace {
  const w = raw as Workspace & { hidden?: boolean | 'space' | 'ai-task' }
  const next: Workspace = { ...w }
  if ((w.hidden as unknown) === true) {
    next.hidden = 'ai-task'
  } else if (w.hidden === 'space' || w.hidden === 'ai-task') {
    next.hidden = w.hidden
  } else {
    delete next.hidden
  }
  if (!next.parentWorkspaceId && next.baseWorkspaceId) {
    next.parentWorkspaceId = next.baseWorkspaceId
  }
  return next
}

function firstVisibleWorkspaceId(workspaces: Workspace[]): string | null {
  return workspaces.find((w) => !w.hidden)?.id ?? null
}

function visibleParentId(workspace: Workspace | undefined, byId: Map<string, Workspace>): string | null {
  const parentId = workspace?.parentWorkspaceId ?? workspace?.baseWorkspaceId
  if (!parentId) return null
  const parent = byId.get(parentId)
  return parent && !parent.hidden ? parent.id : null
}

function migrateLoadedWorkspaces(
  rawWorkspaces: Workspace[],
  rawActiveWorkspaceId: string | null
): { workspaces: Workspace[]; activeWorkspaceId: string | null; changed: boolean } {
  const normalized = rawWorkspaces.map(normalizeWorkspace)
  const normalizedById = new Map(normalized.map((w) => [w.id, w]))
  const activeBefore = rawActiveWorkspaceId ? normalizedById.get(rawActiveWorkspaceId) : undefined

  let workspaces = normalized
  let changed = JSON.stringify(normalized) !== JSON.stringify(rawWorkspaces)

  // 历史 hidden='space' 代表「把 space 当独立 workspace」。现在 space worktree
  // 仍存在，但由 parent workspace 的 path 指向；因此 active 若在旧 hidden space，
  // 先把 parent path 迁到那个 worktree，再把 active 迁回 parent。
  if (activeBefore?.hidden === 'space') {
    const parentId = activeBefore.parentWorkspaceId ?? activeBefore.baseWorkspaceId
    if (parentId) {
      workspaces = workspaces.map((w) => {
        if (w.id !== parentId || w.hidden || w.path === activeBefore.path) return w
        changed = true
        return { ...w, path: activeBefore.path }
      })
    }
  }

  // AI task 不再拥有独立 workspace。旧数据里遗留的 hidden AI task workspace
  // 只会导致重启后 active 落在派生工作区，直接从索引里清掉。
  const withoutLegacyAiTask = workspaces.filter((w) => w.hidden !== 'ai-task')
  if (withoutLegacyAiTask.length !== workspaces.length) changed = true
  workspaces = withoutLegacyAiTask

  const byId = new Map(workspaces.map((w) => [w.id, w]))
  const activeCandidate = rawActiveWorkspaceId ? byId.get(rawActiveWorkspaceId) : undefined
  let activeWorkspaceId = rawActiveWorkspaceId

  if (activeCandidate?.hidden) {
    activeWorkspaceId = visibleParentId(activeCandidate, byId) ?? firstVisibleWorkspaceId(workspaces)
  } else if (rawActiveWorkspaceId && !activeCandidate) {
    activeWorkspaceId = visibleParentId(activeBefore, byId) ?? firstVisibleWorkspaceId(workspaces)
  }
  if (activeWorkspaceId !== rawActiveWorkspaceId) changed = true

  return { workspaces, activeWorkspaceId, changed }
}

export class WorkspacesStore {
  async load(): Promise<WorkspacesFile> {
    if (sharedCache) return sharedCache
    const path = workspacesJsonPath()
    try {
      const text = await fs.readFile(path, 'utf-8')
      const parsed = JSON.parse(text) as WorkspacesFile
      if (!Array.isArray(parsed.workspaces)) {
        sharedCache = { ...EMPTY }
      } else {
        const migrated = migrateLoadedWorkspaces(parsed.workspaces, parsed.activeWorkspaceId ?? null)
        sharedCache = {
          workspaces: migrated.workspaces,
          activeWorkspaceId: migrated.activeWorkspaceId,
          schemaVersion: SCHEMA_VERSION
        }
        if (migrated.changed || parsed.schemaVersion !== SCHEMA_VERSION) {
          await this.save().catch(() => undefined)
        }
      }
    } catch {
      sharedCache = { ...EMPTY }
    }
    return sharedCache
  }

  async save(): Promise<void> {
    if (!sharedCache) return
    const path = workspacesJsonPath()
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, JSON.stringify(sharedCache, null, 2), 'utf-8')
  }

  // 默认返回全部 workspace（含 hidden）。renderer 端多处逻辑依赖能通过 list 查到
  // 历史 hidden workspace 仍需要能被按 id 查到，便于迁移期读取 metadata。
  //   - external-pool.service 遍历所有 workspace 做 ref sync
  // Sidebar 展示由 renderer 端判断（WorkspaceSidebar.vue 已用 !w.hidden 过滤）。
  // { visibleOnly: true } 明确"只要用户可见的"，预留给 sidebar IPC 未来收敛用。
  async list(opts: { visibleOnly?: boolean } = {}): Promise<Workspace[]> {
    const f = await this.load()
    if (opts.visibleOnly) return f.workspaces.filter((w) => !w.hidden)
    return [...f.workspaces]
  }

  async activeId(): Promise<string | null> {
    const f = await this.load()
    return f.activeWorkspaceId
  }

  async findById(id: string): Promise<Workspace | null> {
    const f = await this.load()
    return f.workspaces.find((w) => w.id === id) ?? null
  }

  async findByPath(absPath: string): Promise<Workspace | null> {
    const f = await this.load()
    return f.workspaces.find((w) => w.path === absPath) ?? null
  }

  async add(ws: Workspace, options: { makeActive?: boolean } = {}): Promise<void> {
    const f = await this.load()
    if (f.workspaces.some((w) => w.id === ws.id)) {
      throw new Error(`Workspace ${ws.id} already exists`)
    }
    f.workspaces.unshift(ws)
    if (options.makeActive !== false) {
      f.activeWorkspaceId = ws.id
    }
    await this.save()
  }

  async remove(id: string): Promise<void> {
    const f = await this.load()
    f.workspaces = f.workspaces.filter((w) => w.id !== id)
    if (f.activeWorkspaceId === id) {
      f.activeWorkspaceId = f.workspaces[0]?.id ?? null
    }
    await this.save()
  }

  async setActive(id: string | null): Promise<void> {
    const f = await this.load()
    if (id !== null && !f.workspaces.some((w) => w.id === id)) {
      throw new Error(`Workspace ${id} not found`)
    }
    f.activeWorkspaceId = id
    if (id) {
      const w = f.workspaces.find((x) => x.id === id)
      if (w) w.lastActiveAt = new Date().toISOString()
    }
    await this.save()
  }

  async updateWorkspace(id: string, patch: Partial<Workspace>): Promise<void> {
    const f = await this.load()
    const idx = f.workspaces.findIndex((w) => w.id === id)
    if (idx === -1) throw new Error(`Workspace ${id} not found`)
    const { id: _ignored, ...safe } = patch
    f.workspaces[idx] = { ...f.workspaces[idx], ...safe }
    await this.save()
  }
}
