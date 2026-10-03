<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { GitBranch, FolderOpen, Plus, Loader2, ChevronDown, FolderKanban, Search } from 'lucide-vue-next'
import type { FeatureCard, GitCapability, Workspace } from '@shared/types'
import { useWorkspacesStore } from '@/stores/workspaces'
import { usePreviewStore } from '@/stores/preview'
import { useUiStore } from '@/stores/ui'
import { call } from '@/lib/api'
import FeaturesPage from './FeaturesPage.vue'
import PlantPageHeader from './PlantPageHeader.vue'
import { createPreviewProjectContext } from '@/lib/preview/preview-project'
import { formatDateTimeMinute } from '@/lib/date-format'
import { fuzzyMatch } from '@/lib/feature-search'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'


const ws = useWorkspacesStore()
const ui = useUiStore()
const preview = usePreviewStore()
const capabilities = ref<Record<string, GitCapability>>({})
const busy = ref(false)
const error = ref('')
const searchQuery = ref('')
const searchMatches = ref<Record<string, boolean>>({})
function directoryMatches(directory: Workspace): boolean {
  const query = searchQuery.value.trim()
  return !!query && query.split(/\s+/).every(token => fuzzyMatch(`${directory.isDefault ? '本地项目' : directory.name} ${directory.path} ${directory.entryPath ?? ''}`, token))
}
function directorySearch(directory: Workspace): string {
  return directoryMatches(directory) ? '' : searchQuery.value
}
function showDirectory(directory: Workspace): boolean {
  return !searchQuery.value.trim() || directoryMatches(directory) || searchMatches.value[directory.id] === true
}
const visibleDirectoryCount = computed(() => repositories.value.filter(showDirectory).length)

