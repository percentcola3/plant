import { UIClientError } from '../ipc/errors'
import type { GitFailure } from './failures'
import { readGitCapability } from './capability'
import { commitOp, pushOp, type OpContext } from './ops'
import { isPathInsideRelDir, normalizeGitRelPath, stripRelDir } from './paths'
import { getSharedProbe } from './probe'

export type SubmitFeatureResult = {
  committed: boolean
  pushed: boolean
  fileCount: number
  warning?: string
  summary?: string
}

export { isPathInsideRelDir, normalizeGitRelPath }

export function normalizeRelDir(relDir: string): string {
  const normalized = stripRelDir(relDir)
  if (!normalized || normalized.split('/').includes('..')) {
    throw new UIClientError('PATH_OUTSIDE_SCOPE', `路径越界：${relDir}`)
  }
  return normalized
}

export async function submitFeatureDir(input: {
  workspacePath: string
  defaultBranch: string
  relDir: string
}): Promise<SubmitFeatureResult> {
  const relDir = normalizeRelDir(input.relDir)
  const capability = await readGitCapability(input.workspacePath)
  if (capability.state !== 'remote') {
    throw new UIClientError('VALIDATION', '当前工作区未绑定远程 Git')
  }

  const probe = getSharedProbe()
  probe.invalidate(input.workspacePath)
  const snap = await probe.snapshot(input.workspacePath, input.defaultBranch, { force: true })
  const ctx: OpContext = { workspacePath: input.workspacePath, snapshot: snap }

  const name = relDir.split('/').filter(Boolean).at(-1) ?? relDir
  const committed = await commitOp.execute(ctx, { message: `提交 ${name}`, relDir })
  if (!committed.ok) throwGitFailure(committed.failure)

  probe.invalidate(input.workspacePath)
  const after = await probe.snapshot(input.workspacePath, input.defaultBranch, { force: true })
  const outgoing = after.remote.kind === 'tracked'
    ? after.remote.outgoing
    : after.remote.kind === 'untracked-local' ? 1 : 0
  if (!committed.data.committed && outgoing === 0) {
    // Auto-save may have already committed and pushed before the user clicks.
    // Nothing left to submit is a successful no-op, not a submission failure.
    return { committed: false, pushed: false, fileCount: 0 }
  }

  const pushed = await pushOp.execute({ workspacePath: input.workspacePath, snapshot: after }, {})
  if (!pushed.ok) throwGitFailure(pushed.failure)
  probe.invalidate(input.workspacePath)

  return {
    committed: committed.data.committed,
    pushed: true,
    fileCount: committed.data.fileCount,
    warning: pushed.data.warning,
    summary: pushed.data.record?.summary
  }
}

function throwGitFailure(failure: GitFailure): never {
  switch (failure.kind) {
    case 'REBASE_IN_PROGRESS':
      throw new UIClientError('VALIDATION', '当前正在 rebase，不能提交')
    case 'CONFLICT':
      throw new UIClientError('VALIDATION', '当前有未完成的合并操作，不能提交')
    case 'DETACHED':
      throw new UIClientError('VALIDATION', '当前处于 detached HEAD，不能提交')
    case 'AUTH':
      throw new UIClientError('GIT_FAILED', 'Git 认证失败，请检查 SSH 或凭据')
    case 'NETWORK':
      throw new UIClientError('GIT_FAILED', failure.detail)
    case 'NON_FAST_FORWARD':
      throw new UIClientError('VALIDATION', '远程有新提交，请先同步仓库')
    case 'NOTHING_TO_COMMIT':
      throw new UIClientError('VALIDATION', '当前项目没有可提交的改动')
    case 'UNKNOWN':
      throw new UIClientError('GIT_FAILED', failure.raw)
    default:
      throw new UIClientError('GIT_FAILED', failure.kind)
  }
}
