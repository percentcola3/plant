import { describe, expect, it } from 'vitest'
import {
  applyAgentEvent,
  createInitialAgentState,
  isTurnInFlight
} from './agent-event-reducer'

describe('agent-event-reducer', () => {
  it('merges assistant chunks that share the same provider message id', () => {
    const state = createInitialAgentState()

    applyAgentEvent(state, {
      type: 'message.assistant',
      uuid: 'a-text',
      providerMessageId: 'msg-1',
      inFlight: true,
      content: [{ type: 'text', text: '知识库依据已收集到位。' }]
    })
    applyAgentEvent(state, {
      type: 'message.assistant',
      uuid: 'a-tool',
      providerMessageId: 'msg-1',
      inFlight: true,
      content: [{ type: 'tool_use', toolUseId: 'tool-1', name: 'TaskCreate', input: { subject: '写 PRD' } }]
    })

    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].content).toEqual([
      { type: 'text', text: '知识库依据已收集到位。' },
      { type: 'tool_use', toolUseId: 'tool-1', name: 'TaskCreate', input: { subject: '写 PRD' } }
    ])
  })

  it('merges tool results into the previous assistant message', () => {
    const state = createInitialAgentState()

    applyAgentEvent(state, {
      type: 'message.assistant',
      uuid: 'a-tool',
      providerMessageId: 'msg-1',
      inFlight: true,
      content: [{ type: 'tool_use', toolUseId: 'tool-1', name: 'Bash', input: { command: 'pwd' } }]
    })
    applyAgentEvent(state, {
      type: 'tool.result',
      uuid: 'u-result',
      content: [{ type: 'tool_result', toolUseId: 'tool-1', content: 'ok', isError: false }]
    })

    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].content).toEqual([
      { type: 'tool_use', toolUseId: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
      { type: 'tool_result', toolUseId: 'tool-1', content: 'ok', isError: false }
    ])
  })

  it('sets waitingApproval when a Bash approval error is merged', () => {
    const state = createInitialAgentState()

    applyAgentEvent(state, {
      type: 'message.assistant',
      uuid: 'a-tool',
      providerMessageId: 'msg-1',
      inFlight: true,
      content: [{ type: 'tool_use', toolUseId: 'tool-1', name: 'Bash', input: { command: 'find . -name "*.md" | head' } }]
    })
    applyAgentEvent(state, {
      type: 'tool.result',
      uuid: 'u-result',
      content: [{
        type: 'tool_result',
        toolUseId: 'tool-1',
        isError: true,
        content: 'This Bash command contains multiple operations. The following part requires approval: find . -name "*.md"'
      }]
    })

    expect(state.turn.status).toBe('waitingApproval')
    expect(state.turn.approvalRequest?.command).toBe('find . -name "*.md" | head')
    expect(state.turn.approvalRequest?.allowedTools).toEqual(['Bash'])
    expect(isTurnInFlight(state.turn)).toBe(true)
  })

  it('clears approval request when UI approval is resolved', () => {
    const state = createInitialAgentState()

    applyAgentEvent(state, {
      type: 'message.assistant',
      uuid: 'a-tool',
      providerMessageId: 'msg-1',
      inFlight: true,
      content: [{ type: 'tool_use', toolUseId: 'tool-1', name: 'Bash', input: { command: 'find . -name "*.md" | head' } }]
    })
    applyAgentEvent(state, {
      type: 'tool.result',
      uuid: 'u-result',
      content: [{
        type: 'tool_result',
        toolUseId: 'tool-1',
        isError: true,
        content: 'This Bash command contains multiple operations. The following part requires approval: find . -name "*.md"'
      }]
    })
    applyAgentEvent(state, { type: 'approval.resolved', uuid: 'u-approval', decision: 'allow' })

    expect(state.turn.status).toBe('running')
    expect(state.turn.approvalRequest).toBeUndefined()
  })

  it('marks completed task-only turns as no-write outcomes', () => {
    const state = createInitialAgentState()

    applyAgentEvent(state, {
      type: 'message.user',
      uuid: 'u1',
      content: [{ type: 'text', text: '写 PRD' }]
    })
    applyAgentEvent(state, {
      type: 'message.assistant',
      uuid: 'a1',
      providerMessageId: 'msg-1',
      inFlight: true,
      content: [
        { type: 'tool_use', toolUseId: 't1', name: 'TaskCreate', input: { subject: '写 PRD' } },
        { type: 'tool_result', toolUseId: 't1', content: 'Task #1 created successfully', isError: false }
      ]
    })
    applyAgentEvent(state, { type: 'turn.completed', uuid: 'r1', status: 'completed' })

    expect(state.turn.status).toBe('completed')
    expect(state.turn.outcome).toBe('noWrite')
    expect(isTurnInFlight(state.turn)).toBe(false)
  })

  it('marks completed turns with write tools as wrote-files outcomes', () => {
    const state = createInitialAgentState()

    applyAgentEvent(state, {
      type: 'message.user',
      uuid: 'u1',
      content: [{ type: 'text', text: '写 PRD' }]
    })
    applyAgentEvent(state, {
      type: 'message.assistant',
      uuid: 'a1',
      providerMessageId: 'msg-1',
      inFlight: true,
      content: [
        { type: 'tool_use', toolUseId: 't1', name: 'Write', input: { file_path: '测试pred.md' } },
        { type: 'tool_result', toolUseId: 't1', content: 'File written', isError: false }
      ]
    })
    applyAgentEvent(state, { type: 'turn.completed', uuid: 'r1', status: 'completed' })

    expect(state.turn.status).toBe('completed')
    expect(state.turn.outcome).toBe('wroteFiles')
  })

  it('appends a system error message when turn ends with status=error', () => {
    const state = createInitialAgentState()
    applyAgentEvent(state, {
      type: 'message.user',
      uuid: 'u1',
      content: [{ type: 'text', text: '帮我改下' }]
    })
    applyAgentEvent(state, {
      type: 'turn.completed',
      uuid: 'r-err',
      status: 'error',
      errorMessage: 'API key is missing'
    })

    expect(state.turn.status).toBe('error')
    expect(state.turn.errorMessage).toBe('API key is missing')

    const lastMsg = state.messages[state.messages.length - 1]
    expect(lastMsg.role).toBe('system')
    expect(lastMsg.uuid.startsWith('error_')).toBe(true)
    const txt = lastMsg.content[0]
    expect(txt.type).toBe('text')
    if (txt.type === 'text') expect(txt.text).toContain('API key is missing')
  })

  it('does not append system error when error has no message', () => {
    const state = createInitialAgentState()
    applyAgentEvent(state, {
      type: 'message.user',
      uuid: 'u1',
      content: [{ type: 'text', text: 'hi' }]
    })
    applyAgentEvent(state, {
      type: 'turn.completed',
      uuid: 'r-err',
      status: 'error'
    })
    expect(state.messages.find(m => m.role === 'system')).toBeUndefined()
  })

  it('dedupes multiple turn.completed error events into a single system message', () => {
    const state = createInitialAgentState()
    applyAgentEvent(state, {
      type: 'message.user',
      uuid: 'u1',
      content: [{ type: 'text', text: 'hi' }]
    })
    // 1) stream-json result 事件先到，带具体错误内容
    applyAgentEvent(state, {
      type: 'turn.completed',
      uuid: 'r-result',
      status: 'error',
      errorMessage: 'API Error: Request rejected (429)'
    })
    // 2) process exit 后再来一个 turn-end，errorMessage 是退出码概要
    applyAgentEvent(state, {
      type: 'turn.completed',
      uuid: 'r-exit',
      status: 'error',
      errorMessage: 'Claude Code 退出码 1'
    })

    // 只应有一条 system 红条，内容是先到的具体错误
    const systemMsgs = state.messages.filter(m => m.role === 'system')
    expect(systemMsgs).toHaveLength(1)
    const txt = systemMsgs[0].content[0]
    if (txt.type === 'text') expect(txt.text).toContain('API Error')
    // turnState.errorMessage 也保留先到的具体错误
    expect(state.turn.errorMessage).toBe('API Error: Request rejected (429)')
  })

  it('does not append system error when assistant text already contains the error', () => {
    const state = createInitialAgentState()
    applyAgentEvent(state, {
      type: 'message.user',
      uuid: 'u1',
      content: [{ type: 'text', text: 'hi' }]
    })
    // claude 已经把错误信息写在回复里
    applyAgentEvent(state, {
      type: 'message.assistant',
      uuid: 'a1',
      providerMessageId: 'msg-1',
      inFlight: false,
      content: [{ type: 'text', text: 'API Error: Request rejected (429) · 你已达上限' }]
    })
    applyAgentEvent(state, {
      type: 'turn.completed',
      uuid: 'r-err',
      status: 'error',
      errorMessage: 'API Error: Request rejected (429)'
    })
    // 不应再追加 system 红条
    expect(state.messages.find(m => m.role === 'system')).toBeUndefined()
    // 但 turnState.errorMessage 仍记录，底部 banner 还能显示
    expect(state.turn.errorMessage).toBe('API Error: Request rejected (429)')
  })

  it('marks completed turns with changed artifacts as wrote-files outcomes', () => {
    const state = createInitialAgentState()

    applyAgentEvent(state, {
      type: 'message.user',
      uuid: 'u1',
      content: [{ type: 'text', text: '写 PRD' }]
    })
    applyAgentEvent(state, {
      type: 'message.assistant',
      uuid: 'a1',
      providerMessageId: 'msg-1',
      inFlight: true,
      content: [{ type: 'text', text: '已完成。' }]
    })
    applyAgentEvent(state, {
      type: 'turn.completed',
      uuid: 'r1',
      status: 'completed',
      changedArtifacts: ['docs/pix-offline-payment.md']
    })

    expect(state.turn.status).toBe('completed')
    expect(state.turn.outcome).toBe('wroteFiles')
    expect(state.turn.changedArtifacts).toEqual(['docs/pix-offline-payment.md'])
  })

  it('aborted 后再来 turn.completed{error} 不被覆盖（防止"主动中止后又弹错误红条"）', () => {
    const state = createInitialAgentState()
    applyAgentEvent(state, {
      type: 'message.user',
      uuid: 'u1',
      content: [{ type: 'text', text: 'hi' }]
    })
    // 1) 用户主动中止，前端先 dispatch turn.aborted
    applyAgentEvent(state, { type: 'turn.aborted' })
    expect(state.turn.status).toBe('aborted')
    // 2) 子进程被 SIGTERM 后退出，turn-end IPC 紧接着到达。哪怕 main 端把 status
    //    分错走了 'error' 分支，前端 reducer 也要兜底不覆盖 aborted。
    applyAgentEvent(state, {
      type: 'turn.completed',
      uuid: 'r-exit',
      status: 'error',
      errorMessage: 'Claude Code 退出码 1'
    })
    expect(state.turn.status).toBe('aborted')
    expect(state.turn.errorMessage).toBeUndefined()
    // 不该出现红条系统消息
    const systemMsgs = state.messages.filter(m => m.role === 'system')
    expect(systemMsgs).toHaveLength(0)
  })

  // P4：text.delta 流式合并
  describe('text.delta streaming', () => {
    it('appends delta to the last in-flight assistant message', () => {
      const state = createInitialAgentState()
      applyAgentEvent(state, { type: 'message.user', uuid: 'u1', content: [{ type: 'text', text: 'hi' }] })
      // 先有一个 in-flight assistant（message_start 到达但还没整消息）
      applyAgentEvent(state, {
        type: 'message.assistant',
        uuid: 'a1',
        providerMessageId: 'msg-1',
        inFlight: true,
        content: []
      })
      applyAgentEvent(state, { type: 'text.delta', uuid: 'a1', delta: 'Hello' })
      applyAgentEvent(state, { type: 'text.delta', uuid: 'a1', delta: ' world' })

      const assistant = state.messages.find(m => m.role === 'assistant')!
      expect(assistant.content).toEqual([{ type: 'text', text: 'Hello world' }])
      expect(state.turn.status).toBe('streaming')
    })

    it('pre-creates assistant message when delta arrives before assistant event', () => {
      const state = createInitialAgentState()
      applyAgentEvent(state, { type: 'message.user', uuid: 'u1', content: [{ type: 'text', text: 'hi' }] })
      // 首个 delta 先于 assistant 整消息（partial-messages 的典型时序）
      applyAgentEvent(state, { type: 'text.delta', uuid: 'a-pre', delta: 'Streaming' })

      expect(state.messages).toHaveLength(2)   // user + 预创建 assistant
      const assistant = state.messages[1]
      expect(assistant.role).toBe('assistant')
      expect(assistant.inFlight).toBe(true)
      expect(assistant.content).toEqual([{ type: 'text', text: 'Streaming' }])
    })

    it('merges pre-created message when real assistant event arrives', () => {
      const state = createInitialAgentState()
      applyAgentEvent(state, { type: 'message.user', uuid: 'u1', content: [{ type: 'text', text: 'hi' }] })
      applyAgentEvent(state, { type: 'text.delta', uuid: 'a-pre', delta: 'Streaming' })
      // 真正的 assistant 整消息到达（同 uuid）→ 合并而非新建
      applyAgentEvent(state, {
        type: 'message.assistant',
        uuid: 'a-pre',
        providerMessageId: 'msg-1',
        inFlight: true,
        content: [{ type: 'text', text: 'Streaming done.' }]
      })

      const assistants = state.messages.filter(m => m.role === 'assistant')
      expect(assistants).toHaveLength(1)
    })

    it('appends to existing text block when one exists', () => {
      const state = createInitialAgentState()
      applyAgentEvent(state, {
        type: 'message.assistant',
        uuid: 'a1',
        inFlight: true,
        content: [{ type: 'text', text: 'Base' }]
      })
      applyAgentEvent(state, { type: 'text.delta', uuid: 'a1', delta: ' +more' })

      const assistant = state.messages.find(m => m.role === 'assistant')!
      expect(assistant.content[0]).toEqual({ type: 'text', text: 'Base +more' })
    })

    it('creates new text block when last block is tool_use', () => {
      const state = createInitialAgentState()
      applyAgentEvent(state, {
        type: 'message.assistant',
        uuid: 'a1',
        inFlight: true,
        content: [{ type: 'tool_use', toolUseId: 't1', name: 'Bash', input: { command: 'ls' } }]
      })
      applyAgentEvent(state, { type: 'text.delta', uuid: 'a1', delta: 'Done' })

      const assistant = state.messages.find(m => m.role === 'assistant')!
      expect(assistant.content).toHaveLength(2)
      expect(assistant.content[1]).toEqual({ type: 'text', text: 'Done' })
    })

    it('does not override toolRunning status with streaming', () => {
      const state = createInitialAgentState()
      applyAgentEvent(state, {
        type: 'message.assistant',
        uuid: 'a1',
        inFlight: true,
        content: [{ type: 'tool_use', toolUseId: 't1', name: 'Bash', input: {} }]
      })
      expect(state.turn.status).toBe('toolRunning')
      applyAgentEvent(state, { type: 'text.delta', uuid: 'a1', delta: 'x' })
      // toolRunning 优先级高于 streaming，不应被覆盖
      expect(state.turn.status).toBe('toolRunning')
    })
  })

  // P4：artifact 回声抑制集成（reducer 层）
  describe('artifact echo suppression', () => {
    it('strips text block that duplicates a Write tool_use content', () => {
      const state = createInitialAgentState()
      const fileContent = 'export const x = 1\nexport const y = 2'
      // assistant message 同时有 Write tool_use 和重复 content 的 text block
      applyAgentEvent(state, {
        type: 'message.assistant',
        uuid: 'a1',
        inFlight: true,
        content: [
          { type: 'text', text: fileContent },   // echo（跟写入一致）
          { type: 'tool_use', toolUseId: 'w1', name: 'Write', input: { file_path: 'a.ts', content: fileContent } }
        ]
      })
      const assistant = state.messages.find(m => m.role === 'assistant')!
      // text block 应被剥掉，只留 tool_use
      expect(assistant.content.some(b => b.type === 'text')).toBe(false)
      expect(assistant.content.some(b => b.type === 'tool_use')).toBe(true)
    })

    it('keeps text block that is unrelated to written content', () => {
      const state = createInitialAgentState()
      applyAgentEvent(state, {
        type: 'message.assistant',
        uuid: 'a1',
        inFlight: true,
        content: [
          { type: 'text', text: '我已经创建了文件，接下来可以运行测试。' },
          { type: 'tool_use', toolUseId: 'w1', name: 'Write', input: { file_path: 'a.ts', content: 'const x = 1' } }
        ]
      })
      const assistant = state.messages.find(m => m.role === 'assistant')!
      expect(assistant.content.filter(b => b.type === 'text')).toHaveLength(1)
    })

    it('clears recentFileWrites on turn completion', () => {
      const state = createInitialAgentState()
      applyAgentEvent(state, {
        type: 'message.assistant',
        uuid: 'a1',
        inFlight: true,
        content: [
          { type: 'tool_use', toolUseId: 'w1', name: 'Write', input: { file_path: 'a.ts', content: 'data' } }
        ]
      })
      expect(state.recentFileWrites.length).toBe(1)
      applyAgentEvent(state, { type: 'turn.completed', uuid: 'r1', status: 'completed' })
      expect(state.recentFileWrites).toHaveLength(0)
    })
  })
})

