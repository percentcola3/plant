import { registerIpcHandler } from '../registry'
import { UIClientError } from '../errors'
import {
  addExternalRef,
  attachExternalRef,
  detachExternalRef,
  hydrateExternalManifest,
  listExternalRefAssetLibraries,
  listExternalRefBranches,
  listExternalRefs,
  readExternalRefSyncStatus,
  refreshExternalRef,
  requestExternalRefIndexBuild,
  removeExternalRef,
  switchExternalRefCheckout,
  updateExternalRefBinding
} from '../../external-pool/service'
import { normalizeExternalCheckout, normalizeExternalVisibleDirs } from '@shared/external-ref-controls'

function toValidationError(e: unknown): UIClientError {
  return new UIClientError('VALIDATION', e instanceof Error ? e.message : String(e))
}

export function registerExternalHandlers(): void {
  registerIpcHandler('external.list', async () => listExternalRefs())

  registerIpcHandler('external.add', async (input) => {
    if (!input || typeof input.alias !== 'string') {
      throw new UIClientError('VALIDATION', '缺少 alias')
    }
    if (input.category !== 'uikit' && input.category !== 'knowledge') {
      throw new UIClientError('VALIDATION', `category 必须是 uikit | knowledge，收到：${String(input.category)}`)
    }
    if (input.kind === 'git') {
      if (!input.url) throw new UIClientError('VALIDATION', '缺少 git URL')
      let checkout = input.checkout
      if (checkout) {
        try {
          checkout = normalizeExternalCheckout(checkout)
        } catch (e) {
          throw toValidationError(e)
        }
      }
      return addExternalRef({
        alias: input.alias,
        category: input.category,
        kind: 'git',
        url: input.url,
        checkout
      })
    }
    if (input.kind === 'local') {
      if (!input.sourcePath) throw new UIClientError('VALIDATION', '缺少 sourcePath')
      return addExternalRef({
        alias: input.alias,
        category: input.category,
        kind: 'local',
        sourcePath: input.sourcePath
      })
    }
    throw new UIClientError('VALIDATION', `未知 kind：${(input as { kind?: string }).kind}`)
  })

  registerIpcHandler('external.remove', async ({ id }) => {
    if (!id) throw new UIClientError('VALIDATION', '缺少 id')
    await removeExternalRef(id)
  })

  registerIpcHandler('external.status', async ({ id }) => {
    if (!id) throw new UIClientError('VALIDATION', '缺少 id')
    // status 通常是渲染端自动轮询，不需要交互式凭证。
    return readExternalRefSyncStatus(id, { interactive: false })
  })

  registerIpcHandler('external.branches', async ({ id }) => {
    if (!id) throw new UIClientError('VALIDATION', '缺少 id')
    return listExternalRefBranches(id)
  })

  registerIpcHandler('external.refresh', async ({ id }) => {
    if (!id) throw new UIClientError('VALIDATION', '缺少 id')
    // 用户主动点"刷新"才允许弹凭证框。
    return refreshExternalRef(id, { interactive: true })
  })

  registerIpcHandler('external.buildIndex', async ({ id }) => {
    if (!id) throw new UIClientError('VALIDATION', '缺少 id')
    return requestExternalRefIndexBuild(id)
  })

  registerIpcHandler('external.hydrate', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return hydrateExternalManifest(workspaceId)
  })

  registerIpcHandler('external.attach', async ({ workspaceId, externalRefId, assetLibrary, usageNote }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!externalRefId) throw new UIClientError('VALIDATION', '缺少 externalRefId')
    await attachExternalRef(workspaceId, externalRefId, { assetLibrary, usageNote })
  })

  registerIpcHandler('external.listAssetLibraries', async ({ id }) => {
    if (!id) throw new UIClientError('VALIDATION', '缺少 id')
    return listExternalRefAssetLibraries(id)
  })

  registerIpcHandler('external.detach', async ({ workspaceId, externalRefId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!externalRefId) throw new UIClientError('VALIDATION', '缺少 externalRefId')
    await detachExternalRef(workspaceId, externalRefId)
  })

  registerIpcHandler('external.checkout', async ({ id, checkout }) => {
    if (!id) throw new UIClientError('VALIDATION', '缺少 id')
    if (!checkout) throw new UIClientError('VALIDATION', '缺少 checkout')
    let normalized = checkout
    try {
      normalized = normalizeExternalCheckout(checkout)
    } catch (e) {
      throw toValidationError(e)
    }
    return switchExternalRefCheckout(id, normalized)
  })

  registerIpcHandler('external.updateBinding', async ({ workspaceId, externalRefId, visibleDirs, assetLibrary, usageNote }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!externalRefId) throw new UIClientError('VALIDATION', '缺少 externalRefId')
    const patch: { visibleDirs?: string[]; assetLibrary?: string; usageNote?: string } = {}
    if (visibleDirs !== undefined) {
      try {
        patch.visibleDirs = normalizeExternalVisibleDirs(visibleDirs)
      } catch (e) {
        throw toValidationError(e)
      }
    }
    if (assetLibrary !== undefined) patch.assetLibrary = assetLibrary
    if (usageNote !== undefined) patch.usageNote = usageNote
    return updateExternalRefBinding(workspaceId, externalRefId, patch)
  })
}
