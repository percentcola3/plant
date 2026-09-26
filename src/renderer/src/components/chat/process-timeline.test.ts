import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ProcessTimeline.vue', import.meta.url), 'utf-8')

describe('process timeline', () => {
  it('converges thinking into a single pill with a live shimmer state', () => {
    expect(source).toContain("if (props.thinkingStreaming) return '思考中'")
    expect(source).toContain('已思考 ${')
    // 历史回放没观察到流式时不编造时长
    expect(source).toContain(": '思考过程'")
    expect(source).toContain('sawStreaming')
    expect(source).toContain('chat-shimmer')
  })

  it('renders tool calls as single-line timeline nodes with vertical track', () => {
    expect(source).toContain('.ptimeline::before')
    expect(source).toContain('class="pt-dot"')
    expect(source).toContain('class="pt-row"')
    // 单行节点：标题 + 摘要 + chevron，点击展开 ToolCall 详情
    expect(source).toContain('function toggleNode(index: number)')
    expect(source).toContain('<ToolCall')
  })

  it('keeps tool nodes visible while running and folds them when done', () => {
    expect(source).toContain('props.running || props.expanded')
    expect(source).toContain("const showToolNodes = computed(() => props.running || props.expanded)")
  })

  it('shows the merged thinking text only when expanded, in compact style', () => {
    expect(source).toContain('v-if="expanded && trimmedText" class="pt-thinking-body"')
    expect(source).toContain('font-size: 11px;')
    expect(source).toContain('line-height: 1.5;')
  })
})
