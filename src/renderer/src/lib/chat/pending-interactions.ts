import {
  isClaudeInteractionAnswerResult,
  parseClaudeInteraction,
  type ClaudeInteraction
} from '@shared/claude-interactions'
import type { AgentContentBlock } from './agent-events'

type PendingInteraction = {
  interaction: ClaudeInteraction
  resultContent?: unknown
}

export function hasPendingClaudeInteraction(content: AgentContentBlock[]): boolean {
  const interactions = new Map<string, PendingInteraction>()

  for (const block of content) {
    if (block.type === 'tool_use') {
      const interaction = parseClaudeInteraction(block.name, block.input)
      if (interaction) interactions.set(block.toolUseId, { interaction })
      continue
    }
    if (block.type === 'tool_result') {
      const pending = interactions.get(block.toolUseId)
      if (pending) pending.resultContent = block.content
    }
  }

  return Array.from(interactions.values()).some((pending) =>
    pending.resultContent === undefined ||
    !isClaudeInteractionAnswerResult(pending.interaction, pending.resultContent)
  )
}
