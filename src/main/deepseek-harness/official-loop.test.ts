import { describe, expect, it, vi } from 'vitest'
import { runOfficialDshTurn } from './official-loop'
import type { DeepSeekMessage } from './api'

const definition = { type: 'function' as const, function: { name: 'read_file', description: 'Read an allowed file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } }

describe('official DSH integration', () => {
  it('runs the official loop, dispatches restricted tools and includes prior history exactly once', async () => {
    const requests: DeepSeekMessage[][] = []
    const execute = vi.fn(async () => ({ content: 'file contents', isError: false }))
    const onToolResult = vi.fn()
    const result = await runOfficialDshTurn({
      sessionId: 'integration-test', workDir: '/tmp', signal: new AbortController().signal,
      messages: [{ role: 'system', content: 'Only use allowed files.' }, { role: 'user', content: 'previous question' }, { role: 'assistant', content: 'previous reply' }, { role: 'user', content: 'read file' }],
      toolbox: { definitions: [definition], execute },
      onAssistant: vi.fn(), onToolResult,
      request: async (messages) => {
        requests.push(messages)
        return requests.length === 1
          ? { role: 'assistant', content: null, tool_calls: [{ type: 'function', id: 'call-1', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] }
          : { role: 'assistant', content: 'finished' }
      }
    })
    expect(result).toBe('finished')
    expect(execute).toHaveBeenCalledWith('read_file', { path: 'a.txt' })
    expect(onToolResult).toHaveBeenCalledWith('call-1', 'file contents', false)
    expect(requests[1].filter(m => m.role === 'user' && m.content === 'read file')).toHaveLength(1)
    expect(requests[1]).toContainEqual({ role: 'tool', tool_call_id: 'call-1', content: 'file contents' })
    expect(requests[1][1]).toEqual({ role: 'user', content: 'previous question' })
  })

  it('returns permission failures to the model as tool errors', async () => {
    const onToolResult = vi.fn()
    let step = 0
    await runOfficialDshTurn({
      sessionId: 'denied-test', workDir: '/tmp', signal: new AbortController().signal,
      messages: [{ role: 'user', content: 'read private file' }],
      toolbox: { definitions: [definition], execute: async () => ({ content: 'Path outside allowed roots', isError: true }) },
      onAssistant: vi.fn(), onToolResult,
      request: async (messages) => {
        if (++step === 1) return { role: 'assistant', content: null, tool_calls: [{ type: 'function', id: 'denied-call', function: { name: 'read_file', arguments: '{"path":"/private"}' } }] }
        expect(messages.some(m => m.role === 'tool' && m.content.includes('Path outside allowed roots'))).toBe(true)
        return { role: 'assistant', content: 'Permission denied' }
      }
    })
    expect(onToolResult).toHaveBeenCalledWith('denied-call', expect.stringContaining('Path outside allowed roots'), true)
  })

  it('retries a reasoning-only response without publishing it or duplicating tools', async () => {
    const onAssistant = vi.fn()
    const request = vi.fn()
      .mockResolvedValueOnce({ role: 'assistant', content: null, reasoning_content: 'still thinking' })
      .mockResolvedValueOnce({ role: 'assistant', content: 'recovered answer' })
    const result = await runOfficialDshTurn({
      sessionId: 'empty-retry-test', workDir: '/tmp', signal: new AbortController().signal,
      messages: [{ role: 'user', content: 'answer the question' }],
      toolbox: { definitions: [], execute: vi.fn() }, request,
      onAssistant, onToolResult: vi.fn()
    })
    expect(result).toBe('recovered answer')
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][0]).toEqual(request.mock.calls[0][0])
    expect(onAssistant).toHaveBeenCalledTimes(1)
    expect(onAssistant.mock.calls[0][0].content).toBe('recovered answer')
  })

  it('stops after one retry when the model keeps returning no answer', async () => {
    const request = vi.fn(async () => ({ role: 'assistant' as const, content: null, reasoning_content: 'thinking only' }))
    const onAssistant = vi.fn()
    await expect(runOfficialDshTurn({
      sessionId: 'empty-failure-test', workDir: '/tmp', signal: new AbortController().signal,
      messages: [{ role: 'user', content: 'answer the question' }],
      toolbox: { definitions: [], execute: vi.fn() }, request,
      onAssistant, onToolResult: vi.fn()
    })).rejects.toThrow('模型连续两次未返回正文或工具调用')
    expect(request).toHaveBeenCalledTimes(2)
    expect(onAssistant).not.toHaveBeenCalled()
  })

  it('aborts the in-flight request and releases the runtime', async () => {
    const controller = new AbortController()
    const run = runOfficialDshTurn({
      sessionId: 'cancel-test', workDir: '/tmp', messages: [{ role: 'user', content: 'wait' }],
      signal: controller.signal, toolbox: { definitions: [], execute: vi.fn() }, onAssistant: vi.fn(), onToolResult: vi.fn(),
      request: async (_messages, signal) => {
        queueMicrotask(() => controller.abort())
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      }
    })
    await expect(run).rejects.toThrow()
  })
})
