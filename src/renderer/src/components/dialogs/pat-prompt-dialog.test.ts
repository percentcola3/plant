import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('./PATPromptDialog.vue', import.meta.url),
  'utf-8'
)

describe('PAT prompt dialog', () => {
  it('labels HTTPS git credentials as password or token', () => {
    expect(source).toContain('输入密码 / 访问令牌')
    expect(source).toContain('密码或 Personal Access Token')
  })
})
