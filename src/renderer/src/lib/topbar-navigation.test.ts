import { describe, expect, it } from 'vitest'
import {
  isTopBarHomeActive,
  isTopBarTabClosable,
  resolveTopBarAddAction,
  resolveTopBarTabTitle,
  shouldShowTopBarContextTab,
} from './topbar-navigation'

describe('topbar navigation', () => {
  it('prefers preview and editor titles for the active tab', () => {
    expect(resolveTopBarTabTitle({
      workspaceName: 'SaaS',
      workspaceKind: 'ux',
      currentView: 'project-home',
      uxActiveNode: 'outputs',
      outputsFirstProject: true,
      previewTabTitle: '移动端支持直接点餐',
      previewActive: true,
      editorTitle: null,
      editorOpen: false,
      externalAlias: null,
    })).toBe('移动端支持直接点餐')

    expect(resolveTopBarTabTitle({
      workspaceName: 'SaaS',
      workspaceKind: 'ux',
      currentView: 'project-home',
      uxActiveNode: 'outputs',
      outputsFirstProject: true,
      previewTabTitle: null,
      previewActive: false,
      editorTitle: 'README.md',
      editorOpen: true,
      externalAlias: null,
    })).toBe('README.md')
  })

  it('marks home active only on the project landing view', () => {
    expect(isTopBarHomeActive({
      previewActive: false,
      editorOpen: false,
      currentView: 'project-home',
      uxActiveNode: 'outputs',
      outputsFirstProject: true,
    })).toBe(true)

    expect(isTopBarHomeActive({
      previewActive: false,
      editorOpen: false,
      currentView: 'project-home',
      uxActiveNode: 'assets',
      outputsFirstProject: true,
    })).toBe(false)
  })

  it('allows closing preview, editor, and non-home workspace tabs', () => {
    expect(isTopBarTabClosable({
      previewActive: true,
      editorOpen: false,
      currentView: 'project-home',
      uxActiveNode: 'outputs',
      outputsFirstProject: true,
      workspaceKind: 'ux',
    })).toBe(true)

    expect(isTopBarTabClosable({
      previewActive: false,
      editorOpen: false,
      currentView: 'project-home',
      uxActiveNode: 'assets',
      outputsFirstProject: true,
      workspaceKind: 'ux',
    })).toBe(true)

    expect(isTopBarTabClosable({
      previewActive: false,
      editorOpen: false,
      currentView: 'project-home',
      uxActiveNode: 'outputs',
      outputsFirstProject: true,
      workspaceKind: 'ux',
    })).toBe(false)
  })

  it('hides the placeholder context tab on the project home landing view', () => {
    expect(shouldShowTopBarContextTab({
      homeActive: true,
      previewActive: false,
      editorOpen: false,
    })).toBe(false)

    expect(shouldShowTopBarContextTab({
      homeActive: false,
      previewActive: false,
      editorOpen: false,
    })).toBe(true)
  })

  it('routes add actions to preview open, ux create product, or new workspace', () => {
    expect(resolveTopBarAddAction({
      previewActive: true,
      hasOpenProjectTabs: false,
      workspaceKind: 'ux',
      currentView: 'project-home',
      uxActiveNode: 'outputs',
      outputsFirstProject: true,
    })).toBe('open-project')

    expect(resolveTopBarAddAction({
      previewActive: false,
      hasOpenProjectTabs: true,
      workspaceKind: 'ux',
      currentView: 'project-home',
      uxActiveNode: 'outputs',
      outputsFirstProject: true,
    })).toBe('open-project')

    expect(resolveTopBarAddAction({
      previewActive: false,
      hasOpenProjectTabs: false,
      workspaceKind: 'ux',
      currentView: 'project-home',
      uxActiveNode: 'outputs',
      outputsFirstProject: true,
    })).toBe('create-product')

    expect(resolveTopBarAddAction({
      previewActive: false,
      hasOpenProjectTabs: false,
      workspaceKind: 'project',
      currentView: 'project-home',
      uxActiveNode: 'home',
      outputsFirstProject: false,
    })).toBe('new-workspace')
  })
})
