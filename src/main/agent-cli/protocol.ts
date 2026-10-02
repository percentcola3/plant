import { randomUUID } from 'node:crypto'
import type { CliAiProvider } from '../../shared/ai-provider'
import type { StreamJsonEvent } from '../claude-headless/spawn-turn'

export const CLI_COMMANDS: Record<CliAiProvider, string> = {
  'codex-cli': 'codex', 'opencode-cli': 'opencode', 'pi-cli': 'pi'
}

export function cliLaunchArgs(provider: CliAiProvider, input: {
  nativeSessionId?: string; piSessionPath: string; images: string[]; addDirs: string[]
}): string[] {
  if (provider === 'codex-cli') {
    const args = ['exec', ...(input.nativeSessionId ? ['resume', input.nativeSessionId] : []), '--json', '--skip-git-repo-check']
    if (!input.nativeSessionId) args.push('--sandbox', 'workspace-write', ...input.addDirs.flatMap(dir => ['--add-dir', dir]))
    args.push(...input.images.flatMap(path => ['--image', path]), '-')
    return args
  }
  if (provider === 'opencode-cli') return ['run', '--format', 'json', ...(input.nativeSessionId ? ['--session', input.nativeSessionId] : []), ...input.images.flatMap(path => ['--file', path])]
  return ['--print', '--mode', 'json', '--session', input.piSessionPath, ...input.images.map(path => `@${path}`)]
}

type WireEvent = Record<string, any>
type Block = NonNullable<StreamJsonEvent['message']>['content'][number]
function message(role: 'assistant' | 'user', content: Block[]): StreamJsonEvent {
  return { type: role, uuid: randomUUID(), message: { role, content } }
}
function tool(id: string, name: string, input: unknown, output: unknown, isError = false): StreamJsonEvent[] {
  return [message('assistant', [{ type: 'tool_use', id, name, input }]),
    message('user', [{ type: 'tool_result', tool_use_id: id, content: typeof output === 'string' ? output : JSON.stringify(output ?? ''), is_error: isError }])]
}

// Each CLI's completed records are authoritative; deltas must not duplicate them.
export function normalizeCliEvent(provider: CliAiProvider, raw: WireEvent): {
  events: StreamJsonEvent[]; nativeSessionId?: string; error?: string; completed?: boolean
} {
  const events: StreamJsonEvent[] = []
  const out: ReturnType<typeof normalizeCliEvent> = { events }
  if (provider === 'codex-cli') {
    if (raw.type === 'thread.started') out.nativeSessionId = raw.thread_id
    if (raw.type === 'turn.completed') out.completed = true
    if (raw.type === 'turn.failed' || raw.type === 'error') out.error = raw.error?.message ?? raw.message ?? 'Codex 执行失败'
    if (raw.type === 'item.completed') {
      const item = raw.item ?? {}
      if (item.type === 'agent_message') events.push(message('assistant', [{ type: 'text', text: item.text ?? '' }]))
      else if (item.type === 'reasoning') events.push(message('assistant', [{ type: 'thinking', thinking: item.text ?? '' }]))
      else if (['command_execution', 'file_change', 'mcp_tool_call', 'web_search'].includes(item.type)) {
        events.push(...tool(item.id, item.type, item.command ?? item.arguments ?? item.changes ?? item.query, item.aggregated_output ?? item.result ?? item.changes, item.status === 'failed'))
      }
    }
  } else if (provider === 'opencode-cli') {
    if (raw.sessionID) out.nativeSessionId = raw.sessionID
    const part = raw.part ?? {}
    if (raw.type === 'text') events.push(message('assistant', [{ type: 'text', text: part.text ?? '' }]))
    if (raw.type === 'reasoning') events.push(message('assistant', [{ type: 'thinking', thinking: part.text ?? '' }]))
    if (raw.type === 'tool_use') events.push(...tool(part.callID ?? part.id, part.tool, part.state?.input, part.state?.output ?? part.state?.error, part.state?.status === 'error'))
    if (raw.type === 'step_finish' && part.reason === 'stop') out.completed = true
    if (raw.type === 'error') out.error = raw.error?.data?.message ?? raw.error?.message ?? 'OpenCode 执行失败'
  } else {
    if (raw.type === 'session') out.nativeSessionId = raw.id
    if (raw.type === 'agent_end' || raw.type === 'agent_settled') out.completed = !raw.willRetry
    if (raw.type === 'message_end') {
      const msg = raw.message ?? {}
      if (msg.role === 'assistant') {
        const content: Block[] = (msg.content ?? []).flatMap((b: WireEvent): Block[] => {
          if (b.type === 'text') return [{ type: 'text', text: b.text }]
          if (b.type === 'thinking') return [{ type: 'thinking', thinking: b.thinking }]
          if (b.type === 'toolCall') return [{ type: 'tool_use', id: b.id, name: b.name, input: b.arguments }]
          return []
        })
        if (content.length) events.push(message('assistant', content))
        if (msg.stopReason === 'error' || msg.stopReason === 'aborted') out.error = msg.errorMessage ?? 'Pi 执行失败'
      }
      if (msg.role === 'toolResult') events.push(message('user', [{ type: 'tool_result', tool_use_id: msg.toolCallId, content: (msg.content ?? []).filter((b: WireEvent) => b.type === 'text').map((b: WireEvent) => b.text).join('\n'), is_error: !!msg.isError }]))
    }
  }
  return out
}
