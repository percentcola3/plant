// 旧版全文扫描：大小写不敏感子串匹配（zg 检索不可用时的回退路径）。
// 原实现自 workspaces/search.ts 抽出，行为不变：递归收集文本文件（深度/数量
// 上限）→ 逐文件 indexOf → 每文件一条 180 字符片段，无评分。
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

const MAX_DEPTH = 8
const MAX_FILES = 1200

const SKIPPED_DIRS = new Set([
  '.git',
  '.ui-client',
  '.workspace',
  '.claude',
  '.external',
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
  '.zvec-grep'
])

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.markdown',
  '.txt',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.vue',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.xml'
])

type SearchableFile = {
  absPath: string
  relPath: string
}

function isTextFile(name: string): boolean {
  const lower = name.toLowerCase()
  for (const ext of TEXT_EXTENSIONS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

async function collectTextFiles(
  rootPath: string,
  options?: { relPrefix?: string }
): Promise<SearchableFile[]> {
  const root = resolve(rootPath)
  const files: SearchableFile[] = []
  const relPrefix = options?.relPrefix?.replace(/^\/+/, '').replace(/\/+$/, '')

  async function walk(absDir: string, relDir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return
    const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return
      if (entry.name === '.DS_Store') continue
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
      const absPath = join(absDir, entry.name)

      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue
        await walk(absPath, relPath, depth + 1)
        continue
      }

      if (!entry.isFile() || !isTextFile(entry.name)) continue
      const resolved = resolve(absPath)
      if (resolved === root || !resolved.startsWith(root + '/')) continue
      files.push({ absPath: resolved, relPath: relPrefix ? `${relPrefix}/${relPath}` : relPath })
    }
  }

  await walk(root, '', 0)
  return files
}

function buildSnippet(content: string, query: string): string | null {
  const lowerContent = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerContent.indexOf(lowerQuery)
  if (index === -1) return null

  const lineStart = content.lastIndexOf('\n', index) + 1
  const nextBreak = content.indexOf('\n', index)
  const lineEnd = nextBreak === -1 ? content.length : nextBreak
  const line = content.slice(lineStart, lineEnd).trim()
  if (line.length <= 180) return line
  const localIndex = Math.max(0, index - lineStart)
  const start = Math.max(0, localIndex - 70)
  return `${start > 0 ? '...' : ''}${line.slice(start, start + 180)}${start + 180 < line.length ? '...' : ''}`
}

export type LegacyScanHit = {
  relPath: string
  snippet: string
}

// 单根回退扫描。relPath 相对 root（或 relPrefix 前缀），与 zg 的 relPath 语义一致。
export async function legacyScanRoot(
  rootPath: string,
  query: string,
  opts: { relPrefix?: string; maxResults?: number; pathFilter?: (relPath: string) => boolean } = {}
): Promise<LegacyScanHit[]> {
  const files = await collectTextFiles(rootPath, { relPrefix: opts.relPrefix })
  const out: LegacyScanHit[] = []
  for (const file of files) {
    if (opts.maxResults !== undefined && out.length >= opts.maxResults) break
    if (opts.pathFilter && !opts.pathFilter(file.relPath)) continue
    const content = await fs.readFile(file.absPath, 'utf-8').catch(() => null)
    if (content === null) continue
    const snippet = buildSnippet(content, query)
    if (!snippet) continue
    out.push({ relPath: file.relPath, snippet })
  }
  return out
}
