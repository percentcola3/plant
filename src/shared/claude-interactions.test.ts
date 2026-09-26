import { describe, expect, it } from 'vitest'
import {
  parseClaudeInteraction,
  buildInteractionResponse,
  isClaudeInteractionAnswerResult
} from './claude-interactions'

describe('parseClaudeInteraction', () => {
  it('parses request_user_input questions with options', () => {
    const result = parseClaudeInteraction('request_user_input', {
      questions: [{
        id: 'mode',
        header: '模式',
        question: '选择生成模式',
        options: [
          { label: '快速版', description: '先出主流程' },
          { label: '完整 PRD', description: '包含评审材料' }
        ]
      }]
    })

    expect(result).toEqual({
      title: 'Claude 需要你补充信息',
      questions: [{
        id: 'mode',
        label: '模式',
        question: '选择生成模式',
        options: [
          { label: '快速版', description: '先出主流程' },
          { label: '完整 PRD', description: '包含评审材料' }
        ],
        multiSelect: false
      }]
    })
  })

  it('reads multiSelect (camelCase or snake_case) on a question', () => {
    const r1 = parseClaudeInteraction('AskUserQuestion', {
      questions: [{ id: 'feat', header: '特性', question: '选要的', options: [{ label: 'A' }], multiSelect: true }]
    })
    expect(r1?.questions[0].multiSelect).toBe(true)

    const r2 = parseClaudeInteraction('AskUserQuestion', {
      questions: [{ id: 'feat', header: '特性', question: '选要的', options: [{ label: 'A' }], multi_select: true }]
    })
    expect(r2?.questions[0].multiSelect).toBe(true)
  })

  it('builds a clear response from selected single-answer and notes', () => {
    const response = buildInteractionResponse({
      title: 'Claude 需要你补充信息',
      questions: [{
        id: 'mode',
        label: '模式',
        question: '选择生成模式',
        options: [{ label: '快速版' }],
        multiSelect: false
      }]
    }, { mode: ['快速版'] }, '先不要写研发评审')

    expect(response).toBe('模式：快速版\n补充说明：先不要写研发评审')
  })

  it('joins multi-select answers with 、', () => {
    const response = buildInteractionResponse({
      title: 'Claude 需要你补充信息',
      questions: [{
        id: 'feat',
        label: '特性',
        question: '勾要的',
        options: [{ label: '搜索' }, { label: '导出' }],
        multiSelect: true
      }]
    }, { feat: ['搜索', '导出'] }, '')

    expect(response).toBe('特性：搜索、导出')
  })

  it('skips empty answers and trims values', () => {
    const response = buildInteractionResponse({
      title: 't',
      questions: [
        { id: 'a', label: 'A', question: '?', options: [], multiSelect: false },
        { id: 'b', label: 'B', question: '?', options: [], multiSelect: true }
      ]
    }, { a: [], b: ['  x  ', ''] }, '')

    expect(response).toBe('B：x')
  })

  it('does not treat request prompt echoes as submitted answers', () => {
    const interaction = parseClaudeInteraction('request_user_input', {
      questions: [{ id: 'mode', header: '模式', question: '选择生成模式', options: [{ label: '快速版' }] }]
    })
    expect(interaction).not.toBeNull()
    expect(isClaudeInteractionAnswerResult(interaction!, 'Answer questions?')).toBe(false)
    expect(isClaudeInteractionAnswerResult(interaction!, '模式：快速版')).toBe(true)
  })
})
