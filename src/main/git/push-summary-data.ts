import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { SimpleGit } from 'simple-git'
import type { GitPushFileSummary, GitPushSummary } from '../../shared/git-push-summary'

export const PUSH_NOTES_REF = 'refs/notes/peeka-push'
export const INCOMING_NOTES_REF = 'refs/notes/peeka-push-incoming'
const SHA = /^[0-9a-f]{40,64}$/
const MAX_FILES = 300
const MAX_DIFF_CHARS = 36_000
const LABELS = { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名', other: '更新' }
export type PushEvidence = { record: GitPushSummary; diff: string }

export function parseChangedFiles(raw: string): GitPushFileSummary[] {
  const parts = raw.split('\0')
  const result: GitPushFileSummary[] = []
  for (let i = 0; i < parts.length - 1;) {
    const status = parts[i++]
    const first = parts[i++]
    if (!first) break
    const renamed = status.startsWith('R') || status.startsWith('C')
    const path = renamed ? parts[i++] : first
    if (!path) break
    const change = renamed ? 'renamed' : status === 'A' ? 'added' : status === 'D' ? 'deleted' : status === 'M' ? 'modified' : 'other'
    result.push({ path, ...(renamed ? { previousPath: first } : {}), change, summary: `${LABELS[change]}文件` })
  }
  return result
}

export async function capturePushEvidence(git: SimpleGit, branch: string, baseSha: string | null, headSha: string): Promise<PushEvidence> {
  if (!SHA.test(headSha) || (baseSha !== null && !SHA.test(baseSha))) throw new Error('推送版本号无效')
  // A new branch is compared with the empty tree, never a guessed merge base.
  const base = baseSha ?? await emptyTree(git)
  const allFiles = parseChangedFiles(await git.raw(['diff', '--name-status', '-z', '--find-renames', base, headSha, '--']))
  const files = allFiles.slice(0, MAX_FILES)
  let diff = ''
  let sampled = 0
  for (const file of files) {
    if (sampled >= 20 || diff.length >= MAX_DIFF_CHARS) break
    if (!canSummarizeContent(file.path)) continue
    const oldPath = file.previousPath ?? file.path
    // Avoid reading large blobs or binary files into the main process.
    const sizes = await Promise.all([
      git.raw(['cat-file', '-s', `${headSha}:${file.path}`]).catch(() => '0'),
      git.raw(['cat-file', '-s', `${base}:${oldPath}`]).catch(() => '0')
    ])
    if (sizes.some(size => Number(size) > 128_000)) continue
    const patch = await git.raw(['--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--unified=3', base, headSha, '--', oldPath, file.path])
    diff += `\n${patch.slice(0, Math.min(6000, MAX_DIFF_CHARS - diff.length))}`
    sampled++
  }
  const author = (await git.raw(['show', '-s', '--format=%an <%ae>', headSha])).trim()
  return {
    record: {
      version: 1, id: createHash('sha256').update(`${branch}\0${baseSha}\0${headSha}`).digest('hex').slice(0, 24),
      branch, baseSha, headSha, pushedAt: new Date().toISOString(), author,
      source: 'basic', summary: `本次推送涉及 ${allFiles.length} 个文件`, files,
      filesTruncated: allFiles.length > files.length, diffTruncated: sampled < allFiles.length || diff.length >= MAX_DIFF_CHARS
    },
    diff: redactDiff(diff)
  }
}

function canSummarizeContent(path: string): boolean {
  if (/(^|\/)(\.env(?:\..*)?|[^/]*(?:credential|secret|token|private.?key)[^/]*|[^/]*lock[^/]*)$/i.test(path)) return false
  return /\.(md|mdx|txt|rst|adoc|ts|tsx|js|jsx|vue|html|css|scss|json|yaml|yml|py|swift|go|rs|java|sql)$/i.test(path)
}

function redactDiff(text: string): string {
  return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|password|secret|access[_-]?token)\s*["']?\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
}

export function applyAiSummary(record: GitPushSummary, output: string): GitPushSummary {
  const cleaned = output.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(cleaned) as { summary?: unknown; files?: unknown }
  if (typeof parsed.summary !== 'string' || !parsed.summary.trim() || !Array.isArray(parsed.files)) throw new Error('AI 总结格式无效')
  const byPath = new Map<string, string>()
  for (const item of parsed.files) {
    if (item && typeof item.path === 'string' && typeof item.summary === 'string') byPath.set(item.path, item.summary.trim().slice(0, 600))
  }
  return { ...record, source: 'ai', summary: parsed.summary.trim().slice(0, 2000),
    files: record.files.map(file => ({ ...file, summary: byPath.get(file.path) || file.summary })) }
}

export function parsePushNote(text: string): GitPushSummary[] {
  const records: GitPushSummary[] = []
  if (text.length > 2_000_000) return records
  for (const line of text.split('\n')) {
    try {
      const r = JSON.parse(line) as GitPushSummary
      if (r.version !== 1 || !SHA.test(r.headSha) || (r.baseSha !== null && !SHA.test(r.baseSha))
        || typeof r.id !== 'string' || typeof r.branch !== 'string' || typeof r.author !== 'string'
        || typeof r.summary !== 'string' || typeof r.pushedAt !== 'string' || !Number.isFinite(Date.parse(r.pushedAt))
        || !['ai', 'basic'].includes(r.source) || !Array.isArray(r.files) || r.files.length > MAX_FILES
        || r.files.some(f => typeof f.path !== 'string' || typeof f.summary !== 'string' || !Object.hasOwn(LABELS, f.change))) continue
      records.push(r)
    } catch { /* Ignore malformed/untrusted notes without losing other entries. */ }
  }
  return records
}

async function emptyTree(git: SimpleGit): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'peeka-empty-tree-'))
  try {
    const path = join(dir, 'empty')
    await writeFile(path, '')
    return (await git.raw(['hash-object', '-w', '-t', 'tree', path])).trim()
  } finally { await rm(dir, { recursive: true, force: true }) }
}
