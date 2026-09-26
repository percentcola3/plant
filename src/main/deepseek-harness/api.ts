import { PEEKA_PRESETS, peekaEndpoint, type PeekaConnection } from '../../shared/peeka'
import { messagesRequest, responsesRequest, parseMessages, parseResponses } from './protocols'
import type { DeepSeekToolDefinition } from './tools'

export const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
export const DEEPSEEK_MODEL = PEEKA_PRESETS.official.model
export const DEEPSEEK_VISION_MODEL = PEEKA_PRESETS.official.visionModel

export type DeepSeekImageContent = {
  type: 'image_url'
  image_url: { url: string }
}

export type DeepSeekUserContent = string | Array<
  | { type: 'text'; text: string }
  | DeepSeekImageContent
>

export type DeepSeekToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type DeepSeekMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: DeepSeekUserContent }
  | {
      role: 'assistant'
      content: string | null
      reasoning_content?: string | null
      tool_calls?: DeepSeekToolCall[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

export type DeepSeekAssistantMessage = Extract<DeepSeekMessage, { role: 'assistant' }>

type CompletionResponse = {
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: DeepSeekToolCall[]
    }
  }>
}

export async function createDeepSeekCompletion(input: {
  apiKey: string
  connection?: PeekaConnection
  messages: DeepSeekMessage[]
  tools: DeepSeekToolDefinition[]
  signal: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<DeepSeekAssistantMessage> {
  const fetcher = input.fetchImpl ?? fetch
  const connection = input.connection ?? PEEKA_PRESETS.official
  const messages = input.messages.filter(message => message.role !== 'assistant'
    || !!message.content?.trim() || !!message.tool_calls?.length)
  const model = hasVisionInput(messages) && connection.visionModel ? connection.visionModel : connection.model
  const request = connection.protocol === 'messages' ? messagesRequest(messages, input.tools)
    : connection.protocol === 'responses' ? responsesRequest(messages, input.tools)
      : { messages, tools: input.tools, tool_choice: 'auto',
          ...(model.startsWith('deepseek-') ? { thinking: { type: 'enabled' }, reasoning_effort: 'high' } : {}) }
  const response = await fetcher(peekaEndpoint(connection), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
      ...(connection.protocol === 'messages' ? { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' } : {})
    },
    body: JSON.stringify({ model, ...request, stream: false }),
    signal: input.signal
  })

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 800)
    throw new Error(friendlyApiError(response.status, detail.split(input.apiKey).join('[REDACTED]')))
  }
  const body = await response.json()
  if (connection.protocol === 'messages') return parseMessages(body)
  if (connection.protocol === 'responses') return parseResponses(body)
  const completion = body as CompletionResponse
  if (completion.choices?.[0]?.finish_reason === 'length') throw new Error('模型输出达到长度上限，请缩小任务后重试')
  const message = completion.choices?.[0]?.message
  if (!message || message.role !== 'assistant') {
    throw new Error('DeepSeek 返回格式异常：缺少 assistant message')
  }
  return {
    role: 'assistant',
    content: typeof message.content === 'string' ? message.content : null,
    reasoning_content: typeof message.reasoning_content === 'string' ? message.reasoning_content : null,
    tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls.filter(isToolCall) : undefined
  }
}

function hasVisionInput(messages: DeepSeekMessage[]): boolean {
  return messages.some((message) => message.role === 'user'
    && Array.isArray(message.content)
    && message.content.some((part) => part.type === 'image_url'))
}

function isToolCall(value: DeepSeekToolCall): boolean {
  return !!value
    && value.type === 'function'
    && typeof value.id === 'string'
    && typeof value.function?.name === 'string'
    && typeof value.function?.arguments === 'string'
}

function friendlyApiError(status: number, detail: string): string {
  if (status === 401 || status === 403) return 'Peeka API key 无效或没有访问权限，请在设置中更新'
  if (status === 402) return 'API 账户余额不足，请充值后重试'
  if (status === 429) return 'Peeka 请求过于频繁，请稍后重试'
  const summary = safeErrorDetail(detail)
  return `Peeka API 请求失败（HTTP ${status}）${summary ? `：${summary}` : ''}`
}

function safeErrorDetail(detail: string): string {
  if (!detail) return ''
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: unknown } }
    return typeof parsed.error?.message === 'string' ? parsed.error.message.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 300) : ''
  } catch {
    return detail.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/\s+/g, ' ').trim().slice(0, 300)
  }
}
