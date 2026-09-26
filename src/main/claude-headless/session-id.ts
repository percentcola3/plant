// 会话 ID 管理：每项目持久化一个 session-id，用于 claude --session-id / --resume
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, rmdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { APP_MANAGED_GITIGNORE_ENTRIES } from '@shared/app-managed-paths'
import { removeDeepSeekTranscript } from '../deepseek-harness/transcript'

export function isClaudeSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

// Claude Code 2.1.x 的短 cwd key：每个非 ASCII 字母/数字字符都替换成 `-`。
// 这里只用于首轮尚无 JSONL 时给 watcher 一个预期路径；恢复已有会话时必须通过
// findSessionJsonlAnywhere 找到真实文件，不能依赖这个私有规则（长路径规则可能变化）。
export function projectHashFor(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-')
}

// 会话 JSONL 文件路径
export function sessionJsonlPath(projectPath: string, sessionId: string): string {
  const hash = projectHashFor(projectPath)
  return join(homedir(), '.claude', 'projects', hash, `${sessionId}.jsonl`)
}

// 历史回放优先读当前 cwd 下的 JSONL；会话曾在其他 work area 启动时，
// 回退到 Claude Code 实际归档位置。文件还没创建时仍返回当前 cwd 路径，便于 watcher 等待首轮写入。
export function sessionJsonlPathForReplay(projectPath: string, sessionId: string): string {
  return findSessionJsonlForResume(projectPath, sessionId)
    ?? sessionJsonlPath(projectPath, sessionId)
}

// submit 与 watcher 共用同一解析规则：优先当前 cwd 的 transcript；否则从所有
// Claude 私有目录中选 mtime 最新的一份，避免同 SID 多副本时回放 A、续聊 B。
export function findSessionJsonlForResume(projectPath: string, sessionId: string): string | null {
  const expected = sessionJsonlPath(projectPath, sessionId)
  try {
    if (statSync(expected).size > 0) return expected
  } catch { /* not at current cwd */ }
  return findSessionJsonlAnywhere(sessionId)
}

// 扫所有 Claude 私有 cwd-key 目录，找到 sid 对应的真实 JSONL 绝对路径。
// 恢复时直接把它交给 `claude --resume`，找不到则返回 null。
export function findSessionJsonlAnywhere(sessionId: string): string | null {
  return findSessionJsonlPathsAnywhere(sessionId)[0] ?? null
}

function findSessionJsonlPathsAnywhere(sessionId: string): string[] {
  const matches: Array<{ path: string; mtimeMs: number }> = []
  try {
    const root = join(homedir(), '.claude', 'projects')
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(root, entry.name, `${sessionId}.jsonl`)
      try {
        const stat = statSync(candidate)
        if (stat.size > 0) matches.push({ path: candidate, mtimeMs: stat.mtimeMs })
      } catch { /* not in this dir */ }
    }
  } catch { /* projects root missing */ }
  return matches
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
    .map((match) => match.path)
}

// 项目级 .workspace 目录路径
function workspaceDir(projectPath: string): string {
  return join(projectPath, '.workspace')
}

// 读取或创建 session-id（每项目一个，持久化到 .workspace/session-id）
export function ensureSessionId(projectPath: string): string {
  ensureSessionGitignore(projectPath)
  const sidFile = projectSessionFile(projectPath)

  if (existsSync(sidFile)) {
    const existing = readFileSync(sidFile, 'utf-8').trim()
    if (existing) return existing
  }

  return createSessionId(projectPath)
}

// 创建新的会话 ID，并覆盖项目持久化的当前 session-id。
export function createSessionId(projectPath: string): string {
  ensureSessionGitignore(projectPath)
  return createSessionIdAt(projectSessionFile(projectPath))
}

export function ensureWorkspaceSessionId(projectPath: string, scopeKey?: string): string {
  ensureSessionGitignore(projectPath)
  const sidFile = workspaceSessionFile(projectPath, scopeKey)
  if (existsSync(sidFile)) {
    const existing = readFileSync(sidFile, 'utf-8').trim()
    if (existing) return existing
  }
  return createSessionIdAt(sidFile)
}

