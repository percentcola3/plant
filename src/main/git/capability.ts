import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { GitCapability } from '@shared/types'
import { APP_MANAGED_GITIGNORE_ENTRIES } from '@shared/app-managed-paths'
import { ensureGitignoreEntry } from '../projects/gitignore'
import { UIClientError } from '../ipc/errors'
import { requireSshKeyForRemote, sshAuthorizationError } from '../system/ssh'
import { gitFor, gitForWithAskpass } from './client'

async function hasGitEntry(workspacePath: string): Promise<boolean> {
  try {
    await fs.lstat(join(workspacePath, '.git'))
    return true
  } catch {
    return gitFor(workspacePath).raw(['rev-parse', '--is-inside-work-tree'])
      .then(value => value.trim() === 'true').catch(() => false)
  }
}

export async function readGitCapability(workspacePath: string): Promise<GitCapability> {
  if (!(await hasGitEntry(workspacePath))) return { state: 'unbound' }

  const sg = gitFor(workspacePath)
  const status = await sg.status()
  const branch = status.current || 'main'
  const remoteUrl = await sg.raw(['remote', 'get-url', 'origin'])
    .then((value) => value.trim())
    .catch(() => '')

  return remoteUrl
    ? { state: 'remote', branch, remoteUrl }
    : { state: 'local', branch }
}

// 仅解除远端绑定，保留工作树、提交和本地分支。
export async function unbindGitRepository(workspacePath: string): Promise<GitCapability> {
  if (!(await hasGitEntry(workspacePath))) return { state: 'unbound' }
  const sg = gitFor(workspacePath)
  const remotes = await sg.getRemotes()
  if (remotes.some((remote) => remote.name === 'origin')) await sg.removeRemote('origin')
  return readGitCapability(workspacePath)
}

export async function bindGitRepository(
  workspacePath: string,
  options: { remoteUrl: string; branch: string },
): Promise<GitCapability> {
  const remoteUrl = requireRemoteUrl(options.remoteUrl)
  const branch = requireBranch(options.branch)
  const remote = await listRemoteGitBranches(workspacePath, remoteUrl)
  if (!remote.branches.includes(branch)) {
    throw new UIClientError('VALIDATION', `远端分支不存在：${branch}`)
  }

  const createdGit = !(await hasGitEntry(workspacePath))
  const sg = await gitForWithAskpass(workspacePath)
  let addedRemote = false
  try {
    if (createdGit) {
      await sg.init([`--initial-branch=${branch}`])
    }

    const existing = await sg.raw(['remote', 'get-url', 'origin'])
      .then((value) => value.trim())
      .catch(() => '')
    if (existing && existing !== remoteUrl) {
      throw new UIClientError('VALIDATION', `项目已绑定其他 origin：${existing}`)
    }
    if (!existing) {
      await sg.raw(['remote', 'add', 'origin', remoteUrl])
      addedRemote = true
    }

    await sg.raw(['fetch', 'origin', branch])
    const hasHead = await sg.raw(['rev-parse', '--verify', 'HEAD'])
      .then(() => true)
      .catch(() => false)
    const localBranchExists = await sg.raw(['show-ref', '--verify', `refs/heads/${branch}`])
      .then(() => true)
      .catch(() => false)
    if (!hasHead && !localBranchExists) {
      await bindUnbornBranch(workspacePath, branch)
    } else {
      await sg.checkout(localBranchExists
        ? [branch]
        : ['-b', branch, '--track', `origin/${branch}`])
    }

    await sg.raw(['branch', `--set-upstream-to=origin/${branch}`, branch])
    for (const entry of APP_MANAGED_GITIGNORE_ENTRIES) {
      await ensureGitignoreEntry(workspacePath, entry)
    }
  } catch (error) {
    if (createdGit) {
      await fs.rm(join(workspacePath, '.git'), { recursive: true, force: true }).catch(() => undefined)
    } else if (addedRemote) {
      await sg.raw(['remote', 'remove', 'origin']).catch(() => undefined)
    }
    throw error
  }

  return readGitCapability(workspacePath)
}

