import { registerIpcHandler } from '../registry'
import { UIClientError } from '../errors'
import { WorkspacesStore } from '../../workspaces/store'
import {
  copyEditorEntry,
  createEditorEntryWithSkillMirror,
  deleteEditorEntry,
  deleteEditorFile,
  editorEntryExists,
  editorEntryKind,
  moveEditorEntry,
  readEditorFile,
  saveEditorAsset,
  saveProjectBinaryFile,
  writeEditorFileWithSkillMirror
} from '../../editor/service'
import { importUiProduct } from '../../outputs/import-product'
import { copyUiProductToSpace } from '../../outputs/copy-to-space'
import { updateUiProductCardMeta } from '../../outputs/card-meta'
import { seedProductAgentFiles } from '../../outputs/seed-agent-files'

const store = new WorkspacesStore()

async function resolveWorkspacePath(workspaceId: string): Promise<string> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
  return ws.path
}

async function resolveWorkspace(workspaceId: string): Promise<{ path: string; name: string }> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)
  return { path: ws.path, name: ws.name }
}

export function registerEditorHandlers(): void {
  registerIpcHandler('editor.readTextFile', async ({ workspaceId, relPath }) => {
    if (!workspaceId || !relPath) throw new UIClientError('VALIDATION', '缺少参数')
    const root = await resolveWorkspacePath(workspaceId)
    return readEditorFile(root, root, relPath)
  })

  registerIpcHandler('editor.entryExists', async ({ workspaceId, relPath }) => {
    if (!workspaceId || !relPath) throw new UIClientError('VALIDATION', '缺少参数')
    const root = await resolveWorkspacePath(workspaceId)
    return { exists: await editorEntryExists(root, root, relPath) }
  })

  registerIpcHandler('editor.entryKind', async ({ workspaceId, relPath }) => {
    if (!workspaceId || !relPath) throw new UIClientError('VALIDATION', '缺少参数')
    const root = await resolveWorkspacePath(workspaceId)
    return editorEntryKind(root, root, relPath)
  })

  registerIpcHandler('editor.writeTextFile', async ({ workspaceId, relPath, content, expectedMtime }) => {
    if (!workspaceId || !relPath) throw new UIClientError('VALIDATION', '缺少参数')
    const root = await resolveWorkspacePath(workspaceId)
    return writeEditorFileWithSkillMirror(root, root, relPath, content, expectedMtime)
  })

  registerIpcHandler('editor.deleteTextFile', async ({ workspaceId, relPath }) => {
    if (!workspaceId || !relPath) throw new UIClientError('VALIDATION', '缺少参数')
    const root = await resolveWorkspacePath(workspaceId)
    await deleteEditorFile(root, root, relPath)
  })

  registerIpcHandler('editor.deleteEntry', async ({ workspaceId, relPath }) => {
    if (!workspaceId || !relPath) throw new UIClientError('VALIDATION', '缺少参数')
    const root = await resolveWorkspacePath(workspaceId)
    await deleteEditorEntry(root, root, relPath)
  })

  registerIpcHandler('editor.copyEntry', async ({ workspaceId, sourceRelPath, targetRelPath }) => {
    if (!workspaceId || !sourceRelPath || !targetRelPath) throw new UIClientError('VALIDATION', '缺少参数')
    const root = await resolveWorkspacePath(workspaceId)
    return copyEditorEntry(root, root, sourceRelPath, targetRelPath)
  })

  registerIpcHandler('editor.moveEntry', async ({ workspaceId, sourceRelPath, targetRelPath }) => {
    if (!workspaceId || !sourceRelPath || !targetRelPath) throw new UIClientError('VALIDATION', '缺少参数')
    const root = await resolveWorkspacePath(workspaceId)
    return moveEditorEntry(root, root, sourceRelPath, targetRelPath)
  })

  registerIpcHandler('editor.createEntry', async ({ workspaceId, targetRelPath }) => {
    if (!workspaceId || !targetRelPath) throw new UIClientError('VALIDATION', '缺少参数')
    const root = await resolveWorkspacePath(workspaceId)
    return createEditorEntryWithSkillMirror(root, root, targetRelPath)
  })

  registerIpcHandler('editor.saveAsset', async ({ workspaceId, ...rest }) => {
    if (!workspaceId || !rest.contextRelPath || !rest.mimeType || !rest.dataBase64) {
      throw new UIClientError('VALIDATION', '缺少参数')
    }
    const root = await resolveWorkspacePath(workspaceId)
    return saveEditorAsset(root, root, rest)
  })

  registerIpcHandler('editor.saveBinaryFile', async ({ workspaceId, ...rest }) => {
    if (!workspaceId || !rest.targetRelDir || !rest.mimeType || !rest.dataBase64) {
      throw new UIClientError('VALIDATION', '缺少参数')
    }
    const root = await resolveWorkspacePath(workspaceId)
    return saveProjectBinaryFile(root, root, rest)
  })

  registerIpcHandler('uiProduct.seedAgentFiles', async ({ workspaceId, productRelPath }) => {
    if (!workspaceId || !productRelPath) throw new UIClientError('VALIDATION', '缺少参数')
    const ws = await resolveWorkspace(workspaceId)
    return seedProductAgentFiles(ws.path, productRelPath)
  })

  registerIpcHandler('uiProduct.import', async ({ workspaceId, sourcePath, name }) => {
    if (!workspaceId || !sourcePath) throw new UIClientError('VALIDATION', '缺少参数')
    const ws = await resolveWorkspace(workspaceId)
    return importUiProduct({ workspacePath: ws.path, sourcePath, name })
  })

  registerIpcHandler('uiProduct.copyToSpace', async ({ workspaceId, relPath, targetSlug, targetWorkspaceId, targetName }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!relPath) throw new UIClientError('VALIDATION', '缺少 relPath')
    if (!targetSlug) throw new UIClientError('VALIDATION', '缺少 targetSlug')
    return copyUiProductToSpace({ workspaceId, relPath, targetSlug, targetWorkspaceId, targetName })
  })

  registerIpcHandler('uiProduct.updateCardMeta', async ({ workspaceId, productRelPath, title, coverTag, uxName, pmName }) => {
    if (!workspaceId || !productRelPath) throw new UIClientError('VALIDATION', '缺少参数')
    const ws = await resolveWorkspace(workspaceId)
    return updateUiProductCardMeta(ws.path, productRelPath, { title, coverTag, uxName, pmName })
  })
}
