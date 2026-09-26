import { describe, expect, it } from 'vitest'
import { loadChatDraft, saveChatDraft } from './drafts'

describe('chat drafts', () => {
  it('keeps project drafts isolated and returns defensive copies', () => {
    saveChatDraft('project-a', [{ type: 'text', text: 'A' }])
    saveChatDraft('project-b', [{ type: 'text', text: 'B' }])

    const projectA = loadChatDraft('project-a')
    expect(projectA).toEqual([{ type: 'text', text: 'A' }])
    expect(loadChatDraft('project-b')).toEqual([{ type: 'text', text: 'B' }])

    projectA[0] = { type: 'text', text: 'changed' }
    expect(loadChatDraft('project-a')).toEqual([{ type: 'text', text: 'A' }])
  })
})
