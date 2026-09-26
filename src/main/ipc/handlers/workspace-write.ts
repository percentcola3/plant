import { BrowserWindow } from 'electron'
import { registerIpcHandler } from '../registry'
import { UIClientError } from '../errors'
import {
  cloneWorkspace,
  createWorkspace,
  ensureDefaultKnowledgeWorkspace,
  importWorkspace,
  removeWorkspace,
  renameWorkspace
} from '../../workspaces/lifecycle'
import { checkoutProjectHome } from '../../requirements/lifecycle'
import { saveWorkspace, syncWorkspace, type SyncProgressEvent } from '../../workspaces/sync'
import { pushToTeamSpace, abortTeamPush, type TeamPushProgressEvent, type TeamPushTarget } from '../../workspaces/team-push'
import { setWorkspaceWatchScope, setWorkspaceWorkArea } from '../../workspaces/service'
import {
  createPersonalSpace,
  ensurePersonalSpace,
  listPersonalSpaces,
  readPersonalSpace,
  removePersonalSpace,
  switchPersonalSpace
} from '../../workspaces/personal-space'
import {
  createFeature,
  deleteFeature,
  importFeature,
  moveFeature,
  renameFeature
} from '../../features/lifecycle'
import { copyFeatureToSpace } from '../../features/copy-to-space'
import { listFeatureGroups, listFeatures } from '../../features/scanner'
import { WorkspacesStore } from '../../workspaces/store'
import {
  abortOperation,
  applyResolution,
  continueOperation,
  listConflicts,
  pickSide
} from '../../workspaces/conflict'
import { startAiResolve, abortAiResolve } from '../../conflict/ai-resolve'
import {
  listExternalRefs,
  readFeatureExternalRefs,
  updateFeatureExternalRefs
} from '../../external-pool/service'
import { settingsStore } from '../../settings/store'

const featuresStore = new WorkspacesStore()

async function resolveFeatureWorkspacePath(workspaceId: string): Promise<string> {
  const ws = await featuresStore.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
  if (ws.kind !== 'project') {
    throw new UIClientError('VALIDATION', '项目能力仅本地工作台支持')
  }
  return ws.path
}

function broadcastProgress(event: SyncProgressEvent): void {
  const channel = `sync.progress:${event.workspaceId}`
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, event)
  }
}

function broadcastTeamPushProgress(event: TeamPushProgressEvent): void {
  const channel = `team-push.progress:${event.workspaceId}`
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, event)
  }
}

function broadcastAiResolveDone(workspaceId: string, result: unknown): void {
  const channel = `conflict.aiResolve.done:${workspaceId}`
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, result)
  }
}

