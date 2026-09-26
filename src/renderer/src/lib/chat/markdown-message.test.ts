import { describe, expect, it } from 'vitest'
import { markdownToRichClipboardHtml, renderChatMarkdown } from './markdown-message'

describe('renderChatMarkdown', () => {
  it('renders markdown headings and tables', () => {
    const html = renderChatMarkdown([
      '## 前端在线支付处理架构',
      '',
      '| 场景 | 入口 |',
      '|---|---|',
      '| 堂食点餐 | payment-drawer |'
    ].join('\n'))

    expect(html).toContain('<h2>前端在线支付处理架构</h2>')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>堂食点餐</td>')
  })

  it('escapes raw html from assistant output', () => {
    const html = renderChatMarkdown('<script>alert(1)</script>')

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('renders path chips after markdown parsing', () => {
    const html = renderChatMarkdown('参考 [:docs/a.md]', () => ({ alias: 'A', alive: true }))

    expect(html).toContain('class="chat-md-chip"')
    expect(html).toContain('@A')
    expect(html).toContain('title="docs/a.md"')
  })
})

describe('markdownToRichClipboardHtml', () => {
  it('wraps rendered markdown in an article for rich clipboard', () => {
    expect(markdownToRichClipboardHtml('**hello**')).toContain('<article class="chat-markdown">')
    expect(markdownToRichClipboardHtml('**hello**')).toContain('<strong>hello</strong>')
  })
})

describe('hex color swatch', () => {
  it('wraps 6-digit hex inline code with color swatch', () => {
    const html = renderChatMarkdown('主色是 `#ff7a3d`')
    expect(html).toContain('chat-color-swatch')
    expect(html).toContain('style="background:#ff7a3d"')
  })

  it('wraps 3-digit hex shorthand', () => {
    const html = renderChatMarkdown('用 `#f00` 做错误色')
    expect(html).toContain('chat-color-swatch')
    expect(html).toContain('background:#f00')
  })

  it('wraps 8-digit hex with alpha', () => {
    const html = renderChatMarkdown('半透明 `#ff7a3d80`')
    expect(html).toContain('chat-color-swatch')
  })

  it('does not wrap non-hex code', () => {
    const html = renderChatMarkdown('变量 `userId` 是字符串')
    expect(html).not.toContain('chat-color-swatch')
  })

  it('does not wrap hex inside fenced code blocks', () => {
    const html = renderChatMarkdown('```js\nconst c = "#ff7a3d"\n```')
    // fenced block 里的 hex 不应变 inline 色块
    expect(html).not.toContain('chat-color-swatch')
  })
})

describe('code block enhancement', () => {
  it('wraps fenced code block with header + lang + copy button', () => {
    const html = renderChatMarkdown('```typescript\nconst x = 1\n```')
    expect(html).toContain('chat-code-block')
    expect(html).toContain('data-lang="typescript"')
    expect(html).toContain('chat-code-lang')
    expect(html).toContain('chat-code-copy')
    expect(html).toContain('data-code=')
  })

  it('marks blocks over 16 lines as collapsible', () => {
    const long = '```js\n' + Array.from({ length: 20 }, (_, i) => `const x${i} = ${i}`).join('\n') + '\n```'
    const html = renderChatMarkdown(long)
    expect(html).toContain('chat-code-block--collapsible')
    expect(html).toContain('chat-code-block--collapsed')
  })

  it('does not mark short blocks as collapsible', () => {
    const html = renderChatMarkdown('```js\nconst x = 1\nconst y = 2\n```')
    expect(html).not.toContain('chat-code-block--collapsible')
  })

  it('uses text as lang when no language specified', () => {
    const html = renderChatMarkdown('```\nplain code\n```')
    expect(html).toContain('data-lang="text"')
  })
})
