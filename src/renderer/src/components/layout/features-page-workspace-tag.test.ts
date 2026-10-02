import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./FeaturesPage.vue', import.meta.url), 'utf-8')

describe('FeaturesPage workspace tag', () => {
  it('uses the project-management header without legacy workspace metadata', () => {
    expect(source).not.toContain('‹ 返回首页')
    expect(source).not.toContain('function back(): void')
    expect(source).not.toContain('ui.backToProjectHome()')
    expect(source).toContain('workspaceId?: string; searchQuery?: string; actionsTarget?: string')
    expect(source).toContain('更多操作')
    expect(source).toContain('@click="createGroup"')
    expect(source).toContain('@click="importFeatureProject"')
    expect(source).toContain('@click="createFeature()"')
    expect(source).not.toContain('>PM 项目</span>')
    expect(source).not.toContain('hero-kind-tag')
    expect(source).not.toContain('{{ active?.path }}')
    expect(source).toContain('formatWorkspaceGitSummary')
    expect(source).toContain("gitCapability.value.state !== 'remote'")
    expect(source).toContain("call('git.remoteBranches'")
    expect(source).toContain('title: \'选择绑定分支\'')
    expect(source).toContain("branchesResult.code === 'SSH_KEY_REQUIRED'")
    expect(source).toContain("ui.openSettings('ssh')")
    expect(source).toContain('v-if="gitCapability?.state === \'remote\'"')
    expect(source).toContain('Git 已绑定')
    expect(source).toContain('gitSummary.branchLabel')
    expect(source).toContain('gitSummary.remoteLabel')
    expect(source).toContain('同步仓库')
    expect(source).toContain('同步整个仓库当前分支')
    expect(source).toContain('单个项目请在项目工作台点「提交」')
    expect(source).not.toContain('>同步 Git</Button>')
  })
})
