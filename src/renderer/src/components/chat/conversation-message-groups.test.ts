import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ConversationView.vue', import.meta.url), 'utf-8')

describe('ConversationView message hierarchy', () => {
  it('groups consecutive assistant messages into one visual response', () => {
    expect(source).toContain('const messageGroups = computed<MessageGroup[]>')
    expect(source).toContain("message.role === 'assistant' && previous?.role === 'assistant'")
    expect(source).toContain('v-for="group in messageGroups"')
    expect(source).toContain('class="msg-group"')
  })

  it('does not render disabled action rows for tool-only messages', () => {
    expect(source).toContain('function messageHasActionableText')
    expect(source).toContain('messageHasActionableText(msg)')
    expect(source).toContain('class="msg-segment"')
  })

  it('renders system messages as dividers instead of assistant cards', () => {
    expect(source).toContain("group.role === 'system'")
    expect(source).toContain('class="msg-system-line"')
  })

  it('renders a guided empty state instead of a placeholder sentence', () => {
    expect(source).toContain('告诉我你想完成什么')
    expect(source).toContain('描述目标，或添加图片和截图作为参考')
    expect(source).not.toContain('cv-empty__mention-hint')
    expect(source).toContain('class="cv-empty__icon"')
    expect(source).not.toContain('开始对话…')
  })

  it('uses the configured engine identity for assistant message cards', () => {
    expect(source).toContain("if (settings.aiProvider === 'deepseek-harness') return { name: 'Peeka', avatar: 'P' }")
    expect(source).toContain("if (settings.cliKind === 'claude') return { name: 'Claude', avatar: 'C' }")
    expect(source).toContain("return { name: 'DCC', avatar: 'D' }")
    expect(source).toContain('{{ assistantIdentity.name }}')
    expect(source).toContain('{{ assistantIdentity.avatar }}')
  })
})
