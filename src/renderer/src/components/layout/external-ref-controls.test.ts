import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workspaceSource = readFileSync(
  new URL('./ProjectAiConfigPanel.vue', import.meta.url),
  'utf-8'
)

const viewerSource = readFileSync(
  new URL('./ExternalRefViewer.vue', import.meta.url),
  'utf-8'
)

const addDialogSource = readFileSync(
  new URL('../dialogs/AddExternalRefDialog.vue', import.meta.url),
  'utf-8'
)

const mainWindowSource = readFileSync(
  new URL('../../views/MainWindow.vue', import.meta.url),
  'utf-8'
)

const uiStoreSource = readFileSync(
  new URL('../../stores/ui.ts', import.meta.url),
  'utf-8'
)

const aiConfigSource = readFileSync(
  new URL('./ProjectAiConfigPanel.vue', import.meta.url),
  'utf-8'
)

const resourceIndexSource = readFileSync(
  new URL('./ResourceIndexStatus.vue', import.meta.url),
  'utf-8'
)

const builtinPackagesSource = readFileSync(
  new URL('../../../../shared/builtin-resource-packages.ts', import.meta.url),
  'utf-8'
)

describe('external ref controls wiring', () => {
  it('project home exposes checkout switching without resource directory filtering actions', () => {
    expect(workspaceSource).toContain('switchExternalCheckout')
    expect(workspaceSource).toContain('toggleExternalBranchMenu')
    expect(workspaceSource).toContain('selectExternalBranch')
    expect(workspaceSource).toContain('filteredExternalBranches')
    expect(workspaceSource).toContain('onExternalBranchQueryInput')
    expect(workspaceSource).toContain('switchingExternal')
    expect(workspaceSource).toContain('ext.loadBranches')
    expect(workspaceSource).toContain('ext.switchCheckout')
    expect(workspaceSource).not.toContain('toggleKnowledgeDirMenu')
    expect(workspaceSource).not.toContain('loadKnowledgeDirOptions')
    expect(workspaceSource).not.toContain('selectKnowledgeVisibleDir')
    expect(workspaceSource).not.toContain('collectKnowledgeDirOptions')
    expect(workspaceSource).not.toContain('visibleDirsSummary')
    expect(workspaceSource).not.toContain('branchOptionsMessage')
    expect(workspaceSource).not.toContain('parseExternalCheckoutInput')
  })

  it('external checkout switching happens inline instead of through a global dialog', () => {
    expect(mainWindowSource).not.toContain('ExternalBranchSelectDialog')
    expect(uiStoreSource).not.toContain('externalBranchSelect')
    expect(uiStoreSource).not.toContain('askExternalBranchSelect')
    expect(workspaceSource).toContain('external-branch-menu')
    expect(workspaceSource).toContain('branch-search')
    expect(workspaceSource).toContain('搜索分支')
    expect(workspaceSource).toContain('v-for="branch in filteredExternalBranches')
    expect(workspaceSource).toContain('正在读取分支')
    expect(workspaceSource).toContain('没有匹配的分支')
    expect(workspaceSource).toContain('切换中')
    expect(workspaceSource).toContain('selected.trim()')
    expect(workspaceSource).toContain('请选择要切换的分支')
    expect(workspaceSource).not.toContain('ui.askExternalBranchSelect')
  })

  it('resource package cards hide directory and AI usage note actions', () => {
    expect(workspaceSource).not.toContain('knowledge-dir-menu')
    expect(workspaceSource).not.toContain('knowledge-dir-option')
    expect(workspaceSource).not.toContain('data-external-knowledge-dir-menu-root')
    expect(workspaceSource).not.toContain('editResourceUsageNote')
    expect(workspaceSource).not.toContain('AI 说明')
  })

  it('external viewer loads knowledge trees through filtered visibleDirs roots', () => {
    expect(viewerSource).toContain('visibleTreeRoots')
    expect(viewerSource).toContain('binding.value?.binding.visibleDirs')
    expect(viewerSource).toContain('workspace.listFiles')
  })

  it('external uikit assets show component preview cards that enter detail preview', () => {
    expect(viewerSource).toContain('buildComponentPreviewDetailUrl')
    expect(viewerSource).toContain('openExternalComponentPreview')
    expect(viewerSource).toContain('组件预览')
    expect(viewerSource).toContain(':src="componentDemoPreviewUrl(comp.demoPath)"')
    expect(viewerSource).toContain('@click="comp.hasDemo && openExternalComponentPreview(selectedLibrary.name, comp.name)"')
  })

  it('uses app themed surfaces for external uikit assets without return buttons', () => {
    expect(viewerSource).toContain('external-ref-viewer')
    expect(viewerSource).toContain('uikit-assets-view')
    expect(viewerSource).toContain('uikit-assets-view__sidebar')
    expect(viewerSource).toContain('uikit-assets-view__content')
    expect(viewerSource).toContain('background: var(--color-bg-base);')
    expect(viewerSource).toContain('background: var(--color-bg-panel);')
    expect(viewerSource).not.toContain('title="返回项目首页"')
    expect(viewerSource).not.toContain('‹ 返回</button>')
    expect(viewerSource).not.toContain('‹ 返回组件卡片</button>')
  })

  it('add external dialog does not ask for checkout during clone', () => {
    expect(addDialogSource).not.toContain('checkoutInput')
    expect(addDialogSource).not.toContain('parseExternalCheckoutInput')
    expect(addDialogSource).not.toContain('分支 / 标签 / 提交')
  })

  it('resource packages can be installed with AI usage files', () => {
    expect(addDialogSource).toContain('安装新资源包')
    expect(addDialogSource).toContain('ext.addToPool')
    expect(addDialogSource).toContain("code === 'SSH_KEY_REQUIRED'")
    expect(addDialogSource).toContain("ui.openSettings('ssh')")
    expect(addDialogSource).toContain('配置 SSH Key')
    expect(addDialogSource).toContain('AI_USAGE.md')
    expect(addDialogSource).toContain('usageNote')
    expect(addDialogSource).not.toContain('已安装资源包')
    expect(addDialogSource).not.toContain('从资源中心')
    expect(addDialogSource).not.toContain('BUILTIN_RESOURCE_PACKAGES')
    // 检索统一走 zg 混合索引：面板只有构建按钮，不再有 INDEX.md 编辑入口
    expect(aiConfigSource).not.toContain('openResourceIndex')
    expect(aiConfigSource).toContain('buildExternalIndex')
    expect(resourceIndexSource).toContain('zg检索')
    expect(resourceIndexSource).not.toContain('编辑索引')
  })

  it('shows builtin knowledge packages directly on the resource page', () => {
    expect(aiConfigSource).toContain('BUILTIN_RESOURCE_PACKAGES')
    expect(aiConfigSource).toContain('builtinKnowledgePackages')
    expect(aiConfigSource).toContain('builtinUikitPackages')
    expect(aiConfigSource).toContain('内置知识库')
    expect(aiConfigSource).toContain('内置 UX 资产')
    expect(builtinPackagesSource).toContain("alias: 'POS前端'")
    expect(builtinPackagesSource).toContain("alias: '管理端前端'")
    expect(builtinPackagesSource).toContain("alias: 'SaaSUI'")
    expect(builtinPackagesSource).toContain("category: 'uikit'")
    expect(aiConfigSource).toContain('installBuiltinResource')
    expect(aiConfigSource).toContain('Clone 并绑定')
    expect(aiConfigSource).toContain('builtin-knowledge-grid')
    expect(aiConfigSource).toContain('builtin-knowledge-card')
    expect(aiConfigSource).toContain('knowledge-resource-grid')
    expect(aiConfigSource).toContain('knowledge-resource-card')
    expect(aiConfigSource).toContain('knowledge-resource-actions')
    expect(aiConfigSource).toContain('<GitBranch')
    expect(aiConfigSource).toContain('.builtin-knowledge-head {')
    expect(aiConfigSource).toContain('color: var(--color-text-primary)')
    expect(aiConfigSource).not.toContain('color: #1d1d1f')
    expect(aiConfigSource).not.toContain('color: #6e6e73')
  })
})
