import { join } from 'node:path'
import type { DocTreeNode, ExternalRefBinding, UikitAssetSummary, Workspace, WorkspaceScanResult } from '@shared/types'
import { WorkspacesStore } from './store'
import { scanWorkspace } from './scanner'
import { readRefs } from './refs'
import { readFileTree } from './doc-tree'
import { UIClientError } from '../ipc/errors'
import { scanUikitAssetSummary } from '../uikit/summary'
import { projectWatcher } from '../projects/watcher'
import { bindAutoSave, catchUpPush } from '../saga/auto-save'
import { resumeWorkspaceSagas } from '../saga/service'
import { syncWorkspaceTemplates } from './templates'
import { writeActiveWorkArea, type ActiveWorkArea } from './work-area'
import {
  ensureDefaultKnowledgeWorkspace as ensureDefaultKnowledgeWorkspaceLifecycle,
  ensureDefaultWorkspace as ensureDefaultWorkspaceLifecycle
} from './lifecycle'
import { resolvePersonalSpaceWorktreePath } from './personal-space'
import { isSimpleWorkspace } from '@shared/workspace-policy'
import { readGitCapability } from '../git/capability'
import {
  addExternalRef,
  attachExternalRef,
  listExternalRefs
} from '../external-pool/service'
import { enqueueWorkspaceScopeTransition } from './scope-transition'

// IPC handler 调用入口的薄封装。Workspace / Requirement 维度。
// 外部池增删改与挂载/卸载迁到 main/external-pool/service.ts。

const store = new WorkspacesStore()

export async function listWorkspaces(): Promise<Workspace[]> {
  return (await store.list()).filter((workspace) => workspace.isDefault)
}

export async function ensureDefaultKnowledgeWorkspace(): Promise<Workspace> {
  return ensureDefaultKnowledgeWorkspaceLifecycle()
}

export async function ensureDefaultWorkspace(): Promise<Workspace> {
  const workspace = await ensureDefaultWorkspaceLifecycle()
  let ready = workspace
  try {
    await ensureDefaultClipLibraryBinding(workspace)
  } catch (error) {
    ready = {
      ...workspace,
      externalInitWarnings: [
        ...(workspace.externalInitWarnings ?? []),
        `剪页库默认绑定失败：${error instanceof Error ? error.message : String(error)}`
      ]
    }
  }
  await attachWorkspaceLifecycle(ready)
  return ready
}

async function ensureDefaultClipLibraryBinding(workspace: Workspace): Promise<void> {
  const clipsWorkspace = await ensureDefaultKnowledgeWorkspaceLifecycle()
  const refs = await listExternalRefs()
  let clipsRef = refs.find((ref) =>
    ref.category === 'knowledge'
    && ref.kind === 'local'
    && ref.source === clipsWorkspace.path
  )
  if (!clipsRef) {
    const alias = refs.some((ref) => ref.alias === '剪页库')
      ? `clips-${clipsWorkspace.id.slice(0, 8)}`
      : '剪页库'
    clipsRef = await addExternalRef({
      alias,
      category: 'knowledge',
      kind: 'local',
      sourcePath: clipsWorkspace.path
    })
  }
  await attachExternalRef(workspace.id, clipsRef.id)
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  return store.findById(id)
}

export async function getActiveWorkspaceId(): Promise<string | null> {
  const id = await store.activeId()
  if (id) {
    const ws = await store.findById(id)
    if (ws) await attachWorkspaceLifecycle(ws)
  }
  return id
}

export function setActiveWorkspace(id: string | null): Promise<void> {
  return enqueueWorkspaceScopeTransition(async () => {
    const previousId = await store.activeId()
    const requested = id ? await store.findById(id) : null
    const target = requested?.isDefault
      ? requested
      : (await store.list()).find((workspace) => workspace.isDefault) ?? null
    const nextId = target?.id ?? null
    if (previousId !== nextId) {
      await projectWatcher.stopAll()
    }
    await store.setActive(nextId)
    if (target) await attachWorkspaceLifecycle(target)
  })
}

async function attachWorkspaceLifecycle(workspace: Workspace): Promise<void> {
  if (isSimpleWorkspace(workspace)) {
    const capability = await readGitCapability(workspace.path).catch(() => ({ state: 'unbound' as const }))
    if (capability.state === 'unbound') return
  }
  bindAutoSave(workspace.id)
  // 异步 resume 上次崩溃 / before-quit 留下的 saga；不阻塞激活流程
  void (async () => {
    try {
      await resumeWorkspaceSagas(workspace.id, workspace.path)
    } catch { /* ignore */ }
    // resume 完了再 catch-up push：处理 paused 类型不会 resume + before-quit
    // 只 commit 没 push 的场景，避免 ↑N 长期挂着。
    await catchUpPush(workspace.id)
  })()
}

