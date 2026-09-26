import { describe, expect, it } from 'vitest'
import { buildMarkdownShortcutInsertion } from './markdown-shortcuts'

describe('buildMarkdownShortcutInsertion', () => {
  it('wraps selected text as highlight emphasis', () => {
    expect(buildMarkdownShortcutInsertion('emphasis', '重点')).toEqual({
      text: '==重点==',
      selectionStart: 2,
      selectionEnd: 4
    })
  })

  it('creates a heading from selected text', () => {
    expect(buildMarkdownShortcutInsertion('heading', '范围说明').text).toBe('## 范围说明')
  })

  it('quotes every selected line', () => {
    expect(buildMarkdownShortcutInsertion('quote', '第一行\n第二行').text).toBe('> 第一行\n> 第二行')
  })

  it('inserts a table template', () => {
    const result = buildMarkdownShortcutInsertion('table')
    expect(result.text).toContain('| 列 1 | 列 2 | 列 3 |')
    expect(result.text).toContain('|---|---|---|')
  })

  it('inserts a mermaid chart template', () => {
    const result = buildMarkdownShortcutInsertion('chart')
    expect(result.text).toContain('```mermaid')
    expect(result.text).toContain('flowchart LR')
  })
})
