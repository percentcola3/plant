import type { Workspace } from '@shared/types'

export type TopBarProjectView =
  | 'project-management'
  | 'project-home'
  | 'features-page'
  | 'ai-config'
  | 'skills-config'
  | 'external-view'
export type TopBarUxNode = 'home' | 'assets' | 'images' | 'outputs' | 'skills'
export type TopBarAddAction = 'create-product' | 'new-workspace' | 'open-project'

const UX_NODE_LABELS: Record<TopBarUxNode, string> = {
  home: '项目',
  outputs: '项目',
  assets: '组件资产',
  images: '图片',
  skills: 'AI 配置',
}

export function effectiveUxNode(
  uxActiveNode: TopBarUxNode,
  outputsFirstProject: boolean
): TopBarUxNode {
  return outputsFirstProject && uxActiveNode === 'home' ? 'outputs' : uxActiveNode
}

export function resolveTopBarTabTitle(input: {
  workspaceName: string | null
  workspaceKind: Workspace['kind'] | null
  currentView: TopBarProjectView
  uxActiveNode: TopBarUxNode
  outputsFirstProject: boolean
  previewTabTitle: string | null
  previewActive: boolean
  editorTitle: string | null
  editorOpen: boolean
  externalAlias: string | null
}): string {
  if (input.previewActive && input.previewTabTitle) return input.previewTabTitle
  if (input.editorOpen && input.editorTitle) return input.editorTitle
  if (input.currentView === 'features-page' || input.currentView === 'project-management') return '工作台'
  if (input.currentView === 'ai-config') return '知识库'
  if (input.currentView === 'skills-config') return '技能'
  if (input.currentView === 'external-view') return input.externalAlias ?? '外部库'
  if (input.workspaceKind === 'ux') {
    const node = effectiveUxNode(input.uxActiveNode, input.outputsFirstProject)
    return UX_NODE_LABELS[node] ?? input.workspaceName ?? '项目'
  }
  return input.workspaceName ?? '未选择工作区'
}

export function isTopBarHomeActive(input: {
  previewActive: boolean
  editorOpen: boolean
  currentView: TopBarProjectView
  uxActiveNode: TopBarUxNode
  outputsFirstProject: boolean
}): boolean {
  if (input.previewActive || input.editorOpen) return false
  if (input.currentView === 'project-management' || input.currentView === 'features-page') return true
  if (input.currentView !== 'project-home') return false
  const node = effectiveUxNode(input.uxActiveNode, input.outputsFirstProject)
  return node === 'home' || node === 'outputs'
}

export function isTopBarTabClosable(input: {
  previewActive: boolean
  editorOpen: boolean
  currentView: TopBarProjectView
  uxActiveNode: TopBarUxNode
  outputsFirstProject: boolean
  workspaceKind: Workspace['kind'] | null
}): boolean {
  if (input.previewActive || input.editorOpen) return true
  if (input.currentView === 'external-view') return true
  if (
    input.currentView === 'project-management'
    || input.currentView === 'features-page'
    || input.currentView === 'ai-config'
    || input.currentView === 'skills-config'
  ) return true
  if (input.currentView === 'project-home' && input.workspaceKind === 'ux') {
    const node = effectiveUxNode(input.uxActiveNode, input.outputsFirstProject)
    return node !== 'home' && node !== 'outputs'
  }
  return false
}

export function shouldShowTopBarContextTab(input: {
  homeActive: boolean
  previewActive: boolean
  editorOpen: boolean
}): boolean {
  return !input.homeActive && !input.previewActive && !input.editorOpen
}

export function resolveTopBarAddAction(input: {
  previewActive: boolean
  hasOpenProjectTabs: boolean
  workspaceKind: Workspace['kind'] | null
  currentView: TopBarProjectView
  uxActiveNode: TopBarUxNode
  outputsFirstProject: boolean
}): TopBarAddAction {
  if (input.previewActive || input.hasOpenProjectTabs) return 'open-project'
  if (
    input.workspaceKind === 'ux'
    && input.currentView === 'project-home'
  ) {
    const node = effectiveUxNode(input.uxActiveNode, input.outputsFirstProject)
    if (node === 'outputs' || node === 'home') return 'create-product'
  }
  return 'new-workspace'
}
