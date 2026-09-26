import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { registerIpcHandler } from '../registry'
import { WorkspacesStore } from '../../workspaces/store'
import { capturePageDesign, closePage, controlPage, layoutPage, listPages, openPage, readPage } from '../../project-browser/service'
import { savePageDesign } from '../../project-browser/design-file'
import type { BrowserScope } from '../../../shared/project-browser'

function owner(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) throw new Error('无权访问项目网页')
  return window
}
async function validateScope(scope: BrowserScope): Promise<void> {
  if (!scope || typeof scope.projectRelPath !== 'string' || typeof scope.workspaceId !== 'string'
    || !scope.projectRelPath || scope.projectRelPath.startsWith('/')
    || scope.projectRelPath.includes('\\') || scope.projectRelPath.split('/').some(p => p === '..' || p === '.')) throw new Error('项目路径无效')
  if (!await new WorkspacesStore().findById(scope.workspaceId)) throw new Error('工作区不存在')
}
export function registerProjectBrowserHandlers(): void {
  registerIpcHandler('projectBrowser.list', (_input, event) => listPages(owner(event)))
  registerIpcHandler('projectBrowser.open', async (input, event) => {
    const window = owner(event)
    await validateScope(input)
    return openPage(window, input, input.url)
  })
  registerIpcHandler('projectBrowser.close', (input, event) => closePage(owner(event), input, input.id))
  registerIpcHandler('projectBrowser.control', (input, event) => controlPage(owner(event), input, input.id, input.action, input.url))
  registerIpcHandler('projectBrowser.layout', (input, event) => layoutPage(owner(event), input, input.id, input.bounds))
  registerIpcHandler('projectBrowser.read', (input, event) => readPage(owner(event), input, input.id))
  registerIpcHandler('projectBrowser.createDesign', async (input, event) => {
    const window = owner(event)
    await validateScope(input)
    const store = new WorkspacesStore()
    const workspace = await store.findById(input.workspaceId)
    if (!workspace) throw new Error('工作区不存在')
    const workspacePath = workspace.path
    const snapshot = await capturePageDesign(window, input, input.id)
    if ((await store.findById(input.workspaceId))?.path !== workspacePath) {
      throw new Error('工作区目录已切换，请重新生成设计稿')
    }
    return savePageDesign(workspacePath, input.projectRelPath, snapshot)
  })
}
