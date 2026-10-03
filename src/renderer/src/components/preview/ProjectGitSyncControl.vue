<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import type { GitCapability, GitStatus } from '@shared/types'

const props = defineProps<{ workspaceId: string; prepare?: () => Promise<void> }>()
const ui = useUiStore()
const capability = ref<GitCapability | null>(null)
const status = ref<GitStatus | null>(null)
const preparing = ref(false)
const automatic = ref<{ state: 'idle' | 'syncing' | 'error'; message?: string; lastSyncedAt?: string } | null>(null)
let seq = 0
const remote = computed(() => capability.value?.state === 'remote')
const summary = computed(() => {
  if (automatic.value?.state === 'error') return '同步失败'
  if (automatic.value?.state === 'syncing') return remote.value ? '自动同步中…' : '自动提交中…'
  if (!remote.value) return '自动提交'
  if (status.value?.rebaseInProgress) return '同步待处理'
  if (status.value && (status.value.isDirty || status.value.behind > 0)) return '等待同步'
  return '自动同步'
})
async function refresh(): Promise<void> {
  const current = ++seq
  const workspaceId = props.workspaceId
  const [cap, gitStatus, autoStatus] = await Promise.all([
    call('git.capability', { workspaceId }), call('git.status', { workspaceId }), call('git.autoSyncStatus', { workspaceId })
  ])
  if (current !== seq) return
  capability.value = cap.ok ? cap.data : null
  status.value = gitStatus.ok ? gitStatus.data : null
  automatic.value = autoStatus.ok ? autoStatus.data : null
}
watch(() => props.workspaceId, (id, _previous, cleanup) => {
  capability.value = null
  status.value = null
  automatic.value = null
  void refresh()
  const unsubscribers = ['fs.change', 'git.remote-updated', 'git.auto-sync-status', 'saga.fs-change-pushed', 'sync.progress'].map(channel => window.events.on(`${channel}:${id}`, () => { void refresh() }))
  // A Git operation can finish after the filesystem event that started it.
  const timer = setInterval(() => { void refresh() }, 10_000)
  cleanup(() => { seq++; unsubscribers.forEach(unsubscribe => unsubscribe()); clearInterval(timer) })
}, { immediate: true })
async function sync(): Promise<void> {
  if (preparing.value || ui.syncProgress || !remote.value) return
  preparing.value = true
  try {
    await props.prepare?.()
    ui.openSyncProgress(props.workspaceId, undefined, 'remote')
  } catch { /* The editor has already shown the saving failure. */ }
  finally { preparing.value = false }
}
</script>

<template>
  <div v-if="capability && capability.state !== 'unbound'" class="project-git-sync">
    <span class="project-git-sync__status" role="status" :title="automatic?.message ?? (remote ? '文件变更后自动提交、拉取并推送；打开 Git 目录时也会自动同步' : '本地 Git 目录自动提交；绑定远程后可同步')">{{ summary }}</span>
    <button v-if="remote" type="button" class="project-git-sync__button" :disabled="preparing || !!ui.syncProgress" title="同步当前 Git 仓库：提交改动、拉取远端并推送" @click="sync">
      <RefreshCw :size="12" :class="{ 'animate-spin': preparing || !!ui.syncProgress }" aria-hidden="true" />
      {{ preparing || ui.syncProgress ? '同步中…' : '手动同步' }}
    </button>
  </div>
</template>

<style scoped>
.project-git-sync { display: flex; align-items: center; gap: 8px; font-size: 10px; white-space: nowrap; }
.project-git-sync__status { color: var(--color-text-muted); }
.project-git-sync__button { display: inline-flex; align-items: center; gap: 5px; height: 26px; border-radius: 7px; padding: 0 8px; background: var(--color-tab-selected); color: var(--color-text-primary); }
.project-git-sync__button:hover:not(:disabled) { background: var(--color-bg-hover); }
.project-git-sync__button:disabled { opacity: .55; }
</style>
