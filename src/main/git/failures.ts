// git 操作失败的 canonical 枚举。所有 op 内部的 catch 都走 classifyError 转这个类型。
// 替换原 sync.ts / mainline.ts / client.ts 三处分散的字符串匹配。

export type ConflictDuring = 'rebase' | 'merge' | 'cherry-pick' | 'revert'

export type GitFailure =
  | { kind: 'CONFLICT'; files: string[]; during: ConflictDuring }
  | { kind: 'NON_FAST_FORWARD' }
  | { kind: 'AUTH'; host?: string }
  | { kind: 'NETWORK'; detail: string }
  | { kind: 'DETACHED' }
  | { kind: 'UNCOMMITTED'; files: string[] }
  | { kind: 'BRANCH_TAKEN'; name: string }
  | { kind: 'BRANCH_MISSING'; name: string }
  | { kind: 'REBASE_IN_PROGRESS' }
  | { kind: 'NOTHING_TO_COMMIT' }
  | { kind: 'UNKNOWN'; raw: string }

export type ClassifyContext = {
  during?: ConflictDuring | 'pull' | 'push' | 'commit' | 'checkout' | 'fetch'
  branch?: string
}

export function classifyError(err: unknown, ctx: ClassifyContext = {}): GitFailure {
  const raw = err instanceof Error ? err.message : String(err)
  const lower = raw.toLowerCase()

  if (lower.includes('non-fast-forward') || lower.includes('failed to push some refs') || lower.includes('fetch first')) {
    return { kind: 'NON_FAST_FORWARD' }
  }

  if (lower.includes('rebase in progress') || lower.includes('it seems that there is already a') || lower.includes('cannot start a new rebase')) {
    return { kind: 'REBASE_IN_PROGRESS' }
  }

  if (lower.includes('conflict') || lower.includes('unmerged paths') || lower.includes('automatic merge failed') || lower.includes('could not apply')) {
    const during: ConflictDuring = pickDuring(ctx, lower)
    return { kind: 'CONFLICT', files: extractConflictFiles(raw), during }
  }

  if (lower.includes('your local changes to the following files would be overwritten') || lower.includes('please commit your changes') || lower.includes('uncommitted changes')) {
    return { kind: 'UNCOMMITTED', files: extractUncommittedFiles(raw) }
  }

  if (lower.includes('authentication') || lower.includes('could not read username') || /\b(401|403)\b/.test(lower)) {
    const host = extractHost(raw)
    return host ? { kind: 'AUTH', host } : { kind: 'AUTH' }
  }

  if (lower.includes('could not resolve host') || lower.includes('connection') || lower.includes('timed out') || lower.includes('connection refused')) {
    return { kind: 'NETWORK', detail: raw }
  }

  if (lower.includes('detached head')) return { kind: 'DETACHED' }

  if (lower.includes('already exists') && lower.includes('branch')) {
    return { kind: 'BRANCH_TAKEN', name: ctx.branch ?? '' }
  }

  if (lower.includes('did not match any') || lower.includes('not a valid object name') || lower.includes('unknown revision')) {
    return { kind: 'BRANCH_MISSING', name: ctx.branch ?? '' }
  }

  if (lower.includes('nothing to commit') || lower.includes('nothing added to commit')) {
    return { kind: 'NOTHING_TO_COMMIT' }
  }

  return { kind: 'UNKNOWN', raw }
}

function pickDuring(ctx: ClassifyContext, lower: string): ConflictDuring {
  if (ctx.during === 'rebase' || ctx.during === 'merge' || ctx.during === 'cherry-pick' || ctx.during === 'revert') {
    return ctx.during
  }
  if (lower.includes('rebase')) return 'rebase'
  if (lower.includes('cherry-pick')) return 'cherry-pick'
  if (lower.includes('revert')) return 'revert'
  return 'merge'
}

function extractConflictFiles(raw: string): string[] {
  const files = new Set<string>()
  for (const m of raw.matchAll(/CONFLICT \([^)]+\): (?:Merge conflict in |Could not apply [a-f0-9]+\.\.\. )?(\S+)/g)) {
    if (m[1]) files.add(m[1])
  }
  for (const m of raw.matchAll(/^\s+both modified:\s+(\S+)/gm)) {
    if (m[1]) files.add(m[1])
  }
  return [...files]
}

function extractUncommittedFiles(raw: string): string[] {
  const files = new Set<string>()
  let inList = false
  for (const line of raw.split('\n')) {
    if (line.includes('would be overwritten') || line.includes('uncommitted changes')) { inList = true; continue }
    if (!inList) continue
    const trimmed = line.trim()
    if (!trimmed) { inList = false; continue }
    if (/^[\w\-./]+$/.test(trimmed)) files.add(trimmed)
    else inList = false
  }
  return [...files]
}

function extractHost(raw: string): string | undefined {
  const m = raw.match(/(?:https?:\/\/|git@)([\w.-]+)/)
  return m?.[1]
}