export function setWorkspaceWatchScope(
  workspaceId: string | null,
  projectRelPath: string | null
): Promise<void> {
  return enqueueWorkspaceScopeTransition(async () => {
    if (workspaceId === null && projectRelPath === null) {
      await projectWatcher.stopAll()
      return
    }
    if (workspaceId === null || projectRelPath === null) {
      throw new UIClientError('VALIDATION', 'workspaceId 与 projectRelPath 必须同时设置或同时清空')
    }

    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
    if (ws.kind !== 'project' && ws.kind !== 'ux') {
      throw new UIClientError('VALIDATION', '仅 Git 项目和 UX 工作区支持文件监听')
    }
    const activeWorkspaceId = await store.activeId()
    if (activeWorkspaceId !== ws.id) {
      throw new UIClientError('VALIDATION', '监听范围不属于当前激活的根 Git workspace')
    }
    await projectWatcher.activate(ws.id, ws.path, projectRelPath)
  })
}

export async function scan(workspaceId: string): Promise<WorkspaceScanResult> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  if (ws.kind === 'project' || ws.kind === 'ux') {
    await syncWorkspaceTemplates(ws.path, ws.kind)
  }
  return scanWorkspace(ws)
}

function normalizeSafeRelDir(relDir: string | undefined): string {
  const safeRel = (relDir ?? '').replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (safeRel.split('/').includes('..')) {
    throw new UIClientError('PATH_OUTSIDE_SCOPE', `路径越界：${relDir}`)
  }
  return safeRel
}

export async function listWorkspaceFiles(
  workspaceId: string,
  relDir: string,
  opts: { recursive?: boolean; extensions?: string[] }
): Promise<DocTreeNode[]> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  return listFilesAtRoot(ws.path, relDir, opts)
}

export async function listSpaceWorkspaceFiles(
  workspaceId: string,
  spaceSlug: string,
  relDir: string,
  opts: { recursive?: boolean; extensions?: string[] }
): Promise<DocTreeNode[]> {
  const rootPath = await resolvePersonalSpaceWorktreePath(workspaceId, spaceSlug)
  return listFilesAtRoot(rootPath, relDir, opts)
}

async function listFilesAtRoot(
  rootPath: string,
  relDir: string,
  opts: { recursive?: boolean; extensions?: string[] }
): Promise<DocTreeNode[]> {
  // 阻止越界（不允许 ../ 跳出工作区）
  const safeRel = normalizeSafeRelDir(relDir)
  const exts = opts.extensions
    ? new Set(opts.extensions.map((e) => e.toLowerCase().replace(/^\./, '')))
    : null
  return readFileTree(rootPath, safeRel || '.', {
    recursive: opts.recursive !== false,
    filter: exts
      ? (n) => {
          const dot = n.lastIndexOf('.')
          if (dot < 0) return false
          return exts.has(n.slice(dot + 1).toLowerCase())
        }
      : undefined
  })
}

export async function getUikitSummary(workspaceId: string, rootRel?: string): Promise<UikitAssetSummary> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  const safeRootRel = normalizeSafeRelDir(rootRel)
  return scanUikitAssetSummary(safeRootRel ? join(ws.path, safeRootRel) : ws.path)
}

// 工作区内已引用的外部库列表（含 workspace 校验；池侧 list 见 external-pool/service.ts）
export async function getWorkspaceRefs(workspaceId: string): Promise<ExternalRefBinding[]> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  if (ws.kind !== 'project') return []
  return readRefs(ws.path)
}

// 每个 workspace 的 setWorkArea 按请求顺序串行执行，并把最新队列暴露给提交链路。
// 这样快速切换内部项目时，较慢的旧请求不会在新请求之后回写旧 workArea；
// submit/watch 也会等整条队列完成后再读取 Claude 工作目录。
const inFlightWorkAreaSyncs = new Map<string, Promise<void>>()

export async function awaitPendingWorkAreaSync(workspaceId: string): Promise<void> {
  // 等待期间可能又有 set/clear 入队；必须持续 drain 到队列稳定，不能只快照一次。
  while (true) {
    const pending = inFlightWorkAreaSyncs.get(workspaceId)
    if (!pending) return
    await pending
    if (inFlightWorkAreaSyncs.get(workspaceId) === pending) return
  }
}

export function setWorkspaceWorkArea(
  workspaceId: string,
  area: ActiveWorkArea | null
): Promise<void> {
  const previous = inFlightWorkAreaSyncs.get(workspaceId) ?? Promise.resolve()
  const work = previous.catch(() => undefined).then(async () => {
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
    if (ws.kind !== 'project' && ws.kind !== 'ux') return
    try {
      await writeActiveWorkArea(ws.path, area)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new UIClientError('VALIDATION', message)
    }
    await syncWorkspaceTemplates(ws.path, ws.kind as 'project' | 'ux')
    // PM feature workArea：spawn AI 前 ensure .claude / .agents / CLAUDE.md /
    // AGENTS.md 符号链接到位（覆盖 clone 后第一次开 AI / 用户手动删 link 场景）
    if (area && area.kind === 'feature' && ws.kind === 'project') {
      const { ensureFeatureAiLinks } = await import('../features/ai-links')
      await ensureFeatureAiLinks(ws.path, area.relPath).catch(() => undefined)
    }
  })
  inFlightWorkAreaSyncs.set(workspaceId, work)
  return work.finally(() => {
    if (inFlightWorkAreaSyncs.get(workspaceId) === work) {
      inFlightWorkAreaSyncs.delete(workspaceId)
    }
  })
}
