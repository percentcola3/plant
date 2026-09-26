import { promises as fs } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Workspace, WorkspaceKind } from '@shared/types'
import { APP_MANAGED_GITIGNORE_ENTRIES } from '@shared/app-managed-paths'
import { WorkspacesStore } from './store'
import { managedProjectsRoot, projectDocsDir, projectUiDir, requirementsDir, uiClientDir } from './paths'
import { clone, gitFor } from '../git/client'
import { ensureGitignoreEntry } from '../projects/gitignore'
import { UIClientError } from '../ipc/errors'
import { settingsStore } from '../settings/store'
import { syncWorkspaceTemplates } from './templates'
import { projectWatcher } from '../projects/watcher'
import { hydrateExternalManifest } from '../external-pool/service'
import { clearProjectSessionHistory } from '../claude-headless/session-id'
import { unbindAutoSave } from '../saga/auto-save'
import { enqueueWorkspaceScopeTransition } from './scope-transition'

const store = new WorkspacesStore()
const DEFAULT_KNOWLEDGE_WORKSPACE_NAME = '剪页库'
const DEFAULT_WORKSPACE_NAME = '工作台'

export type CreateWorkspaceInput = {
  parentDir: string                  // 工作区父目录（绝对路径）
  name: string                       // 文件夹名 = 工作区显示名（首版同步）
  kind?: WorkspaceKind               // 默认 'project'
  initialBranch?: string             // 默认 'main'
}

export type ImportWorkspaceInput = {
  path: string                       // 已有目录绝对路径（应是 git 仓库或可 git init）
  name?: string                      // 显示名，默认取目录名
  kind?: WorkspaceKind
}

export type CloneWorkspaceInput = {
  url: string
  parentDir: string
  name: string                       // 克隆下来的目录名
  kind?: WorkspaceKind
}

type RegisterWorkspaceOptions = {
  makeActive?: boolean
}

function newId(): string { return randomUUID() }

async function addWorkspaceRecord(
  workspace: Workspace,
  options: RegisterWorkspaceOptions
): Promise<void> {
  if (options.makeActive === false) {
    await store.add(workspace, options)
    return
  }
  await enqueueWorkspaceScopeTransition(async () => {
    const previousId = await store.activeId()
    if (previousId !== workspace.id) await projectWatcher.stopAll()
    await store.add(workspace, options)
  })
}

async function setActiveWorkspaceRecord(workspaceId: string): Promise<void> {
  await enqueueWorkspaceScopeTransition(async () => {
    const previousId = await store.activeId()
    if (previousId !== workspaceId) await projectWatcher.stopAll()
    await store.setActive(workspaceId)
  })
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true } catch { return false }
}

async function gitRepoAtPath(p: string): Promise<boolean> {
  return pathExists(join(p, '.git'))
}

// 所有 kind 共享 .ui-client/ 私有目录；只有已绑定 Git 时才写 .gitignore。
async function scaffoldCommonStructure(workspacePath: string): Promise<void> {
  await fs.mkdir(uiClientDir(workspacePath), { recursive: true })
  if (!(await gitRepoAtPath(workspacePath))) return
  for (const entry of APP_MANAGED_GITIGNORE_ENTRIES) {
    await ensureGitignoreEntry(workspacePath, entry)
  }
}

// 仅项目类：requirements/ 元信息目录 + 项目级共享 docs/、ui/ 资产目录。
// 剪页库是独立 knowledge 工作区，不属于项目 git。
async function scaffoldProjectStructure(workspacePath: string): Promise<void> {
  await Promise.all([
    fs.mkdir(requirementsDir(workspacePath), { recursive: true }),
    fs.mkdir(projectDocsDir(workspacePath), { recursive: true }),
    fs.mkdir(projectUiDir(workspacePath), { recursive: true })
  ])
  await fs.writeFile(join(requirementsDir(workspacePath), '.gitkeep'), '').catch(() => undefined)
  await fs.writeFile(join(projectDocsDir(workspacePath), '.gitkeep'), '').catch(() => undefined)
  await fs.writeFile(join(projectUiDir(workspacePath), '.gitkeep'), '').catch(() => undefined)
}

