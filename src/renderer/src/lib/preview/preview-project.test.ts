import { describe, expect, it } from 'vitest'
import * as previewProject from './preview-project'

const { createPreviewProjectContext } = previewProject

describe('createPreviewProjectContext', () => {
  it('builds a stable internal-project identity from Git project, workspace, and relative path', () => {
    expect(createPreviewProjectContext(
      'ws1',
      'alice',
      '/outputs\\12\\c-order-management-v3/',
      '  '
    )).toEqual({
      key: 'ws1::alice::outputs/12/c-order-management-v3',
      workspaceId: 'ws1',
      spaceSlug: 'alice',
      relPath: 'outputs/12/c-order-management-v3',
      name: 'c-order-management-v3'
    })
  })

  it('keeps same-named projects in different workspaces distinct', () => {
    const alice = createPreviewProjectContext('ws1', 'alice', 'outputs/order', 'order')
    const bob = createPreviewProjectContext('ws1', 'bob', 'outputs/order', 'order')

    expect(alice.key).not.toBe(bob.key)
  })
})
