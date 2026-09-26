import { describe, expect, it } from 'vitest'
import type { AgentContentBlock } from './agent-events'
import { hasPendingClaudeInteraction } from './pending-interactions'

const interactionUse: AgentContentBlock = {
  type: 'tool_use',
  toolUseId: 'toolu_1',
  name: 'request_user_input',
  input: {
    questions: [{
      id: 'entry',
      header: '入口形态',
      question: '新增的 PIX 线下支付在收银台支付方式列表里应该怎么呈现？',
      options: [{ label: '独立并列按钮' }]
    }]
  }
}

describe('pending Claude interactions', () => {
  it('treats unanswered request_user_input prompts as pending', () => {
    expect(hasPendingClaudeInteraction([interactionUse])).toBe(true)
  })

  it('does not treat prompt echoes as submitted answers', () => {
    expect(hasPendingClaudeInteraction([
      interactionUse,
      { type: 'tool_result', toolUseId: 'toolu_1', content: 'Answer questions?' }
    ])).toBe(true)
  })

  it('clears pending state after a real submitted answer', () => {
    expect(hasPendingClaudeInteraction([
      interactionUse,
      { type: 'tool_result', toolUseId: 'toolu_1', content: '入口形态：独立并列按钮' }
    ])).toBe(false)
  })
})
