import http from 'node:http'
import https from 'node:https'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import { parseHTML } from 'linkedom'

export type ExtractInput = {
  url: string
  title?: string
  html: string
  imageUrls?: string[]
  capturedAt?: string
}

export type ExtractedDoc = {
  title: string
  excerpt?: string
  byline?: string
  markdown: string
  imageMap: Array<{ originalUrl: string; relativePath: string }>
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-'
})

turndown.addRule('images', {
  filter: 'img',
  replacement: (_content, node) => {
    const el = node as unknown as { getAttribute(name: string): string | null }
    const src = el.getAttribute('src') || ''
    const alt = el.getAttribute('alt') || ''
    return src ? `![${alt}](${src})` : ''
  }
})

export async function extractToMarkdown(
  input: ExtractInput,
  imagesDir: string
): Promise<ExtractedDoc> {
  await fs.mkdir(imagesDir, { recursive: true })

  const imageMap = await downloadImages(input.imageUrls ?? [], imagesDir)
  let html = input.html
  for (const { originalUrl, relativePath } of imageMap) {
    html = html.split(originalUrl).join(relativePath)
  }

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${escapeAttr(
    input.url
  )}"><title>${escapeAttr(input.title ?? 'Captured')}</title></head><body>${html}</body></html>`

  const { document } = parseHTML(fullHtml)
  let title = input.title ?? 'Untitled'
  let excerpt: string | undefined
  let byline: string | undefined
  let bodyMarkdown = ''

  try {
    const reader = new Readability(document as unknown as Document)
    const article = reader.parse()
    if (article && article.content) {
      bodyMarkdown = turndown.turndown(article.content)
      title = article.title || title
      excerpt = article.excerpt || undefined
      byline = article.byline || undefined
    } else {
      bodyMarkdown = turndown.turndown(html)
    }
  } catch {
    bodyMarkdown = turndown.turndown(html)
  }

  return { title, excerpt, byline, markdown: bodyMarkdown, imageMap }
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

type DownloadResult = { originalUrl: string; relativePath: string }

async function downloadImages(urls: string[], imagesDir: string): Promise<DownloadResult[]> {
  const results: DownloadResult[] = []
  for (const url of urls) {
    const r = await downloadOneImage(url, imagesDir).catch(() => null)
    if (r) results.push(r)
  }
  return results
}

function downloadOneImage(url: string, imagesDir: string): Promise<DownloadResult | null> {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http
    const hash = createHash('md5').update(url).digest('hex').slice(0, 10)

    const req = client.get(
      url,
      { timeout: 10_000, headers: { 'User-Agent': 'Mozilla/5.0' } },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          downloadOneImage(res.headers.location, imagesDir).then(resolve)
          res.resume()
          return
        }
        if (status !== 200) {
          res.resume()
          resolve(null)
          return
        }
        const ext = guessExt(res.headers['content-type'] || '', url)
        const filename = `${hash}.${ext}`
        const dest = join(imagesDir, filename)
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', async () => {
          const buf = Buffer.concat(chunks)
          if (buf.length < 500) { resolve(null); return }
          try {
            await fs.writeFile(dest, buf)
            resolve({ originalUrl: url, relativePath: `images/${filename}` })
          } catch {
            resolve(null)
          }
        })
        res.on('error', () => resolve(null))
      }
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

function guessExt(contentType: string, url: string): string {
  const ct = contentType.toLowerCase()
  if (ct.includes('png')) return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('svg')) return 'svg'
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg'
  try {
    const m = new URL(url).pathname.match(/\.(png|webp|gif|svg|jpe?g)$/i)
    if (m) {
      const ext = m[1].toLowerCase()
      return ext === 'jpeg' ? 'jpg' : ext
    }
  } catch { /* ignore */ }
  return 'jpg'
}
