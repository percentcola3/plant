import { describe, expect, it } from 'vitest'
import { insertTokenAtMentionTrigger } from './mention-insert'

const knowledge = {
  type: 'resource' as const,
  id: 'tk_1',
  resourceKind: 'knowledge' as const,
  alias: 'POS前端',
  path: '.external/POS前端'
}

describe('insertTokenAtMentionTrigger', () => {
  it('replaces a typed @alias with a resource chip instead of keeping plain text', () => {
    expect(insertTokenAtMentionTrigger(
      [{ type: 'text', text: '@POS前端' }],
      'POS前端',
      knowledge
    )).toEqual([knowledge])
  })

  it('replaces a lone @ trigger', () => {
    expect(insertTokenAtMentionTrigger(
      [{ type: 'text', text: '@' }],
      '',
      knowledge
    )).toEqual([knowledge])
  })

  it('keeps text before and after the trigger', () => {
    expect(insertTokenAtMentionTrigger(
      [{ type: 'text', text: '看@POS前端 怎么打包' }],
      'POS前端',
      knowledge
    )).toEqual([
      { type: 'text', text: '看' },
      knowledge,
      { type: 'text', text: ' 怎么打包' }
    ])
  })

  it('appends when the editor has no @ trigger left', () => {
    expect(insertTokenAtMentionTrigger(
      [{ type: 'text', text: '继续勾选' }],
      '',
      knowledge
    )).toEqual([
      { type: 'text', text: '继续勾选' },
      knowledge
    ])
  })
})