describe('turn.completed finalText 落地', () => {
  it('工具收尾的 turn 用 result 文本补出结论文本消息', () => {
    const state = createInitialAgentState()
    applyAgentEvent(state, {
      type: 'message.user', uuid: 'u1', content: [{ type: 'text', text: '开始' }]
    })
    applyAgentEvent(state, {
      type: 'message.assistant',
      uuid: 'a-tool',
      inFlight: true,
      content: [{ type: 'tool_use', toolUseId: 't1', name: 'Bash', input: { command: 'ls' } }]
    })
    applyAgentEvent(state, {
      type: 'turn.completed', uuid: 'r1', status: 'completed', finalText: '页面已生成完毕，共三个状态。'
    })
    const last = state.messages.at(-1)!
    expect(last.role).toBe('assistant')
    expect(last.content).toEqual([{ type: 'text', text: '页面已生成完毕，共三个状态。' }])
  })

  it('与最后一条 assistant 文本相同时不重复追加', () => {
    const state = createInitialAgentState()
    applyAgentEvent(state, {
      type: 'message.assistant',
      uuid: 'a-text',
      inFlight: true,
      content: [{ type: 'text', text: '页面已生成完毕，共三个状态。' }]
    })
    const before = state.messages.length
    applyAgentEvent(state, {
      type: 'turn.completed', uuid: 'r1', status: 'completed', finalText: '页面已生成完毕，共三个状态。'
    })
    expect(state.messages).toHaveLength(before)
  })

  it('error turn 不落地 finalText', () => {
    const state = createInitialAgentState()
    const before = state.messages.length
    applyAgentEvent(state, {
      type: 'turn.completed', uuid: 'r1', status: 'error', errorMessage: 'boom', finalText: '不该出现'
    })
    expect(state.messages.at(-1)!.role).toBe('system')
    expect(state.messages).toHaveLength(before + 1)
  })
})
