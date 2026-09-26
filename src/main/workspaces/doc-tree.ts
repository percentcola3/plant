import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { DocTreeNode, UiProductCardMeta } from '@shared/types'
import { parseUiProductCardMeta } from '../outputs/card-meta'

const DOC_EXT_RE = /\.(md|mdx|markdown|txt)$/i

// 递归读取 markdown 文件树。隐藏目录跳过；非 md 文件跳过。
// knowledge workspace 扫描器用；老通路若需复用从此 import。

export async function readDocTree(rootPath: string, relDir: string): Promise<DocTreeNode[]> {
  return readFileTree(rootPath, relDir, { recursive: true, filter: (n) => DOC_EXT_RE.test(n) })
}

// 通用文件树：按可选过滤返回；recursive=false 仅返回直接子项（目录的 children 留空数组）
export async function readFileTree(
  rootPath: string,
  relDir: string,
  opts: { recursive?: boolean; filter?: (filename: string) => boolean } = {}
): Promise<DocTreeNode[]> {
  const recursive = opts.recursive !== false
  const abs = join(rootPath, relDir)
  const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => [])
  const nodes: DocTreeNode[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const childRel = relDir === '.' ? entry.name : `${relDir}/${entry.name}`
    if (entry.isDirectory()) {
      nodes.push({
        kind: 'folder',
        name: entry.name,
        relPath: childRel,
        children: recursive ? await readFileTree(rootPath, childRel, opts) : [],
        uiProductCard: await readUiProductCard(rootPath, childRel)
      })
      continue
    }
    if (!entry.isFile()) continue
    if (opts.filter && !opts.filter(entry.name)) continue
    const stat = await fs.stat(join(abs, entry.name)).catch(() => null)
    if (!stat) continue
    nodes.push({
      kind: 'file',
      name: entry.name,
      relPath: childRel,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    })
  }

  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function readUiProductCard(rootPath: string, relDir: string): Promise<UiProductCardMeta | null> {
  const parsed = await readMetaJson(rootPath, relDir)
  if (!parsed) return null
  return parseUiProductCardMeta(parsed.card)
}

async function readMetaJson(rootPath: string, relDir: string): Promise<Record<string, unknown> | null> {
  const metaPath = join(rootPath, relDir, 'meta.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}
