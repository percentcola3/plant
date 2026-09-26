import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useConversationStore } from '@/stores/conversation'

describe('conversation store', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  const sid = 'test-session-001'

  it('replay + appendDelta 同 uuid 去重', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    const events = [
      { type: 'user', uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } },
      { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }
    ]
    store.replay(sid, events as any)
    expect(store.messages).toHaveLength(2)

    // 重复 replay 同 uuid → 不增加
    store.replay(sid, events as any)
    expect(store.messages).toHaveLength(2)

    // append 新 uuid → 增加
    store.appendDelta(sid, {
      type: 'assistant', uuid: 'a2',
      message: { role: 'assistant', content: [{ type: 'text', text: 'world' }] }
    } as any)
    expect(store.messages).toHaveLength(3)
  })

  it('localAliases 同 path 同 alias 跨消息稳定', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    store.replay(sid, [
      { type: 'user', uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: '改 [:div.card] 的圆角' }] } }
    ] as any)

    const r1 = store.resolveAlias(sid, 'div.card')
    expect(r1.alias).toBe('A')

    // 同 path 在新消息里，alias 不变
    store.replay(sid, [
      { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: '修改了 [:div.card]' }] } }
    ] as any)

    const r2 = store.resolveAlias(sid, 'div.card')
    expect(r2.alias).toBe('A')
    expect(r2.alias).toBe(r1.alias)
  })

  it('inFlight 状态机', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    expect(store.currentTurnInFlight).toBe(false)

    store.beginTurn(sid, 'hello')
    expect(store.currentTurnInFlight).toBe(true)

    store.endTurn(sid, 'completed')
    expect(store.currentTurnInFlight).toBe(false)
  })

  it('resolveAlias alive 取决于 picksStore', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    // 没有 pick → alive = false
    const r = store.resolveAlias(sid, 'div.card')
    expect(r.alive).toBe(false)
  })

  it('abortTurn 标记中止', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    store.beginTurn(sid, 'test')
    // 追加一个 in-flight assistant 消息
    store.appendDelta(sid, {
      type: 'assistant', uuid: 'a-abort',
      message: { role: 'assistant', content: [{ type: 'text', text: 'thinking...' }] }
    } as any)

    store.abortTurn(sid)
    expect(store.currentTurnInFlight).toBe(false)

    const last = store.messages[store.messages.length - 1]
    expect(last.abortedAt).toBeDefined()
  })

  it('clearSession 清空指定会话消息和流式状态', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    store.beginTurn(sid, 'hello')
    expect(store.messages).toHaveLength(1)

    store.clearSession(sid)

    expect(store.messages).toEqual([])
    expect(store.currentTurnInFlight).toBe(false)
  })

  it('clearAll 清空所有会话缓存和当前活跃会话', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)
    store.beginTurn(sid, 'hello')
    store.beginTurn('another-session', 'world')

    store.clearAll()

    expect(store.activeSessionId).toBeNull()
    expect(store.messagesBySession.size).toBe(0)
    expect(store.turnStateBySession.size).toBe(0)
    expect(store.messages).toEqual([])
    expect(store.currentTurnInFlight).toBe(false)
  })

  it('replay 把 tool_result 合并到上一条 assistant 工具调用', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    store.replay(sid, [
      {
        type: 'assistant',
        uuid: 'a-tool',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pwd' } }]
        }
      },
      {
        type: 'user',
        uuid: 'u-result',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }]
        }
      }
    ] as any)

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].content).toEqual([
      { type: 'tool_use', toolUseId: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
      { type: 'tool_result', toolUseId: 'tool-1', content: 'ok', isError: false }
    ])
  })

  it('replay 用持久化 user 事件替换同文本的临时 user 气泡', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    store.beginTurn(sid, 'hello')
    store.replay(sid, [
      { type: 'user', uuid: 'u-real', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } }
    ] as any)

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].uuid).toBe('u-real')
  })

  it('appendDelta 用 stdout user 事件替换同文本的临时 user 气泡', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    store.beginTurn(sid, 'hello')
    store.appendDelta(sid, {
      type: 'user',
      uuid: 'u-real',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] }
    } as any)

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].uuid).toBe('u-real')
  })

  it('appendDelta 用内部 prompt 替换临时 user 气泡时保留用户可见原文', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    const visibleText = '从前端的角度来分析一下prd，我要改什么东西'
    const internalPrompt = [
      '## 当前编辑文档',
      '',
      '目标文件：`docs/prd/pix-payment-merchant-personal-code.md`',
      '如果本轮需要写入文档，必须写入这个目标文件。',
      '',
      '## 用户指令',
      '',
      visibleText
    ].join('\n')

    store.beginTurn(sid, visibleText)
    store.appendDelta(sid, {
      type: 'user',
      uuid: 'u-real',
      message: { role: 'user', content: [{ type: 'text', text: internalPrompt }] }
    } as any)

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].uuid).toBe('u-real')
    expect(store.messages[0].content).toEqual([{ type: 'text', text: visibleText }])
  })

  it('replay 历史内部 prompt 时只展示用户指令原文', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    const visibleText = '从前端的角度来分析一下prd，我要改什么东西'
    const internalPrompt = [
      '## 当前编辑文档',
      '',
      '目标文件：`docs/prd/pix-payment-merchant-personal-code.md`',
      '如果本轮需要写入文档，必须写入这个目标文件。',
      '',
      '## 用户指令',
      '',
      visibleText
    ].join('\n')

    store.replay(sid, [{
      type: 'user',
      uuid: 'u-real',
      message: { role: 'user', content: [{ type: 'text', text: internalPrompt }] }
    }] as any)

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].content).toEqual([{ type: 'text', text: visibleText }])
  })

  it('appendDelta 把 stdout 授权提示归一为状态事件，不展示用户气泡', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    store.appendDelta(sid, {
      type: 'user',
      uuid: 'u-approval',
      message: {
        role: 'user',
        content: [{
          type: 'text',
          text: [
            '我已在 UI 中授权执行下面这条 Bash 命令。',
            '请继续完成原任务。',
            '',
            'find . -name "*.md" | head'
          ].join('\n')
        }]
      }
    } as any)

    expect(store.messages).toHaveLength(0)
    expect(store.activeTurnState.approvalRequest).toBeUndefined()
  })

  it('replay 忽略 resume 产生的 meta continue 和 synthetic no-response', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    store.replay(sid, [
      {
        type: 'user',
        uuid: 'u-meta',
        isMeta: true,
        message: { role: 'user', content: [{ type: 'text', text: 'Continue from where you left off.' }] }
      },
      {
        type: 'assistant',
        uuid: 'a-synthetic',
        message: {
          id: 'synthetic-id',
          model: '<synthetic>',
          role: 'assistant',
          content: [{ type: 'text', text: 'No response requested.' }]
        }
      },
      {
        type: 'user',
        uuid: 'u-real',
        message: { role: 'user', content: [{ type: 'text', text: '继续' }] }
      }
    ] as any)

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].uuid).toBe('u-real')
    expect(store.messages[0].content).toEqual([{ type: 'text', text: '继续' }])
  })

  it('appendDelta 忽略 resume 产生的 meta continue 和 synthetic no-response', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)
    store.beginTurn(sid, '继续')

    store.appendDelta(sid, {
      type: 'user',
      uuid: 'u-meta',
      isMeta: true,
      message: { role: 'user', content: [{ type: 'text', text: 'Continue from where you left off.' }] }
    } as any)
    store.appendDelta(sid, {
      type: 'assistant',
      uuid: 'a-synthetic',
      message: {
        id: 'synthetic-id',
        model: '<synthetic>',
        role: 'assistant',
        content: [{ type: 'text', text: 'No response requested.' }]
      }
    } as any)
    store.appendDelta(sid, {
      type: 'user',
      uuid: 'u-real',
      message: { role: 'user', content: [{ type: 'text', text: '继续' }] }
    } as any)

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].uuid).toBe('u-real')
    expect(store.messages[0].content).toEqual([{ type: 'text', text: '继续' }])
  })

  it('appendDelta 合并同一 provider message 的 assistant 文本和工具调用', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    store.appendDelta(sid, {
      type: 'assistant',
      uuid: 'a-text',
      message: {
        id: 'msg-1',
        role: 'assistant',
        content: [{ type: 'text', text: '知识库依据已收集到位。' }]
      }
    } as any)
    store.appendDelta(sid, {
      type: 'assistant',
      uuid: 'a-tool',
      message: {
        id: 'msg-1',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'TaskCreate', input: { subject: '写 PRD' } }]
      }
    } as any)

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].content).toEqual([
      { type: 'text', text: '知识库依据已收集到位。' },
      { type: 'tool_use', toolUseId: 'tool-1', name: 'TaskCreate', input: { subject: '写 PRD' } }
    ])
    expect(store.messages[0].inFlight).toBe(true)
  })

  it('replay 合并同一 provider message 的 assistant 文本和工具调用', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    store.replay(sid, [
      {
        type: 'assistant',
        uuid: 'a-text',
        message: {
          id: 'msg-1',
          role: 'assistant',
          content: [{ type: 'text', text: '知识库依据已收集到位。' }]
        }
      },
      {
        type: 'assistant',
        uuid: 'a-tool',
        message: {
          id: 'msg-1',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'TaskCreate', input: { subject: '写 PRD' } }]
        }
      }
    ] as any)

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].content).toEqual([
      { type: 'text', text: '知识库依据已收集到位。' },
      { type: 'tool_use', toolUseId: 'tool-1', name: 'TaskCreate', input: { subject: '写 PRD' } }
    ])
    expect(store.messages[0].inFlight).toBe(false)
  })

  it('appendDelta 遇到 Bash 授权错误时进入 waitingApproval 状态', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)
    store.beginTurn(sid, '查找文档')

    store.appendDelta(sid, {
      type: 'assistant',
      uuid: 'a-tool',
      message: {
        id: 'msg-approval',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-approval', name: 'Bash', input: { command: 'find . -name "*.md" | head' } }]
      }
    } as any)
    store.appendDelta(sid, {
      type: 'user',
      uuid: 'u-tool-result',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-approval',
          is_error: true,
          content: 'This Bash command contains multiple operations. The following part requires approval: find . -name "*.md"'
        }]
      }
    } as any)

    expect(store.activeTurnState.status).toBe('waitingApproval')
    expect(store.activeTurnState.approvalRequest?.command).toBe('find . -name "*.md" | head')
    expect(store.currentTurnInFlight).toBe(true)
  })

  it('turn 完成但只有 Task 工具时标记 noWrite outcome', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)
    store.beginTurn(sid, '写 PRD')

    store.appendDelta(sid, {
      type: 'assistant',
      uuid: 'a-task',
      message: {
        id: 'msg-task',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'task-1', name: 'TaskCreate', input: { subject: '写 PRD' } },
          { type: 'tool_result', tool_use_id: 'task-1', content: 'Task #1 created successfully' }
        ]
      }
    } as any)
    store.appendDelta(sid, { type: 'result', uuid: 'r1', result: 'done' } as any)

    expect(store.activeTurnState.status).toBe('completed')
    expect(store.activeTurnState.outcome).toBe('noWrite')
    expect(store.currentTurnInFlight).toBe(false)
  })

  it('beginInternalTurn 只更新 turn 状态，不追加可见消息', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    store.beginInternalTurn(sid)

    expect(store.messages).toHaveLength(0)
    expect(store.activeTurnState.status).toBe('submitting')
    expect(store.currentTurnInFlight).toBe(true)
  })

  it('historical replay 插入历史分割线，并清理旧 pending 授权状态', () => {
    const store = useConversationStore()
    store.setActiveSession(sid)

    store.replay(sid, [
      {
        type: 'assistant',
        uuid: 'a-tool',
        message: {
          id: 'msg-approval',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-approval', name: 'Bash', input: { command: 'find . -name "*.md" | head' } }]
        }
      },
      {
        type: 'user',
        uuid: 'u-tool-result',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool-approval',
            is_error: true,
            content: 'This Bash command contains multiple operations. The following part requires approval: find . -name "*.md"'
          }]
        }
      }
    ] as any, { historical: true })

    expect(store.messages[0].role).toBe('system')
    expect(store.messages[0].content).toEqual([{ type: 'text', text: '以下为上次会话历史' }])
    expect(store.activeTurnState.status).toBe('idle')
    expect(store.activeTurnState.approvalRequest).toBeUndefined()
    expect(store.currentTurnInFlight).toBe(false)
  })
})
