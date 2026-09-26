import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ChipInput.vue', import.meta.url), 'utf-8')

describe('chip input resource label', () => {
  it('shows only the file name (with extension) on resource chips', () => {
    // alias 形如「库名/目录/文件.md」，标签只取最后一段
    expect(source).toContain("token.alias.split('/').filter(Boolean).pop() ?? token.alias")
    expect(source).toContain('class="chip-token__label"')
  })

  it('drops the 知识库 kind prefix badge', () => {
    expect(source).not.toContain('chip-token__kind')
    expect(source).not.toContain('mentionResourceKindLabel')
  })

  it('caps chip width with ellipsis and keeps the full path in title', () => {
    expect(source).toMatch(/\.chip-input \.chip-token\s*\{[^}]*max-width:\s*240px;/s)
    expect(source).toMatch(/\.chip-input \.chip-token > span\s*\{[^}]*text-overflow:\s*ellipsis;/s)
    expect(source).toContain('title="${escapeHtml(token.path)}"')
  })

  it('turns the @ trigger into a chip token instead of appending beside leftover text', () => {
    expect(source).toContain('insertTokenAtMentionTrigger(current, mentionQuery.value, token)')
    expect(source).not.toContain('[...current, token]')
  })
})
