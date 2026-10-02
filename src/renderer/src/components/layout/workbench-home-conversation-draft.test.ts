import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const terminalSource = readFileSync(new URL('./TerminalPane.vue', import.meta.url), 'utf-8')
const conversationSource = readFileSync(new URL('../chat/ConversationView.vue', import.meta.url), 'utf-8')
const composerSource = readFileSync(new URL('../chat/ChatComposer.vue', import.meta.url), 'utf-8')

describe('workbench home conversation draft', () => {
  it('prefills the composer and auto-submits once the session is ready', () => {
    const draftWatcherStart = conversationSource.indexOf('watch(() => props.initialDraft')
    const draftWatcherEnd = conversationSource.indexOf('async function onSubmitInteraction')
    const draftWatcher = conversationSource.slice(draftWatcherStart, draftWatcherEnd)

    expect(draftWatcher).toContain('composerRef.value.replaceTextDraft(draft.text)')
    expect(draftWatcher).toContain('uiStore.consumeConversationDraft(draft.id)')
    // 等面板会话就绪后再发，避免和挂载期的 initUiMode 并发争抢 activeSession
    expect(draftWatcher).toContain("watch(() => [props.claudeStatus === 'ok', pendingAutoSubmitText.value] as const")
    expect(draftWatcher).toContain('composerRef.value?.submitDraft()')
    expect(draftWatcher).toContain('conversationStore.currentTurnInFlight')
    expect(composerSource).toContain("draft.value = [{ type: 'text', text: value }]")
    expect(composerSource).toContain('function submitDraft(): boolean {')
    expect(composerSource).toContain('if (turnInFlight.value) return false')
  })
})