export function registerWorkspaceWriteHandlers(): void {
  // ── workspace.* 写入 ──
  registerIpcHandler('workspace.create', async (input) => {
    if (!input?.parentDir) throw new UIClientError('VALIDATION', '缺少 parentDir')
    if (!input?.name) throw new UIClientError('VALIDATION', '缺少 name')
    return createWorkspace(input)
  })

  registerIpcHandler('workspace.ensureDefaultKnowledge', async () => {
    return ensureDefaultKnowledgeWorkspace()
  })

  registerIpcHandler('workspace.import', async (input) => {
    if (!input?.path) throw new UIClientError('VALIDATION', '缺少 path')
    return importWorkspace(input)
  })

  registerIpcHandler('workspace.clone', async (input) => {
    if (!input?.url) throw new UIClientError('VALIDATION', '缺少 url')
    if (!input?.parentDir) throw new UIClientError('VALIDATION', '缺少 parentDir')
    if (!input?.name) throw new UIClientError('VALIDATION', '缺少 name')
    return cloneWorkspace(input)
  })

  registerIpcHandler('workspace.remove', async ({ id, deleteFiles }) => {
    if (!id) throw new UIClientError('VALIDATION', '缺少 id')
    await removeWorkspace(id, { deleteFiles })
  })

  registerIpcHandler('workspace.rename', async ({ id, name }) => {
    if (!id) throw new UIClientError('VALIDATION', '缺少 id')
    await renameWorkspace(id, name)
  })

  registerIpcHandler('workspace.setWorkArea', async ({ workspaceId, area }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    await setWorkspaceWorkArea(workspaceId, area ?? null)
  })

  registerIpcHandler('workspace.setWatchScope', async (input) => {
    const workspaceId = input?.workspaceId
    const projectRelPath = input?.projectRelPath
    if (workspaceId === null && projectRelPath === null) {
      await setWorkspaceWatchScope(null, null)
      return
    }
    if (
      typeof workspaceId !== 'string'
      || workspaceId.trim().length === 0
      || typeof projectRelPath !== 'string'
      || projectRelPath.trim().length === 0
    ) {
      throw new UIClientError('VALIDATION', 'workspaceId 与 projectRelPath 必须同时设置或同时清空')
    }
    await setWorkspaceWatchScope(workspaceId, projectRelPath)
  })

  registerIpcHandler('workspace.checkoutHome', async ({ workspaceId, preCommitMessage }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    await checkoutProjectHome({ workspaceId, preCommitMessage })
  })

  registerIpcHandler('workspace.save', async ({ workspaceId, commitMessage }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return saveWorkspace(workspaceId, commitMessage)
  })

  // ── personalSpace.*（PM / UX workspace 共用，2026-06-24 重构后支持多空间）──
  registerIpcHandler('personalSpace.ensure', async ({ workspaceId, slug, preCommitMessage }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return ensurePersonalSpace({ workspaceId, slug, preCommitMessage })
  })

  registerIpcHandler('personalSpace.get', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return readPersonalSpace(workspaceId)
  })

  registerIpcHandler('personalSpace.list', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return listPersonalSpaces(workspaceId)
  })

  registerIpcHandler('personalSpace.create', async ({ workspaceId, slug, fromBranch, preCommitMessage }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return createPersonalSpace({ workspaceId, slug, fromBranch, preCommitMessage })
  })

  registerIpcHandler('personalSpace.switch', async ({ workspaceId, slug, preCommitMessage }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!slug) throw new UIClientError('VALIDATION', '缺少 slug')
    return switchPersonalSpace({ workspaceId, slug, preCommitMessage })
  })

  registerIpcHandler('personalSpace.remove', async ({ workspaceId, slug, preCommitMessage }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!slug) throw new UIClientError('VALIDATION', '缺少 slug')
    return removePersonalSpace({ workspaceId, slug, preCommitMessage })
  })

  // ── feature.*（PM 项目 2026-06-24 重构后取代 requirements 模型）──
  registerIpcHandler('feature.list', async ({ workspaceId }) => {
    const workspacePath = await resolveFeatureWorkspacePath(workspaceId)
    return listFeatures(workspacePath)
  })

  registerIpcHandler('feature.listGroups', async ({ workspaceId }) => {
    const workspacePath = await resolveFeatureWorkspacePath(workspaceId)
    return listFeatureGroups(workspacePath)
  })

  registerIpcHandler('feature.create', async ({
    workspaceId,
    slug,
    group,
    withPrd,
    withIndexHtml,
    externalRefIds,
    setResourcesAsDefault
  }) => {
    const workspacePath = await resolveFeatureWorkspacePath(workspaceId)
    if (!slug) throw new UIClientError('VALIDATION', '缺少 slug')
    if (externalRefIds !== undefined && (
      !Array.isArray(externalRefIds)
      || externalRefIds.some((id) => typeof id !== 'string')
    )) {
      throw new UIClientError('VALIDATION', 'externalRefIds 必须是字符串数组')
    }
    const availableIds = new Set((await listExternalRefs()).map((ref) => ref.id))
    const defaults = (await settingsStore.get()).defaultExternalRefIds
    const requestedIds = externalRefIds ?? defaults
    if (externalRefIds && externalRefIds.some((id) => !availableIds.has(id))) {
      throw new UIClientError('VALIDATION', '选择的资源包已不存在，请刷新后重试')
    }
    const selectedIds = [...new Set(requestedIds.filter((id) => availableIds.has(id)))]
    const created = await createFeature({ workspacePath, slug, group: group ?? null, withPrd, withIndexHtml })
    try {
      await updateFeatureExternalRefs(workspaceId, created.featureRelPath, selectedIds)
      if (setResourcesAsDefault) {
        await settingsStore.update({ defaultExternalRefIds: selectedIds })
      }
      return created
    } catch (error) {
      await deleteFeature({ workspacePath, relPath: created.featureRelPath }).catch(() => undefined)
      throw error
    }
  })

  registerIpcHandler('feature.resources.get', async ({ workspaceId, featureRelPath }) => {
    if (!featureRelPath) throw new UIClientError('VALIDATION', '缺少 featureRelPath')
    return readFeatureExternalRefs(workspaceId, featureRelPath)
  })

  registerIpcHandler('feature.resources.update', async ({ workspaceId, featureRelPath, externalRefIds, setAsDefault }) => {
    if (!featureRelPath) throw new UIClientError('VALIDATION', '缺少 featureRelPath')
    if (!Array.isArray(externalRefIds)) throw new UIClientError('VALIDATION', 'externalRefIds 必须是数组')
    const updated = await updateFeatureExternalRefs(workspaceId, featureRelPath, externalRefIds)
    if (setAsDefault) await settingsStore.update({ defaultExternalRefIds: updated.externalRefIds })
    return updated
  })

  registerIpcHandler('feature.import', async ({ workspaceId, sourcePath, slug, group }) => {
    const workspacePath = await resolveFeatureWorkspacePath(workspaceId)
    if (!sourcePath) throw new UIClientError('VALIDATION', '缺少 sourcePath')
    return importFeature({ workspacePath, sourcePath, slug, group: group ?? null })
  })

  registerIpcHandler('feature.delete', async ({ workspaceId, relPath }) => {
    const workspacePath = await resolveFeatureWorkspacePath(workspaceId)
    if (!relPath) throw new UIClientError('VALIDATION', '缺少 relPath')
    await deleteFeature({ workspacePath, relPath })
  })

  registerIpcHandler('feature.rename', async ({ workspaceId, relPath, newSlug }) => {
    const workspacePath = await resolveFeatureWorkspacePath(workspaceId)
    if (!relPath) throw new UIClientError('VALIDATION', '缺少 relPath')
    if (!newSlug) throw new UIClientError('VALIDATION', '缺少 newSlug')
    return renameFeature({ workspacePath, relPath, newSlug })
  })

  registerIpcHandler('feature.move', async ({ workspaceId, relPath, toGroup }) => {
    const workspacePath = await resolveFeatureWorkspacePath(workspaceId)
    if (!relPath) throw new UIClientError('VALIDATION', '缺少 relPath')
    return moveFeature({ workspacePath, relPath, toGroup: toGroup ?? null })
  })

  registerIpcHandler('feature.copyToSpace', async ({ workspaceId, relPath, targetSlug, targetWorkspaceId, targetName }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!relPath) throw new UIClientError('VALIDATION', '缺少 relPath')
    if (!targetSlug) throw new UIClientError('VALIDATION', '缺少 targetSlug')
    return copyFeatureToSpace({ workspaceId, relPath, targetSlug, targetWorkspaceId, targetName })
  })

  // ── sync.* ──
  registerIpcHandler('sync.start', async ({ workspaceId, mode, uncommittedStrategy, commitMessage }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return syncWorkspace(workspaceId, {
      mode,
      uncommittedStrategy,
      commitMessage,
      onProgress: broadcastProgress
    })
  })

  // ── team.push ── 推送单个对象目录（feature / outputs）到团队空间（origin/main）
  registerIpcHandler('team.push', async ({ workspaceId, relPath, name, type }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!relPath) throw new UIClientError('VALIDATION', '缺少 relPath')
    const target: TeamPushTarget = { relPath, name: name || relPath, type: type === 'ui' ? 'ui' : 'feat' }
    return pushToTeamSpace(workspaceId, target, { onProgress: broadcastTeamPushProgress })
  })

  // ── team.abort ── 放弃冲突推送：abort rebase + 移除临时 worktree
  registerIpcHandler('team.abort', async ({ workspaceId, worktreePath }) => {
    if (!workspaceId || !worktreePath) throw new UIClientError('VALIDATION', '缺少参数')
    await abortTeamPush(workspaceId, worktreePath)
    return { ok: true as const }
  })

  // ── conflict.* ──
  registerIpcHandler('conflict.list', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return listConflicts(workspaceId)
  })

  registerIpcHandler('conflict.applyResolution', async ({ workspaceId, relPath, resolvedContent }) => {
    if (!workspaceId || !relPath) throw new UIClientError('VALIDATION', '缺少参数')
    await applyResolution(workspaceId, relPath, resolvedContent ?? '')
  })

  registerIpcHandler('conflict.pickSide', async ({ workspaceId, relPath, side }) => {
    if (!workspaceId || !relPath) throw new UIClientError('VALIDATION', '缺少参数')
    if (side !== 'ours' && side !== 'theirs') throw new UIClientError('VALIDATION', 'side 必须是 ours/theirs')
    await pickSide(workspaceId, relPath, side)
  })

  registerIpcHandler('conflict.continue', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    await continueOperation(workspaceId)
  })

  registerIpcHandler('conflict.abort', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    await abortOperation(workspaceId)
  })

  // ── conflict.aiResolve ── 异步后台：立即返回 started，结果走事件，不阻塞
  registerIpcHandler('conflict.aiResolve', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    const { started } = startAiResolve(workspaceId, (result) => broadcastAiResolveDone(workspaceId, result))
    return { started }
  })

  registerIpcHandler('conflict.aiResolve.abort', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return { aborted: abortAiResolve(workspaceId) }
  })
}
