import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ProjectAiConfigPanel.vue', import.meta.url), 'utf-8')

describe('ProjectAiConfigPanel header', () => {
  it('uses the UX-style project header when not embedded', () => {
    expect(source).not.toContain('‹ 返回首页')
    expect(source).not.toContain('function back(): void')
    expect(source).not.toContain('ui.backToProjectHome()')
    expect(source).not.toContain('<h1 class="truncate text-base font-semibold">AI 配置</h1>')
    expect(source).toContain('<h2 class="truncate text-base font-semibold text-foreground">{{ active?.name }}</h2>')
    expect(source).toContain('>PM 项目</span>')
    expect(source).toContain('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] px-2.5 text-xs font-semibold text-primary shadow-sm')
    expect(source).toContain('{{ active?.path }}')
    expect(source).toContain('formatWorkspaceGitSummary')
    expect(source).toContain('gitSummary.branchLabel')
    expect(source).toContain('gitSummary.remoteLabel')
    expect(source).toContain('Git · 检查中')
  })
})
