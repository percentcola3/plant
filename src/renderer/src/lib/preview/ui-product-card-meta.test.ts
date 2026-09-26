import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildUiProductCardMeta,
  loadUiProductCardMeta,
  parseMetaJsonCardContent,
  patchOutputsTreeProductCard,
  productPreviewPeople,
  resolveProductPreviewTag,
  resolveProductPreviewTitle,
  resolveWorkbenchBrandTitle,
} from './ui-product-card-meta'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ui-product-card-meta', () => {
  it('builds card meta from trimmed inputs and drops empty fields', () => {
    expect(buildUiProductCardMeta({
      title: ' 移动端支持直接点餐 ',
      coverTag: ' saas ',
      uxName: '张裴',
      pmName: '  ',
    })).toEqual({
      title: '移动端支持直接点餐',
      coverTag: 'saas',
      uxName: '张裴',
    })
    expect(buildUiProductCardMeta({ coverTag: '  ' })).toBeNull()
  })

  it('resolves preview title from card meta or folder name', () => {
    expect(resolveProductPreviewTitle({ title: '移动端支持直接点餐' }, 'login-page')).toBe('移动端支持直接点餐')
    expect(resolveProductPreviewTitle(null, 'login-page')).toBe('login-page')
  })

  it('parses card metadata from meta.json content', () => {
    expect(parseMetaJsonCardContent(JSON.stringify({
      card: { title: '移动端支持直接点餐', coverTag: 'saas' },
    }))).toEqual({ title: '移动端支持直接点餐', coverTag: 'saas' })
    expect(parseMetaJsonCardContent('not-json')).toBeNull()
  })

  it('does not strictly read optional meta.json when it is absent', async () => {
    const readTextFile = vi.fn()
    const entryExists = vi.fn(async () => ({
      ok: true as const,
      data: { exists: false },
    }))
    vi.stubGlobal('window', {
      api: {
        'editor.entryExists': entryExists,
        'editor.readTextFile': readTextFile,
      },
    })

    await expect(loadUiProductCardMeta('workspace-1', 'outputs/login-page')).resolves.toBeNull()
    expect(entryExists).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      relPath: 'outputs/login-page/meta.json',
      scope: 'project',
    })
    expect(readTextFile).not.toHaveBeenCalled()
  })

  it('resolves workbench brand title from card or folder name', () => {
    expect(resolveWorkbenchBrandTitle({ title: '移动端支持直接点餐' }, 'outputs/login-page')).toBe('移动端支持直接点餐')
    expect(resolveWorkbenchBrandTitle(null, 'outputs/login-page')).toBe('login-page')
  })

  it('resolves preview tag from card meta, group, or UX fallback', () => {
    expect(resolveProductPreviewTag({ coverTag: 'saas' }, 'auth')).toBe('SAAS')
    expect(resolveProductPreviewTag(null, 'auth')).toBe('AUTH')
    expect(resolveProductPreviewTag(null, null)).toBe('SAAS')
  })

  it('builds preview people lines for UX and PM names', () => {
    expect(productPreviewPeople({ uxName: '张裴', pmName: '张代辉' })).toEqual([
      'UX: 张裴',
      'PM: 张代辉',
    ])
    expect(productPreviewPeople({ uxName: '张裴' })).toEqual(['UX: 张裴'])
  })

  it('patches card metadata onto a matching outputs tree node', () => {
    const tree = patchOutputsTreeProductCard(
      [{
        kind: 'folder',
        name: 'demo',
        relPath: 'outputs/demo',
        children: [],
        uiProductCard: null,
      }],
      'outputs/demo',
      { title: '移动端支持直接点餐', coverTag: 'SAAS', uxName: '张裴', pmName: '张代辉' }
    )
    expect(tree[0]?.kind === 'folder' ? tree[0].uiProductCard : null).toEqual({
      title: '移动端支持直接点餐',
      coverTag: 'SAAS',
      uxName: '张裴',
      pmName: '张代辉',
    })
  })
})
