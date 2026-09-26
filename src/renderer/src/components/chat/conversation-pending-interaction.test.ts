import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/chat/ConversationView.vue'),
  'utf-8'
)

describe('ConversationView pending interactions', () => {
  it('does not present unanswered Claude questions as processed messages', () => {
    expect(source).toContain("import { hasPendingClaudeInteraction } from '@/lib/chat/pending-interactions'")
    expect(source).toContain('function messageHasPendingInteraction')
    expect(source).toContain('function groupHasPendingInteraction')
    expect(source).toContain("class=\"msg-processed msg-processed--waiting\"")
    expect(source).toContain("v-if=\"group.role === 'assistant' && groupHasPendingInteraction(group)\"")
    expect(source).toContain("!messageHasPendingInteraction(msg)")
  })
})
