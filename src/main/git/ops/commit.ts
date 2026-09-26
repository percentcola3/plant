import { isAppManagedPath } from '@shared/app-managed-paths'
import { gitFor } from '../client'
import { classifyError } from '../failures'
import { isPathInsideRelDir, normalizeGitRelPath } from '../paths'
import type { GitOp, OpOutcome } from './types'

export type CommitArgs = { message: string; relDir?: string }
export type CommitData = { committed: boolean; fileCount: number }

function parseNameOnlyZ(raw: string): string[] {
  return raw.split('\0').map(normalizeGitRelPath).filter(Boolean)
}

// 同时服务"打版本"（用户给 message）和"auto-save"（saga 给 wip 前缀 message）。
// 整仓提交用 snapshot.working.files（已过滤 isAppManagedPath）。
// 带 relDir 时不信任 snapshot 文件列表：git status 路径可能漏报，改为 `add -A -- relDir`。
export const commitOp: GitOp<CommitArgs, CommitData> = {
  name: 'commit',
  idempotent: true,
  isSatisfied(ctx, args) {
    const w = ctx.snapshot.working
    const relDir = args.relDir
    if (!relDir) return w.kind === 'clean'
    if (w.kind === 'clean') return true
    if (w.kind !== 'dirty') return false
    return !w.files.some((file) => isPathInsideRelDir(file.path, relDir))
  },
  async execute(ctx, args): Promise<OpOutcome<CommitData>> {
    const w = ctx.snapshot.working
    if (w.kind === 'rebasing') return { ok: false, failure: { kind: 'REBASE_IN_PROGRESS' } }
    if (w.kind === 'merging' || w.kind === 'cherry-picking' || w.kind === 'reverting') {
      return { ok: false, failure: { kind: 'CONFLICT', files: w.conflicts, during: w.kind === 'merging' ? 'merge' : w.kind === 'cherry-picking' ? 'cherry-pick' : 'revert' } }
    }
    if (w.kind === 'detached') return { ok: false, failure: { kind: 'DETACHED' } }

    const msg = args.message.trim()
    if (!msg) {
      if (w.kind !== 'dirty' && !args.relDir) return { ok: true, data: { committed: false, fileCount: 0 } }
      return { ok: false, failure: { kind: 'UNKNOWN', raw: 'commit message empty' } }
    }

    if (args.relDir) {
      return commitRelDir(ctx.workspacePath, args.relDir, msg)
    }

    if (w.kind !== 'dirty') return { ok: true, data: { committed: false, fileCount: 0 } }

    const sg = gitFor(ctx.workspacePath)
    try {
      await sg.add(w.files.map((f) => f.path))
      await sg.commit(msg)
      return { ok: true, data: { committed: true, fileCount: w.files.length } }
    } catch (e) {
      return { ok: false, failure: classifyError(e, { during: 'commit' }) }
    }
  }
}

async function commitRelDir(workspacePath: string, relDir: string, msg: string): Promise<OpOutcome<CommitData>> {
  const sg = gitFor(workspacePath)
  try {
    await sg.raw(['add', '-A', '--', relDir])
    const stagedAll = parseNameOnlyZ(await sg.raw(['diff', '--cached', '--name-only', '-z', '--', relDir]))
    const managed = stagedAll.filter((path) => isAppManagedPath(path))
    if (managed.length > 0) {
      await sg.raw(['reset', '-q', 'HEAD', '--', ...managed])
    }
    const staged = stagedAll.filter((path) => isPathInsideRelDir(path, relDir) && !isAppManagedPath(path))
    if (staged.length === 0) {
      return { ok: true, data: { committed: false, fileCount: 0 } }
    }
    await sg.commit(msg, staged)
    return { ok: true, data: { committed: true, fileCount: staged.length } }
  } catch (e) {
    const failure = classifyError(e, { during: 'commit' })
    if (failure.kind === 'NOTHING_TO_COMMIT') {
      return { ok: true, data: { committed: false, fileCount: 0 } }
    }
    return { ok: false, failure }
  }
}

export function wipMessage(branch: string, isoTime: string): string {
  return `wip(${branch}): ${isoTime}`
}

export function isWipMessage(subject: string): boolean {
  return /^wip\(/.test(subject.trim())
}