export function createWorkspaceSessionId(projectPath: string, scopeKey?: string): string {
  ensureSessionGitignore(projectPath)
  const sidFile = workspaceSessionFile(projectPath, scopeKey)
  const sessionId = createSessionIdAt(sidFile)
  // 显式“新会话”在首条消息前还没有 JSONL，不能被死绑定自愈误判并换回旧会话。
  writeFileSync(intentionalNewSessionFile(sidFile), sessionId + '\n', 'utf-8')
  return sessionId
}

export function branchScopedWorkspaceKey(branch: string, scopeKey?: string): string {
  return `branch:${normalizeBranchName(branch)}|workspace:${normalizeRelPath(scopeKey || 'home')}`
}

export function branchScopedDocumentKey(branch: string, relPath: string): string {
  return `branch:${normalizeBranchName(branch)}|document:${normalizeRelPath(relPath)}`
}

export function ensureDocumentSessionId(projectPath: string, relPath: string): string {
  ensureSessionGitignore(projectPath)
  const sidFile = documentSessionFile(projectPath, relPath)
  if (existsSync(sidFile)) {
    const existing = readFileSync(sidFile, 'utf-8').trim()
    if (existing) return existing
  }
  return createSessionIdAt(sidFile)
}

export function createDocumentSessionId(projectPath: string, relPath: string): string {
  ensureSessionGitignore(projectPath)
  return createSessionIdAt(documentSessionFile(projectPath, relPath))
}

export function clearProjectSessionHistory(projectPath: string): void {
  const sessionFiles = knownSessionFiles(projectPath)
  const sessionIds = new Set<string>()

  for (const file of sessionFiles) {
    try {
      const id = readFileSync(file, 'utf-8').trim()
      if (id) sessionIds.add(id)
    } catch {
      // ignore missing session file
    }
  }

  for (const sessionId of sessionIds) {
    // 同一个 workspace session 索引也可能属于内置 DSH；两类 transcript 各自清理。
    removeDeepSeekTranscript(sessionId)
    const actualPaths = findSessionJsonlPathsAnywhere(sessionId)
    if (actualPaths.length === 0) {
      rmSync(sessionJsonlPath(projectPath, sessionId), { force: true })
      continue
    }
    for (const jsonlPath of actualPaths) rmSync(jsonlPath, { force: true })
  }

  for (const file of sessionFiles) {
    rmSync(file, { force: true })
    rmSync(intentionalNewSessionFile(file), { force: true })
  }
  removeIfEmpty(join(workspaceDir(projectPath), 'document-sessions'))
  removeIfEmpty(join(workspaceDir(projectPath), 'workspace-sessions'))
  removeIfEmpty(join(homedir(), '.claude', 'projects', projectHashFor(projectPath)))
}

