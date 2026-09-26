import { runInNewContext } from 'node:vm'
import { parseHTML } from 'linkedom'
import { describe, expect, it } from 'vitest'
import { PAGE_DESIGN_SCRIPT } from './design-capture'

interface CaptureResult {
  html: string
  warnings: string[]
  viewport: { width: number; height: number }
}

type Styles = Record<string, string>
interface CaptureOptions {
  styles?: Record<string, Styles>
  pseudo?: Record<string, Record<string, Styles>>
  prepare?: (document: Document) => void
  sourceURL?: string
  date?: { new (): Date; now(): number }
}

function capture(markup: string, options: CaptureOptions = {}) {
  const { document } = parseHTML(markup)
  const sourceURL = options.sourceURL || 'https://example.com/articles/page'
  Object.defineProperties(document, {
    URL: { value: sourceURL },
    baseURI: { value: sourceURL }
  })
  // Browsers create an empty head while parsing; linkedom creates it lazily on access.
  void document.head
  options.prepare?.(document as unknown as Document)
  const before = document.documentElement.outerHTML
  const result = runInNewContext(PAGE_DESIGN_SCRIPT, {
    document,
    window: { innerWidth: 1280, innerHeight: 800 },
    URL,
    Date: options.date || Date,
    getComputedStyle: (element: HTMLElement, pseudo: string | null) => {
      const values: Styles = pseudo
        ? { content: 'none', ...options.pseudo?.[element.id]?.[pseudo] }
        : { display: 'block', color: 'rgb(20, 20, 20)', ...options.styles?.[element.id] }
      return { getPropertyValue: (property: string) => values[property] || '' }
    }
  }) as CaptureResult
  expect(document.documentElement.outerHTML).toBe(before)
  return { ...result, parsed: parseHTML(result.html).document }
}

