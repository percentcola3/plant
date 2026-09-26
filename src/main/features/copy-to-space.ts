import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { UIClientError } from '../ipc/errors'
import { gitFor } from '../git/client'
import { addWorktree, removeWorktree } from '../git/worktree'
import { WorkspacesStore } from '../workspaces/store'
import { listPersonalSpacesByPath } from '../workspaces/personal-space'
import { SPACE_BRANCH_PREFIX, hasRemoteSpaceBranch } from '../workspaces/personal-space-branches'
import { assertFeatureRelPath } from './scanner'

const store = new WorkspacesStore()

export type CopyFeatureToSpaceInput = {
  workspaceId: string
  relPath: string
  targetSlug: string
  targetWorkspaceId?: string
  targetName?: string
}

export type CopyFeatureToSpaceResult = {
  relPath: string
  targetSlug: string
  targetBranch: string
  targetWorkspaceId: string
}

function copyToSpaceRoot(): string {
  return join(app.getPath('userData'), 'feature-copy-to-space')
}

function copyToSpaceWorktreeDir(workspaceId: string): string {
  return join(copyToSpaceRoot(), workspaceId, randomBytes(6).toString('hex'))
}

async function pathExists(path: string): Promise<boolean> {
  return fs.stat(path).then(() => true).catch(() => false)
}

function normalizeTargetName(input: string | undefined, sourceRelPath: string): string {
  const fallback = sourceRelPath.split('/').filter(Boolean).pop() ?? sourceRelPath
  const name = (input ?? fallback).trim()
  if (!name) throw new UIClientError('VALIDATION', '目标名称不能为空')
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name.includes('..')) {
    throw new UIClientError('VALIDATION', `目标名称无效：${name}`)
  }
  return name
}

function replaceRelPathLeaf(relPath: string, targetName: string): string {
  const segments = relPath.split('/').filter(Boolean)
  segments[segments.length - 1] = targetName
  return segments.join('/')
}

async function addTargetWorktree(
  workspacePath: string,
  worktreePath: string,
  branch: string
): Promise<void> {
  const local = await gitFor(workspacePath).branchLocal()
  if (local.all.includes(branch)) {
    await addWorktree({ repoPath: workspacePath, targetPath: worktreePath, branch })
    return
  }
  if (branch.startsWith(SPACE_BRANCH_PREFIX) && await hasRemoteSpaceBranch(workspacePath, branch)) {
    await addWorktree({
      repoPath: workspacePath,
      targetPath: worktreePath,
      branch,
      createBranch: true,
      from: `origin/${branch}`
    })
    return
  }
  throw new UIClientError('NOT_FOUND', `目标分支不存在：${branch}`)
}

export async function copyFeatureToSpace(input: CopyFeatureToSpaceInput): Promise<CopyFeatureToSpaceResult> {
  const ws = await store.findById(input.workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${input.workspaceId}`)
  if (ws.kind !== 'project') {
    throw new UIClientError('VALIDATION', '复制到工作空间仅 PM 项目支持')
  }
  const targetWorkspaceId = input.targetWorkspaceId ?? input.workspaceId
  const targetWs = targetWorkspaceId === input.workspaceId
    ? ws
    : await store.findById(targetWorkspaceId)
  if (!targetWs) throw new UIClientError('NOT_FOUND', `目标工作区不存在：${targetWorkspaceId}`)
  if (targetWs.kind !== 'project') {
    throw new UIClientError('VALIDATION', '目标工作区必须是 PM 项目')
  }

  const relPath = assertFeatureRelPath(input.relPath)
  const targetRelPath = assertFeatureRelPath(replaceRelPathLeaf(relPath, normalizeTargetName(input.targetName, relPath)))
  const sourceAbs = join(ws.path, relPath)
  const sourceStat = await fs.stat(sourceAbs).catch(() => null)
  if (!sourceStat?.isDirectory()) {
    throw new UIClientError('NOT_FOUND', `PM 项目不存在：${relPath}`)
  }

  const targetSlug = input.targetSlug.trim()
  const spaces = await listPersonalSpacesByPath(targetWs.path, targetWs.defaultBranch)
  const target = spaces.spaces.find((space) => space.slug === targetSlug)
  if (!target) {
    throw new UIClientError('NOT_FOUND', `工作空间不存在：${targetSlug}`)
  }

  const currentBranch = (await gitFor(targetWs.path).status()).current ?? ''
  if (targetWorkspaceId === input.workspaceId && currentBranch === target.branch) {
    throw new UIClientError('VALIDATION', '目标工作空间就是当前工作空间')
  }

  const useTargetWorktree = currentBranch !== target.branch
  const worktreePath = useTargetWorktree ? copyToSpaceWorktreeDir(targetWorkspaceId) : targetWs.path
  let added = false
  try {
    if (useTargetWorktree) {
      await addTargetWorktree(targetWs.path, worktreePath, target.branch)
      added = true
    }
    const targetAbs = join(worktreePath, targetRelPath)
    if (await pathExists(targetAbs)) {
      throw new UIClientError('EXISTS', `目标工作空间已存在：${targetRelPath}`)
    }

    await fs.mkdir(dirname(targetAbs), { recursive: true })
    await fs.cp(sourceAbs, targetAbs, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true
    })

    const wt = gitFor(worktreePath)
    await wt.add(['-A', targetRelPath])
    await wt.commit(`feat: 复制 ${targetRelPath.split('/').pop() ?? targetRelPath} 到工作空间`)
    return { relPath: targetRelPath, targetSlug: target.slug, targetBranch: target.branch, targetWorkspaceId }
  } finally {
    if (added) await removeWorktree(targetWs.path, worktreePath)
    else if (useTargetWorktree) await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => undefined)
  }
}
