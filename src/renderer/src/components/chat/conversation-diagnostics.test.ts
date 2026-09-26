import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Conversation diagnostics', () => {
  it('offers a contextual export action for failed AI turns', () => {
    const source = readFileSync(resolve(__dirname, 'ConversationView.vue'), 'utf8')

    expect(source).toContain('exportFailureDiagnostics')
    expect(source).toContain("call('diagnostics.export', { sessionId: sessionId.value")
    expect(source).toContain("turnState.status === 'error'")
    expect(source).toContain('导出诊断日志')
  })
})
