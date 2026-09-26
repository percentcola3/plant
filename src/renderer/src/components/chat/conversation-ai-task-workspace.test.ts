import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/chat/ConversationView.vue'),
  'utf-8'
)

describe('ConversationView AI task submit handoff', () => {
  it('keeps the current workspace and follows the returned session only', () => {
    expect(source).toContain('async function activateSubmittedTaskWorkspace')
    expect(source).not.toContain('await projectsStore.refresh()')
    expect(source).not.toContain('await projectsStore.setActive(result.workspaceId)')
    expect(source).toContain('conversationStore.setActiveSession(result.sessionId)')
  })

  it('prepares a subscribed session before submitting a new task turn', () => {
    expect(source).toContain('prepareSubmitSession: [request: PrepareSubmitSessionRequest]')
    expect(source).toContain('sid = await prepareSubmitSession(targetDocument, targetWorkspace)')
    expect(source).toContain("const r = await call('claude.submit', { workspaceId, sessionId: sid")
  })
})