async function bindUnbornBranch(workspacePath: string, branch: string): Promise<void> {
  const sg = gitFor(workspacePath)
  // 没有 HEAD 也可能已有用户暂存的版本，不能用远端 index 覆盖它。
  if ((await sg.raw(['ls-files', '--cached', '-z'])).length > 0) {
    throw new UIClientError('VALIDATION', '工作区存在已暂存内容，请先处理暂存区后再绑定 Git')
  }

  const remoteRef = `origin/${branch}`
  await sg.raw(['read-tree', remoteRef])
  try {
    const blocked = (await sg.raw(['ls-files', '--killed', '-z'])).split('\0').filter(Boolean)
    if (blocked.length > 0) {
      throw new UIClientError('VALIDATION', `本地路径与远端文件类型冲突，请移动这些路径后重试：${blocked.join('、')}`)
    }
    // 新工作区已生成模板和资源索引：以远端为 Git 基线，同名本地内容作为未提交修改保留。
    // 仅补齐缺失文件，checkout-index 不加 --force，遇到并发写入或父目录软链会安全失败。
    const missing = (await sg.raw(['ls-files', '--deleted', '-z'])).split('\0').filter(Boolean)
    for (let offset = 0; offset < missing.length; offset += 64) {
      await sg.raw(['checkout-index', '--', ...missing.slice(offset, offset + 64)])
    }
    await sg.checkout(['-b', branch, '--track', remoteRef])
  } catch (error) {
    // checkout 成功前仍是 unborn 分支；恢复空暂存区，让已有 .git 的工作区也能重试。
    await sg.raw(['read-tree', '--empty']).catch(() => undefined)
    throw error
  }
}

export async function listRemoteGitBranches(
  workspacePath: string,
  remoteUrlInput: string,
): Promise<{ branches: string[]; defaultBranch: string | null }> {
  const remoteUrl = requireRemoteUrl(remoteUrlInput)
  const sshRemote = await requireSshKeyForRemote(remoteUrl)
  const sg = await gitForWithAskpass(workspacePath)
  let output: string
  try {
    output = await sg.raw(['ls-remote', '--symref', remoteUrl, 'HEAD', 'refs/heads/*'])
  } catch (error) {
    const sshError = sshAuthorizationError(error, sshRemote)
    if (sshError) throw sshError
    throw error
  }
  const defaultBranch = output.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/m)?.[1] ?? null
  const branches = [...new Set(
    [...output.matchAll(/^[0-9a-f]+\s+refs\/heads\/([^\s]+)$/gm)].map((match) => match[1])
  )].sort((left, right) => {
    if (left === defaultBranch) return -1
    if (right === defaultBranch) return 1
    return left.localeCompare(right)
  })
  if (branches.length === 0) {
    throw new UIClientError('VALIDATION', '远端仓库没有可绑定的分支')
  }
  return { branches, defaultBranch }
}

function requireRemoteUrl(value: string): string {
  const remoteUrl = value?.trim()
  if (!remoteUrl || remoteUrl.startsWith('-')) {
    throw new UIClientError('VALIDATION', '请输入有效的远端 Git 地址')
  }
  return remoteUrl
}

function requireBranch(value: string): string {
  const branch = value?.trim()
  if (!branch) throw new UIClientError('VALIDATION', '请选择有效的远端分支')
  const invalidChars = new Set([' ', '\t', '\n', '~', '^', ':', '?', '*', '[', '\\'])
  const hasInvalidChar = [...branch].some((char) => invalidChars.has(char) || char.charCodeAt(0) < 32)
  if (
    branch.startsWith('-')
    || branch.startsWith('/')
    || branch.endsWith('/')
    || branch.endsWith('.')
    || branch.includes('..')
    || branch.includes('//')
    || branch.includes('@{')
    || hasInvalidChar
  ) {
    throw new UIClientError('VALIDATION', '请选择有效的远端分支')
  }
  return branch
}
