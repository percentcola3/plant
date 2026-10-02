import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, createUserMessage, ToolCallId, type GenerateOptions, type StreamChunk, type RequestMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { DeepSeekAssistantMessage, DeepSeekMessage } from './api'
import type { HarnessToolbox } from './tools'

export const DSH_VERSION = '0.2.0-rc.2'

type Input = {
  sessionId: string
  workDir: string
  messages: DeepSeekMessage[]
  toolbox: HarnessToolbox
  signal: AbortSignal
  request(messages: DeepSeekMessage[], signal: AbortSignal): Promise<DeepSeekAssistantMessage>
  onAssistant(message: DeepSeekAssistantMessage): void
  onToolResult(callId: string, content: string, isError: boolean): void
}

// Plant owns persisted history, images and the restricted toolbox. The official
// loop owns each turn's scheduling, tool dispatch, cancellation and termination.
// A fresh scoped context per turn avoids sharing providers/tools across tasks.
export async function runOfficialDshTurn(input: Input): Promise<string> {
  const ctx = new Context()
  const starter = createUserMessage({ content: [{ type: 'text', text: '继续当前用户请求' }], source: { kind: 'user' } })
  let steps = 0
  let finalText = ''
  class PlantAdapter extends LlmAdapter {
    override async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (++steps > 24) throw new Error('Plant 超过最大执行步数（24）')
      const signal = options.signal ?? input.signal
      // Plant supplies history and system context, including original images.
      // Locate the synthetic starter by identity: dsh may prepend prompt messages.
      const starterIndex = options.messages.findIndex(message => message.id === starter.id)
      if (starterIndex < 0) throw new Error('DSH request is missing its turn starter')
      const messages = [...input.messages, ...projectLoopMessages(options.messages.slice(starterIndex + 1))]
      let answer = await input.request(messages, signal)
      // A reasoning-only response is not a completed answer. Retry the same
      // request once before publishing anything or executing any tools.
      if (!answer.content?.trim() && !answer.tool_calls?.length) {
        signal.throwIfAborted()
        answer = await input.request(messages, signal)
        if (!answer.content?.trim() && !answer.tool_calls?.length) {
          throw new Error('模型连续两次未返回正文或工具调用，请重试或切换模型')
        }
      }
      input.onAssistant(answer)
      let index = 0
      for (const [kind, text] of [['reasoning', answer.reasoning_content], ['text', answer.content]] as const) {
        if (!text) continue
        yield { type: 'block-start', index, blockType: kind }
        yield kind === 'text' ? { type: 'text-delta', index, text } : { type: 'reasoning-delta', index, text }
        yield { type: 'block-end', index, block: { type: kind, text } }
        index++
      }
      for (const call of answer.tool_calls ?? []) {
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.function.name, arguments: call.function.arguments } }
        index++
      }
      if (!answer.tool_calls?.length) finalText = answer.content?.trim() ?? ''
      yield { type: 'finish', reason: { kind: answer.tool_calls?.length ? 'tool-calls' : 'stop' } }
    }
  }
  try {
    input.signal.throwIfAborted()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
    // 同时注册新旧 provider 名，旧会话 JSONL 里持久化的 peeka 记录也能回放
    ctx.llm.registerAdapter(['plant', 'peeka'], new PlantAdapter())
    for (const definition of input.toolbox.definitions) {
      ctx.tools.register({
        ...definition.function,
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: String(value) }]
        },
        async execute(args, exec) {
          exec.signal.throwIfAborted()
          const result = await input.toolbox.execute(definition.function.name, args)
          if (result.isError) throw new Error(result.content)
          return result.content
        }
      })
    }
    const agent = await ctx.agentLoop.create(SessionId(input.sessionId), { provider: 'plant', model: 'configured' }, { cwd: input.workDir })
    ctx.on('session/event', (_session, event) => {
      if (event.type !== 'tool/result') return
      // dsh 0.2.0 stores tool results as first-class tool-role messages.
      const message = event.data.message
      const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      input.onToolResult(message.toolCallId, text, !!message.isError)
    })
    const cancel = () => agent.cancel({ kind: 'user' })
    input.signal.addEventListener('abort', cancel, { once: true })
    try {
      input.signal.throwIfAborted()
      agent.followup(starter)
      await agent.whenIdle()
      input.signal.throwIfAborted()
      const end = agent.session.snapshotEvents().filter(e => e.type === 'turn/end').at(-1)
      if (!end || end.data.reason.kind !== 'completed') {
        throw new Error(end?.data.reason.kind === 'error' ? end.data.reason.error.message : 'Plant 任务未正常完成')
      }
      if (!finalText) throw new Error('Plant 未返回可显示的最终回复')
      return finalText
    } finally {
      input.signal.removeEventListener('abort', cancel)
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

function projectLoopMessages(messages: readonly RequestMessage[]): DeepSeekMessage[] {
  return messages.flatMap((message): DeepSeekMessage[] => {
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
    if (message.role === 'assistant') {
      return [{ role: 'assistant', content: text || null,
        reasoning_content: message.content.filter(b => b.type === 'reasoning').map(b => b.text).join('\n') || null,
        tool_calls: message.content.filter(b => b.type === 'tool-call').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: b.arguments } })) }]
    }
    if (message.role === 'tool') {
      return [{ role: 'tool', tool_call_id: message.toolCallId, content: text }]
    }
    return text ? [{ role: message.role === 'system' || message.role === 'developer' ? 'system' : 'user', content: text }] : []
  })
}