/**
 * 确保系统唯一的本地工作台存在。
 *
 * 它直接使用 <workspaceRoot>/.mywork，不再让用户创建、导入或克隆一个根项目。
 * 历史 workspace 记录继续留在索引中供旧数据兼容，但不会再作为默认入口。
 */
export async function ensureDefaultWorkspace(): Promise<Workspace> {
  const settings = await settingsStore.get()
  const workspacePath = managedProjectsRoot(settings.workspaceRoot)
  await fs.mkdir(workspacePath, { recursive: true })
  await scaffoldCommonStructure(workspacePath)
  await scaffoldProjectStructure(workspacePath)
  await syncWorkspaceTemplates(workspacePath, 'project')

  const now = new Date().toISOString()
  let workspace = await store.findByPath(workspacePath)
  if (workspace) {
    await store.updateWorkspace(workspace.id, {
      kind: 'project',
      workflowMode: 'simple',
      isDefault: true,
      name: DEFAULT_WORKSPACE_NAME,
      managedPath: true
    })
    workspace = {
      ...workspace,
      kind: 'project',
      workflowMode: 'simple',
      isDefault: true,
      name: DEFAULT_WORKSPACE_NAME,
      managedPath: true
    }
  } else {
    workspace = {
      id: newId(),
      kind: 'project',
      workflowMode: 'simple',
      isDefault: true,
      name: DEFAULT_WORKSPACE_NAME,
      path: workspacePath,
      managedPath: true,
      defaultBranch: 'main',
      addedAt: now,
      lastActiveAt: now
    }
    await store.add(workspace, { makeActive: false })
  }

  // workspaceRoot 改动后，旧 .mywork 仅保留为兼容记录，不能继续抢占默认入口。
  const all = await store.list()
  for (const item of all) {
    if (item.id !== workspace.id && item.isDefault) {
      await store.updateWorkspace(item.id, { isDefault: false })
    }
  }
  await setActiveWorkspaceRecord(workspace.id)
  return withExternalInitWarnings(workspace)
}

function shouldSyncWorkspaceTemplates(kind: WorkspaceKind): kind is Extract<WorkspaceKind, 'project' | 'ux'> {
  return kind === 'project' || kind === 'ux'
}

async function alignCloneToRemoteMainline(workspacePath: string): Promise<string | null> {
  const sg = gitFor(workspacePath)
  const branch = await resolveRemoteMainlineBranch(sg)
  if (!branch) return null

  const status = await sg.status().catch(() => null)
  if (status?.current !== branch) {
    await sg.checkout(['-B', branch, `origin/${branch}`])
  }
  await sg.raw(['branch', `--set-upstream-to=origin/${branch}`, branch]).catch(() => undefined)
  return branch
}

async function resolveRemoteMainlineBranch(sg: ReturnType<typeof gitFor>): Promise<string | null> {
  try {
    const symbolic = await sg.raw(['symbolic-ref', 'refs/remotes/origin/HEAD'])
    const branch = parseRemoteHeadRef(symbolic)
    if (branch) return branch
  } catch { /* fallback below */ }

  try {
    const output = await sg.raw(['branch', '-r'])
    const branches = parseRemoteBranches(output)
    return branches.find((item) => item === 'main') ??
      branches.find((item) => item === 'master') ??
      branches[0] ??
      null
  } catch {
    return null
  }
}

function parseRemoteHeadRef(output: string): string | null {
  const match = output.match(/refs\/(?:remotes\/origin|heads)\/([^\s]+)/)
  return match?.[1] ?? null
}

