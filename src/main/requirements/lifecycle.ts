// Phase E（2026-06-24）后只保留 checkoutProjectHome —— PM/UX 工作区"切回默认分支"的入口。
// 老 createRequirement/switchRequirement/... 已随需求模型一并删除（features/<slug>/ 取代）。

import { promises as fs } from 'node:fs'
import { isAppManagedPath } from '@shared/app-managed-paths'
import { WorkspacesStore } from '../workspaces/store'
import { activeReqPath } from '../workspaces/paths'
import { gitFor } from '../git/client'
import { UIClientError } from '../ipc/errors'

const store = new WorkspacesStore()

type DirtyChange = { path: string; index: string; workingDir: string }

type WorkspaceGitStatus = {
  isClean: () => boolean
  current?: string | null
  files?: Array<{ path: string; index?: string; working_dir?: string }>
}

async function getBranchWorkspace(workspaceId: string): Promise<{ path: string; defaultBranch: string }> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  if (ws.kind !== 'project' && ws.kind !== 'ux') {
    throw new UIClientError('VALIDATION', '只有 project/ux 工作区可切换分支')
  }
  return { path: ws.path, defaultBranch: ws.defaultBranch }
}

function dirtyChangesFromStatus(status: WorkspaceGitStatus): DirtyChange[] {
  return (status.files ?? [])
    .filter((file) => !isAppManagedPath(file.path))
    .map((file) => ({
      path: file.path,
      index: file.index ?? ' ',
      workingDir: file.working_dir ?? ' '
    }))
}

function checkoutSafeManagedPaths(status: { files?: Array<{ path: string }> }): string[] {
  return Array.from(new Set((status.files ?? [])
    .map((file) => file.path)
    .filter((path) => isAppManagedPath(path))
    .filter((path) => !path.startsWith('.ui-client/') && !path.startsWith('.external/'))))
}

async function discardCheckoutBlockingManagedChanges(
  workspacePath: string,
  knownStatus?: { files?: Array<{ path: string }> }
): Promise<void> {
  const sg = gitFor(workspacePath)
  const status = knownStatus ?? await sg.status()
  const paths = checkoutSafeManagedPaths(status)
  if (paths.length === 0) return
  const restoreError = await sg.raw(['restore', '--staged', '--worktree', '--', ...paths])
    .then(() => null)
    .catch((error: unknown) => error)
  const cleanError = await sg.raw(['clean', '-f', '-X', '--', ...paths])
    .then(() => null)
    .catch((error: unknown) => error)
  if (restoreError && cleanError) {
    const message = restoreError instanceof Error ? restoreError.message : String(restoreError)
    throw new UIClientError('GIT_FAILED', `清理应用管理文件失败：${message}`)
  }
}

async function commitCurrentChanges(workspacePath: string, message: string): Promise<void> {
  const sg = gitFor(workspacePath)
  const status = await sg.status()
  if (status.isClean()) return
  await sg.add(['-A'])
  await sg.commit(message)
}

async function ensureCleanOrCommit(
  workspacePath: string,
  message: string | undefined,
  knownStatus?: WorkspaceGitStatus
): Promise<void> {
  const sg = gitFor(workspacePath)
  const status = knownStatus ?? await sg.status()
  if (status.isClean()) return
  const changes = dirtyChangesFromStatus(status)
  if (changes.length === 0) {
    await discardCheckoutBlockingManagedChanges(workspacePath, status)
    return
  }
  if (!message || !message.trim()) {
    throw new UIClientError(
      'UNCOMMITTED_CHANGES',
      '当前工作区有未提交的改动。请先确认这些改动是否需要保存。',
      { changes }
    )
  }
  await commitCurrentChanges(workspacePath, message)
  await discardCheckoutBlockingManagedChanges(workspacePath)
}

async function assertCurrentBranch(workspacePath: string, expectedBranch: string): Promise<void> {
  const sg = gitFor(workspacePath)
  const status = await sg.status()
  if (status.current !== expectedBranch) {
    throw new UIClientError('GIT_FAILED', `分支切换失败：当前=${status.current}，预期=${expectedBranch}`)
  }
}

export type CheckoutProjectHomeInput = {
  workspaceId: string
  preCommitMessage?: string
}

export async function checkoutProjectHome(input: CheckoutProjectHomeInput): Promise<void> {
  const { path, defaultBranch } = await getBranchWorkspace(input.workspaceId)
  const sg = gitFor(path)
  const status = await sg.status()
  if (status.current !== defaultBranch) {
    await ensureCleanOrCommit(path, input.preCommitMessage, status)
    await sg.checkout(defaultBranch)
    await assertCurrentBranch(path, defaultBranch)
  }
  await fs.rm(activeReqPath(path), { force: true }).catch(() => undefined)
}