// ── 死绑定自愈 ──
// 旧版本每次发消息前都 forceNew 覆盖 scope 绑定；若那一次
// spawn 失败（如 spawn EBADF 时期），新会话只留下 id、jsonl 从未写入，绑定就被
// "空壳会话"污染——表现为重新打开项目 AI 面板时完全空白（replay 不到任何历史）。
// 检测：当前绑定会话在任意位置都没有 jsonl。恢复：在同一 workDir（feature 目录）
// 的 jsonl 里找"属于本项目已知会话、最近修改"的一个，写回当前 scope 绑定。
export function recoverDeadWorkspaceSessionBinding(
  projectPath: string,
  workDir: string,
  scopeKey: string | undefined
): string | null {
  const sidFile = workspaceSessionFile(projectPath, scopeKey)
  let bound: string | null = null
  try {
    bound = readFileSync(sidFile, 'utf-8').trim() || null
  } catch {
    return null // 没有绑定文件，ensure 会新建，不算死绑定
  }
  if (!bound || !isClaudeSessionId(bound)) return null
  if (findSessionJsonlAnywhere(bound)) {
    rmSync(intentionalNewSessionFile(sidFile), { force: true })
    return null // 绑定健康
  }
  try {
    if (readFileSync(intentionalNewSessionFile(sidFile), 'utf-8').trim() === bound) {
      return null // 用户主动创建的空会话，不回退到旧历史
    }
  } catch { /* 没有显式新会话标记 */ }

  const known = new Set(knownSessionIds(projectPath))
  if (known.size === 0) return null

  // workDir 对应的 ~/.claude/projects hash 目录；历史 jsonl 按首次 spawn cwd 落盘
  const jsonlDir = join(homedir(), '.claude', 'projects', projectHashFor(workDir))
  let best: { sid: string; mtimeMs: number } | null = null
  try {
    for (const entry of readdirSync(jsonlDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const sid = entry.name.slice(0, -'.jsonl'.length)
      if (!known.has(sid) || sid === bound) continue
      const jsonlPath = join(jsonlDir, entry.name)
      try {
        const st = statSync(jsonlPath)
        if (st.size === 0) continue
        if (!best || st.mtimeMs > best.mtimeMs) best = { sid, mtimeMs: st.mtimeMs }
      } catch { /* 读取失败跳过 */ }
    }
  } catch {
    return null // 目录不存在：该 workDir 从未有过会话
  }
  if (!best) return null

  try {
    writeFileSync(sidFile, best.sid + '\n', 'utf-8')
    console.warn(`[session-id] 死绑定自愈：scope=${scopeKey ?? 'home'} ${bound.slice(0, 8)}(无jsonl) → ${best.sid.slice(0, 8)}`)
    return best.sid
  } catch (e) {
    console.warn('[session-id] 死绑定自愈写回失败:', e)
    return null
  }
}

function knownSessionIds(projectPath: string): string[] {
  const ids: string[] = []
  for (const file of knownSessionFiles(projectPath)) {
    try {
      const id = readFileSync(file, 'utf-8').trim()
      if (id && isClaudeSessionId(id)) ids.push(id)
    } catch { /* ignore */ }
  }
  return ids
}

function ensureSessionGitignore(projectPath: string): void {
  const gitignorePath = join(projectPath, '.gitignore')
  let current = ''
  try {
    current = readFileSync(gitignorePath, 'utf-8')
  } catch {
    current = ''
  }
  const lines = current ? current.replace(/\s+$/, '').split('\n') : []
  let changed = false
  for (const entry of APP_MANAGED_GITIGNORE_ENTRIES) {
    if (!lines.includes(entry)) {
      lines.push(entry)
      changed = true
    }
  }
  if (changed) writeFileSync(gitignorePath, lines.filter(Boolean).join('\n') + '\n', 'utf-8')
}

function projectSessionFile(projectPath: string): string {
  const wsDir = workspaceDir(projectPath)
  return join(wsDir, 'session-id')
}

function workspaceSessionFile(projectPath: string, scopeKey?: string): string {
  const wsDir = workspaceDir(projectPath)
  if (scopeKey) {
    const key = createHash('sha1').update(normalizeRelPath(scopeKey)).digest('hex').slice(0, 16)
    return join(wsDir, 'workspace-sessions', `${key}.session-id`)
  }
  return join(wsDir, 'home-session-id')
}

function intentionalNewSessionFile(sessionFile: string): string {
  return `${sessionFile}.intentional-new`
}

function documentSessionFile(projectPath: string, relPath: string): string {
  const wsDir = workspaceDir(projectPath)
  const key = createHash('sha1').update(normalizeRelPath(relPath)).digest('hex').slice(0, 16)
  return join(wsDir, 'document-sessions', `${key}.session-id`)
}

function knownSessionFiles(projectPath: string): string[] {
  const wsDir = workspaceDir(projectPath)
  return [
    projectSessionFile(projectPath),
    workspaceSessionFile(projectPath),
    ...sessionFilesIn(join(wsDir, 'document-sessions')),
    ...sessionFilesIn(join(wsDir, 'workspace-sessions'))
  ]
}

function sessionFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.session-id'))
      .map((entry) => join(dir, entry.name))
  } catch {
    return []
  }
}

function removeIfEmpty(dir: string): void {
  try {
    rmdirSync(dir)
  } catch {
    // keep non-empty or missing directories
  }
}

function createSessionIdAt(sidFile: string): string {
  const newId = randomUUID()
  mkdirSync(dirname(sidFile), { recursive: true })
  writeFileSync(sidFile, newId, 'utf-8')
  return newId
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '')
}

function normalizeBranchName(branch: string): string {
  const normalized = branch.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return normalized || 'detached'
}
