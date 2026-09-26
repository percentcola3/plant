// 共享：从已 walk 的文件列表里挑出可发布的 .md/.mdx/.markdown，并解析每个文件的标题。
// 原本只在 UX 发布器里有；现在 PM 也复用，让两边的"侧栏文档"行为一致。
import { promises as fs } from 'node:fs'
import { basename, relative } from 'node:path'

export type MarkdownDocLink = {
  relPath: string                 // 相对 root 的 POSIX 风格路径，用于侧栏链接 & fetch
  title: string                   // 首个 `# H1` 文本；缺失时退回文件名
}

// 排除以 . 开头的隐藏目录（.git/.workspace/.claude 等），但保留 CLAUDE.md / AGENTS.md 等
// 项目根/feature 根下的约定文件 —— 它们对设计师/PM 看产物时也是相关上下文。
export function isPublishMarkdownDoc(relPath: string): boolean {
  if (!/\.(md|mdx|markdown)$/i.test(relPath)) return false
  return !relPath.split('/').some((part) => part.startsWith('.'))
}

export async function collectMarkdownDocs(
  rootAbs: string,
  allFiles: string[]
): Promise<MarkdownDocLink[]> {
  const docs: MarkdownDocLink[] = []
  for (const abs of allFiles) {
    const relPath = relative(rootAbs, abs).split(/\\|\//).join('/')
    if (!isPublishMarkdownDoc(relPath)) continue
    docs.push({
      relPath,
      title: await readMarkdownDocTitle(abs, relPath)
    })
  }
  return docs.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

async function readMarkdownDocTitle(absPath: string, relPath: string): Promise<string> {
  try {
    const content = await fs.readFile(absPath, 'utf-8')
    const heading = content
      .split(/\r?\n/)
      .map((line) => line.match(/^#\s+(.+?)\s*#*\s*$/)?.[1]?.trim())
      .find((line): line is string => !!line)
    if (heading) return heading
  } catch {
    // 读不到就退回文件名；不阻断发布
  }
  return basename(relPath).replace(/\.(md|mdx|markdown)$/i, '') || relPath
}
