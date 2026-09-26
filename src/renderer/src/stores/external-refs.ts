import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  ExternalRef,
  ExternalRefBinding,
  ExternalRefBranches,
  ExternalRefCategory,
  ExternalRefCheckout,
  ExternalRefSyncStatus
} from '@shared/types'
import { call } from '../lib/api'

// 外部资源池 + 工作区引用管理。

export const useExternalRefsStore = defineStore('external-refs', () => {
  const pool = ref<ExternalRef[]>([])
  const bindings = ref<ExternalRefBinding[]>([])
  const syncStatusById = ref<Record<string, ExternalRefSyncStatus>>({})

  async function refreshPool(): Promise<ExternalRef[]> {
    const r = await call('external.list', undefined)
    if (r.ok) {
      pool.value = r.data
      return r.data
    }
    return pool.value
  }

  async function refreshBindings(workspaceId: string): Promise<ExternalRefBinding[]> {
    const r = await call('external.refs', { workspaceId })
    if (r.ok) {
      bindings.value = r.data
      return r.data
    }
    return []
  }

  async function addToPool(
    alias: string,
    category: ExternalRefCategory,
    source: { kind: 'git'; url: string; checkout?: ExternalRefCheckout } | { kind: 'local'; sourcePath: string }
  ): Promise<{ ok: true; data: ExternalRef } | { ok: false; code: string; message: string }> {
    const input =
      source.kind === 'git'
        ? { alias, category, kind: 'git' as const, url: source.url, checkout: source.checkout }
        : { alias, category, kind: 'local' as const, sourcePath: source.sourcePath }
    const r = await call('external.add', input)
    if (!r.ok) return { ok: false, code: r.code, message: r.message }
    await refreshPool()
    return { ok: true, data: r.data }
  }

  async function removeFromPool(id: string): Promise<void> {
    const r = await call('external.remove', { id })
    if (r.ok) await refreshPool()
  }

  async function refresh(id: string): Promise<{ ok: boolean; message?: string }> {
    const r = await call('external.refresh', { id })
    if (!r.ok) return { ok: false, message: r.message }
    await refreshPool()
    await checkStatus(id)
    return r.data
  }

  async function buildIndex(
    id: string
  ): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
    const r = await call('external.buildIndex', { id })
    if (!r.ok) return { ok: false, code: r.code, message: r.message }
    pool.value = pool.value.map((ref) => ref.id === id ? { ...ref, indexStatus: r.data } : ref)
    return { ok: true }
  }

  async function loadBranches(
    id: string
  ): Promise<{ ok: true; data: ExternalRefBranches } | { ok: false; code: string; message: string }> {
    const r = await call('external.branches', { id })
    if (!r.ok) return { ok: false, code: r.code, message: r.message }
    return { ok: true, data: r.data }
  }

  async function switchCheckout(
    id: string,
    checkout: ExternalRefCheckout
  ): Promise<{ ok: true; data: ExternalRef } | { ok: false; code: string; message: string }> {
    const r = await call('external.checkout', { id, checkout })
    if (!r.ok) return { ok: false, code: r.code, message: r.message }
    await refreshPool()
    await checkStatus(id)
    return { ok: true, data: r.data }
  }

  async function updateBinding(
    workspaceId: string,
    externalRefId: string,
    patch: Pick<ExternalRefBinding, 'visibleDirs' | 'usageNote'>
  ): Promise<{ ok: true; data: ExternalRefBinding } | { ok: false; code: string; message: string }> {
    const r = await call('external.updateBinding', {
      workspaceId,
      externalRefId,
      visibleDirs: patch.visibleDirs,
      usageNote: patch.usageNote
    })
    if (!r.ok) return { ok: false, code: r.code, message: r.message }
    await refreshBindings(workspaceId)
    return { ok: true, data: r.data }
  }

  async function checkStatus(id: string): Promise<ExternalRefSyncStatus | null> {
    const r = await call('external.status', { id })
    if (!r.ok) return null
    syncStatusById.value = { ...syncStatusById.value, [id]: r.data }
    return r.data
  }

  async function attach(workspaceId: string, externalRefId: string, options?: { assetLibrary?: string; usageNote?: string }): Promise<void> {
    const r = await call('external.attach', {
      workspaceId,
      externalRefId,
      assetLibrary: options?.assetLibrary,
      usageNote: options?.usageNote,
    })
    if (!r.ok) throw new Error(r.message)
    await refreshBindings(workspaceId)
  }

  async function listAssetLibraries(
    externalRefId: string,
  ): Promise<{ libraries: { name: string; hasTheme: boolean; componentCount: number }[] }> {
    const r = await call('external.listAssetLibraries', { id: externalRefId })
    if (!r.ok) return { libraries: [] }
    return r.data
  }

  async function detach(workspaceId: string, externalRefId: string): Promise<void> {
    const r = await call('external.detach', { workspaceId, externalRefId })
    if (r.ok) await refreshBindings(workspaceId)
  }

  // 把 binding（只有 alias + externalRefId）联到池里的完整 ExternalRef
  const resolvedBindings = computed(() =>
    bindings.value.map((b) => {
      const ref = pool.value.find((p) => p.id === b.externalRefId)
      return { binding: b, ref: ref ?? null }
    })
  )
  const knowledgeBindings = computed(() =>
    resolvedBindings.value.filter((x) => x.ref?.category === 'knowledge')
  )
  const uikitBindings = computed(() =>
    resolvedBindings.value.filter((x) => x.ref?.category === 'uikit')
  )

  return {
    pool,
    bindings,
    syncStatusById,
    resolvedBindings,
    knowledgeBindings,
    uikitBindings,
    refreshPool,
    refreshBindings,
    addToPool,
    removeFromPool,
    refresh,
    buildIndex,
    loadBranches,
    switchCheckout,
    updateBinding,
    checkStatus,
    attach,
    detach,
    listAssetLibraries
  }
})
