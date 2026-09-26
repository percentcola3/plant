import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeClaudeEvent } from './claude-event-normalizer'
import { applyAgentEvent, createInitialAgentState } from './agent-event-reducer'
import { findConclusionUuids, collectProcessTexts } from './narration'

const SESSION_DIR = '/Users/dev/.claude/projects/-Users-didi-Documents-WorkSpace--mywork-features--------'

describe('history replay pipeline on real session jsonl', () => {
  it('materializes historical messages and classifies conclusion/narration', () => {
    const file = `${SESSION_DIR}/5dee7a81-f2b7-4d7c-90b9-606033c98ddb.jsonl`
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean)

    const state = createInitialAgentState()
    let normalized = 0
    for (const line of lines) {
      let raw: unknown
      try { raw = JSON.parse(line) } catch { continue }
      const events = normalizeClaudeEvent(raw as never)
      for (const event of events) {
        if (event.type === 'ignore') continue
        normalized += 1
        applyAgentEvent(state, event as never)
      }
    }

    const messages = state.messages
    const userMsgs = messages.filter(m => m.role === 'user')
    const asstMsgs = messages.filter(m => m.role === 'assistant')
    const asstTextMsgs = asstMsgs.filter(m => m.content.some(b => b.type === 'text' && b.text.trim()))
    console.log('总消息:', messages.length, '| 用户:', userMsgs.length, '| assistant:', asstMsgs.length,
      '| 带文本assistant:', asstTextMsgs.length, '| 归一化事件:', normalized)

    // 按连续 assistant 分组(和 ConversationView messageGroups 一致)
    const groups: Array<{ role: string; messages: typeof messages }> = []
    for (const message of messages) {
      const prev = groups.at(-1)
      if (message.role === 'assistant' && prev?.role === 'assistant') { prev.messages.push(message); continue }
      groups.push({ role: message.role, messages: [message] })
    }
    const conclusionIds = findConclusionUuids(groups as never)
    let withConclusion = 0
    for (const g of groups) {
      if (g.role !== 'assistant') continue
      const texts = collectProcessTexts(g.messages, conclusionIds)
      const hasConclusion = g.messages.some(m => conclusionIds.has(m.uuid))
      if (hasConclusion) withConclusion += 1
      console.log(`  组(${g.messages.length}条) 结论=${hasConclusion ? '✓' : '✗ 无结论文本'} 过程段=${texts.length}`)
    }
    console.log('assistant组数:', groups.filter(g => g.role === 'assistant').length, '有结论的:', withConclusion)

    // 断言:至少一个 assistant 组有结论文本(历史可见)
    expect(withConclusion).toBeGreaterThan(0)
    expect(userMsgs.length).toBeGreaterThan(0)
  })
})
