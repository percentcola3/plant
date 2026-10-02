<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { call } from '@/lib/api'
import { useWorkspacesStore } from '@/stores/workspaces'
const props = defineProps<{ workspaceId: string | null; contextKey: string }>()
const scope = ref<{ workDir: string; readRoots: string[]; writeRoots: string[]; enforced: boolean } | null>(null)
const workspaces = useWorkspacesStore()
const rootPath = computed(() => workspaces.list.find(workspace => workspace.id === props.workspaceId)?.path ?? scope.value?.workDir ?? '')
function relativePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const base = rootPath.value.replace(/\\/g, '/').split('/').filter(Boolean)
  if (!rootPath.value) return path
  // Different Windows drives have no relative path.
  if (/^[A-Za-z]:$/.test(parts[0] ?? '') && parts[0]?.toLowerCase() !== base[0]?.toLowerCase()) return path
  let common = 0
  while (common < parts.length && common < base.length && parts[common] === base[common]) common++
  return [...base.slice(common).map(() => '..'), ...parts.slice(common)].join('/') || '.'
}
const error = ref('')
const loading = ref(false)
let revision = 0
async function refresh(): Promise<void> {
  const current = ++revision
  scope.value = null
  error.value = ''
  if (!props.workspaceId) { loading.value = false; return }
  loading.value = true
  try {
    const result = await call('claude.accessScope', { workspaceId: props.workspaceId })
    if (current !== revision) return
    if (result.ok) scope.value = result.data
    else error.value = result.message
  } catch (e) {
    if (current === revision) error.value = e instanceof Error ? e.message : String(e)
  } finally { if (current === revision) loading.value = false }
}
watch(() => [props.workspaceId, props.contextKey], refresh, { immediate: true })
function toggled(event: Event): void {
  if ((event.target as HTMLDetailsElement).open) void refresh()
}
</script>
<template>
  <details v-if="workspaceId" class="access-scope" @toggle="toggled">
    <summary :title="scope?.workDir">
      <span>目录权限</span>
      <span v-if="loading">读取中…</span>
      <span v-else-if="error">暂不可用</span>
      <template v-else-if="scope">
        <span class="scope-chip scope-chip--read">可读 {{ scope.readRoots.length }}</span>
        <span class="scope-chip scope-chip--write">可写 {{ scope.writeRoots.length }}</span>
        <span class="scope-summary">{{ relativePath(scope.workDir) }}</span>
      </template>
    </summary>
    <div class="scope-body">
      <div v-if="error">{{ error }}</div>
      <template v-else-if="scope">
        <p class="scope-note">{{ scope.enforced ? '当前引擎执行以下目录限制。' : '以下为启动读取范围与项目可写约定；Claude 当前跳过权限确认，不代表文件系统硬限制。' }}</p>
        <div class="scope-heading">工作目录 <span class="scope-base-note">相对工作区</span></div><div class="scope-path" :title="scope.workDir">{{ relativePath(scope.workDir) }}</div>
        <div class="scope-heading">可读目录</div>
        <div class="scope-chips"><span v-for="path in scope.readRoots" :key="`r:${path}`" class="scope-chip scope-chip--read scope-chip--path" :title="path">{{ relativePath(path) }}</span></div>
        <div class="scope-heading">可写目录</div>
        <div class="scope-chips"><span v-for="path in scope.writeRoots" :key="`w:${path}`" class="scope-chip scope-chip--write scope-chip--path" :title="path">{{ relativePath(path) }}</span></div>
      </template>
    </div>
  </details>
</template>
<style scoped>
.access-scope { margin: 10px 12px 0; font-size: 11px; color: var(--color-text-secondary); min-width: 0; }
summary { cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 2px 0; border: 0; border-radius: var(--radius-button); width: 100%; min-width: 0; line-height: 20px; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: '▸'; flex: none; color: var(--color-text-muted); }
summary > span:not(.scope-summary) { flex: none; }
summary:hover { color: var(--color-text-primary); }
summary:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }
.access-scope[open] summary::before { content: '▾'; }
.scope-summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 2px; color: var(--color-text-muted); }
.scope-body { max-height: 180px; overflow: auto; padding: 8px 10px; background: var(--color-bg-subtle); border-radius: var(--radius-button); margin-top: 6px; }
.scope-heading { font-weight: 600; color: var(--color-text-secondary); margin-top: 7px; margin-bottom: 4px; }
.scope-path { overflow-wrap: anywhere; user-select: text; font-family: monospace; }
.scope-note { margin: 0 0 8px; line-height: 1.65; }
.scope-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.scope-chip { display: inline-flex; flex: none; align-items: center; padding: 0 6px; border: 0; border-radius: var(--radius-button); line-height: 20px; font-size: 10px; }
.scope-chip--read { color: var(--color-text-secondary); background: var(--color-bg-subtle); }
.scope-chip--write { color: var(--color-accent); background: var(--color-accent-subtle); }
.scope-chip--path { max-width: 100%; font-family: monospace; overflow-wrap: anywhere; user-select: text; }
.scope-base-note { margin-left: 4px; font-size: 10px; color: var(--color-text-muted); font-weight: 400; }
</style>