describe('project webpage design capture', () => {
  it('keeps editable content, computed layout, SVG and page metadata without changing the original DOM', () => {
    const result = capture('<html lang="zh-CN"><head><title>示例设计</title></head><body><main id="layout"><h1>展示标题</h1><svg viewBox="0 0 24 24"><defs><linearGradient id="gradient"><stop offset="0%" /></linearGradient></defs><path id="shape" d="M0 0L24 24" fill="url(#gradient)" /></svg></main></body></html>', {
      styles: {
        layout: { display: 'grid', 'grid-template-columns': '100px 1fr', gap: '16px', 'column-gap': '16px', translate: '-50% -50%', rotate: '15deg', scale: '0.9' },
        shape: { fill: 'url("https://user:password@example.com/articles/page?token=credential#gradient")' }
      },
      sourceURL: 'https://user:password@example.com/articles/page?token=credential#secret'
    })

    expect(result.parsed.title).toBe('示例设计')
    expect(result.parsed.documentElement.lang).toBe('zh-CN')
    expect(result.parsed.querySelector('h1')?.textContent).toBe('展示标题')
    expect(result.parsed.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(result.parsed.querySelector('#shape')?.getAttribute('d')).toBe('M0 0L24 24')
    expect(result.parsed.querySelector('#shape')?.getAttribute('fill')).toBe('url("#gradient")')
    expect(result.html).toContain('display:grid')
    expect(result.html).toContain('grid-template-columns:100px 1fr')
    expect(result.html).toContain('column-gap:16px')
    expect(result.html).toContain('translate:-50% -50%')
    expect(result.html).toContain('rotate:15deg')
    expect(result.html).toContain('scale:0.9')
    expect(result.html).toContain('fill:url("#gradient")')
    expect(result.html).not.toContain('!important')
    expect(result.parsed.querySelector('meta[name="design-source"]')?.getAttribute('content')).toBe('https://example.com/articles/page')
    expect(result.parsed.querySelector('meta[name="design-captured-at"]')?.getAttribute('content')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result.html).not.toContain('credential')
    expect(result.viewport).toEqual({ width: 1280, height: 800 })
  })

  it('deduplicates styles, preserves common generated content and escapes style closing tags', () => {
    const result = capture('<html><body><div id="a">A</div><div id="b">B</div><span id="badge" data-label="New">C</span></body></html>', {
      pseudo: { badge: {
        '::before': { content: 'attr(data-label)', color: 'red' },
        '::after': { content: '"</style><script>alert(1)</script>"' }
      } }
    })
    expect(result.parsed.querySelector('#a')?.className).toBe(result.parsed.querySelector('#b')?.className)
    expect(result.parsed.querySelector('#badge')?.className).not.toBe(result.parsed.querySelector('#a')?.className)
    expect(result.html).toContain('::before{content:"New";color:red')
    expect(result.html).toContain('\\3c /style>')
    expect(result.parsed.querySelector('script')).toBeNull()
    expect(result.parsed.querySelectorAll('style')).toHaveLength(1)
    expect(result.parsed.querySelector('#badge')?.hasAttribute('data-label')).toBe(false)
  })

  it('removes execution, navigation, submission and credentials even in SVG and custom elements', () => {
    const result = capture(`<html><head><base href="https://attacker.example/"><meta http-equiv="refresh" content="0;url=https://attacker.example"><link rel="stylesheet" href="remote.css"><style>@import 'remote.css';</style></head><body onload="alert(1)">
      <script>secretScript()</script><iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe><object data="page.html"></object><embed src="page.html">
      <form action="https://attacker.example" method="post"><input name="password" type="password" value="password-secret"><input type="hidden" name="token" value="token-secret"><input type="file"><input id="text" value="typed-secret" data-token="data-secret" onfocus="alert(1)"><textarea>textarea-secret</textarea><button formaction="https://attacker.example">保存</button></form>
      <a href="javascript:alert(1)" ping="https://attacker.example" onclick="alert(1)">链接</a>
      <img src="javascript:alert(1)" onerror="alert(1)" srcset="https://attacker.example/x 2x">
      <custom-widget data-token="custom-secret"><span>组件正文</span></custom-widget>
      <svg onload="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)"><text>click</text></a><use href="#safe"><animate attributeName="href" values="javascript:alert(1)" /></use><foreignObject><iframe src="page.html"></iframe></foreignObject></svg>
    </body></html>`)

    expect(result.parsed.querySelector('script, iframe, object, embed, base, link, form, foreignObject, animate, custom-widget')).toBeNull()
    expect(result.parsed.querySelector('meta[http-equiv]')).toBeNull()
    expect(result.parsed.querySelector('input[type="password"], input[type="hidden"], input[type="file"]')).toBeNull()
    expect(result.parsed.querySelector('#text')?.getAttribute('value')).toBeNull()
    expect(result.parsed.querySelector('textarea')?.textContent).toBe('')
    expect(result.parsed.querySelector('button')?.getAttribute('type')).toBe('button')
    expect(result.parsed.querySelector('a')?.getAttribute('href')).toBeNull()
    expect(result.parsed.querySelector('img')?.getAttribute('src')).toBeNull()
    expect(result.parsed.querySelector('use')?.getAttribute('href')).toBe('#safe')
    expect(result.html).not.toMatch(/(?:secret|javascript:|onload=|onerror=|onclick=|onfocus=|formaction=|data-token=|srcset=)/)
    expect(result.html).toContain('组件正文')
    expect(result.warnings.join('\n')).toContain('内嵌页面未复制')
    expect(result.warnings.join('\n')).toContain('Shadow DOM')
    expect(result.warnings.join('\n')).toContain('表单输入内容')
  })

  it('resolves the displayed image and CSS URLs, strips URL credentials, and rejects active URL schemes', () => {
    const result = capture('<html><body><img id="responsive" src="fallback.png"><img id="auth" src="https://user:password@example.com/picture.png?token=secret&size=2#credential"><img id="data" src="data:image/svg+xml,&lt;svg onload=alert(1)&gt;"><div id="background"></div><div id="unsafe"></div></body></html>', {
      prepare(document) {
        Object.defineProperty(document.querySelector('#responsive'), 'currentSrc', { value: '/assets/selected.png' })
      },
      styles: {
        background: { 'background-image': 'url("../assets/background image.png")' },
        unsafe: { 'background-image': 'url("j\\61vascript:alert(1)")', 'list-style-image': 'url(file:///etc/passwd)' }
      }
    })

    expect(result.parsed.querySelector('#responsive')?.getAttribute('src')).toBe('https://example.com/assets/selected.png')
    expect(result.parsed.querySelector('#auth')?.getAttribute('src')).toBe('https://example.com/picture.png?size=2')
    expect(result.parsed.querySelector('#data')?.getAttribute('src')).toBeNull()
    expect(result.html).toContain('url("https://example.com/assets/background%20image.png")')
    expect(result.html).toContain('background-image:none')
    expect(result.html).toContain('list-style-image:none')
    expect(result.html).not.toMatch(/password|secret|credential|javascript:|file:\/\//)
    expect(result.warnings.filter(warning => warning.includes('依赖原网站'))).toHaveLength(1)
    expect(result.warnings.filter(warning => warning.includes('凭据已移除'))).toHaveLength(1)
  })

  it('turns canvas and blob images into inert embedded images, retaining blank layout when canvas is tainted', () => {
    const png = 'data:image/png;base64,aGVsbG8='
    const result = capture('<html><body><canvas id="ok"></canvas><canvas id="tainted"></canvas><img id="blob" src="blob:https://example.com/1234"><img id="broken" src="blob:https://example.com/5678"></body></html>', {
      prepare(document) {
        Object.defineProperty(document.querySelector('#ok'), 'toDataURL', { value: () => png })
        Object.defineProperty(document.querySelector('#tainted'), 'toDataURL', { value: () => { throw new Error('tainted') } })
        Object.defineProperties(document.querySelector('#blob'), { naturalWidth: { value: 10 }, naturalHeight: { value: 20 } })
        const createElement = document.createElement.bind(document)
        document.createElement = ((tag: string) => {
          const element = createElement(tag)
          if (tag === 'canvas') {
            Object.defineProperty(element, 'getContext', { value: () => ({ drawImage: () => undefined }) })
            Object.defineProperty(element, 'toDataURL', { value: () => png })
          }
          return element
        }) as typeof document.createElement
      }
    })

    expect(result.parsed.querySelector('canvas')).toBeNull()
    expect(result.parsed.querySelector('#ok')?.getAttribute('src')).toBe(png)
    expect(result.parsed.querySelector('#blob')?.getAttribute('src')).toBe(png)
    expect(result.parsed.querySelector('#tainted')?.localName).toBe('img')
    expect(result.parsed.querySelector('#tainted')?.getAttribute('src')).toBeNull()
    expect(result.parsed.querySelector('#broken')?.getAttribute('src')).toBeNull()
    expect(result.warnings.filter(warning => warning.includes('Canvas'))).toHaveLength(1)
    expect(result.html).not.toContain('blob:')
  })

  it('escapes text and metadata without allowing an extra script or meta element', () => {
    const result = capture('<html><body><p>&lt;script&gt;literal text&lt;/script&gt;</p></body></html>', {
      prepare(document) { document.title = '</title><script>alert(1)</script>$&' },
      sourceURL: 'https://example.com/%22%3E%3Cscript%3E?token=secret'
    })
    expect(result.parsed.querySelector('script')).toBeNull()
    expect(result.html).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;$&amp;</title>')
    expect(result.parsed.querySelector('p')?.textContent).toBe('<script>literal text</script>')
    expect(result.parsed.querySelectorAll('meta')).toHaveLength(4)
  })

  it('rejects excessive nodes, nesting and content as a whole', () => {
    expect(() => capture('<html><body>' + '<i></i>'.repeat(25001) + '</body></html>')).toThrow('网页节点过多')
    expect(() => capture('<html><body>' + '<div>'.repeat(202) + 'deep' + '</div>'.repeat(202) + '</body></html>')).toThrow('网页嵌套过深')
    expect(() => capture('<html><body>' + 'a'.repeat(13 * 1024 * 1024) + '</body></html>')).toThrow('网页内容过大')
  })

  it('enforces an internal time budget instead of relying on the caller timeout', () => {
    let calls = 0
    class BudgetDate extends Date {
      static now() { return ++calls === 1 ? 0 : 10001 }
    }
    expect(() => capture('<html><body><p>Slow page</p></body></html>', { date: BudgetDate })).toThrow('生成设计稿超时')
  })
})
