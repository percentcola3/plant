import { registerIpcHandler } from '../registry'
import { UIClientError } from '../errors'
import { WorkspacesStore } from '../../workspaces/store'
import { associateSourceProject, commitSourceProject, getSourceProject, startSourceProject, stopSourceProject } from '../../source-projects/service'

const store = new WorkspacesStore()

async function workspacePath(workspaceId: string): Promise<string> {
  const workspace = await store.findById(workspaceId)
  if (!workspace) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  return workspace.path
}

export function registerSourceProjectHandlers(): void {
  registerIpcHandler('sourceProject.get', async ({ workspaceId, projectRelPath }) =>
    getSourceProject(await workspacePath(workspaceId), projectRelPath)
  )
  registerIpcHandler('sourceProject.associate', async ({ workspaceId, projectRelPath, sourcePath }) =>
    associateSourceProject(await workspacePath(workspaceId), projectRelPath, sourcePath)
  )
  registerIpcHandler('sourceProject.commit', async ({ workspaceId, projectRelPath, message }) =>
    commitSourceProject(await workspacePath(workspaceId), projectRelPath, message)
  )
  registerIpcHandler('sourceProject.start', async ({ workspaceId, projectRelPath }) =>
    startSourceProject(await workspacePath(workspaceId), projectRelPath)
  )
  registerIpcHandler('sourceProject.stop', async ({ workspaceId, projectRelPath }) =>
    stopSourceProject(await workspacePath(workspaceId), projectRelPath)
  )
}