const repositories = computed(() => ws.list.filter(w => !w.hidden && w.kind === 'project'))
let loadSequence = 0
async function load(): Promise<void> {
  const sequence = ++loadSequence
  const results = await Promise.all(repositories.value.map(async repository => {
    const result = await call('git.capability', { workspaceId: repository.id })
    return [repository.id, result.ok ? result.data : null] as const
  }))
  if (sequence !== loadSequence) return
  capabilities.value = Object.fromEntries(results.filter((entry): entry is readonly [string, GitCapability] => entry[1] !== null))
}
async function chooseDirectory(): Promise<void> {
  const mode = await ui.askPrompt({ title: '添加目录', message: '关联本地目录，或克隆 Git 仓库。', defaultValue: 'local', options: [{ label: '本地目录', value: 'local' }, { label: 'Git 仓库', value: 'remote' }], confirmLabel: '继续' })
  if (mode === 'local' || mode === 'remote') await add(mode)
}
async function add(mode: 'local' | 'remote'): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    let result
    if (mode === 'local') {
      const picked = await call('system.selectDirectory', { title: '选择本地目录', buttonLabel: '关联目录' })
      if (!picked.ok || !picked.data) return
      const name = await ui.askPrompt({ title: '目录名称', message: '为这个本地目录设置工作台中的名称。', defaultValue: picked.data.path.split('/').at(-1), confirmLabel: '添加目录' })
      if (!name?.trim()) return
      result = await call('workspace.import', { path: picked.data.path, name: name.trim(), kind: 'project' })
    } else {
      const url = await ui.askPrompt({ title: '添加 Git 目录', message: '将仓库克隆为工作台目录，下一步可设置项目入口。', placeholder: 'https://github.com/team/repo.git 或 SSH 地址', confirmLabel: '下一步' })
      if (!url?.trim()) return
      const suggestion = url.trim().split(/[/:]/).at(-1)?.replace(/\.git$/, '') || 'repository'
      const name = await ui.askPrompt({ title: '目录名称', message: '为这个 Git 目录设置名称。', defaultValue: suggestion, confirmLabel: '选择保存位置' })
      if (!name?.trim()) return
      const picked = await call('system.selectDirectory', { title: '选择仓库保存位置', buttonLabel: '克隆到这里' })
      if (!picked.ok || !picked.data) return
      result = await call('workspace.clone', { url: url.trim(), parentDir: picked.data.path, name: name.trim(), kind: 'project' })
    }
    if (!result.ok) { error.value = result.message; return }
    await ws.refresh()
    await ws.setActive(result.data.id)
    await load()

    if (mode === 'remote') await setEntry(result.data)
    const existing = await call('editor.entryKind', { workspaceId: result.data.id, relPath: 'features/默认分组' })
    if (existing.ok && existing.data.kind === 'missing') {
      const created = await call('editor.writeTextFile', { workspaceId: result.data.id, relPath: 'features/默认分组/.gitkeep', content: '', scope: 'project' })
      if (!created.ok) ui.showToast('error', `默认分组创建失败：${created.message}`)
    }
    await loadRecent()
    ui.showToast('success', '目录已添加')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally { busy.value = false }
}
function unbind(repository: Workspace): void {
  if (busy.value) return
  ui.askConfirm({
    title: '解绑目录',
    message: repository.isDefault
      ? `解除「${repository.name}」的远端绑定。本地文件、分支和提交历史都会保留。`
      : `从工作台解绑目录「${repository.name}」。本地目录、Git 远端配置和提交历史都会保留，可随时重新添加。`,
    confirmLabel: '解绑',
    onConfirm: async () => {
      busy.value = true
      try {
        if (!repository.isDefault) {
          for (const tab of [...preview.tabs]) {
            if (tab.project?.workspaceId === repository.id) preview.closeTab(tab.id)
          }
          if (preview.tabs.some(tab => tab.project?.workspaceId === repository.id)) return
        }
        const result = repository.isDefault
          ? await call('git.unbind', { workspaceId: repository.id })
          : await call('workspace.remove', { id: repository.id, deleteFiles: false })
        if (!result.ok) { error.value = result.message; return }
        await ws.refresh()
        if (!ws.active || ws.activeId === repository.id && !repository.isDefault) {
          const fallback = ws.list.find(w => w.isDefault) ?? ws.list[0]
          if (fallback) await ws.setActive(fallback.id)
        }
        await load()

        await loadRecent()
        ui.showToast('success', '目录已解绑，本地文件已保留')
      } finally { busy.value = false }
    }
  })
}
function isGitDirectory(id: string): boolean {
  const capability = capabilities.value[id]
  return !!capability && capability.state !== 'unbound'
}
const recent = ref<Array<{ workspace: Workspace; card: FeatureCard }>>([])
let recentSequence = 0
async function loadRecent(): Promise<void> {
  const sequence = ++recentSequence
  const results = await Promise.all(repositories.value.map(async workspace => {
    const result = await call('feature.list', { workspaceId: workspace.id })
    return result.ok ? result.data.map(card => ({ workspace, card })) : []
  }))
  if (sequence === recentSequence) recent.value = results.flat().sort((a, b) => (b.card.modifiedAt ?? '').localeCompare(a.card.modifiedAt ?? '')).slice(0, 6)
}
let recentReloadTimer: ReturnType<typeof setTimeout> | undefined
function scheduleRecentReload(): void {
  clearTimeout(recentReloadTimer)
  recentReloadTimer = setTimeout(() => { void loadRecent(); void load() }, 150)
}
onBeforeUnmount(() => clearTimeout(recentReloadTimer))
async function openRecent(item: { workspace: Workspace; card: FeatureCard }): Promise<void> {
  await ws.setActive(item.workspace.id)
  const project = createPreviewProjectContext(item.workspace.id, ws.personalSpace?.slug ?? '__public__', item.card.relPath, item.card.name)
  preview.openProject({ project, primaryRelPath: item.card.uiArtifacts[0]?.htmlRelPath ?? item.card.prdRelPath ?? undefined })
}
async function setEntry(directory: Workspace): Promise<void> {
  const choice = await ui.askPrompt({ title: '设置项目入口', message: '选择项目所在的目录，按入口下 features/ 的约定展示分组与项目。', defaultValue: directory.entryPath ? 'pick' : 'default', options: [{ label: '使用默认入口（仓库根目录）', value: 'default' }, { label: '选择仓库内的目录', value: 'pick' }], confirmLabel: '继续' })
  if (choice === null) return
  let value = ''
  if (choice === 'pick') {
    const picked = await call('system.selectDirectory', { title: '选择仓库内的项目入口', buttonLabel: '设为入口' })
    if (!picked.ok || !picked.data) return
    const root = (directory.directoryRoot ?? directory.path).replace(/\/+$/, '')
    if (picked.data.path !== root && !picked.data.path.startsWith(`${root}/`)) { ui.showToast('error', '请选择当前 Git 目录内的子目录'); return }
    value = picked.data.path === root ? '' : picked.data.path.slice(root.length + 1)
  } else if (choice !== 'default') return
  for (const tab of [...preview.tabs]) if (tab.project?.workspaceId === directory.id) preview.closeTab(tab.id)
  if (preview.tabs.some(tab => tab.project?.workspaceId === directory.id)) return
  const result = await call('workspace.setEntry', { id: directory.id, entryPath: value.trim() })
  if (!result.ok) { ui.showToast('error', result.message); return }
  await ws.refresh()
  await loadRecent()
}
async function rename(directory: Workspace): Promise<void> {
  const value = await ui.askPrompt({ title: '重命名目录', defaultValue: directory.name, confirmLabel: '保存' })
  if (value?.trim()) await ws.rename(directory.id, value.trim())
}
const collapsed = ref(new Set<string>())
function toggleDirectory(id: string): void {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  collapsed.value = next
}
onMounted(() => { void load(); void loadRecent() })
watch(() => ws.list.map(w => `${w.id}:${w.path}`).join(','), () => { void load(); void loadRecent() })
</script>

