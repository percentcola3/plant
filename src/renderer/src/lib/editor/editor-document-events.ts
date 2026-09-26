export const EDITOR_DOCUMENT_OPENED_EVENT = '__uikit_editor_document_opened__'

export type EditorDocumentOpenedDetail = {
  projectId: string
  relPath: string
  kind: 'markdown' | 'css' | 'html' | 'text'
  readonly?: boolean
}

export function dispatchEditorDocumentOpened(
  target: Pick<Window, 'dispatchEvent'>,
  detail: EditorDocumentOpenedDetail
): void {
  target.dispatchEvent(new CustomEvent(EDITOR_DOCUMENT_OPENED_EVENT, { detail }))
}

export function isEditorDocumentOpenedDetail(value: unknown): value is EditorDocumentOpenedDetail {
  if (!value || typeof value !== 'object') return false
  const detail = value as Record<string, unknown>
  return typeof detail.projectId === 'string'
    && detail.projectId.length > 0
    && typeof detail.relPath === 'string'
    && detail.relPath.length > 0
    && (detail.kind === 'markdown' || detail.kind === 'css' || detail.kind === 'html' || detail.kind === 'text')
    && (detail.readonly === undefined || typeof detail.readonly === 'boolean')
}
