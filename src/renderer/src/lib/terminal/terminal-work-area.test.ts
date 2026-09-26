import { describe, expect, it } from 'vitest'
import { resolveClaudeWorkAreaFromTargets } from './terminal-work-area'

describe('resolveClaudeWorkAreaFromTargets', () => {
  it('maps PM feature file tabs to feature work area', () => {
    expect(resolveClaudeWorkAreaFromTargets({
      workspaceKind: 'project',
      preview: { type: 'files', rootRelPath: 'features/payments' }
    })).toEqual({ kind: 'feature', relPath: 'features/payments' })
  })

  it('maps PM feature product previews to feature work area', () => {
    expect(resolveClaudeWorkAreaFromTargets({
      workspaceKind: 'project',
      preview: { type: 'product', path: 'features/payments' }
    })).toEqual({ kind: 'feature', relPath: 'features/payments' })
  })

  it('keeps UX products and components on their existing work area kinds', () => {
    expect(resolveClaudeWorkAreaFromTargets({
      workspaceKind: 'ux',
      preview: { type: 'product', path: 'outputs/login' }
    })).toEqual({ kind: 'ui-product', relPath: 'outputs/login' })

    expect(resolveClaudeWorkAreaFromTargets({
      workspaceKind: 'ux',
      preview: { type: 'component', path: 'components/form/input' }
    })).toEqual({ kind: 'ui-component', relPath: 'components/form/input' })
  })

  it('falls back to the current editable document', () => {
    expect(resolveClaudeWorkAreaFromTargets({
      workspaceKind: 'project',
      targetDocument: { relPath: 'docs/prd.md' }
    })).toEqual({ kind: 'document', relPath: 'docs/prd.md' })
  })
})
