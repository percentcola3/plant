import { describe, expect, it } from 'vitest'
import {
  buildComponentPreviewDetailUrl,
  buildProjectFilePreviewUrl,
  externalRefSourceText,
  isMarkdownPreviewPath
} from './external-preview'
import type { ExternalRef } from '@shared/types'

describe('external preview helpers', () => {
  it('detects markdown files for rendered preview', () => {
    expect(isMarkdownPreviewPath('.external/kb/a.md')).toBe(true)
    expect(isMarkdownPreviewPath('.external/kb/a.mdx')).toBe(true)
    expect(isMarkdownPreviewPath('.external/kb/a.markdown')).toBe(true)
  })

  it('keeps non-markdown files as raw text', () => {
    expect(isMarkdownPreviewPath('.external/kb/a.json')).toBe(false)
    expect(isMarkdownPreviewPath('.external/kb/a.yml')).toBe(false)
    expect(isMarkdownPreviewPath('.external/kb/a.txt')).toBe(false)
  })

  it('uses the external ref source for the inline header', () => {
    const gitRef = {
      id: 'ref-1',
      alias: 'pos',
      kind: 'git',
      category: 'knowledge',
      source: 'git@git.example.internal:example-team/pm-knowledge.git',
      poolPath: '/Users/me/.ui-client/external-pool/ref-1',
      addedAt: '2026-06-10T00:00:00.000Z'
    } satisfies ExternalRef
    const localRef = {
      ...gitRef,
      id: 'ref-2',
      kind: 'local',
      source: '/Users/me/docs',
      poolPath: '/Users/me/docs'
    } satisfies ExternalRef

    expect(externalRefSourceText(gitRef)).toBe('git@git.example.internal:example-team/pm-knowledge.git')
    expect(externalRefSourceText(localRef)).toBe('/Users/me/docs')
    expect(externalRefSourceText(null)).toBe('')
  })

  it('builds encoded project file preview urls under an external root', () => {
    expect(buildProjectFilePreviewUrl(
      'http://127.0.0.1:1234/preview/icons/ws-1?rootRel=.external/saas-ui',
      'ws 1',
      '.external/saas-ui',
      'styles/默认/theme light.css'
    )).toBe('http://127.0.0.1:1234/p/ws%201/.external/saas-ui/styles/%E9%BB%98%E8%AE%A4/theme%20light.css')
  })

  it('builds component detail preview urls without dropping query params', () => {
    expect(buildComponentPreviewDetailUrl(
      'http://127.0.0.1:1234/preview/components/ws-1?rootRel=.external/saas-ui&_t=1',
      'common lib',
      'sp button'
    )).toBe('http://127.0.0.1:1234/preview/components/ws-1?rootRel=.external/saas-ui&_t=1#/c/common%20lib/sp%20button')
  })
})