function parseRemoteBranches(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\*?\s*/, ''))
    .filter((line) => line.startsWith('origin/') && !line.includes('origin/HEAD'))
    .map((line) => line.replace(/^origin\//, ''))
    .filter((branch) => branch.length > 0)
}

async function withExternalInitWarnings(ws: Workspace): Promise<Workspace> {
  if (ws.kind !== 'project') return ws
  try {
    const result = await hydrateExternalManifest(ws.id)
    return result.warnings.length > 0
      ? { ...ws, externalInitWarnings: result.warnings }
      : ws
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ...ws, externalInitWarnings: [`外部依赖初始化失败：${message}`] }
  }
}

export async function createWorkspace(input: CreateWorkspaceInput, options: RegisterWorkspaceOptions = {}): Promise<Workspace> {
  if (!isAbsolute(input.parentDir)) {
    throw new UIClientError('VALIDATION', '父目录必须是绝对路径')
  }
  const slug = input.name.trim()
  if (!slug) throw new UIClientError('VALIDATION', '工作区名不能为空')
  const workspacePath = join(managedProjectsRoot(input.parentDir), slug)
  if (await pathExists(workspacePath)) {
    throw new UIClientError('PATH_TAKEN', `目录已存在：${workspacePath}`)
  }
  if (await store.findByPath(workspacePath)) {
    throw new UIClientError('PATH_TAKEN', `工作区已登记：${workspacePath}`)
  }
  await fs.mkdir(workspacePath, { recursive: true })

  const kind = input.kind ?? 'project'
  const branch = input.initialBranch ?? 'main'

  await scaffoldCommonStructure(workspacePath)
  if (kind === 'project') {
    await scaffoldProjectStructure(workspacePath)
  }
  if (shouldSyncWorkspaceTemplates(kind)) {
    await syncWorkspaceTemplates(workspacePath, kind)
  }

  const now = new Date().toISOString()
  const ws: Workspace = {
    id: newId(),
    kind,
    ...((kind === 'project' || kind === 'ux') ? { workflowMode: 'simple' as const } : {}),
    name: slug,
    path: workspacePath,
    managedPath: true,
    defaultBranch: branch,
    addedAt: now,
    lastActiveAt: now
  }
  await addWorkspaceRecord(ws, options)
  return withExternalInitWarnings(ws)
}

export async function importWorkspace(input: ImportWorkspaceInput, options: RegisterWorkspaceOptions = {}): Promise<Workspace> {
  const path = input.path
  if (!isAbsolute(path)) throw new UIClientError('VALIDATION', '路径必须是绝对路径')
  if (!(await pathExists(path))) throw new UIClientError('NOT_FOUND', `目录不存在：${path}`)
  if (await store.findByPath(path)) {
    throw new UIClientError('PATH_TAKEN', `已登记：${path}`)
  }
  const kind = input.kind ?? 'project'
  const isGit = await gitRepoAtPath(path)

  // 导入只登记和补齐工作台结构，不初始化 Git，也不替用户创建提交。
  await scaffoldCommonStructure(path)
  if (kind === 'project') {
    await scaffoldProjectStructure(path)
  }
  if (shouldSyncWorkspaceTemplates(kind)) {
    await syncWorkspaceTemplates(path, kind)
  }
  let defaultBranch = 'main'
  if (isGit) {
    try {
      const status = await gitFor(path).status()
      if (status.current) defaultBranch = status.current
    } catch { /* keep default */ }
  }

  const now = new Date().toISOString()
  const ws: Workspace = {
    id: newId(),
    kind,
    ...((kind === 'project' || kind === 'ux') ? { workflowMode: 'simple' as const } : {}),
    name: input.name ?? basename(path),
    path,
    managedPath: false,
    defaultBranch,
    addedAt: now,
    lastActiveAt: now
  }
  await addWorkspaceRecord(ws, options)
  return withExternalInitWarnings(ws)
}

