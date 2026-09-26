import { BrowserWindow } from 'electron'
import type { FeaturePublishProgressEvent, UiProductPublishProgressEvent } from '@shared/types'
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
import { publishMarkdownDocument, readDocPublishStatus } from '../../docs/publish'
import { importUiProduct } from '../../outputs/import-product'
import { copyUiProductToSpace } from '../../outputs/copy-to-space'
import { updateUiProductCardMeta } from '../../outputs/card-meta'
import { publishUiProduct } from '../../outputs/publish'
import { seedProductAgentFiles } from '../../outputs/seed-agent-files'
import { publishFeature } from '../../features/publish'

const store = new WorkspacesStore()

function broadcastUiProductPublishProgress(event: UiProductPublishProgressEvent): void {
  const channel = `ui-product.publish-progress:${event.workspaceId}`
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, event)
  }
}

function broadcastFeaturePublishProgress(event: FeaturePublishProgressEvent): void {
  const channel = `feature.publish-progress:${event.workspaceId}`
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, event)
  }
}

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
    const result = await readEditorFile(root, root, relPath)
    const publish = /\.(md|mdx|markdown)$/i.test(result.relPath)
      ? await readDocPublishStatus(root, result.relPath, result.content)
      : null
    return { ...result, publish }
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

  registerIpcHandler('editor.publishMarkdown', async ({ workspaceId, relPath }) => {
    if (!workspaceId || !relPath) throw new UIClientError('VALIDATION', '缺少参数')
    const ws = await resolveWorkspace(workspaceId)
    const record = await publishMarkdownDocument({
      workspacePath: ws.path,
      workspaceName: ws.name,
      relPath
    })
    return { ...record, isPublished: true }
  })

  registerIpcHandler('uiProduct.publish', async ({ workspaceId, productRelPath }) => {
    if (!workspaceId || !productRelPath) throw new UIClientError('VALIDATION', '缺少参数')
    const ws = await resolveWorkspace(workspaceId)
    return publishUiProduct({
      workspacePath: ws.path,
      workspaceName: ws.name,
      productRelPath,
      onProgress: (event) => {
        broadcastUiProductPublishProgress({ workspaceId, ...event })
      }
    })
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

  registerIpcHandler('feature.publish', async ({ workspaceId, featureRelPath }) => {
    if (!workspaceId || !featureRelPath) throw new UIClientError('VALIDATION', '缺少参数')
    const ws = await resolveWorkspace(workspaceId)
    return publishFeature({
      workspacePath: ws.path,
      workspaceName: ws.name,
      featureRelPath,
      onProgress: (event) => {
        broadcastFeaturePublishProgress({ workspaceId, ...event })
      }
    })
  })
}
