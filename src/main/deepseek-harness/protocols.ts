import type { DeepSeekAssistantMessage, DeepSeekMessage } from './api'
import type { DeepSeekToolDefinition } from './tools'

type Block = Record<string, unknown>

export function messagesRequest(messages: DeepSeekMessage[], tools: DeepSeekToolDefinition[]): Record<string, unknown> {
  const turns: { role: 'user' | 'assistant'; content: Block[] }[] = []
  for (const message of messages) {
    if (message.role === 'system') continue
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const content: Block[] = []
    if (message.role === 'tool') content.push({ type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content })
    else if (typeof message.content === 'string' && message.content) content.push({ type: 'text', text: message.content })
    else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'text') content.push(part)
        else {
          const url = part.image_url.url
          const data = /^data:([^;]+);base64,(.+)$/s.exec(url)
          content.push({ type: 'image', source: data
            ? { type: 'base64', media_type: data[1], data: data[2] }
            : { type: 'url', url } })
        }
      }
    }
    if (message.role === 'assistant') {
      for (const call of message.tool_calls ?? []) content.push({ type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) })
    }
    if (!content.length) continue
    const last = turns[turns.length - 1]
    if (last?.role === role) last.content.push(...content)
    else turns.push({ role, content })
  }
  return {
    system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n'),
    messages: turns,
    max_tokens: 8192,
    ...(tools.length ? { tools: tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })), tool_choice: { type: 'auto' } } : {})
  }
}

export function responsesRequest(messages: DeepSeekMessage[], tools: DeepSeekToolDefinition[]): Record<string, unknown> {
  const input: Block[] = []
  for (const message of messages) {
    if (message.role === 'system') continue
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: message.content })
      continue
    }
    if (message.role === 'assistant') {
      if (message.content) input.push({ role: 'assistant', content: [{ type: 'output_text', text: message.content }] })
      for (const call of message.tool_calls ?? []) input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments })
    } else {
      input.push({ role: 'user', content: typeof message.content === 'string'
        ? [{ type: 'input_text', text: message.content }]
        : message.content.map(part => part.type === 'text' ? { type: 'input_text', text: part.text } : { type: 'input_image', image_url: part.image_url.url }) })
    }
  }
  return {
    instructions: messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n'),
    input,
    store: false,
    ...(tools.length ? { tools: tools.map(t => ({ type: 'function', ...t.function, strict: false })), tool_choice: 'auto' } : {})
  }
}

export function parseMessages(body: { content?: Block[]; stop_reason?: string }): DeepSeekAssistantMessage {
  if (!Array.isArray(body.content)) throw new Error('Plant 返回格式异常：缺少 content')
  if (body.stop_reason === 'max_tokens') throw new Error('模型输出达到长度上限，请缩小任务后重试')
  return {
    role: 'assistant',
    content: body.content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n') || null,
    tool_calls: body.content.filter(b => b.type === 'tool_use').map(b => {
      if (typeof b.id !== 'string' || typeof b.name !== 'string' || !b.input || typeof b.input !== 'object') throw new Error('Plant 返回了无效工具调用')
      return { id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }
    })
  }
}

export function parseResponses(body: { output?: Block[]; status?: string }): DeepSeekAssistantMessage {
  if (!Array.isArray(body.output) || (body.status && body.status !== 'completed')) throw new Error('Plant Responses 请求未完成或返回格式异常')
  const texts: string[] = []
  const calls: NonNullable<DeepSeekAssistantMessage['tool_calls']> = []
  for (const item of body.output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text)
        if (part.type === 'refusal' && typeof part.refusal === 'string') texts.push(part.refusal)
      }
    }
    if (item.type === 'function_call') {
      if (typeof item.call_id !== 'string' || typeof item.name !== 'string' || typeof item.arguments !== 'string') throw new Error('Plant 返回了无效工具调用')
      calls.push({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } })
    }
  }
  return { role: 'assistant', content: texts.join('\n') || null, tool_calls: calls }
}
