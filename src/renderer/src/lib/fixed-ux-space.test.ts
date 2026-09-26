import { describe, expect, it } from 'vitest'
import { fixedUxSpaceSlug, isOutputsFirstUxProject } from './fixed-ux-space'

describe('fixed UX space policy', () => {
  it('pins every UX Git project to the shared ux-shared space', () => {
    expect(isOutputsFirstUxProject({ kind: 'ux', name: 'Saas2' })).toBe(true)
    expect(fixedUxSpaceSlug({ kind: 'ux', name: 'Saas2' })).toBe('ux-shared')
    expect(fixedUxSpaceSlug({ kind: 'ux', name: 'SaaS' })).toBe('ux-shared')
    expect(fixedUxSpaceSlug({ kind: 'ux', name: 'Another UX project' })).toBe('ux-shared')
  })

  it('recognizes UX projects with outputs/ as outputs-first', () => {
    expect(isOutputsFirstUxProject(
      { kind: 'ux', name: 'Another UX project' },
      { kind: 'ux', hasOutputsDir: true, warnings: [], assetLibraries: [], designSystemAssets: [], hasComponentsDir: true, hasDesignSystemsDir: false, hasAssetsDir: true, personalSpace: null }
    )).toBe(true)
  })

  it('does not affect non-UX Git projects', () => {
    expect(isOutputsFirstUxProject({ kind: 'project', name: 'Saas2' })).toBe(false)
    expect(isOutputsFirstUxProject(null)).toBe(false)
    expect(fixedUxSpaceSlug({ kind: 'project', name: 'Saas2' })).toBeNull()
    expect(fixedUxSpaceSlug(null)).toBeNull()
  })
})