<template>
  <main class="workbench-page">
    <PlantPageHeader title="工作台" description="按目录整理项目，在项目分组内开始工作。" kind="workbench">
      <template #actions><div class="workbench-actions"><label class="workbench-search"><Search :size="16" aria-hidden="true" /><input v-model="searchQuery" type="search" placeholder="搜索目录、分组和项目…" aria-label="搜索工作台所有目录和项目" autocomplete="off" /></label><Button size="icon" class="workbench-add" :disabled="busy" title="添加目录" aria-label="添加目录" @click="chooseDirectory"><Loader2 v-if="busy" class="animate-spin" :size="16" /><Plus v-else :size="18" /></Button></div></template>
    </PlantPageHeader>
    <div class="workbench-content">

      <p v-if="error" role="alert" class="workbench-error">{{ error }}</p>
      <section v-if="!searchQuery.trim()" class="workbench-recent" aria-labelledby="recent-title">
        <h2 id="recent-title">最近编辑</h2>
        <p v-if="!recent.length" class="recent-empty">暂无最近编辑的项目。在目录内新建项目后，会显示在这里。</p>
        <div v-else class="workbench-recent__grid">
          <button v-for="item in recent" :key="`${item.workspace.id}:${item.card.relPath}`" class="recent-project" :title="`${item.card.name} · ${item.workspace.isDefault ? '本地项目' : item.workspace.name} / ${item.card.group ?? '未分组'}\n编辑于 ${formatDateTimeMinute(item.card.modifiedAt, '未记录编辑时间')}`" @click="openRecent(item)">
            <FolderKanban class="recent-project__icon" :size="16" aria-hidden="true" />
            <strong>{{ item.card.name }}</strong>
            <span>{{ item.workspace.isDefault ? '本地项目' : item.workspace.name }}</span>
          </button>
        </div>
      </section>
      <section class="workbench-directories" aria-label="工作台目录">
        <p v-if="searchQuery.trim() && !visibleDirectoryCount" class="recent-empty">没有匹配「{{ searchQuery.trim() }}」的目录、项目分组或项目。</p>
        <article v-for="directory in repositories" v-show="showDirectory(directory)" :key="`${directory.id}:${directory.path}`" class="workbench-directory">
          <header class="directory-heading">
            <button class="directory-toggle" :aria-expanded="!!searchQuery.trim() || !collapsed.has(directory.id)" @click="toggleDirectory(directory.id)"><ChevronDown :size="14" :class="{ 'is-collapsed': !searchQuery.trim() && collapsed.has(directory.id) }" /><GitBranch v-if="isGitDirectory(directory.id)" :size="16" /><FolderOpen v-else :size="16" /><strong>{{ directory.isDefault ? '本地项目' : directory.name }}</strong></button>
            <span class="directory-path" :title="directory.path">{{ directory.path }}</span>
            <div class="directory-actions">
              <div :id="`directory-actions-${directory.id}`" class="directory-project-actions" />
            </div>
          </header>
          <div v-show="!!searchQuery.trim() || !collapsed.has(directory.id)">
            <FeaturesPage :workspace-id="directory.id" :search-query="directorySearch(directory)" :actions-target="`#directory-actions-${directory.id}`" @search-match="searchMatches[directory.id] = $event" @changed="scheduleRecentReload">
              <template v-if="isGitDirectory(directory.id) || !directory.isDefault" #directory-menu>
                <DropdownMenuItem v-if="isGitDirectory(directory.id)" :disabled="busy" @select="setEntry(directory)">设置入口</DropdownMenuItem>
                <DropdownMenuItem v-if="!directory.isDefault" :disabled="busy" @select="rename(directory)">重命名目录</DropdownMenuItem>
                <DropdownMenuItem v-if="!directory.isDefault" :disabled="busy" @select="unbind(directory)">移除目录关联</DropdownMenuItem>
              </template>
            </FeaturesPage>
          </div>
        </article>
      </section>
    </div>
  </main>
