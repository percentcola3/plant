import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const composerSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/chat/ChatComposer.vue'),
  'utf-8'
)
const messageActionsSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/chat/MessageActions.vue'),
  'utf-8'
)
const conversationSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/chat/ConversationView.vue'),
  'utf-8'
)

describe('chat icon buttons', () => {
  it('renders composer controls as icon-only buttons with accessible names', () => {
    expect(composerSource).toContain('cc-icon-btn')
    expect(composerSource).toContain('cc-send-btn')
    expect(composerSource).toContain('cc-send-btn--idle')
    expect(composerSource).toContain('cc-send-btn--ready')
    expect(composerSource).toContain('--color-button-bg')
    expect(composerSource).toContain('Paperclip')
    expect(composerSource).toContain('cc-action-icon')
    expect(composerSource).toContain(":aria-label=\"turnInFlight ? '停止当前回合' : '发送消息'\"")
    expect(composerSource).toContain('aria-label="添加图片或截图"')
    expect(composerSource).toContain('accept="image/*"')
    expect(composerSource).toContain('粘贴截图')
    expect(composerSource).toContain('navigator.clipboard.read()')
    expect(composerSource).toContain('chipInputRef.value?.insertImages(images)')
    expect(composerSource).not.toContain('aria-label="新开会话"')
    expect(composerSource).not.toContain('>暂停</button>')
    expect(composerSource).not.toContain(">新会话</button>")
    expect(composerSource).not.toContain(">重启</button>")
  })

  it('keeps new conversation in the header without a status light', () => {
    expect(conversationSource).not.toContain('cv-status-indicator')
    expect(conversationSource).not.toContain('cv-status-dot')
    expect(conversationSource).not.toContain('statusIndicatorLabel')
    expect(conversationSource).toContain('class="cv-new-session"')
    expect(conversationSource).toContain('aria-label="新建对话"')
    expect(conversationSource).toContain('<Plus')
    expect(conversationSource).not.toContain('<SquarePen')
    expect(conversationSource).not.toContain('class="cv-status-label"')
  })

  it('shows only one copy action when a message is hovered or focused', () => {
    expect(messageActionsSource.match(/<button/g)).toHaveLength(1)
    expect(messageActionsSource).toContain('<Copy v-else')
    expect(messageActionsSource).toContain('ma-icon')
    expect(messageActionsSource).toContain('opacity: 0')
    expect(messageActionsSource).toContain('margin-top: 4px')
    expect(messageActionsSource).toContain('width: 22px')
    expect(messageActionsSource).toContain('width: 12px')
    expect(messageActionsSource).not.toContain('position: absolute')
    expect(messageActionsSource).not.toContain('top: -3px')
    expect(messageActionsSource).not.toContain('copyRichText')
    expect(messageActionsSource).not.toContain('saveAsDocument')
    expect(messageActionsSource).not.toContain('createdAtLabel')
    expect(messageActionsSource).not.toContain('resend')
    expect(conversationSource).toContain('.msg-segment:hover :deep(.msg-actions)')
    expect(conversationSource).toContain("v-if=\"group.role === 'assistant'\" class=\"msg-group-head\"")
    expect(conversationSource).not.toContain("group.role === 'user' ? '你' : 'Claude'")
  })
})
