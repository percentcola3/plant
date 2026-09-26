import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderMarkdownPreview } from './markdown-preview'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg role="img" aria-label="chart"></svg>' }))
  }
}))

const originalDocument = globalThis.document

function installDocumentStub(): void {
  const element = {
    innerHTML: '',
    querySelectorAll: () => []
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => element
    }
  })
}

describe('renderMarkdownPreview', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument
    })
  })

  it('空白文档不渲染 markdown 内容容器', async () => {
    installDocumentStub()

    const html = await renderMarkdownPreview({
      content: '  \n\t',
      projectId: 'p1',
      relPath: 'empty.md',
      previewBaseUrl: null
    })

    expect(html).not.toContain('<article class="markdown"')
  })

  it('支持 ==高亮== 语法', async () => {
    installDocumentStub()

    const html = await renderMarkdownPreview({
      content: '这里是 ==重点==',
      projectId: 'p1',
      relPath: 'note.md',
      previewBaseUrl: null
    })

    expect(html).toContain('<mark>重点</mark>')
  })

  it('支持深色预览主题且默认仍保持浅色发布主题', async () => {
    installDocumentStub()

    const darkHtml = await renderMarkdownPreview({
      content: '# Dark',
      projectId: 'p1',
      relPath: 'SKILL.md',
      previewBaseUrl: null,
      theme: 'dark'
    })
    const lightHtml = await renderMarkdownPreview({
      content: '# Light',
      projectId: 'p1',
      relPath: 'README.md',
      previewBaseUrl: null
    })

    expect(darkHtml).toContain('<html lang="zh-CN" data-theme="dark">')
    expect(darkHtml).toContain(':root[data-theme="dark"]')
    expect(lightHtml).toContain('<html lang="zh-CN" data-theme="light">')
  })

  it('把 mermaid 图表渲染成统一的图表卡片', async () => {
    const element = {
      _innerHTML: '',
      mermaidNode: null as null | { dataset: { mermaidCode: string }; outerHTML: string },
      get innerHTML() {
        return this._innerHTML
      },
      set innerHTML(value: string) {
        this._innerHTML = value
        if (value.includes('data-mermaid-code=')) {
          const owner = this
          this.mermaidNode = {
            dataset: { mermaidCode: 'flowchart LR\nA --> B' },
            get outerHTML() {
              return ''
            },
            set outerHTML(next: string) {
              owner._innerHTML = next
            }
          }
        }
      },
      querySelectorAll(selector: string) {
        if (selector === '[data-mermaid-code]') return this.mermaidNode ? [this.mermaidNode] : []
        return []
      }
    }
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: () => element
      }
    })

    const html = await renderMarkdownPreview({
      content: ['```mermaid', 'flowchart LR', 'A --> B', '```'].join('\n'),
      projectId: 'p1',
      relPath: 'chart.md',
      previewBaseUrl: null
    })

    expect(html).toContain('class="md-chart"')
    expect(html).toContain('class="md-chart__title">图表</span>')
    expect(html).toContain('<svg role="img" aria-label="chart"></svg>')
  })
})