export async function cloneWorkspace(input: CloneWorkspaceInput): Promise<Workspace> {
  if (!isAbsolute(input.parentDir)) {
    throw new UIClientError('VALIDATION', '父目录必须是绝对路径')
  }
  const dest = join(managedProjectsRoot(input.parentDir), input.name)
  if (await pathExists(dest)) {
    throw new UIClientError('PATH_TAKEN', `目录已存在：${dest}`)
  }
  await fs.mkdir(managedProjectsRoot(input.parentDir), { recursive: true })
  try {
    await clone({ url: input.url, dest })
  } catch (e) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined)
    throw new UIClientError('GIT_FAILED', `clone 失败：${(e as Error).message ?? String(e)}`)
  }
  try {
    const kind = input.kind ?? 'project'
    const remoteMainline = kind === 'project' || kind === 'ux' ? await alignCloneToRemoteMainline(dest) : null
    await scaffoldCommonStructure(dest)
    if (kind === 'project') {
      await scaffoldProjectStructure(dest)
    }
    if (shouldSyncWorkspaceTemplates(kind)) {
      await syncWorkspaceTemplates(dest, kind)
    }
    let defaultBranch = remoteMainline ?? 'main'
    try {
      const status = await gitFor(dest).status()
      if (status.current && !remoteMainline) defaultBranch = status.current
    } catch { /* keep default */ }

    const now = new Date().toISOString()
    const ws: Workspace = {
      id: newId(),
      kind,
      ...((kind === 'project' || kind === 'ux') ? { workflowMode: 'simple' as const } : {}),
      name: input.name,
      path: dest,
      managedPath: true,
      remoteUrl: input.url,
      defaultBranch,
      addedAt: now,
      lastActiveAt: now
    }
    await addWorkspaceRecord(ws, {})
    return withExternalInitWarnings(ws)
  } catch (e) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined)
    if (e instanceof UIClientError) throw e
    throw new UIClientError('WORKSPACE_INIT_FAILED', `项目初始化失败：${(e as Error).message ?? String(e)}`)
  }
}

export async function ensureDefaultKnowledgeWorkspace(): Promise<Workspace> {
  const existing = (await store.list()).find((w) => w.kind === 'knowledge')
  if (existing) return existing

  const settings = await settingsStore.get()
  try {
    return await createWorkspace(
      {
        parentDir: settings.workspaceRoot,
        name: DEFAULT_KNOWLEDGE_WORKSPACE_NAME,
        kind: 'knowledge'
      },
      { makeActive: false }
    )
  } catch (error) {
    if (!(error instanceof UIClientError) || error.code !== 'PATH_TAKEN') throw error
    const workspacePath = join(managedProjectsRoot(settings.workspaceRoot), DEFAULT_KNOWLEDGE_WORKSPACE_NAME)
    const registered = await store.findByPath(workspacePath)
    if (registered) return registered
    return importWorkspace(
      {
        path: workspacePath,
        name: DEFAULT_KNOWLEDGE_WORKSPACE_NAME,
        kind: 'knowledge'
      },
      { makeActive: false }
    )
  }
}

export function removeWorkspace(
  id: string,
  options: { deleteFiles?: boolean } = {},
): Promise<void> {
  return enqueueWorkspaceScopeTransition(async () => {
    const ws = await store.findById(id)
    if (!ws) return
    unbindAutoSave(id)
    await projectWatcher.stop(id)
    clearProjectSessionHistory(ws.path)
    if (ws.managedPath === true && options.deleteFiles === true) {
      await fs.rm(ws.path, { recursive: true, force: true })
    }
    await store.remove(id)
  })
}

export async function renameWorkspace(id: string, newName: string): Promise<void> {
  const ws = await store.findById(id)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${id}`)
  const trimmed = newName.trim()
  if (!trimmed) throw new UIClientError('VALIDATION', '工作区名不能为空')
  await store.updateWorkspace(id, { name: trimmed })
}
