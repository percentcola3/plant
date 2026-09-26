import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const state = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData }
}))

import {
  appendDeepSeekEvent,
  deepSeekSessionTranscriptPath,
  hasDeepSeekTranscript,
  loadDeepSeekMessages,
  removeDeepSeekTranscript
} from './transcript'

const sessionId = '123e4567-e89b-42d3-a456-426614174000'

beforeEach(async () => {
  state.userData = await mkdtemp(join(tmpdir(), 'ui-client-deepseek-transcript-'))
})

afterEach(async () => {
  await rm(state.userData, { recursive: true, force: true })
})

describe('DeepSeek transcript', () => {
  it('reconstructs user text, reasoning, tool calls and tool results for the next turn', () => {
    appendDeepSeekEvent(sessionId, {
      type: 'user',
      uuid: 'user-event',
      message: { role: 'user', content: [{ type: 'text', text: '修改页面' }] }
    })
    appendDeepSeekEvent(sessionId, {
      type: 'assistant',
      uuid: 'assistant-event',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先读取文件' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'src/a.ts' } }
        ]
      }
    })
    appendDeepSeekEvent(sessionId, {
      type: 'user',
      uuid: 'tool-result-event',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '1\texport const a = 1' }]
      }
    })

    expect(hasDeepSeekTranscript(sessionId)).toBe(true)
    expect(deepSeekSessionTranscriptPath(sessionId)).toContain(`${sessionId}.jsonl`)
    expect(loadDeepSeekMessages(sessionId)).toEqual([
      { role: 'user', content: '修改页面' },
      {
        role: 'assistant',
        content: null,
        reasoning_content: '先读取文件',
        tool_calls: [{
          id: 'tool-1',
          type: 'function',
          function: { name: 'Read', arguments: '{"file_path":"src/a.ts"}' }
        }]
      },
      { role: 'tool', tool_call_id: 'tool-1', content: '1\texport const a = 1' }
    ])

    removeDeepSeekTranscript(sessionId)
    expect(hasDeepSeekTranscript(sessionId)).toBe(false)
  })

  it('skips reasoning-only failed answers when resuming an existing conversation', () => {
    appendDeepSeekEvent(sessionId, {
      type: 'assistant', uuid: 'failed-thinking',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'unfinished reasoning' }, { type: 'text', text: '   ' }] }
    })
    appendDeepSeekEvent(sessionId, {
      type: 'assistant', uuid: 'valid-answer',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'valid reasoning' }, { type: 'text', text: 'answer' }] }
    })
    expect(loadDeepSeekMessages(sessionId)).toEqual([
      { role: 'assistant', content: 'answer', reasoning_content: 'valid reasoning' }
    ])
    expect(hasDeepSeekTranscript(sessionId)).toBe(true)
  })

  it('preserves image attachments as OpenAI-compatible image_url blocks', () => {
    appendDeepSeekEvent(sessionId, {
      type: 'user',
      uuid: 'image-event',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: '看这张图' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }
        ]
      }
    })

    expect(loadDeepSeekMessages(sessionId)).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: '看这张图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }
      ]
    }])
  })
})
