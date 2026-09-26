import { describe, expect, it, vi } from 'vitest'
import { pastePlainTextIntoSelection } from './paste-plain-text'

describe('pastePlainTextIntoSelection', () => {
  it('prevents default HTML paste and inserts clipboard plain text', () => {
    const preventDefault = vi.fn()
    const insertText = vi.fn()

    const pasted = pastePlainTextIntoSelection({
      text: '复制的气泡文本',
      preventDefault,
      insertText
    })

    expect(pasted).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(insertText).toHaveBeenCalledWith('复制的气泡文本')
  })

  it('does nothing when clipboard text is empty', () => {
    const preventDefault = vi.fn()
    const insertText = vi.fn()

    const pasted = pastePlainTextIntoSelection({
      text: '',
      preventDefault,
      insertText
    })

    expect(pasted).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(insertText).not.toHaveBeenCalled()
  })
})
