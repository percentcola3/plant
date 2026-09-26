import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { WorkspacesStore } from './store'
import { gitFor } from '../git/client'
import { UIClientError } from '../ipc/errors'

const store = new WorkspacesStore()

// 单个冲突 chunk 的位置 + ours/theirs 文本。
export type ConflictChunk = {
  startLine: number              // 1-based，<<<<<<< 行
  separatorLine: number          // ======= 行
  endLine: number                // >>>>>>> 行
  ours: string                   // <<<<<<< ↔ ======= 中间文本（不含围栏）
  theirs: string                 // ======= ↔ >>>>>>> 中间文本（不含围栏）
}

export type ConflictFile = {
  relPath: string
  chunks: ConflictChunk[]
  binary: boolean                // 二进制 / 大文件 → chunks 为空，UI 走"保留我的/对方/手动"
}

export type ConflictListResult = {
  inProgress: 'rebase' | 'merge' | 'none'
  files: ConflictFile[]
}

const MARK_BEGIN = '<<<<<<<'
const MARK_SEPARATOR = '======='
const MARK_END = '>>>>>>>'
const BINARY_HINT_BYTES = 8000  // 取首段做 NUL 字节检测

async function detectInProgress(workspacePath: string): Promise<'rebase' | 'merge' | 'none'> {
  const gitDir = join(workspacePath, '.git')
  if (await pathExists(join(gitDir, 'rebase-merge')) || await pathExists(join(gitDir, 'rebase-apply'))) {
    return 'rebase'
  }
  if (await pathExists(join(gitDir, 'MERGE_HEAD'))) {
    return 'merge'
  }
  return 'none'
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true } catch { return false }
}

function looksBinary(text: string): boolean {
  // 取首段查 NUL；典型 git diff 也用这个判定
  return text.includes('\0')
}

function parseChunks(text: string): ConflictChunk[] {
  const lines = text.split('\n')
  const chunks: ConflictChunk[] = []
  let start = -1
  let sep = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith(MARK_BEGIN + ' ')) {
      start = i
      sep = -1
    } else if (start >= 0 && line.startsWith(MARK_SEPARATOR) && (line.length === MARK_SEPARATOR.length || /^=+$/.test(line))) {
      sep = i
    } else if (start >= 0 && sep >= 0 && line.startsWith(MARK_END + ' ')) {
      chunks.push({
        startLine: start + 1,
        separatorLine: sep + 1,
        endLine: i + 1,
        ours: lines.slice(start + 1, sep).join('\n'),
        theirs: lines.slice(sep + 1, i).join('\n')
      })
      start = -1; sep = -1
    }
  }
  return chunks
}

export async function listConflicts(workspaceId: string): Promise<ConflictListResult> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  const inProgress = await detectInProgress(ws.path)

  const sg = gitFor(ws.path)
  const status = await sg.status()
  const conflictPaths = status.conflicted ?? []
  const files: ConflictFile[] = []
  for (const rel of conflictPaths) {
    const abs = join(ws.path, rel)
    let raw: Buffer
    try {
      raw = await fs.readFile(abs)
    } catch {
      continue
    }
    const head = raw.subarray(0, BINARY_HINT_BYTES).toString('utf-8')
    if (looksBinary(head)) {
      files.push({ relPath: rel, chunks: [], binary: true })
      continue
    }
    const text = raw.toString('utf-8')
    files.push({ relPath: rel, chunks: parseChunks(text), binary: false })
  }
  return { inProgress, files }
}

// 用户对单文件给出最终内容（前端拼好的）；后端写入磁盘 + git add，让 git 看到已解决。
export async function applyResolution(
  workspaceId: string,
  relPath: string,
  resolvedContent: string
): Promise<void> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  const abs = join(ws.path, relPath)
  await fs.writeFile(abs, resolvedContent, 'utf-8')
  const sg = gitFor(ws.path)
  await sg.add([relPath])
}

// "保留我的 / 保留对方 / 我来手动" 中前两个的快捷实现
export async function pickSide(
  workspaceId: string,
  relPath: string,
  side: 'ours' | 'theirs'
): Promise<void> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  const sg = gitFor(ws.path)
  await sg.checkout([side === 'ours' ? '--ours' : '--theirs', relPath])
  await sg.add([relPath])
}

export async function continueOperation(workspaceId: string): Promise<void> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  const inProgress = await detectInProgress(ws.path)
  const sg = gitFor(ws.path)
  if (inProgress === 'rebase') {
    await sg.rebase(['--continue'])
  } else if (inProgress === 'merge') {
    // simple-git 没直接 mergeContinue；用 raw
    await sg.raw(['merge', '--continue'])
  } else {
    throw new UIClientError('VALIDATION', '当前没有进行中的 rebase/merge 操作')
  }
}

export async function abortOperation(workspaceId: string): Promise<void> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  const inProgress = await detectInProgress(ws.path)
  const sg = gitFor(ws.path)
  if (inProgress === 'rebase') {
    await sg.rebase(['--abort'])
  } else if (inProgress === 'merge') {
    await sg.raw(['merge', '--abort'])
  } else {
    throw new UIClientError('VALIDATION', '当前没有进行中的 rebase/merge 操作')
  }
}
