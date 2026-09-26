import { describe, expect, it } from 'vitest'
import { displayInputTokens, expandInputTokens, formatRetrievalPriority, type ChatInputToken } from './input-token-text'

describe('expandInputTokens', () => {
  it('keeps picked element aliases stable in submitted text', () => {
    const tokens: ChatInputToken[] = [
      { type: 'text', text: '把 ' },
      { type: 'chip', alias: 'A', path: 'body > main > h1' },
      { type: 'text', text: ' 改成品牌色' }
    ]

    expect(expandInputTokens(tokens)).toBe('把 @A 改成品牌色')
  })

  it('serializes file references as at mentions', () => {
    expect(expandInputTokens([
      { type: 'text', text: '参考 ' },
      { type: 'fileref', relPath: 'docs/login/prd.md' }
    ])).toBe('参考 @docs/login/prd.md')
  })

  it('serializes product file references as at mentions', () => {
    expect(expandInputTokens([
      { type: 'fileref', relPath: 'ui/pix-offline/meta.json' }
    ])).toBe('@ui/pix-offline/meta.json')
  })

  it('shows resource aliases while submitting concrete resource paths', () => {
    const tokens: ChatInputToken[] = [
      { type: 'text', text: '参考 ' },
      {
        type: 'resource',
        alias: '订单知识库/退款规则.md',
        path: '.external/订单知识库/docs/退款规则.md'
      }
    ]

    expect(displayInputTokens(tokens)).toBe('参考 @订单知识库/退款规则.md')
    expect(expandInputTokens(tokens)).toBe('参考 @.external/订单知识库/docs/退款规则.md')
  })

  it('omits image tokens from the text channel', () => {
    expect(expandInputTokens([
      { type: 'text', text: '看图' },
      { type: 'image' },
      { type: 'text', text: ' 修改' }
    ])).toBe('看图 修改')
  })
})


describe('retrieval priority from explicit mentions', () => {
  it('preserves selected file paths and deduplicates resources without changing display text', () => {
    const tokens: ChatInputToken[] = [
      { type: 'fileref', relPath: 'docs/订单 规则.md' },
      { type: 'resource', alias: '订单', path: '.external/orders/spec.md' },
      { type: 'fileref', relPath: 'docs/订单 规则.md' }
    ]
    const text = formatRetrievalPriority(tokens)
    expect(text.match(/docs\/订单 规则.md/g)).toHaveLength(1)
    expect(text).toContain('.external/orders/spec.md')
    expect(text).toContain('只有未找到相关信息时，才扩展')
    expect(text).toContain('是否需要检索由你判断，不要求调用工具')
    expect(text).toContain('不要将单个文件作为 root')
    expect(displayInputTokens(tokens)).not.toContain('优先检索范围')
  })

  it('does not convert plain text, DOM picks or web tabs into file retrieval scopes', () => {
    expect(formatRetrievalPriority([
      { type: 'text', text: '@someone hello' },
      { type: 'chip', alias: 'A', path: 'body > main' },
      { type: 'resource', alias: '网页', path: 'webpage:tab-1' },
      { type: 'image' }
    ])).toBe('')
    expect(formatRetrievalPriority([])).toBe('')
  })
})
