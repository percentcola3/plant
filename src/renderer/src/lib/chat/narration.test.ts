import { describe, expect, it } from 'vitest'
import { findConclusionUuids, collectProcessTexts } from './narration'
import type { AgentMessage } from './agent-events'

let seq = 0
function msg(role: AgentMessage['role'], blocks: AgentMessage['content']): AgentMessage {
  return {
    uuid: `m${++seq}`,
    role,
    content: blocks,
    inFlight: false,
    createdAt: 0
  }
}
const text = (t: string) => ({ type: 'text' as const, text: t })
const thinking = (t: string) => ({ type: 'thinking' as const, text: t })
const toolUse = (id: string) => ({ type: 'tool_use' as const, toolUseId: id, name: 'Bash', input: {} })

describe('findConclusionUuids', () => {
  it('marks only the last text-bearing assistant message of a group as conclusion', () => {
    // 真实 dcc 链路形态：思考以普通 text 到达，thinking block 为空（已被 normalizer 过滤）
    const narration1 = msg('assistant', [text("I'll start by understanding the project context.")])
    const tool1 = msg('assistant', [toolUse('t1')])
    const narration2 = msg('assistant', [text('Let me check the UI asset library refs.')])
    const tool2 = msg('assistant', [toolUse('t2')])
    const conclusion = msg('assistant', [text('订单管理页已完成，包含五个状态的流转。')])

    const ids = findConclusionUuids([{ role: 'assistant', messages: [narration1, tool1, narration2, tool2, conclusion] }])

    expect(ids.has(conclusion.uuid)).toBe(true)
    expect(ids.has(narration1.uuid)).toBe(false)
    expect(ids.has(narration2.uuid)).toBe(false)
    expect(ids.size).toBe(1)
  })

  it('keeps a single text answer (plain Q&A turn) as conclusion', () => {
    const answer = msg('assistant', [text('直接回答，没有工具调用')])
    const ids = findConclusionUuids([{ role: 'assistant', messages: [answer] }])
    expect(ids.has(answer.uuid)).toBe(true)
  })

  it('treats the streaming narration as conclusion until a later message arrives', () => {
    // turn 进行中：最后一条 in-flight 消息的 text 仍是「当前结论候选」，正常流式渲染；
    // 下一条 assistant 消息到达后它自动降级为旁白（组重新计算）。
    const narration = msg('assistant', [text('正在分析…')])
    narration.inFlight = true
    const ids = findConclusionUuids([{ role: 'assistant', messages: [narration] }])
    expect(ids.has(narration.uuid)).toBe(true)
  })

  it('marks no conclusion when the group has no text at all', () => {
    const toolOnly = msg('assistant', [toolUse('t1')])
    const ids = findConclusionUuids([{ role: 'assistant', messages: [toolOnly] }])
    expect(ids.size).toBe(0)
  })

  it('ignores whitespace-only text blocks', () => {
    const blank = msg('assistant', [text('   \n  ')])
    const ids = findConclusionUuids([{ role: 'assistant', messages: [blank] }])
    expect(ids.size).toBe(0)
  })

  it('handles separate turns (user message splits groups)', () => {
    const turn1Answer = msg('assistant', [text('第一轮结论')])
    const userQuestion = msg('user', [text('再来一轮')])
    const turn2Narration = msg('assistant', [text('第二轮旁白')])
    const turn2Tool = msg('assistant', [toolUse('t9')])
    const turn2Answer = msg('assistant', [text('第二轮结论')])

    const ids = findConclusionUuids([
      { role: 'assistant', messages: [turn1Answer] },
      { role: 'user', messages: [userQuestion] },
      { role: 'assistant', messages: [turn2Narration, turn2Tool, turn2Answer] }
    ])

    expect(ids.has(turn1Answer.uuid)).toBe(true)
    expect(ids.has(turn2Narration.uuid)).toBe(false)
    expect(ids.has(turn2Answer.uuid)).toBe(true)
    expect(ids.size).toBe(2)
  })
})

describe('collectProcessTexts', () => {
  it('merges thinking blocks and narration texts of the group in order', () => {
    const thinking1 = msg('assistant', [thinking('先看目录结构')])
    const narration1 = msg('assistant', [text('我先看一下当前项目的结构。')])
    const tool = msg('assistant', [toolUse('t1')])
    const thinking2 = msg('assistant', [thinking('确认资产库约定')])
    const narration2 = msg('assistant', [text('找到了组件库，接下来读取 token。')])
    const conclusion = msg('assistant', [text('订单管理页已完成。')])

    const group = { role: 'assistant' as const, messages: [thinking1, narration1, tool, thinking2, narration2, conclusion] }
    const conclusionIds = findConclusionUuids([group])

    const texts = collectProcessTexts(group.messages, conclusionIds)
    expect(texts).toEqual([
      '先看目录结构',
      '我先看一下当前项目的结构。',
      '确认资产库约定',
      '找到了组件库，接下来读取 token。'
    ])
  })

  it('ignores whitespace-only blocks and non-assistant messages', () => {
    const blank = msg('assistant', [thinking('  '), text(' \n ')])
    const user = msg('user', [text('用户消息不算过程')])
    const answer = msg('assistant', [text('结论')])

    const texts = collectProcessTexts([blank, user, answer], new Set([answer.uuid]))
    expect(texts).toEqual([])
  })
})
