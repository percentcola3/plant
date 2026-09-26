import { registerIpcHandler } from '../registry'
import { UIClientError } from '../errors'
import { WorkspacesStore } from '../../workspaces/store'
import { findLatestRepairContext, renderRepairPrompt } from '../../saga/repair-context'

const store = new WorkspacesStore()

export function registerSagaHandlers(): void {
  registerIpcHandler('saga.latestRepair', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
    const context = await findLatestRepairContext(workspaceId, ws.path, ws.name)
    if (!context) return { context: null, prompt: null }
    return { context, prompt: renderRepairPrompt(context) }
  })
}
