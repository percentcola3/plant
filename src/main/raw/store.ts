import { promises as fs } from 'node:fs'
import { rawEntryDir, rawEntryImagesDir, rawEntryMarkdown } from './paths'

// 剪页库工作区的写入。当前只用 createEntry；列表/读取/索引等待后续需要时再加。

export type CreateInput = {
  baseDir: string
  url: string
  title: string
  capturedAt: string
  excerpt?: string
  byline?: string
  tags?: string[]
  markdown: string
  imageCount: number
  videoCount?: number
  audioCount?: number
  subtitleCount?: number
}

export type CreatedItem = {
  id: string
  title: string
  source: string
  sourceHost: string
  capturedAt: string
}

const FRONT_KEYS_ORDER = [
  'title',
  'source',
  'sourceHost',
  'captured',
  'tags',
  'excerpt',
  'author',
  'images',
  'videos',
  'audios',
  'subtitles'
] as const

export async function createEntry(id: string, input: CreateInput): Promise<CreatedItem> {
  await fs.mkdir(rawEntryDir(input.baseDir, id), { recursive: true })
  const sourceHost = safeHost(input.url)

  const front: Record<string, string | number | string[]> = {
    title: input.title,
    source: input.url,
    captured: input.capturedAt
  }
  if (sourceHost) front.sourceHost = sourceHost
  if (input.tags && input.tags.length) front.tags = input.tags
  if (input.excerpt) front.excerpt = input.excerpt
  if (input.byline) front.author = input.byline
  front.images = input.imageCount
  if (input.videoCount) front.videos = input.videoCount
  if (input.audioCount) front.audios = input.audioCount
  if (input.subtitleCount) front.subtitles = input.subtitleCount

  const file = renderFrontmatter(front) + '\n' + input.markdown.trimEnd() + '\n'
  await fs.writeFile(rawEntryMarkdown(input.baseDir, id), file, 'utf-8')

  return {
    id,
    title: input.title,
    source: input.url,
    sourceHost,
    capturedAt: input.capturedAt
  }
}

// ── tiny YAML frontmatter ──
type FrontValue = string | number | string[]

function renderFrontmatter(front: Record<string, FrontValue>): string {
  const out: string[] = ['---']
  const keys = [
    ...FRONT_KEYS_ORDER,
    ...Object.keys(front).filter(k => !FRONT_KEYS_ORDER.includes(k as typeof FRONT_KEYS_ORDER[number]))
  ]
  const seen = new Set<string>()
  for (const k of keys) {
    if (seen.has(k) || !(k in front)) continue
    seen.add(k)
    out.push(`${k}: ${renderValue(front[k])}`)
  }
  out.push('---')
  return out.join('\n')
}

function renderValue(v: FrontValue): string {
  if (Array.isArray(v)) return `[${v.map(renderScalarString).join(', ')}]`
  if (typeof v === 'number') return String(v)
  return renderScalarString(v)
}

function renderScalarString(s: string): string {
  const safe = String(s).split('\n')[0].replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${safe}"`
}

function safeHost(url: string): string {
  if (!url) return ''
  try { return new URL(url).host } catch { return '' }
}

// 稳定生成 raw 条目 id（YYYYMMDD-HHMMSS-titleSnippet）
export function buildEntryId(now: Date, title: string): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const safe = (title || 'untitled')
    .replace(/[^a-zA-Z0-9一-鿿\-_]/g, '')
    .slice(0, 30) || 'untitled'
  return `${ts}-${safe}`
}

export { rawEntryImagesDir }