</template>

<style scoped>
.workbench-page { min-width: 0; flex: 1; overflow-y: auto; color: var(--color-text-primary); }
.workbench-content { padding: 8px 24px 24px; }
.workbench-actions { display: flex; align-items: center; gap: 10px; }
.workbench-add { width: 34px; height: 34px; padding: 0; flex: none; }
.workbench-recent { margin-bottom: 14px; }
.recent-empty { margin: 0; padding: 10px 12px; border: 0; background: var(--color-card-group); border-radius: 12px; font-size: 12px; color: var(--color-text-muted); }
.workbench-recent h2, .directory-list-heading h2 { font-size: 15px; font-weight: 650; margin: 0 0 8px; }
.workbench-recent__grid { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; }
.recent-project { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; max-width: 260px; height: 30px; padding: 0 10px; border: 0; border-radius: 10px; background: var(--color-card-surface); text-align: left; }
.recent-project:hover { background: var(--color-card-hover); }
.recent-project:focus-visible { outline: 2px solid var(--color-leaf); outline-offset: 2px; }
.recent-project strong { min-width: 0; font-size: 12px; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.recent-project > span { max-width: 80px; font-size: 10px; color: var(--color-text-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.recent-project__icon { flex: none; color: var(--color-leaf); }
.directory-list-heading { display: flex; gap: 10px; align-items: baseline; }
.directory-list-heading > span { font-size: 11px; color: var(--color-text-muted); }
.workbench-directory { margin-bottom: 16px; border: 0; border-radius: 16px; background: var(--color-card-group); overflow: hidden; }
.directory-heading { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 0; }
.directory-toggle { display: flex; align-items: center; gap: 7px; min-width: 0; flex-shrink: 0; text-align: left; }
.directory-toggle strong { font-size: 13px; max-width: 160px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.directory-toggle svg { flex: none; color: var(--color-leaf); transition: transform 160ms; }
.directory-toggle .is-collapsed { transform: rotate(-90deg); }
.directory-actions { display: flex; flex: none; align-items: center; gap: 8px; font-size: 11px; color: var(--color-text-muted); }
.directory-actions > button { padding: 4px 2px; }
.directory-actions button:hover { color: var(--color-leaf); }
.directory-project-actions { display: flex; }
.directory-path { min-width: 40px; flex: 1; font-size: 11px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.workbench-search { display: flex; align-items: center; gap: 8px; width: clamp(180px, 28vw, 400px); height: 34px; padding: 0 11px; margin-bottom: 0; border: 1px solid var(--color-border); border-radius: var(--radius-control); background: var(--color-bg-elevated); color: var(--color-text-muted); transition: border-color 160ms ease, box-shadow 160ms ease; }
.workbench-search:focus-within { border-color: var(--color-leaf); box-shadow: 0 0 0 3px var(--color-accent-light); }
.workbench-search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--color-text-primary); font-size: 12px; }
.workbench-error { color: var(--color-error); font-size: 12px; }
@media (max-width: 760px) { .workbench-content { padding: 16px 14px 32px; } .directory-heading { gap: 8px; overflow-x: auto; } .directory-path { display: none; } .workbench-actions { width: 100%; } .workbench-search { width: auto; flex: 1; } }
</style>
