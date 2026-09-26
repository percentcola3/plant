import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const groupSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/chat/ToolGroup.vue'),
  'utf-8'
)
const callSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/chat/ToolCall.vue'),
  'utf-8'
)

describe('tool call layout', () => {
  it('keeps command labels and status on their own stable lines', () => {
    expect(groupSource).toContain('class="tg-main"')
    expect(groupSource).toContain('class="tg-title-row"')
    expect(groupSource).toContain('class="tg-detail-row"')
    expect(groupSource).toMatch(/\.tg-main\s*\{[^}]*display:\s*grid;/)
    expect(groupSource).toContain('white-space: nowrap;')

    expect(callSource).toMatch(/\.tc-main\s*\{[^}]*display:\s*grid;/)
    expect(callSource).toContain('.tc-name-row')
    expect(callSource).toContain('.tc-summary-row')
  })

  it('collapses tool cards to a single header line (result body only when expanded)', () => {
    // tc-result 必须在 v-show 折叠体内：收起态只剩标题行，正文/结果不可见
    const bodyStart = callSource.indexOf('v-show="!collapsed" class="tc-body"')
    const resultPos = callSource.indexOf('class="tc-result"')
    expect(bodyStart).toBeGreaterThan(-1)
    expect(resultPos).toBeGreaterThan(bodyStart)
    // 授权提醒仍要在折叠体外常显（需要用户行动）
    const approvalPos = callSource.indexOf('class="tc-approval"')
    expect(approvalPos).toBeGreaterThan(-1)
    expect(approvalPos).toBeLessThan(bodyStart)
  })
})
