import { describe, it, expect } from 'vitest'
import { extractMessageText } from './message-text'

describe('extractMessageText', () => {
  it('joins multiple text blocks with double newline', () => {
    expect(extractMessageText([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' }
    ])).toBe('a\n\nb')
  })

  it('skips thinking / tool_use / tool_result / image blocks', () => {
    expect(extractMessageText([
      { type: 'thinking', text: 'pondering' },
      { type: 'text', text: 'hi' },
      { type: 'tool_use' },
      { type: 'tool_result' },
      { type: 'image' }
    ])).toBe('hi')
  })

  it('trims surrounding whitespace', () => {
    expect(extractMessageText([{ type: 'text', text: '  hello  \n' }])).toBe('hello')
  })

  it('returns empty string when no text block present', () => {
    expect(extractMessageText([
      { type: 'tool_use' },
      { type: 'thinking', text: 'x' }
    ])).toBe('')
  })

  it('handles missing text field gracefully', () => {
    expect(extractMessageText([
      { type: 'text' },
      { type: 'text', text: 'real' }
    ])).toBe('real')
  })
})
