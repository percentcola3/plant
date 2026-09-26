import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf-8')
const storeSource = readFileSync(new URL('./workspaces.ts', import.meta.url), 'utf-8')
const contractSource = readFileSync(new URL('../../../shared/ipc-contract.ts', import.meta.url), 'utf-8')
const rawServerSource = readFileSync(new URL('../../../main/raw/server.ts', import.meta.url), 'utf-8')
const workspaceServiceSource = readFileSync(new URL('../../../main/workspaces/service.ts', import.meta.url), 'utf-8')
const resourcePanelSource = readFileSync(new URL('../components/layout/ProjectAiConfigPanel.vue', import.meta.url), 'utf-8')

describe('default knowledge workspace bootstrap', () => {
  it('creates and binds the clip library while initializing the local workspace', () => {
    expect(appSource).not.toContain('workspaces.ensureDefaultKnowledgeWorkspace()')
    expect(storeSource).toContain("call('workspace.ensureDefaultKnowledge'")
    expect(contractSource).toContain("'workspace.ensureDefaultKnowledge'")
    expect(workspaceServiceSource).toContain('ensureDefaultClipLibraryBinding(workspace)')
    expect(workspaceServiceSource).toContain('await attachExternalRef(workspace.id, clipsRef.id)')
  })

  it('uses the same default knowledge workspace fallback when saving from the browser extension', () => {
    expect(rawServerSource).toContain('ensureDefaultKnowledgeWorkspace')
    expect(rawServerSource).not.toContain('剪页库尚未创建，请先在 App 左下角点击"剪页库"入口创建')
  })

  it('removes the manual clip installation action and labels UX actions as add', () => {
    expect(resourcePanelSource).not.toContain('安装剪页资源包')
    expect(resourcePanelSource).not.toContain('attachGlobalKnowledgeWorkspace')
    expect(resourcePanelSource).toContain("defaultCategory: 'uikit'")
    expect(resourcePanelSource).toContain('<span>添加</span>')
  })
})
