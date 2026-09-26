import http from 'node:http'
import { BrowserWindow } from 'electron'
import { extractToMarkdown } from './extractor'
import { buildEntryId, createEntry } from './store'
import { rawEntryImagesDir } from './paths'
import { ensureDefaultKnowledgeWorkspace } from '../workspaces/service'

// 内嵌 capture HTTP server。Chrome 插件 popup 启动时按 9527→9531 顺序探测，
// 找到响应 /health 且返回 { app: 'ui-client' } 的端口就用。app 启动时按同样顺序绑定。
//
// 设计：保存成功后只往渲染端推一条 raw.captured 事件让它弹 toast，
// 不返回 deep link、不唤起 App、不打断当前工作。

export const PORT_CANDIDATES = [9527, 9528, 9529, 9530, 9531]

class CaptureServer {
  private server: http.Server | null = null
  private boundPort = 0

  port(): number { return this.boundPort }

  async start(): Promise<{ port: number } | null> {
    if (this.server) return { port: this.boundPort }
    for (const port of PORT_CANDIDATES) {
      const ok = await this.tryBind(port).catch(() => false)
      if (ok) {
        this.boundPort = port
        return { port }
      }
    }
    return null
  }

  async stop(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((resolve) => this.server!.close(() => resolve()))
    this.server = null
    this.boundPort = 0
  }

  private tryBind(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => this.handle(req, res))
      const onError = (_err: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListen)
        resolve(false)
      }
      const onListen = (): void => {
        server.removeListener('error', onError)
        server.on('error', (e) => console.error('[capture-server] error after bind:', e))
        this.server = server
        resolve(true)
      }
      server.once('error', onError)
      server.once('listening', onListen)
      server.listen(port, '127.0.0.1')
    })
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    // Chrome 把 127.0.0.1 视为 Private Network；从 https 公网页面发请求需要这两个头才不会被拦
    res.setHeader('Access-Control-Allow-Private-Network', 'true')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, app: 'ui-client', port: this.boundPort })
      return
    }

    if (req.method === 'POST' && req.url === '/capture') {
      void this.handleCapture(req, res)
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'not_found' }))
  }

  private async handleCapture(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body = ''
    req.setEncoding('utf-8')
    req.on('data', (chunk: string) => { body += chunk })
    req.on('end', async () => {
      try {
        const data = JSON.parse(body) as CapturePayload
        const result = await this.persistCapture(data)
        sendJson(res, 200, result)
        broadcastCaptured({
          id: result.id,
          title: result.title,
          sourceHost: result.sourceHost,
          workspaceId: result.workspaceId,
          relPath: result.relPath
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[capture-server] capture failed:', msg)
        sendJson(res, 400, { ok: false, error: msg })
      }
    })
    req.on('error', (e) => {
      sendJson(res, 400, { ok: false, error: e.message })
    })
  }

  private async persistCapture(payload: CapturePayload): Promise<CaptureResponse> {
    if (!payload || typeof payload.html !== 'string' || typeof payload.url !== 'string') {
      throw new Error('invalid payload: html and url are required')
    }

    // 写到剪页库工作区（kind=knowledge）。首次安装或旧数据缺失时自动补建。
    const ws = await ensureDefaultKnowledgeWorkspace()

    const capturedAt = payload.capturedAt || new Date().toISOString()
    const tags = sanitizeTags(payload.tags)
    const id = buildEntryId(new Date(), payload.title || 'untitled')
    const imagesDir = rawEntryImagesDir(ws.path, id)

    const extracted = await extractToMarkdown(
      {
        url: payload.url,
        title: payload.title,
        html: payload.html,
        imageUrls: payload.imageUrls,
        capturedAt
      },
      imagesDir
    )

    const subtitleSection = (payload.subtitleTracks || [])
      .filter(t => t && t.text)
      .map(t => `## 字幕：${t.label || t.srclang || ''}\n\n${t.text}`)
      .join('\n\n')

    const fullMarkdown = subtitleSection
      ? `${extracted.markdown.trimEnd()}\n\n---\n\n${subtitleSection}\n`
      : extracted.markdown

    const item = await createEntry(id, {
      baseDir: ws.path,
      url: payload.url,
      title: extracted.title || payload.title || 'Untitled',
      excerpt: extracted.excerpt,
      byline: extracted.byline,
      capturedAt,
      tags,
      markdown: fullMarkdown,
      imageCount: extracted.imageMap.length,
      videoCount: payload.videoUrls?.length,
      audioCount: payload.audioUrls?.length,
      subtitleCount: (payload.subtitleTracks || []).filter(t => !!t?.text).length
    })

    return {
      ok: true,
      id: item.id,
      title: item.title,
      sourceHost: item.sourceHost,
      workspaceId: ws.id,
      relPath: `${item.id}/index.md`,
      images: extracted.imageMap.map(m => m.relativePath)
    }
  }
}

function broadcastCaptured(payload: {
  id: string
  title: string
  sourceHost: string
  workspaceId: string
  relPath: string
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('raw.captured', payload)
  }
}

type CapturePayload = {
  url: string
  title?: string
  html: string
  imageUrls?: string[]
  videoUrls?: string[]
  audioUrls?: string[]
  subtitleTracks?: Array<{ label?: string; srclang?: string; text?: string }>
  tags?: string[] | string
  capturedAt?: string
}

type CaptureResponse = {
  ok: true
  id: string
  title: string
  sourceHost: string
  workspaceId: string
  relPath: string
  images: string[]
}

function sanitizeTags(input: CapturePayload['tags']): string[] {
  if (!input) return []
  const arr = Array.isArray(input) ? input : String(input).split(',')
  return arr.map(t => String(t).trim()).filter(Boolean).slice(0, 20)
}

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

export const captureServer = new CaptureServer()
