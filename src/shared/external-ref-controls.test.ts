import { describe, expect, it } from 'vitest'
import {
  normalizeExternalCheckout,
  normalizeExternalVisibleDirs,
  parseExternalCheckoutInput
} from './external-ref-controls'

describe('normalizeExternalVisibleDirs', () => {
  it('normalizes, dedupes, and removes nested duplicate directories', () => {
    expect(normalizeExternalVisibleDirs([
      ' docs/api ',
      '/docs/',
      'research\\payment',
      '',
      '.',
      'docs'
    ])).toEqual(['docs', 'research/payment'])
  })

  it('rejects unsafe directory paths', () => {
    expect(() => normalizeExternalVisibleDirs(['docs/../secret']))
      .toThrow('目录不能包含 ..')
    expect(() => normalizeExternalVisibleDirs(['/']))
      .not.toThrow()
  })
})

describe('parseExternalCheckoutInput', () => {
  it('parses branch/tag/commit prefixes and defaults to branch', () => {
    expect(parseExternalCheckoutInput('docs-main')).toEqual({ type: 'branch', value: 'docs-main' })
    expect(parseExternalCheckoutInput('branch:release/docs')).toEqual({ type: 'branch', value: 'release/docs' })
    expect(parseExternalCheckoutInput('tag:v1.0.0')).toEqual({ type: 'tag', value: 'v1.0.0' })
    expect(parseExternalCheckoutInput('commit:abc123')).toEqual({ type: 'commit', value: 'abc123' })
  })

  it('rejects empty or unsafe checkout values', () => {
    expect(() => parseExternalCheckoutInput('')).toThrow('checkout 不能为空')
    expect(() => parseExternalCheckoutInput('branch:../main')).toThrow('checkout 不能包含 ..')
  })

  it('rejects malformed checkout payloads without throwing runtime TypeError', () => {
    expect(() => normalizeExternalCheckout({ type: 'branch' } as never)).toThrow('checkout 不能为空')
    expect(() => normalizeExternalCheckout({ type: 'branch', value: null } as never)).toThrow('checkout 不能为空')
  })
})
