import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { StreamJsonEvent } from '../claude-headless/spawn-turn'
import type { DeepSeekImageContent, DeepSeekMessage, DeepSeekToolCall } from './api'

export function deepSeekSessionTranscriptPath(sessionId: string): string {
  return transcriptPath(sessionId) ?? ''
}

export function hasDeepSeekTranscript(sessionId: string): boolean {
  const path = transcriptPath(sessionId)
  if (!path) return false
  try {
    return existsSync(path) && readFileSync(path).byteLength > 0
  } catch {
    return false
  }
}

export function appendDeepSeekEvent(sessionId: string, event: StreamJsonEvent): void {
  const path = transcriptPath(sessionId)
  if (!path) throw new Error('DeepSeek 会话存储不可用')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a', mode: 0o600 })
}

export function removeDeepSeekTranscript(sessionId: string): void {
  const path = transcriptPath(sessionId)
  if (path) rmSync(path, { force: true })
}

export function loadDeepSeekMessages(sessionId: string): DeepSeekMessage[] {
  let raw = ''
  const path = transcriptPath(sessionId)
  if (!path) return []
  try { raw = readFileSync(path, 'utf8') } catch { return [] }
  const messages: DeepSeekMessage[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let event: StreamJsonEvent
    try { event = JSON.parse(line) as StreamJsonEvent } catch { continue }
    if (event.type === 'user') appendUserMessages(messages, event)
    if (event.type === 'assistant') appendAssistantMessage(messages, event)
  }
  return messages
}

function transcriptPath(sessionId: string): string | null {
  try {
    const userData = app?.getPath?.('userData')
    return userData ? join(userData, 'deepseek-harness', 'sessions', `${sessionId}.jsonl`) : null
  } catch {
    return null
  }
}

function appendUserMessages(messages: DeepSeekMessage[], event: StreamJsonEvent): void {
  const content = event.message?.content ?? []
  const toolResults = content.filter((block) => block.type === 'tool_result')
  if (toolResults.length === content.length && toolResults.length > 0) {
    for (const block of toolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: block.tool_use_id ?? '',
        content: stringifyToolResult(block.content)
      })
    }
    return
  }
  const text = content
    .map((block) => block.type === 'text'
      ? block.text ?? ''
      : '')
    .filter(Boolean)
    .join('\n\n')
  const images: DeepSeekImageContent[] = content
    .filter((block) => block.type === 'image' && block.source?.type === 'base64')
    .map((block) => ({
      type: 'image_url',
      image_url: { url: `data:${block.source!.media_type};base64,${block.source!.data}` }
    }))
  if (images.length > 0) {
    messages.push({
      role: 'user',
      content: [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...images
      ]
    })
  } else if (text) {
    messages.push({ role: 'user', content: text })
  }
}

function appendAssistantMessage(messages: DeepSeekMessage[], event: StreamJsonEvent): void {
  const content = event.message?.content ?? []
  const text = content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n\n')
  const reasoning = content.filter((block) => block.type === 'thinking').map((block) => block.thinking ?? '').join('\n\n')
  const toolCalls: DeepSeekToolCall[] = content
    .filter((block) => block.type === 'tool_use' && !!block.id && !!block.name)
    .map((block) => ({
      id: block.id!,
      type: 'function',
      function: { name: block.name!, arguments: JSON.stringify(block.input ?? {}) }
    }))
  // Older failed turns may have persisted reasoning without a valid answer.
  // Keep the transcript on disk, but never replay these invalid API messages.
  if (!text.trim() && toolCalls.length === 0) return
  messages.push({
    role: 'assistant',
    content: text || null,
    ...(reasoning ? { reasoning_content: reasoning } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
  })
}

function stringifyToolResult(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}
