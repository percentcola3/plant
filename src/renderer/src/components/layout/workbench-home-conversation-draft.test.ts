import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const homeSource = readFileSync(new URL('./WorkbenchHome.vue', import.meta.url), 'utf-8')
const terminalSource = readFileSync(new URL('./TerminalPane.vue', import.meta.url), 'utf-8')
const conversationSource = readFileSync(new URL('../chat/ConversationView.vue', import.meta.url), 'utf-8')
const composerSource = readFileSync(new URL('../chat/ChatComposer.vue', import.meta.url), 'utf-8')

describe('workbench home conversation draft', () => {
  it('aligns recent project cards with project management preview cards', () => {
    expect(homeSource).toContain('class="product-card__preview"')
    expect(homeSource).toContain('class="product-card__preview-cover"')
    expect(homeSource).toContain('class="product-card__preview-tag">SAAS</span>')
    expect(homeSource).toContain('class="product-card__preview-title-text">{{ card.name }}</span>')
    expect(homeSource).toContain('projectPreviewDetails(card)')
    expect(homeSource).toContain("url('@/assets/project-preview-bg.png')")
    expect(homeSource).not.toContain('project-card__icon')
    expect(homeSource).not.toContain('project-card__arrow')
  })

  it('queues the project description as a draft after creating the project', () => {
    expect(homeSource).toContain('ui.queueConversationDraft(instruction)')
    expect(homeSource).not.toContain('ui.queueConversationPrompt(instruction)')
    expect(terminalSource).toContain(':initial-draft="uiStore.pendingConversationDraft"')
  })

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

describe('workbench home project naming', () => {
  it('names new projects 无名 + index instead of deriving from the instruction', () => {
    expect(homeSource).toContain("index === 1 ? '无名' : `无名-${index}`")
    expect(homeSource).not.toContain('firstSentence')
    // 指令仍然完整交给 AI 面板驱动内容生成
    expect(homeSource).toContain('ui.queueConversationDraft(instruction)')
  })
})
