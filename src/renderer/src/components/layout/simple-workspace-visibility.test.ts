import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const topBarSource = readFileSync(new URL('./TopBar.vue', import.meta.url), 'utf-8')
const featuresSource = readFileSync(new URL('./FeaturesPage.vue', import.meta.url), 'utf-8')
const aiConfigSource = readFileSync(new URL('./ProjectAiConfigPanel.vue', import.meta.url), 'utf-8')

describe('simple workspace visibility', () => {
  it('gates project Git status behind capability detection', () => {
    expect(topBarSource).toContain("call('git.capability'")
    expect(topBarSource).toContain('shouldRequestWorkspaceGitStatus')
    expect(featuresSource).toContain("call('git.capability'")
    expect(featuresSource).toContain('shouldRequestWorkspaceGitStatus')
    expect(aiConfigSource).toContain("call('git.capability'")
    expect(aiConfigSource).toContain('shouldRequestWorkspaceGitStatus')
  })

  it('offers Git binding and hides personal spaces for simple projects', () => {
    expect(featuresSource).toContain("call('git.bind'")
    expect(featuresSource).toContain("call('git.remoteBranches'")
    expect(featuresSource).toContain('绑定远端 Git')
    expect(featuresSource).toContain('v-if="isGitUnbound"')
    expect(featuresSource).toContain('v-if="gitCapability?.state === \'remote\'"')
    expect(featuresSource).toContain('gitSummary.branchLabel')
    expect(featuresSource).toContain('supportsLegacyCollaboration')
    expect(aiConfigSource).toContain('supportsPersonalSpaces')
  })
})
