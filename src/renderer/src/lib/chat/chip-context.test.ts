import { describe, expect, it } from 'vitest'
import { collectSubmitChips } from './chip-context'

describe('collectSubmitChips', () => {
  it('resolves plain @A mentions from current inspector picks', () => {
    const chips = collectSubmitChips({
      text: '@A\u00a0字体小一点',
      tokens: [{ type: 'text', text: '@A\u00a0字体小一点' }],
      currentPicks: [{
        alias: 'A',
        path: 'body > main > h1',
        tagName: 'h1',
        textPreview: '点餐'
      }]
    })

    expect(chips).toEqual([{
      alias: 'A',
      path: 'body > main > h1',
      tagName: 'h1',
      textPreview: '点餐',
      edits: undefined
    }])
  })

  it('resolves @A mentions before Chinese text without requiring a space', () => {
    const chips = collectSubmitChips({
      text: '@A字体小一点',
      tokens: [{ type: 'text', text: '@A字体小一点' }],
      currentPicks: [{
        alias: 'A',
        path: 'body > main > h1'
      }]
    })

    expect(chips).toEqual([{
      alias: 'A',
      path: 'body > main > h1',
      tagName: undefined,
      textPreview: undefined,
      edits: undefined
    }])
  })

  it('does not duplicate aliases already represented by chip tokens', () => {
    const chips = collectSubmitChips({
      text: '@A 字体小一点',
      tokens: [{ type: 'chip', alias: 'A', path: 'body > main > h1' }],
      currentPicks: [{
        alias: 'A',
        path: 'body > main > h1',
        tagName: 'h1'
      }]
    })

    expect(chips).toEqual([{
      alias: 'A',
      path: 'body > main > h1',
      tagName: 'h1',
      textPreview: undefined,
      edits: undefined
    }])
  })
})
