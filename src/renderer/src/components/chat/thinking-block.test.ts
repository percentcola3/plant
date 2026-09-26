import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ThinkingBlock.vue', import.meta.url), 'utf-8')
const messageContentSource = readFileSync(new URL('./MessageContent.vue', import.meta.url), 'utf-8')

describe('thinking block presentation', () => {
  it('keeps thinking text hidden when collapsed (no preview leak)', () => {
    // 收起态不允许再渲染思考文本预览：思考内容只有展开后可见
    expect(source).not.toContain('tb-preview')
    expect(source).toContain('v-show="expandedState && trimmed" class="tb-body"')
  })

  it('downgrades finished thinking to a borderless quiet row', () => {
    // 任务结束后收起态走 --quiet：无边框脚注行，只留"已深度思考 Ns"入口
    expect(source).toContain("'thinking-block--quiet': !streaming && !expanded")
    expect(source).toContain('.thinking-block--quiet {')
    expect(source).toContain('已深度思考')
  })

  it('keeps the active indicator while the turn is still streaming', () => {
    expect(source).toContain("'thinking-block--active': streaming")
    expect(source).toContain("props.streaming ? '思考中'")
    expect(source).toContain('chat-spinner')
  })

  it('still marks only the last block of an in-flight message as streaming', () => {
    expect(messageContentSource).toContain(
      ':streaming="streaming && i === content.length - 1"'
    )
  })

  it('renders dcc narration text blocks through the collapsed ThinkingBlock', () => {
    // dcc 链路思考以普通 text 到达：processText 时走折叠块而不是正文 markdown
    expect(messageContentSource).toContain('processText?: boolean')
    expect(messageContentSource).toContain(
      `<ThinkingBlock
          v-if="processText && !suppressProcess"`
    )
    // 过程块在组级合并渲染时消息内跳过，避免重复
    expect(messageContentSource).toContain('suppressProcess?: boolean')
  })

  it('computes the per-group conclusion and collapses narration in ConversationView', () => {
    const conversationSource = readFileSync(new URL('./ConversationView.vue', import.meta.url), 'utf-8')
    expect(conversationSource).toContain('findConclusionUuids(messageGroups.value)')
    expect(conversationSource).toContain(':process-text="isProcessNarration(msg)"')
    // 旁白消息不挂复制等操作栏、不挂单条 loading
    expect(conversationSource).toContain('v-if="!msg.inFlight && !isProcessNarration(msg) && !messageHasPendingInteraction(msg)')
    expect(conversationSource).toContain('msg.inFlight && !isProcessNarration(msg)')
  })

  it('merges all thinking/narration of a group into the process timeline', () => {
    const conversationSource = readFileSync(new URL('./ConversationView.vue', import.meta.url), 'utf-8')
    // 组级合并：ProcessTimeline 承载全部过程文本，N 轮思考收敛为一个胶囊
    expect(conversationSource).toContain('collectProcessTexts(group.messages, conclusionUuids.value)')
    expect(conversationSource).toContain(':thinking-texts="processTextsOf(group)"')
    expect(conversationSource).toContain(':thinking-streaming="groupProcessStreaming(group)"')
    expect(conversationSource).toContain("import ProcessTimeline from './ProcessTimeline.vue'")
  })

  it('treats executed commands as timeline nodes controlled by the process pill', () => {
    const conversationSource = readFileSync(new URL('./ConversationView.vue', import.meta.url), 'utf-8')
    // 工具命令进时间线节点：受控展开（expanded + toggle），交互问答不进时间线
    expect(conversationSource).toContain(':tool-entries="processToolEntries(group)"')
    expect(conversationSource).toContain(':running="groupInFlight(group)"')
    expect(conversationSource).toContain(':expanded="expandedProcessGroups.has(group.key)"')
    expect(conversationSource).toContain('@toggle="toggleProcessGroup(group.key)"')
    expect(conversationSource).toContain('!parseClaudeInteraction(pair.name, pair.input)')
    // 消息内的工具卡整体移除（交给时间线），交互问答卡不受影响
    expect(conversationSource).toContain(':hide-tool-calls="group.role === \'assistant\'"')
    expect(messageContentSource).not.toContain('v-if="!hideToolCalls" v-for="prompt in interactionPairs"')
  })

  it('renders the expanded thinking body in a compact style', () => {
    // 展开体更小更紧凑：11px / 1.5 行高 / muted 色
    expect(source).toContain('font-size: 11px; line-height: 1.5;')
    expect(source).toContain('color: var(--color-text-muted);')
    expect(source).toContain('padding: 6px 10px 8px;')
  })
})
