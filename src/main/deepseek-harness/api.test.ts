import { describe, expect, it } from 'vitest'
import { createDeepSeekCompletion, DEEPSEEK_API_URL, DEEPSEEK_MODEL, DEEPSEEK_VISION_MODEL } from './api'

describe('createDeepSeekCompletion', () => {
  it('uses the official chat-completions endpoint and keeps thinking/tool settings enabled', async () => {
    let captured: RequestInit | undefined
    const result = await createDeepSeekCompletion({
      apiKey: 'sk-test-secret',
      messages: [{ role: 'user', content: '请检查文件' }],
      tools: [],
      signal: new AbortController().signal,
      fetchImpl: async (_url, init) => {
        captured = init
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '好的' } }]
        }), { status: 200 })
      }
    })

    expect(result).toMatchObject({ role: 'assistant', content: '好的' })
    expect(captured?.headers).toMatchObject({ Authorization: 'Bearer sk-test-secret' })
    expect(JSON.parse(String(captured?.body))).toMatchObject({
      model: 'deepseek-flash',
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
      tool_choice: 'auto'
    })
    expect(DEEPSEEK_API_URL).toBe('https://api.deepseek.com/chat/completions')
    expect(DEEPSEEK_MODEL).toBe('deepseek-flash')
  })

  it('turns an authentication failure into an actionable error without exposing the key', async () => {
    await expect(createDeepSeekCompletion({
      apiKey: 'sk-secret-value',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      signal: new AbortController().signal,
      fetchImpl: async () => new Response('{"error":{"message":"invalid key"}}', { status: 401 })
    })).rejects.toThrow('API key 无效')
  })

  it('selects the vision model when a message contains an image data URL', async () => {
    let captured: RequestInit | undefined
    await createDeepSeekCompletion({
      apiKey: 'sk-test-secret',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '分析这张截图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }
        ]
      }],
      tools: [],
      signal: new AbortController().signal,
      fetchImpl: async (_url, init) => {
        captured = init
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '已看到图片' } }]
        }), { status: 200 })
      }
    })

    const body = JSON.parse(String(captured?.body))
    expect(body.model).toBe(DEEPSEEK_VISION_MODEL)
    expect(body.model).toBe('deepseek-flash')
    expect(body.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,aGVsbG8=' }
    })
  })
})

it.each(['messages', 'responses'] as const)('adapts %s tool calls and images for the LLM proxy', async (protocol) => {
  let url: unknown
  let body: any
  const result = await createDeepSeekCompletion({
    apiKey: 'proxy-key', connection: { baseUrl: 'http://llm-proxy.example.com', protocol, model: 'deepseek-v4-pro', visionModel: 'gpt-5.6-sol' },
    messages: [
      { role: 'system', content: 'instructions' },
      { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] },
      { role: 'assistant', content: null, tool_calls: [{ type: 'function', id: 'call1', function: { name: 'read_file', arguments: '{"path":"a"}' } }] },
      { role: 'tool', tool_call_id: 'call1', content: 'contents' }
    ],
    tools: [{ type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} } } }],
    signal: new AbortController().signal,
    fetchImpl: async (target, init) => {
      url = target; body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify(protocol === 'messages'
        ? { content: [{ type: 'tool_use', id: 'call2', name: 'read_file', input: { path: 'b' } }] }
        : { status: 'completed', output: [{ type: 'function_call', call_id: 'call2', name: 'read_file', arguments: '{"path":"b"}' }] }))
    }
  })
  expect(url).toBe(`http://llm-proxy.example.com${protocol === 'messages' ? '/v1/messages' : '/responses'}`)
  expect(body.model).toBe('gpt-5.6-sol')
  expect(body.thinking).toBeUndefined()
  expect(result.tool_calls?.[0].function.arguments).toBe('{"path":"b"}')
  if (protocol === 'messages') {
    expect(body.messages[0].content[1].source).toEqual({ type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' })
    expect(body.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'call1' })
  } else {
    expect(body.store).toBe(false)
    expect(body.input[0].content[1].type).toBe('input_image')
    expect(body.input[2]).toMatchObject({ type: 'function_call_output', call_id: 'call1' })
  }
})


it('omits empty assistant history while preserving valid reasoning and tool exchanges', async () => {
  const toolCall = { type: 'function' as const, id: 'read-1', function: { name: 'Read', arguments: '{}' } }
  let body: any
  await createDeepSeekCompletion({
    apiKey: 'test-key', signal: new AbortController().signal, tools: [],
    messages: [
      { role: 'user', content: 'read file' },
      { role: 'assistant', content: null, reasoning_content: 'need a tool', tool_calls: [toolCall] },
      { role: 'tool', tool_call_id: 'read-1', content: 'file contents' },
      { role: 'assistant', content: null, reasoning_content: 'unfinished', tool_calls: [] },
      { role: 'assistant', content: '   ' },
      { role: 'user', content: 'continue' }
    ],
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'done' } }] }))
    }
  })
  expect(body.messages).toEqual([
    { role: 'user', content: 'read file' },
    { role: 'assistant', content: null, reasoning_content: 'need a tool', tool_calls: [toolCall] },
    { role: 'tool', tool_call_id: 'read-1', content: 'file contents' },
    { role: 'user', content: 'continue' }
  ])
})
