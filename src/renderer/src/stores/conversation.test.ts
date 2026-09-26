import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConversationStore } from './conversation'

describe('conversation session reconnection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('restores an active background turn after historical replay reset transient state', () => {
    const store = useConversationStore()
    store.setActiveSession('session-running')
    store.replay('session-running', [], { historical: true })

    expect(store.currentTurnInFlight).toBe(false)

    store.restoreRunningTurn('session-running')

    expect(store.activeTurnState.status).toBe('running')
    expect(store.currentTurnInFlight).toBe(true)
  })

  it('在全新 renderer store 中用 JSONL 回放重建可见历史', () => {
    const store = useConversationStore()
    const sessionId = 'session-restored'
    store.setActiveSession(sessionId)
    store.replay(sessionId, [
      {
        type: 'user',
        uuid: 'user-1',
        message: { role: 'user', content: [{ type: 'text', text: '第一个问题' }] }
      },
      {
        type: 'assistant',
        uuid: 'assistant-1',
        message: { role: 'assistant', content: [{ type: 'text', text: '第一个回答' }] }
      }
    ], { historical: true })

    expect(store.messages
      .filter(message => message.role !== 'system')
      .map(message => ({
        role: message.role,
        text: message.content.find(block => block.type === 'text')?.text
      })))
      .toEqual([
        { role: 'user', text: '第一个问题' },
        { role: 'assistant', text: '第一个回答' }
      ])
  })
})
