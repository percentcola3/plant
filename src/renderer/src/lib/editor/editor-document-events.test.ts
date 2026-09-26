import { describe, expect, it, vi } from 'vitest'
import {
  EDITOR_DOCUMENT_OPENED_EVENT,
  dispatchEditorDocumentOpened,
  isEditorDocumentOpenedDetail
} from './editor-document-events'

describe('editor-document-events', () => {
  it('dispatches editable document open details', () => {
    const dispatchEvent = vi.fn()
    const target = { dispatchEvent } as unknown as Window

    dispatchEditorDocumentOpened(target, {
      projectId: 'p1',
      relPath: '测试pred.md',
      kind: 'markdown',
      readonly: false
    })

    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent
    expect(event.type).toBe(EDITOR_DOCUMENT_OPENED_EVENT)
    expect(event.detail).toEqual({
      projectId: 'p1',
      relPath: '测试pred.md',
      kind: 'markdown',
      readonly: false
    })
    expect(isEditorDocumentOpenedDetail(event.detail)).toBe(true)
  })

  it('rejects malformed document open details', () => {
    expect(isEditorDocumentOpenedDetail({ projectId: 'p1', relPath: 'scripts/check.py', kind: 'text' })).toBe(true)
    expect(isEditorDocumentOpenedDetail({ projectId: 'p1', relPath: '', kind: 'markdown' })).toBe(false)
    expect(isEditorDocumentOpenedDetail({ projectId: 'p1', relPath: 'a.md', kind: 'other' })).toBe(false)
  })
})
