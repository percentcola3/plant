import MarkdownIt from 'markdown-it'

type AliasResolver = (path: string) => { alias: string; alive: boolean }

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false
})

export function renderChatMarkdown(
  source: string,
  resolveAlias?: AliasResolver
): string {
  let rendered = markdown.render(source)
  if (resolveAlias) {
    rendered = rendered.replace(/\[:(.+?)\]/g, (_match, path: string) => {
      const { alias, alive } = resolveAlias(path)
      const staleClass = alive ? '' : ' chat-md-chip--stale'
      const title = alive ? path : `${path} (已不再选中)`
      return `<span class="chat-md-chip${staleClass}" title="${escapeAttr(title)}">@${escapeHtml(alias)}</span>`
    })
  }
  // inline code 里的 hex 颜色 → 色块 + 代码
  rendered = wrapHexColors(rendered)
  // HTML / Markdown 文档路径 → 可点预览按钮
  rendered = wrapPreviewableFiles(rendered)
  // fenced code block 增强：语言标签 + 复制按钮 + 折叠
  rendered = wrapCodeBlocksWithHeader(rendered)
  return rendered
}

// inline code 里的 hex 颜色（#rgb / #rrggbb / #rrggbbaa）→ 色块。
// 对标 open-design ColorSwatch：设计类对话里颜色值频繁出现，色块让色值可感知。
// 只处理 inline <code>，不处理 fenced code block（代码里的 hex 注释不该变色块）。
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function wrapHexColors(html: string): string {
  // 只匹配 inline <code>（单行，无换行）；fenced block 的 <code> 在 <pre> 内，结构不同
  return html.replace(/<code>([^<\n]+?)<\/code>/g, (full, body: string) => {
    const trimmed = body.trim()
    if (!HEX_COLOR_RE.test(trimmed)) return full
    return `<code class="chat-color-swatch"><span class="chat-color-swatch-chip" style="background:${trimmed}"></span>${body}</code>`
  })
}

// fenced code block 增强：给 <pre> 加语言标签 + 复制按钮 + 折叠标记。
// markdown-it 输出 <pre><code class="language-xxx">...</code></pre>。
// 我们把它包成带 header 的结构，复制按钮的点击逻辑在 MessageContent 里监听。
const CODE_COLLAPSE_THRESHOLD = 16

function wrapCodeBlocksWithHeader(html: string): string {
  return html.replace(
    /<pre><code(?:\s+class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g,
    (full, lang?: string, codeBody?: string) => {
      const language = lang ?? 'text'
      const lineCount = codeBody ? codeBody.split('\n').length : 0
      const collapsible = lineCount > CODE_COLLAPSE_THRESHOLD ? ' chat-code-block--collapsible' : ''
      const collapsed = collapsible ? ' chat-code-block--collapsed' : ''
      // 复制按钮：data-code 存原始代码（已 HTML 转义），点击时 JS 解析回真值
      return `<div class="chat-code-block${collapsible}${collapsed}" data-lang="${escapeAttr(language)}">` +
        `<div class="chat-code-header">` +
        `<span class="chat-code-lang">${escapeHtml(language)}</span>` +
        `<button type="button" class="chat-code-copy" data-code="${escapeAttr(codeBody ?? '')}">复制</button>` +
        `</div>` +
        `<pre><code class="language-${escapeAttr(language)}">${codeBody ?? ''}</code></pre>` +
        `</div>`
    }
  )
}

// 在 <code>...</code> 文本里挑出形如 `ui/<...>.html` `docs/<...>.md` `outputs/<...>.html`
// 的项目相对路径，包成一个 chat-md-preview 按钮。MessageContent 监听点击，调
// preview.fileUrl + previewStore.openTab。
//
// 路径白名单：避开把任意单词当成路径（"button.html" 不算；"ui/foo.html" 才算）。
const PREVIEWABLE_RE = /^((?:ui|docs|outputs|components|assets|requirements)\/[\w./@\-_+]+?\.(?:html?|md|mdx|markdown))$/i

function wrapPreviewableFiles(html: string): string {
  // 仅处理 <code> 内文本：避免误伤普通段落里的字符串
  return html.replace(/<code>([^<]+)<\/code>/g, (full, body: string) => {
    const trimmed = body.trim()
    const m = PREVIEWABLE_RE.exec(trimmed)
    if (!m) return full
    const path = m[1]
    return `<button type="button" class="chat-md-preview" data-preview-path="${escapeAttr(path)}" title="在右侧预览面板打开">${escapeHtml(path)}<span class="chat-md-preview-icon" aria-hidden="true">↗</span></button>`
  })
}

export function markdownToRichClipboardHtml(source: string): string {
  return [
    '<article class="chat-markdown">',
    renderChatMarkdown(source),
    '</article>'
  ].join('')
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttr(text: string): string {
  return escapeHtml(text)
}
