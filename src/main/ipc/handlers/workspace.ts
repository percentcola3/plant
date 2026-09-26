import { registerIpcHandler } from '../registry'
import { UIClientError } from '../errors'
import {
  ensureDefaultWorkspace,
  getActiveWorkspaceId,
  getUikitSummary,
  getWorkspace,
  getWorkspaceRefs,
  listSpaceWorkspaceFiles,
  listWorkspaceFiles,
  listWorkspaces,
  scan,
  setActiveWorkspace
} from '../../workspaces/service'
import { searchWorkspaceText } from '../../workspaces/search'

export function registerWorkspaceHandlers(): void {
  // ── workspace.* ──
  registerIpcHandler('workspace.ensureDefault', async () => ensureDefaultWorkspace())
  registerIpcHandler('workspace.list', async () => listWorkspaces())

  registerIpcHandler('workspace.findById', async ({ id }) => {
    if (!id) throw new UIClientError('VALIDATION', '缺少 id')
    return getWorkspace(id)
  })

  registerIpcHandler('workspace.activeId', async () => getActiveWorkspaceId())

  registerIpcHandler('workspace.setActive', async ({ id }) => {
    await setActiveWorkspace(id ?? null)
  })

  registerIpcHandler('workspace.scan', async ({ id }) => {
    if (!id) throw new UIClientError('VALIDATION', '缺少 id')
    return scan(id)
  })

  registerIpcHandler('workspace.listFiles', async ({ workspaceId, relDir, recursive, extensions }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (typeof relDir !== 'string') throw new UIClientError('VALIDATION', '缺少 relDir')
    return listWorkspaceFiles(workspaceId, relDir, { recursive, extensions })
  })

  registerIpcHandler('workspace.listSpaceFiles', async ({ workspaceId, spaceSlug, relDir, recursive, extensions }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!spaceSlug) throw new UIClientError('VALIDATION', '缺少 spaceSlug')
    if (typeof relDir !== 'string') throw new UIClientError('VALIDATION', '缺少 relDir')
    return listSpaceWorkspaceFiles(workspaceId, spaceSlug, relDir, { recursive, extensions })
  })

  registerIpcHandler('workspace.search', async ({ workspaceId, query }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (typeof query !== 'string') throw new UIClientError('VALIDATION', '缺少 query')
    return searchWorkspaceText(workspaceId, query)
  })

  registerIpcHandler('workspace.uikitSummary', async ({ workspaceId, rootRel }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return getUikitSummary(workspaceId, rootRel)
  })

  // ── external.refs（按工作区列引用，仍属 workspace 维度） ──
  registerIpcHandler('external.refs', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return getWorkspaceRefs(workspaceId)
  })
}
