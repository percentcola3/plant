import wenKaiFontUrl from '@/assets/fonts/LXGWWenKaiLite-Regular.woff2?url'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import mermaid from 'mermaid'
import {
  MARKDOWN_MERMAID_CONFIG,
  createMarkdownChartHtml,
  createMarkdownDocumentHtml
} from '@shared/markdown-document-theme'

type RenderInput = {
  content: string
  projectId: string
  relPath: string
  previewBaseUrl: string | null
  theme?: 'light' | 'dark'
}

type MermaidBlock = {
  id: string
  code: string
}

mermaid.initialize(MARKDOWN_MERMAID_CONFIG as Parameters<typeof mermaid.initialize>[0])

function createMarkdownIt(): MarkdownIt {
  const instance = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : ''
      try {
        return language
          ? hljs.highlight(code, { language, ignoreIllegals: true }).value
          : hljs.highlightAuto(code).value
      } catch {
        return escapeHtml(code)
      }
    }
  })
  markdownMarkPlugin(instance)
  return instance
}

function markdownMarkPlugin(markdown: MarkdownIt): void {
  markdown.inline.ruler.before('emphasis', 'mark', (state: { src: string; pos: number; posMax: number; push: (type: string, tag: string, nesting: number) => { content?: string } }, silent: boolean) => {
    if (state.src.charCodeAt(state.pos) !== 0x3D || state.src.charCodeAt(state.pos + 1) !== 0x3D) return false
    const start = state.pos + 2
    const end = state.src.indexOf('==', start)
    if (end === -1 || end === start || end > state.posMax) return false
    if (!silent) {
      state.push('mark_open', 'mark', 1)
      const token = state.push('text', '', 0)
      token.content = state.src.slice(start, end)
      state.push('mark_close', 'mark', -1)
    }
    state.pos = end + 2
    return true
  })
}

function isExternalUrl(href: string): boolean {
  return /^(https?:|mailto:|tel:|data:)/i.test(href)
}

function normalizePath(path: string): string {
  const isAbs = path.startsWith('/')
  const segments = path.split('/').filter(Boolean)
  const out: string[] = []
  for (const segment of segments) {
    if (segment === '.') continue
    if (segment === '..') {
      out.pop()
      continue
    }
    out.push(segment)
  }
  return `${isAbs ? '/' : ''}${out.join('/')}`
}

function dirname(path: string): string {
  const normalized = normalizePath(path)
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? '' : normalized.slice(0, idx)
}

function resolveRelative(baseFile: string, target: string): string {
  if (!target || target.startsWith('#') || isExternalUrl(target)) return target
  const baseDir = dirname(baseFile)
  return normalizePath(`${baseDir}/${target}`)
}

async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const nodes = [...container.querySelectorAll<HTMLElement>('[data-mermaid-code]')]
  await Promise.all(nodes.map(async (node, index) => {
    const code = node.dataset.mermaidCode ?? ''
    const mermaidId = `md-mermaid-${index}-${Date.now()}`
    try {
      const { svg } = await mermaid.render(mermaidId, code)
      node.outerHTML = createMarkdownChartHtml(`<div class="mermaid-diagram">${svg}</div>`)
    } catch {
      node.outerHTML = createMarkdownChartHtml(`<pre class="mermaid-error">${escapeHtml(code)}</pre>`, { error: true })
    }
  }))
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export async function renderMarkdownPreview(input: RenderInput): Promise<string> {
  const mermaidBlocks: MermaidBlock[] = []
  const markdown = createMarkdownIt()
  const originalFence = markdown.renderer.rules.fence
  markdown.renderer.rules.fence = (
    tokens: Array<{ info?: string; content: string }>,
    idx: number,
    options: unknown,
    env: unknown,
    self: { renderToken: (tokens: unknown, idx: number, options: unknown) => string }
  ) => {
    const token = tokens[idx]
    const lang = (token.info ?? '').trim().split(/\s+/)[0]
    if (lang === 'mermaid') {
      const id = `mermaid-${mermaidBlocks.length}`
      mermaidBlocks.push({ id, code: token.content })
      return `<div data-mermaid-code="${escapeHtml(token.content)}" data-mermaid-id="${id}"></div>`
    }
    return originalFence
      ? originalFence(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options)
  }

  const rendered = markdown.render(input.content)
  markdown.renderer.rules.fence = originalFence

  const container = document.createElement('div')
  container.innerHTML = rendered
  await renderMermaidBlocks(container)

  if (input.previewBaseUrl) {
    for (const img of container.querySelectorAll<HTMLImageElement>('img[src]')) {
      const src = img.getAttribute('src') ?? ''
      if (!src || src.startsWith('#') || isExternalUrl(src)) continue
      const resolved = resolveRelative(input.relPath, src)
      img.src = `${input.previewBaseUrl}/p/${input.projectId}/${resolved}`
    }
  }

  // raw 路径下的剪页内容：图片默认折叠（用 <details> 包裹），点击 summary 才显示
  // 这是渲染层的视觉处理，不影响存储 — Claude/Read 仍能看到原 ![]() 引用
  if (isRawPath(input.relPath)) {
    foldImagesInRawPreview(container)
  }

  return createMarkdownDocumentHtml({
    body: container.innerHTML,
    theme: input.theme,
    // srcdoc needs an absolute app URL in development and packaged file:// builds.
    fontUrl: typeof window === 'undefined' ? undefined : new URL(wenKaiFontUrl, window.location.href).href
  })
}

function isRawPath(relPath: string): boolean {
  return relPath.includes('.knowledge/raw/')
}

function foldImagesInRawPreview(container: HTMLElement): void {
  const imgs = [...container.querySelectorAll<HTMLImageElement>('img')]
  imgs.forEach((img, i) => {
    const alt = img.getAttribute('alt') || ''
    const src = img.getAttribute('src') || ''
    const filename = src ? src.split('/').pop() || '' : ''
    const labelText = alt || filename || `图片 ${i + 1}`
    const details = document.createElement('details')
    details.className = 'raw-image-fold'
    const summary = document.createElement('summary')
    summary.textContent = `🖼 ${labelText}`
    details.appendChild(summary)
    // 移到 details 内部
    img.parentNode?.insertBefore(details, img)
    details.appendChild(img)
  })
}
