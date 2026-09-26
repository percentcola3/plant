// 统一封装 git worktree 的 add/remove/list 三个原子操作。
// 之前散在 workspaces/team-push.ts、features/copy-to-space.ts 里各自实现，
// 每处小差异（是否 --detach、是否 -b、from 是本地分支还是 origin/xxx）都靠 if-else 处理，
// 收敛到这里后调用方只填选项，命令拼装唯一。
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { gitFor } from './client'

export type AddWorktreeInput = {
  // 主仓库路径（共享 .git 的那个 clone）
  repoPath: string
  // 目标 worktree 落地路径
  targetPath: string
  // 目标分支名。留空 = detached HEAD checkout
  branch?: string
  // 起源 ref：'HEAD' / 'origin/xxx' / 具体 sha。省略时用现有本地 branch。
  from?: string
  // 是否新建分支（`-b <branch>`）。true 时 branch 必填、from 通常也要指定
  createBranch?: boolean
  // detached HEAD 模式（`--detach`）
  detach?: boolean
  // `--force`：允许覆盖 git 已有的 worktree 记录
  force?: boolean
}

export async function addWorktree(input: AddWorktreeInput): Promise<void> {
  const { repoPath, targetPath, branch, from, createBranch, detach, force } = input
  if (createBranch && !branch) {
    throw new Error('addWorktree: createBranch=true 时必须指定 branch')
  }
  await fs.mkdir(dirname(targetPath), { recursive: true })

  const args: string[] = ['worktree', 'add']
  if (force) args.push('--force')
  if (detach) args.push('--detach')
  if (createBranch) args.push('-b', branch!)
  args.push(targetPath)
  if (from) {
    args.push(from)
  } else if (branch && !createBranch) {
    args.push(branch)
  }
  // detach 且无 from：git 会默认从 HEAD 起

  await gitFor(repoPath).raw(args)
}

// 拆 worktree：先跑 git 命令让 .git/worktrees/ 元数据同步，再兜底 fs.rm。
// 两步都 catch，允许对已损坏的 worktree 强制清理。
export async function removeWorktree(repoPath: string, targetPath: string): Promise<void> {
  await gitFor(repoPath).raw(['worktree', 'remove', '--force', targetPath]).catch(() => undefined)
  await fs.rm(targetPath, { recursive: true, force: true }).catch(() => undefined)
}

export type WorktreeInfo = {
  path: string
  head?: string
  branch?: string // 已去掉 refs/heads/ 前缀
  detached: boolean
  bare: boolean
  locked: boolean
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  let out: string
  try {
    out = await gitFor(repoPath).raw(['worktree', 'list', '--porcelain'])
  } catch {
    return []
  }
  return parseWorktreePorcelain(out)
}

// porcelain 输出形如：
//   worktree /path/to/main
//   HEAD abcd1234...
//   branch refs/heads/main
//
//   worktree /path/to/other
//   HEAD deadbeef...
//   branch refs/heads/feature/x
//   locked reason...
//
//   worktree /path/to/detached
//   HEAD 5555...
//   detached
export function parseWorktreePorcelain(out: string): WorktreeInfo[] {
  const blocks = out.split(/\r?\n\r?\n+/)
  const result: WorktreeInfo[] = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((line) => line.length > 0)
    if (lines.length === 0) continue
    const entry: WorktreeInfo = { path: '', detached: false, bare: false, locked: false }
    for (const line of lines) {
      const spaceIdx = line.indexOf(' ')
      const key = spaceIdx >= 0 ? line.slice(0, spaceIdx) : line
      const value = spaceIdx >= 0 ? line.slice(spaceIdx + 1) : ''
      if (key === 'worktree') entry.path = value
      else if (key === 'HEAD') entry.head = value
      else if (key === 'branch') entry.branch = value.replace(/^refs\/heads\//, '')
      else if (key === 'detached') entry.detached = true
      else if (key === 'bare') entry.bare = true
      else if (key === 'locked') entry.locked = true
    }
    if (entry.path) result.push(entry)
  }
  return result
}
