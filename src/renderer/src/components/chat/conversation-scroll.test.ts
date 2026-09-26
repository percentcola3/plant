import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/chat/ConversationView.vue'),
  'utf-8'
)

describe('ConversationView scroll behavior', () => {
  it('does not force-scroll while the user is reading history', () => {
    expect(source).toContain('const shouldStickToBottom = ref(true)')
    expect(source).toContain('function onMessagesScroll')
    expect(source).toContain('function scrollMessagesToBottom')
    expect(source).toContain('if (!shouldStickToBottom.value) return')
    expect(source).toContain('@scroll="onMessagesScroll"')
  })
})
