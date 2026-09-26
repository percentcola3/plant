<script setup lang="ts">
// 默认工作台的资源包 / 技能配置页。

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  ExternalRef,
  ExternalRefSyncStatus,
  GitCapability,
  GitStatus,
  WorkspaceSearchTrace,
  WorkspaceTextSearchResultItem
} from '@shared/types'
import { isSimpleWorkspace, supportsPersonalSpaces } from '@shared/workspace-policy'
import { useEditorStore } from '@/stores/editor'
import { formatExternalCheckout } from '@shared/external-ref-controls'
import {
  BUILTIN_RESOURCE_PACKAGES,
  type BuiltinResourcePackage
} from '@shared/builtin-resource-packages'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useExternalRefsStore } from '@/stores/external-refs'
import { useUiStore } from '@/stores/ui'
import { call } from '@/lib/api'
import { shouldShowRemoteSyncButton } from '@/lib/git-sync-visibility'
import { autoCommitMessage } from '@/lib/auto-commit-message'
import { formatWorkspaceGitSummary } from '@/lib/workspace-git-summary'
import { shouldApplyWorkspaceGitStatusResult } from '@/lib/workspace-git-status-request'
import { shouldRequestWorkspaceGitStatus } from '@/lib/workspace-capabilities'
import SkillsList from '@/components/layout/SkillsList.vue'
import ProjectRulesPanel from '@/components/layout/ProjectRulesPanel.vue'
import ResourceIndexStatus from '@/components/layout/ResourceIndexStatus.vue'
import { Button } from '@/components/ui/button'
import { GitBranch, PackageOpen, Sparkles } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ConfigSection = 'all' | 'resources' | 'skills'

// embedded=true 仅用于历史容器；主导航分别打开资源包和技能页面。
const props = withDefaults(defineProps<{ embedded?: boolean; section?: ConfigSection }>(), {
  embedded: false,
  section: 'all'
})
const embedded = computed(() => props.embedded)
const showResources = computed(() => props.section === 'all' || props.section === 'resources')
const showSkills = computed(() => props.section === 'all' || props.section === 'skills')
const pageTitle = computed(() => props.section === 'skills' ? '技能' : '资源包')
const pageDescription = computed(() => props.section === 'skills'
  ? '管理 AI 在当前工作台中可使用的技能与全局规则。'
  : '管理知识库、UX 资产和默认剪页资源。')

const ws = useWorkspacesStore()
const ext = useExternalRefsStore()
const ui = useUiStore()
const editor = useEditorStore()
const { active, scan } = storeToRefs(ws)

const projectScan = computed(() => scan.value?.kind === 'project' ? scan.value : null)
const personalSpace = computed(() =>
  active.value && supportsPersonalSpaces(active.value)
    && (scan.value?.kind === 'project' || scan.value?.kind === 'ux')
    ? scan.value.personalSpace
    : null
)
const supportsLegacyCollaboration = computed(() => !!active.value && supportsPersonalSpaces(active.value))

// 全项目文本搜索：用户输入触发后弹窗展示结果（不内嵌进配置面板，避免占用版面）。
const searchQuery = ref('')
const searchLoading = ref(false)
const searchResults = ref<WorkspaceTextSearchResultItem[]>([])
const searchTrace = ref<WorkspaceSearchTrace | null>(null)
const hasSearched = ref(false)
const searchDialogOpen = ref(false)
const gitStatus = ref<GitStatus | null>(null)
const statusLoading = ref(false)
let gitStatusRequestSeq = 0
type WorkspaceSearchResult = Extract<WorkspaceTextSearchResultItem, { source: 'workspace' }>
type ExternalSearchResult = Extract<WorkspaceTextSearchResultItem, { source: 'external' }>
const workspaceSearchResults = computed((): WorkspaceSearchResult[] =>
  searchResults.value.filter((item): item is WorkspaceSearchResult => item.source === 'workspace')
)
const externalSearchResults = computed((): ExternalSearchResult[] =>
  searchResults.value.filter((item): item is ExternalSearchResult => item.source === 'external')
)
const hasGitUpdates = computed(() => shouldShowRemoteSyncButton(gitStatus.value))
const gitSummary = computed(() => {
  if (!gitStatus.value) return null
  return formatWorkspaceGitSummary({
    branch: gitStatus.value.branch,
    defaultBranch: active.value?.defaultBranch,
    hasRemote: gitStatus.value.hasRemote,
    ahead: gitStatus.value.ahead,
    modifiedCount: gitStatus.value.modifiedCount,
    behind: gitStatus.value.behind
  })
})

async function runProjectSearch(): Promise<void> {
  const query = searchQuery.value.trim()
  if (!query || !active.value) {
    searchResults.value = []
    searchTrace.value = null
    hasSearched.value = false
    return
  }
  searchLoading.value = true
  hasSearched.value = true
  searchDialogOpen.value = true
  const r = await call('workspace.search', { workspaceId: active.value.id, query })
  searchLoading.value = false
  if (!r.ok) {
    ui.showToast('error', `搜索失败：${r.message}`, 4500)
    return
  }
  searchResults.value = r.data.results
  searchTrace.value = r.data.trace
}

function resetProjectSearch(): void {
  searchQuery.value = ''
  searchResults.value = []
  searchTrace.value = null
  hasSearched.value = false
  searchLoading.value = false
  searchDialogOpen.value = false
}

function searchEngineLabel(result: WorkspaceTextSearchResultItem): string {
  if (result.engine === 'zg') return result.matchedBy ? `zg · ${result.matchedBy}` : 'zg'
  return '文本扫描'
}

const searchTraceSummary = computed(() => {
  const trace = searchTrace.value
  if (!trace) return '项目文件 + 知识库'
  const parts = [`项目文件 + 知识库`]
  if (trace.zgRoots > 0) parts.push(`zg ${trace.zgRoots} 个目录`)
  if (trace.legacyRoots > 0) parts.push(`文本扫描 ${trace.legacyRoots} 个目录`)
  if (!trace.zgAvailable) parts.push('未检测到 zg')
  parts.push(`${trace.durationMs}ms`)
  return parts.join(' · ')
})

async function openSearchResult(result: WorkspaceTextSearchResultItem): Promise<void> {
  searchDialogOpen.value = false
  if (result.source === 'external') {
    ui.openExternalView(result.externalAlias, result.relPath)
    return
  }
  if (/\.(md|mdx|markdown|txt)$/i.test(result.relPath)) {
    await editor.openMarkdown(result.relPath)
    return
  }
  if (/\.css$/i.test(result.relPath)) {
    await editor.openCss(result.relPath)
    return
  }
  await editor.openHtml(result.relPath)
}

async function refreshGitStatus(): Promise<void> {
  const current = active.value
  if (!current) {
    gitStatusRequestSeq += 1
    gitStatus.value = null
    statusLoading.value = false
    return
  }
  const requestSeq = ++gitStatusRequestSeq
  statusLoading.value = true
  try {
    let capability: GitCapability | null = null
    if (isSimpleWorkspace(current)) {
      const capabilityResult = await call('git.capability', { workspaceId: current.id })
      if (active.value?.id !== current.id) return
      capability = capabilityResult.ok ? capabilityResult.data : { state: 'unbound' }
    }
    if (!shouldRequestWorkspaceGitStatus(current, capability)) {
      gitStatus.value = null
      return
    }
    const r = await call('git.status', { workspaceId: current.id })
    if (!shouldApplyWorkspaceGitStatusResult({
      workspaceId: current.id,
      activeWorkspaceId: active.value?.id,
      requestSeq,
      latestSeq: gitStatusRequestSeq
    })) return
    gitStatus.value = r.ok ? r.data : null
  } finally {
    if (shouldApplyWorkspaceGitStatusResult({
      workspaceId: current.id,
      activeWorkspaceId: active.value?.id,
      requestSeq,
      latestSeq: gitStatusRequestSeq
    })) {
      statusLoading.value = false
    }
  }
}

async function startSync(): Promise<void> {
  if (!active.value) return
  const status = await call('git.status', { workspaceId: active.value.id })
  const commitMessage = status.ok && status.data.isDirty ? autoCommitMessage('sync') : undefined
  ui.openSyncProgress(active.value.id, commitMessage, 'remote')
}

function openBranchHistory(): void {
  if (!active.value) return
  ui.openBranchHistory({
    workspaceId: active.value.id,
    workspaceName: active.value.name,
    branch: gitStatus.value?.branch ?? active.value.defaultBranch,
    defaultBranch: active.value.defaultBranch
  })
}
const warnings = computed(() => projectScan.value?.warnings ?? [])
const hasExternalWarning = computed(() => warnings.value.some((item) => item.includes('外部依赖')))
const projectResolvedBindings = computed(() =>
  (projectScan.value?.refs ?? []).map((binding) => {
    const ref = ext.pool.find((item) => item.id === binding.externalRefId) ?? null
    return { binding, ref }
  })
)
const projectKnowledgeBindings = computed(() =>
  projectResolvedBindings.value.filter((item) => item.ref?.category === 'knowledge')
)
const builtinKnowledgePackages = computed(() =>
  BUILTIN_RESOURCE_PACKAGES.filter((item) =>
    item.category === 'knowledge' && !isBuiltinResourceBound(item)
  )
)
const builtinUikitPackages = computed(() =>
  BUILTIN_RESOURCE_PACKAGES.filter((item) =>
    item.category === 'uikit' && !isBuiltinResourceBound(item)
  )
)
const projectUikitBindings = computed(() =>
  projectResolvedBindings.value.filter((item) => item.ref?.category === 'uikit')
)
const hasExternalUpdates = computed(() =>
  projectResolvedBindings.value.some((item) =>
    !!item.ref && ext.syncStatusById[item.ref.id]?.hasUpdates === true
  )
)
const hydratingExternal = ref(false)
const buildingExternalIndex = ref<Record<string, boolean>>({})
const checkingExternalStatus = ref<Record<string, boolean>>({})
const refreshingExternal = ref<Record<string, boolean>>({})
const switchingExternal = ref<Record<string, boolean>>({})
const installingBuiltinUrl = ref<string | null>(null)
let resourceIndexPollTimer: ReturnType<typeof setInterval> | null = null

type ExternalBranchState = {
  loading: boolean
  error: string | null
  branches: string[]
  current: string | null
  query: string
}

const branchMenuOpenFor = ref<string | null>(null)
const externalBranchState = ref<Record<string, ExternalBranchState>>({})

async function detachExternal(externalRefId: string): Promise<void> {
  if (!active.value) return
  await ext.detach(active.value.id, externalRefId)
  delete ext.syncStatusById[externalRefId]
  await ws.refreshScan(active.value.id)
}

function installedBuiltinResource(preset: BuiltinResourcePackage): ExternalRef | null {
  return ext.pool.find((item) => item.kind === 'git' && item.source === preset.url) ?? null
}

function isBuiltinResourceBound(preset: BuiltinResourcePackage): boolean {
  const installed = installedBuiltinResource(preset)
  return !!installed && ext.bindings.some((binding) => binding.externalRefId === installed.id)
}

function builtinResourceAliasTaken(preset: BuiltinResourcePackage): boolean {
  return !installedBuiltinResource(preset) && ext.pool.some((item) => item.alias === preset.alias)
}

function builtinResourceStatus(preset: BuiltinResourcePackage): string {
  if (builtinResourceAliasTaken(preset)) return '同名资源包已存在'
  if (installedBuiltinResource(preset)) return '已 Clone 到本地，尚未绑定当前项目'
  return '未下载 · 点击后 Clone 到本地并绑定'
}

function builtinResourceActionLabel(preset: BuiltinResourcePackage): string {
  if (installingBuiltinUrl.value === preset.url) {
    return installedBuiltinResource(preset) ? '绑定中…' : 'Clone 中…'
  }
  if (builtinResourceAliasTaken(preset)) return '别名已占用'
  return installedBuiltinResource(preset) ? '绑定' : 'Clone 并绑定'
}

async function installBuiltinResource(preset: BuiltinResourcePackage): Promise<void> {
  if (!active.value || active.value.kind !== 'project' || installingBuiltinUrl.value) return
  if (isBuiltinResourceBound(preset) || builtinResourceAliasTaken(preset)) return
  const workspaceId = active.value.id
  installingBuiltinUrl.value = preset.url
  try {
    let resource = installedBuiltinResource(preset)
    if (!resource) {
      const created = await ext.addToPool(preset.alias, preset.category, {
        kind: 'git',
        url: preset.url
      })
      if (!created.ok) {
        if (created.code === 'SSH_KEY_REQUIRED' || created.code === 'SSH_AUTH_FAILED') {
          ui.showToast('info', created.message, 8000)
          ui.openSettings('ssh')
          return
        }
        ui.showToast('error', `${preset.alias} Clone 失败：${created.message}`, 6000)
        return
      }
      resource = created.data
    }
    if (active.value?.id !== workspaceId) return
    await ext.attach(workspaceId, resource.id)
    await ws.refreshScan(workspaceId)
    await checkExternalRefStatus(resource.id)
    ui.showToast('success', `${preset.alias} 已 Clone 并绑定`)
  } catch (error) {
    ui.showToast('error', `${preset.alias} 绑定失败：${error instanceof Error ? error.message : String(error)}`, 6000)
  } finally {
    installingBuiltinUrl.value = null
  }
}

async function hydrateExternalRefs(): Promise<void> {
  if (!active.value || active.value.kind !== 'project') return
  hydratingExternal.value = true
  try {
    const r = await call('external.hydrate', { workspaceId: active.value.id })
    if (!r.ok) {
      ui.showToast('error', `外联更新失败：${r.message}`, 6000)
      return
    }
    await ext.refreshPool()
    await ext.refreshBindings(active.value.id)
    await ws.refreshScan(active.value.id)
    await checkProjectExternalStatuses()
    if (r.data.warnings.length > 0) {
      const suffix = r.data.warnings.length > 1 ? `（另有 ${r.data.warnings.length - 1} 条）` : ''
      ui.showToast('error', `${r.data.warnings[0]}${suffix}`, 7000)
      return
    }
    ui.showToast('success', r.data.mounted.length > 0 ? '外联已更新' : '没有需要更新的外联')
  } finally {
    hydratingExternal.value = false
  }
}

function openExternal(alias: string): void { ui.openExternalView(alias) }

async function buildExternalIndex(ref: ExternalRef): Promise<void> {
  if (buildingExternalIndex.value[ref.id]) return
  buildingExternalIndex.value = { ...buildingExternalIndex.value, [ref.id]: true }
  try {
    const result = await ext.buildIndex(ref.id)
    if (!result.ok) {
      ui.showToast('error', `索引构建失败：${result.message}`, 5000)
      return
    }
    ui.showToast('success', `${ref.alias} 已进入索引构建队列`)
  } finally {
    buildingExternalIndex.value = { ...buildingExternalIndex.value, [ref.id]: false }
  }
}

function externalSyncStatusText(
  kind: 'git' | 'local' | undefined,
  status: ExternalRefSyncStatus | null | undefined,
  checking: boolean
): string {
  if (kind !== 'git') return '本地'
  if (checking) return 'Git · 检查中'
  if (!status) return 'Git · 只读'
  if (!status.ok) return 'Git · 检查失败'
  if (status.hasUpdates) return `Git · 远端 +${status.behind}`
  return 'Git · 已是最新'
}

function externalMetaText(
  ref: ExternalRef | null,
  status: ExternalRefSyncStatus | null | undefined,
  checking: boolean
): string {
  const parts = [externalSyncStatusText(ref?.kind, status, checking)]
  if (ref?.kind === 'git') parts.push(formatExternalCheckout(ref.checkout))
  if (ref?.indexStatus?.state === 'queued') parts.push('索引排队中')
  else if (ref?.indexStatus?.state === 'building') parts.push('索引构建中')
  else if (ref?.indexStatus?.state === 'ready') parts.push(`索引 ${ref.indexStatus.fileCount ?? 0} 文件`)
  else if (ref?.indexStatus?.state === 'error') parts.push('索引失败')
  else parts.push('待构建索引')
  parts.push('只读')
  return parts.join(' · ')
}

function defaultExternalBranchSelection(
  ref: ExternalRef,
  branches: string[],
  current: string | null
): string {
  if (ref.checkout?.type === 'branch' && branches.includes(ref.checkout.value)) return ref.checkout.value
  if (current && branches.includes(current)) return current
  return branches[0] ?? ''
}

function externalBranchDisplay(ref: ExternalRef): string {
  if (ref.checkout?.type === 'branch') return ref.checkout.value
  return formatExternalCheckout(ref.checkout)
}

function externalBranchInitialState(): ExternalBranchState {
  return { loading: false, error: null, branches: [], current: null, query: '' }
}

function updateExternalBranchState(refId: string, patch: Partial<ExternalBranchState>): void {
  externalBranchState.value = {
    ...externalBranchState.value,
    [refId]: { ...(externalBranchState.value[refId] ?? externalBranchInitialState()), ...patch }
  }
}

function onExternalBranchQueryInput(refId: string, event: Event): void {
  const target = event.target
  updateExternalBranchState(refId, { query: target instanceof HTMLInputElement ? target.value : '' })
}

function filteredExternalBranches(ref: ExternalRef): string[] {
  const state = externalBranchState.value[ref.id]
  const branches = state?.branches ?? []
  const query = state?.query.trim().toLowerCase() ?? ''
  if (!query) return branches
  return branches.filter((branch) => branch.toLowerCase().includes(query))
}

function externalBranchEmptyText(ref: ExternalRef): string {
  return (externalBranchState.value[ref.id]?.branches.length ?? 0) > 0
    ? '没有匹配的分支'
    : '未检索到可用分支'
}

function closeExternalBranchMenu(): void { branchMenuOpenFor.value = null }

function handleExternalBranchOutsideClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element && target.closest('[data-external-branch-menu-root]'))) {
    closeExternalBranchMenu()
  }
}

function handleExternalBranchKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  closeExternalBranchMenu()
}

async function loadExternalBranches(ref: ExternalRef, alias: string): Promise<void> {
  if (ref.kind !== 'git') return
  updateExternalBranchState(ref.id, { loading: true, error: null })
  const branches = await ext.loadBranches(ref.id)
  if (!branches.ok) {
    updateExternalBranchState(ref.id, { loading: false, error: branches.message, branches: [], current: null })
    ui.showToast('error', `${alias} 分支检索失败：${branches.message}`, 6000)
    return
  }
  updateExternalBranchState(ref.id, {
    loading: false, error: null, branches: branches.data.branches, current: branches.data.current
  })
}

async function toggleExternalBranchMenu(ref: ExternalRef, alias: string): Promise<void> {
  if (ref.kind !== 'git' || switchingExternal.value[ref.id]) return
  if (branchMenuOpenFor.value === ref.id) {
    closeExternalBranchMenu()
    return
  }
  const state = externalBranchState.value[ref.id]
  branchMenuOpenFor.value = ref.id
  updateExternalBranchState(ref.id, { query: '' })
  if (state?.loading || state?.branches.length || state?.error) return
  await loadExternalBranches(ref, alias)
}

function isExternalBranchSelected(ref: ExternalRef, branch: string): boolean {
  const state = externalBranchState.value[ref.id]
  return branch === defaultExternalBranchSelection(ref, state?.branches ?? [], state?.current ?? null)
}

async function selectExternalBranch(ref: ExternalRef, alias: string, branch: string): Promise<void> {
  if (isExternalBranchSelected(ref, branch)) {
    closeExternalBranchMenu()
    return
  }
  await switchExternalCheckout(ref, alias, branch)
}

async function switchExternalCheckout(ref: ExternalRef, alias: string, selected?: string): Promise<void> {
  if (!active.value || ref.kind !== 'git') return
  if (typeof selected !== 'string') { ui.showToast('info', '请选择要切换的分支', 2600); return }
  const branch = selected.trim()
  if (!branch) { ui.showToast('info', '请选择要切换的分支', 2600); return }
  switchingExternal.value = { ...switchingExternal.value, [ref.id]: true }
  const checkout = { type: 'branch' as const, value: branch }
  try {
    const r = await ext.switchCheckout(ref.id, checkout)
    if (!r.ok) {
      ui.showToast('error', `${alias} 切换失败：${r.message}`, 6000)
      return
    }
    updateExternalBranchState(ref.id, { current: branch })
    closeExternalBranchMenu()
    await ws.refreshScan(active.value.id)
    ui.showToast('success', `${alias} 已切换到 ${formatExternalCheckout(checkout)}`)
  } finally {
    switchingExternal.value = { ...switchingExternal.value, [ref.id]: false }
  }
}

async function checkExternalRefStatus(externalRefId: string): Promise<void> {
  checkingExternalStatus.value = { ...checkingExternalStatus.value, [externalRefId]: true }
  try { await ext.checkStatus(externalRefId) }
  finally { checkingExternalStatus.value = { ...checkingExternalStatus.value, [externalRefId]: false } }
}

async function checkProjectExternalStatuses(): Promise<void> {
  const refs = projectResolvedBindings.value
    .map((item) => item.ref)
    .filter((ref): ref is NonNullable<typeof ref> => !!ref && ref.kind === 'git')
  await Promise.all(refs.map((ref) => checkExternalRefStatus(ref.id)))
}

async function refreshExternalRef(externalRefId: string, alias: string): Promise<void> {
  if (!active.value || refreshingExternal.value[externalRefId]) return
  refreshingExternal.value = { ...refreshingExternal.value, [externalRefId]: true }
  try {
    const r = await ext.refresh(externalRefId)
    if (!r.ok) { ui.showToast('error', `${alias} 更新失败：${r.message ?? 'UNKNOWN'}`, 6000); return }
    await ws.refreshScan(active.value.id)
    ui.showToast('success', `${alias} 已更新`)
  } finally {
    refreshingExternal.value = { ...refreshingExternal.value, [externalRefId]: false }
  }
}

async function refreshOutdatedExternalRefs(): Promise<void> {
  const outdated = projectResolvedBindings.value.filter((item) =>
    item.ref?.kind === 'git' && ext.syncStatusById[item.ref.id]?.hasUpdates === true
  )
  for (const item of outdated) {
    if (item.ref) await refreshExternalRef(item.ref.id, item.binding.alias)
  }
}

async function loadProjectExternalRefs(): Promise<void> {
  if (!active.value || active.value.kind !== 'project') return
  await ext.refreshPool()
  await ext.refreshBindings(active.value.id)
  await checkProjectExternalStatuses()
}

onMounted(() => {
  window.addEventListener('click', handleExternalBranchOutsideClick)
  window.addEventListener('keydown', handleExternalBranchKeydown)
  void loadProjectExternalRefs()
  void refreshGitStatus()
})

onBeforeUnmount(() => {
  window.removeEventListener('click', handleExternalBranchOutsideClick)
  window.removeEventListener('keydown', handleExternalBranchKeydown)
  if (resourceIndexPollTimer) clearInterval(resourceIndexPollTimer)
})

watch(
  () => projectResolvedBindings.value.some(({ ref }) =>
    !!ref && (
      !ref.indexStatus
      || ref.indexStatus.state === 'missing'
      || ref.indexStatus.state === 'queued'
      || ref.indexStatus.state === 'building'
      // zg 词法索引已就绪、daemon 后台补向量期间继续轮询，直到归零
      || (!!ref.indexStatus.enhancing && ref.indexStatus.enhancing.pending > 0)
    )
  ),
  (shouldPoll) => {
    if (shouldPoll && !resourceIndexPollTimer) {
      resourceIndexPollTimer = setInterval(() => { void ext.refreshPool() }, 2_500)
    } else if (!shouldPoll && resourceIndexPollTimer) {
      clearInterval(resourceIndexPollTimer)
      resourceIndexPollTimer = null
    }
  },
  { immediate: true }
)

watch(() => active.value?.id, () => {
  resetProjectSearch()
  void loadProjectExternalRefs()
  void refreshGitStatus()
})
</script>

<template>
  <main :class="embedded ? 'flex min-w-0 flex-col' : 'flex h-full min-w-0 flex-1 flex-col overflow-hidden'">
    <header v-if="!embedded" class="config-page-header border-b border-border/60 px-6 py-5">
      <div class="config-page-header__icon" aria-hidden="true">
        <Sparkles v-if="props.section === 'skills'" :size="20" />
        <PackageOpen v-else :size="20" />
      </div>
      <div>
        <h1>{{ pageTitle }}</h1>
        <p>{{ pageDescription }}</p>
      </div>
    </header>

    <div v-if="showResources && warnings.length > 0" :class="embedded ? 'warning-strip mb-3' : 'warning-strip mx-5 mt-3'">
      <span class="warning-dot" aria-hidden="true">⚠️</span>
      <span class="truncate">{{ warnings[0] }}</span>
      <span v-if="warnings.length > 1" class="warning-more">+{{ warnings.length - 1 }}</span>
      <button
        v-if="hasExternalWarning"
        type="button"
        class="warning-action"
        :disabled="hydratingExternal"
        @click="hydrateExternalRefs"
      >{{ hydratingExternal ? '更新中…' : '更新外联' }}</button>
    </div>

    <section :class="embedded ? 'space-y-4' : 'min-h-0 flex-1 overflow-y-auto p-5 space-y-4'">
      <!-- 全项目 + 知识库 文本搜索（独立顶部条；结果走弹窗，不内嵌占用版面） -->
      <div v-if="showResources" class="search-form">
        <input
          v-model="searchQuery"
          class="search-input"
          type="search"
          placeholder="全项目 + 知识库 语义搜索…"
          @keydown.enter.prevent="runProjectSearch"
        />
        <Button size="sm" :disabled="searchLoading || !searchQuery.trim()" @click="runProjectSearch">
          {{ searchLoading ? '搜索中…' : '搜索' }}
        </Button>
      </div>
      <p v-if="showResources" class="text-xxs text-muted-foreground/60 -mt-2">
        由 zg 本地混合检索驱动（代码符号 + 文档语义，无需 AI）；索引未就绪时自动回退文本匹配
      </p>

      <!-- 4 张卡片 2 列网格 -->
      <div v-if="showResources" class="config-grid">
      <!-- UI 资产 -->
      <section class="section-block project-section-card">
        <div class="section-head">
          <div>
            <h3><span aria-hidden="true">🎨</span> UX 资产库</h3>
            <p>可同时安装多个组件、Token、图片和图标资源包。</p>
          </div>
          <div class="section-actions">
            <Button
              variant="outline" size="sm"
              @click="ui.addExternalRefOpen = { defaultCategory: 'uikit' }"
            >
              <span aria-hidden="true">＋</span><span>添加</span>
            </Button>
          </div>
        </div>
        <div v-if="builtinUikitPackages.length > 0" class="builtin-knowledge-block">
          <div class="builtin-knowledge-head">
            <span>内置 UX 资产</span>
            <small>只内置 Git 地址，需要时由你手动 Clone 到本地</small>
          </div>
          <ul class="builtin-knowledge-grid">
            <li
              v-for="preset in builtinUikitPackages"
              :key="preset.url"
              class="builtin-knowledge-card"
            >
              <span class="builtin-knowledge-icon" aria-hidden="true">
                <GitBranch :size="17" />
              </span>
              <div class="builtin-knowledge-copy">
                <strong>{{ preset.alias }}</strong>
                <span>{{ preset.description }}</span>
              </div>
              <Button
                size="sm"
                class="builtin-knowledge-action"
                :disabled="installingBuiltinUrl !== null || builtinResourceAliasTaken(preset)"
                @click="installBuiltinResource(preset)"
              >{{ builtinResourceActionLabel(preset) }}</Button>
              <div class="builtin-knowledge-status">
                <span class="builtin-knowledge-status-dot" aria-hidden="true"></span>
                <span>{{ builtinResourceStatus(preset) }}</span>
              </div>
            </li>
          </ul>
        </div>
        <ul v-if="projectUikitBindings.length > 0" class="knowledge-resource-grid">
          <li v-for="item in projectUikitBindings" :key="item.binding.externalRefId" class="knowledge-resource-card">
            <span class="type-badge type-badge--ui">UX</span>
            <div class="row-main">
              <span class="row-title font-mono">{{ item.binding.alias }}</span>
              <span class="row-sub">{{ externalMetaText(item.ref, item.ref ? ext.syncStatusById[item.ref.id] : null, item.ref ? checkingExternalStatus[item.ref.id] === true : false) }}</span>
              <ResourceIndexStatus
                :status="item.ref?.indexStatus"
                :buildable="!!item.ref"
                :busy="item.ref ? buildingExternalIndex[item.ref.id] === true : false"
                @build="item.ref && buildExternalIndex(item.ref)"
              />
            </div>
            <div class="row-actions knowledge-resource-actions">
            <button
              v-if="item.ref?.kind === 'git' && ext.syncStatusById[item.ref.id]?.hasUpdates"
              type="button" class="row-action row-action--primary"
              :disabled="refreshingExternal[item.ref.id] === true"
              @click="refreshExternalRef(item.ref.id, item.binding.alias)"
            >{{ refreshingExternal[item.ref.id] ? '更新中' : '更新' }}</button>
            <button
              v-if="item.ref?.kind === 'git'"
              type="button" class="row-action branch-trigger"
              :class="{ 'branch-trigger--open': branchMenuOpenFor === item.ref.id }"
              :disabled="switchingExternal[item.ref.id] === true"
              data-external-branch-menu-root
              @click.stop="toggleExternalBranchMenu(item.ref, item.binding.alias)"
            >
              <span v-if="switchingExternal[item.ref.id] === true" class="mini-spinner" aria-hidden="true"></span>
              <span>{{ switchingExternal[item.ref.id] === true ? '切换中' : '分支' }}</span>
              <span class="branch-current">{{ externalBranchDisplay(item.ref) }}</span>
              <span class="branch-chevron" aria-hidden="true">⌄</span>
            </button>
            <div
              v-if="item.ref?.kind === 'git' && branchMenuOpenFor === item.ref.id"
              class="external-branch-menu" data-external-branch-menu-root @click.stop
            >
              <div class="branch-menu-head">
                <span>选择分支</span>
                <small>{{ item.binding.alias }}</small>
              </div>
              <input
                class="branch-search" type="search"
                :value="externalBranchState[item.ref.id]?.query ?? ''"
                placeholder="搜索分支"
                :disabled="externalBranchState[item.ref.id]?.loading === true"
                @input="onExternalBranchQueryInput(item.ref.id, $event)"
                @keydown.stop
              />
              <div v-if="externalBranchState[item.ref.id]?.loading" class="branch-menu-state">
                <span class="mini-spinner" aria-hidden="true"></span><span>正在读取分支</span>
              </div>
              <div v-else-if="externalBranchState[item.ref.id]?.error" class="branch-menu-state branch-menu-state--error">
                <span class="truncate">{{ externalBranchState[item.ref.id]?.error }}</span>
                <button type="button" @click="loadExternalBranches(item.ref, item.binding.alias)">重试</button>
              </div>
              <div v-else-if="filteredExternalBranches(item.ref).length === 0" class="branch-menu-state">
                {{ externalBranchEmptyText(item.ref) }}
              </div>
              <div v-else class="branch-menu-list">
                <button
                  v-for="branch in filteredExternalBranches(item.ref)"
                  :key="branch" type="button" class="branch-option"
                  :class="{ 'branch-option--active': isExternalBranchSelected(item.ref, branch) }"
                  :disabled="switchingExternal[item.ref.id] === true"
                  @click="selectExternalBranch(item.ref, item.binding.alias, branch)"
                >
                  <span class="branch-check" aria-hidden="true">{{ isExternalBranchSelected(item.ref, branch) ? '✓' : '' }}</span>
                  <span class="branch-name">{{ branch }}</span>
                </button>
              </div>
              </div>
              <button type="button" class="row-action" @click="openExternal(item.binding.alias)">打开</button>
              <button type="button" class="row-action row-action--danger" @click="detachExternal(item.binding.externalRefId)">移除</button>
            </div>
          </li>
        </ul>
        <div v-else-if="builtinUikitPackages.length === 0" class="empty-state empty-state--compact">
          <p>还没有 UX 资产库</p>
          <span>安装后项目可以按需关联并复用组件、Token 和图片。</span>
        </div>
      </section>

      <!-- 知识库 -->
      <section class="section-block project-section-card">
        <div class="section-head">
          <div>
            <h3><span aria-hidden="true">📚</span> 知识库与剪页</h3>
            <p>剪页、本地资料和外部文档库统一作为只读知识资源包。</p>
          </div>
          <div class="section-actions">
            <Button
              v-if="hasExternalUpdates"
              variant="outline" size="sm"
              :disabled="Object.values(refreshingExternal).some(Boolean)"
              @click="refreshOutdatedExternalRefs"
            >
              <span aria-hidden="true">↻</span><span>更新</span>
            </Button>
            <Button variant="outline" size="sm" @click="ui.addExternalRefOpen = { defaultCategory: 'knowledge' }">
              <span aria-hidden="true">＋</span><span>添加</span>
            </Button>
          </div>
        </div>
        <div v-if="builtinKnowledgePackages.length > 0" class="builtin-knowledge-block">
          <div class="builtin-knowledge-head">
            <span>内置知识库</span>
            <small>只内置 Git 地址，需要时由你手动 Clone 到本地</small>
          </div>
          <ul class="builtin-knowledge-grid">
            <li
              v-for="preset in builtinKnowledgePackages"
              :key="preset.url"
              class="builtin-knowledge-card"
            >
              <span class="builtin-knowledge-icon" aria-hidden="true">
                <GitBranch :size="17" />
              </span>
              <div class="builtin-knowledge-copy">
                <strong>{{ preset.alias }}</strong>
                <span>{{ preset.description }}</span>
              </div>
              <Button
                size="sm"
                class="builtin-knowledge-action"
                :disabled="installingBuiltinUrl !== null || builtinResourceAliasTaken(preset)"
                @click="installBuiltinResource(preset)"
              >{{ builtinResourceActionLabel(preset) }}</Button>
              <div class="builtin-knowledge-status">
                <span class="builtin-knowledge-status-dot" aria-hidden="true"></span>
                <span>{{ builtinResourceStatus(preset) }}</span>
              </div>
            </li>
          </ul>
        </div>
        <ul v-if="projectKnowledgeBindings.length > 0" class="knowledge-resource-grid">
          <li v-for="x in projectKnowledgeBindings" :key="x.binding.alias" class="knowledge-resource-card">
            <span class="type-badge">KB</span>
            <div class="row-main">
              <span class="row-title font-mono">{{ x.binding.alias }}</span>
              <span class="row-sub">{{ externalMetaText(x.ref, x.ref ? ext.syncStatusById[x.ref.id] : null, x.ref ? checkingExternalStatus[x.ref.id] === true : false) }}</span>
              <ResourceIndexStatus
                :status="x.ref?.indexStatus"
                :buildable="!!x.ref"
                :busy="x.ref ? buildingExternalIndex[x.ref.id] === true : false"
                @build="x.ref && buildExternalIndex(x.ref)"
              />
            </div>
            <div class="row-actions knowledge-resource-actions">
              <button
                v-if="x.ref?.kind === 'git' && ext.syncStatusById[x.ref.id]?.hasUpdates"
                type="button" class="row-action row-action--primary"
                :disabled="refreshingExternal[x.ref.id] === true"
                @click="refreshExternalRef(x.ref.id, x.binding.alias)"
              >{{ refreshingExternal[x.ref.id] ? '更新中' : '更新' }}</button>
              <button
                v-if="x.ref?.kind === 'git'"
                type="button" class="row-action branch-trigger"
                :class="{ 'branch-trigger--open': branchMenuOpenFor === x.ref.id }"
                :disabled="switchingExternal[x.ref.id] === true"
                data-external-branch-menu-root
                @click.stop="toggleExternalBranchMenu(x.ref, x.binding.alias)"
              >
                <span v-if="switchingExternal[x.ref.id] === true" class="mini-spinner" aria-hidden="true"></span>
                <span>{{ switchingExternal[x.ref.id] === true ? '切换中' : '分支' }}</span>
                <span class="branch-current">{{ externalBranchDisplay(x.ref) }}</span>
                <span class="branch-chevron" aria-hidden="true">⌄</span>
              </button>
              <div
                v-if="x.ref?.kind === 'git' && branchMenuOpenFor === x.ref.id"
                class="external-branch-menu" data-external-branch-menu-root @click.stop
              >
                <div class="branch-menu-head">
                  <span>选择分支</span><small>{{ x.binding.alias }}</small>
                </div>
                <input
                  class="branch-search" type="search"
                  :value="externalBranchState[x.ref.id]?.query ?? ''"
                  placeholder="搜索分支"
                  :disabled="externalBranchState[x.ref.id]?.loading === true"
                  @input="onExternalBranchQueryInput(x.ref.id, $event)"
                  @keydown.stop
                />
                <div v-if="externalBranchState[x.ref.id]?.loading" class="branch-menu-state">
                  <span class="mini-spinner" aria-hidden="true"></span><span>正在读取分支</span>
                </div>
                <div v-else-if="externalBranchState[x.ref.id]?.error" class="branch-menu-state branch-menu-state--error">
                  <span class="truncate">{{ externalBranchState[x.ref.id]?.error }}</span>
                  <button type="button" @click="loadExternalBranches(x.ref, x.binding.alias)">重试</button>
                </div>
                <div v-else-if="filteredExternalBranches(x.ref).length === 0" class="branch-menu-state">
                  {{ externalBranchEmptyText(x.ref) }}
                </div>
                <div v-else class="branch-menu-list">
                  <button
                    v-for="branch in filteredExternalBranches(x.ref)"
                    :key="branch" type="button" class="branch-option"
                    :class="{ 'branch-option--active': isExternalBranchSelected(x.ref, branch) }"
                    :disabled="switchingExternal[x.ref.id] === true"
                    @click="selectExternalBranch(x.ref, x.binding.alias, branch)"
                  >
                    <span class="branch-check" aria-hidden="true">{{ isExternalBranchSelected(x.ref, branch) ? '✓' : '' }}</span>
                    <span class="branch-name">{{ branch }}</span>
                  </button>
                </div>
              </div>
              <button type="button" class="row-action" @click="openExternal(x.binding.alias)">打开</button>
              <button type="button" class="row-action row-action--danger" @click="detachExternal(x.binding.externalRefId)">移除</button>
            </div>
          </li>
        </ul>
        <div v-else-if="builtinKnowledgePackages.length === 0" class="empty-state empty-state--compact">
          <p>还没引用知识库</p>
          <span>剪页库会自动绑定；也可以添加本地目录或 Git 知识资源包。</span>
        </div>
      </section>

      </div>

      <div v-if="showSkills" class="config-grid config-grid--single">
        <section class="section-block project-section-card">
          <SkillsList />
        </section>

        <section class="section-block project-section-card">
          <ProjectRulesPanel />
        </section>
      </div>
    </section>

    <!-- 搜索结果弹窗 -->
    <Dialog v-model:open="searchDialogOpen">
      <DialogContent class="max-w-[860px]">
        <DialogHeader>
          <DialogTitle>搜索结果</DialogTitle>
          <DialogDescription>
            关键词「{{ searchQuery }}」 · {{ searchTraceSummary }}
          </DialogDescription>
        </DialogHeader>
        <div v-if="searchLoading" class="search-empty">搜索中…</div>
        <div v-else-if="searchResults.length === 0" class="search-empty">没有找到匹配内容。</div>
        <div v-else class="search-columns max-h-[60vh] overflow-y-auto">
          <div class="search-group">
            <div class="search-group-title">项目文件 · {{ workspaceSearchResults.length }}</div>
            <button
              v-for="result in workspaceSearchResults"
              :key="`workspace:${result.relPath}`"
              type="button"
              class="search-result"
              @click="openSearchResult(result)"
            >
              <span class="search-result-title">
                <span class="search-result-path">{{ result.relPath }}</span>
                <em class="search-engine">{{ searchEngineLabel(result) }}</em>
              </span>
              <span class="search-result-snippet">{{ result.snippet }}</span>
            </button>
            <div v-if="workspaceSearchResults.length === 0" class="search-group-empty">无匹配</div>
          </div>
          <div class="search-group">
            <div class="search-group-title">知识库 · {{ externalSearchResults.length }}</div>
            <button
              v-for="result in externalSearchResults"
              :key="`external:${result.externalRefId}:${result.relPath}`"
              type="button"
              class="search-result"
              @click="openSearchResult(result)"
            >
              <span class="search-result-title">
                <span class="search-result-path">{{ result.externalAlias }} / {{ result.relPath }}</span>
                <em class="search-engine">{{ searchEngineLabel(result) }}</em>
              </span>
              <span class="search-result-snippet">{{ result.snippet }}</span>
            </button>
            <div v-if="externalSearchResults.length === 0" class="search-group-empty">无匹配</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </main>
</template>

<style scoped>
.project-hero { display: flex; flex-direction: column; gap: 8px; }
.config-page-header { display: flex; align-items: center; gap: 12px; background: var(--color-bg-panel); }
.config-page-header__icon { display: inline-flex; width: 38px; height: 38px; align-items: center; justify-content: center; border: 1px solid var(--color-accent-border); border-radius: 10px; background: var(--color-accent-light); color: var(--color-accent); }
.config-page-header h1 { margin: 0; color: var(--color-text-primary); font-size: 20px; font-weight: 700; }
.config-page-header p { margin: 3px 0 0; color: var(--color-text-muted); font-size: 12px; }
.hero-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-width: 0; }
.hero-emoji {
  display: inline-flex; width: 36px; height: 36px; flex: 0 0 auto; align-items: center; justify-content: center;
  border: 1px solid var(--color-accent-border); background: var(--color-accent-subtle); border-radius: 10px;
  font-size: 20px; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}
.hero-title { margin: 0; color: var(--color-text-primary); font-size: 22px; line-height: 28px; font-weight: 700; letter-spacing: -0.01em; }
.hero-kind-tag, .hero-space-tag {
  display: inline-flex; align-items: center; gap: 6px; height: 26px;
  border: 1px solid var(--color-accent-border); background: var(--color-accent-subtle); border-radius: 6px;
  padding: 0 10px; color: var(--color-accent-pressed); font-size: 12px; font-weight: 600;
}
.hero-space-tag--missing { border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.12); color: #92400e; }
.hero-row--main .hero-actions { margin-left: auto; display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.hero-row--meta { margin-left: 0; }
.meta-pill {
  display: inline-flex; align-items: center; gap: 4px; height: 22px;
  border: 1px solid var(--color-border); background: var(--color-bg-base); border-radius: 999px;
  padding: 0 10px; color: var(--color-text-secondary); font-family: SF Mono, Menlo, Consolas, monospace; font-size: 11px; cursor: default;
}
.meta-pill--path { max-width: min(560px, 50vw); }
.meta-pill--path .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta-pill--remote { gap: 6px; }
.meta-pill--remote:disabled { opacity: 1; }
.meta-pill--remote-active { border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.08); color: #92400e; cursor: pointer; }
.meta-pill--remote-active:hover { background: rgba(245, 158, 11, 0.16); }
.meta-pill-action { font-weight: 700; font-family: inherit; }

/* 复用 WorkspaceWorkspace 现有卡片样式 — 视觉一致。 */
.warning-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.08);
  padding: 10px 12px;
  color: #92400e;
  font-size: 12px;
}
.warning-dot { display: inline-flex; width: 20px; height: 20px; flex: 0 0 auto; align-items: center; justify-content: center; font-size: 14px; }
.warning-more { flex: 0 0 auto; margin-left: auto; font-weight: 600; }
.warning-action {
  flex: 0 0 auto; border: 1px solid rgba(245, 158, 11, 0.45); border-radius: 6px;
  background: var(--color-bg-base); padding: 4px 10px; color: #92400e; font-size: 12px; font-weight: 600;
}
.warning-action:hover:not(:disabled) { background: rgba(245, 158, 11, 0.12); }
.warning-action:disabled { cursor: not-allowed; opacity: 0.65; }

.section-block { border: 0; padding-bottom: 18px; }
.project-section-card {
  border: 1px solid var(--color-popover-border); border-radius: 8px; background: var(--color-bg-base);
  padding: 14px 16px; box-shadow: 0 10px 28px rgba(15, 23, 42, 0.04);
}
.config-grid--single { grid-template-columns: minmax(0, 1fr); }
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 0 0 12px; }
.section-head > div { min-width: 0; }
.section-head > div:first-child { flex: 1 1 auto; }
.section-head h3 { margin: 0; color: var(--color-text-primary); font-size: 14px; font-weight: 650; }
.section-head h3 span { margin-right: 4px; }
.section-head p { margin: 4px 0 0; color: var(--color-text-secondary); font-size: 12px; }
.section-actions { display: inline-flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }

.row-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.builtin-knowledge-block { margin-bottom: 14px; border-top: 1px solid var(--color-border); padding-top: 12px; }
.builtin-knowledge-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding-bottom: 10px; color: var(--color-text-primary); font-size: 12px; font-weight: 650; }
.builtin-knowledge-head small { color: var(--color-text-secondary); font-size: 11px; font-weight: 400; }
.builtin-knowledge-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
.builtin-knowledge-card {
  display: grid; min-width: 0; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 10px;
  border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-bg-base); padding: 12px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); transition: border-color 160ms ease, box-shadow 160ms ease;
}
.builtin-knowledge-card:hover { border-color: var(--color-accent-border); box-shadow: 0 4px 12px rgba(15, 23, 42, 0.07); }
.builtin-knowledge-icon {
  display: inline-flex; width: 34px; height: 34px; align-items: center; justify-content: center;
  border: 1px solid var(--color-accent-border); border-radius: 8px; background: var(--color-accent-subtle); color: var(--color-accent-pressed);
}
.builtin-knowledge-copy { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.builtin-knowledge-copy strong { overflow: hidden; color: var(--color-text-primary); font-size: 13px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.builtin-knowledge-copy span { overflow: hidden; color: var(--color-text-secondary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.builtin-knowledge-action { min-width: 92px; }
.builtin-knowledge-status {
  display: flex; min-width: 0; grid-column: 2 / 4; align-items: center; gap: 6px;
  border-top: 1px solid var(--color-border); padding-top: 9px; color: var(--color-text-secondary); font-size: 11px;
}
.builtin-knowledge-status-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 999px; background: var(--color-accent); }
.knowledge-resource-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
.knowledge-resource-card {
  display: grid; min-width: 0; grid-template-columns: 34px minmax(0, 1fr); align-items: center; gap: 10px;
  border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-bg-base); padding: 12px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); transition: border-color 160ms ease, box-shadow 160ms ease;
}
.knowledge-resource-card:hover { border-color: var(--color-accent-border); box-shadow: 0 4px 12px rgba(15, 23, 42, 0.07); }
.knowledge-resource-card > .type-badge { width: 34px; height: 34px; border: 1px solid var(--color-accent-border); border-radius: 8px; }
.row-actions.knowledge-resource-actions {
  width: 100%; grid-column: 1 / -1; flex-wrap: wrap; justify-content: flex-start; margin-left: 0;
  border-top: 1px solid var(--color-border); padding-top: 9px;
}
.data-row {
  display: flex; min-height: 44px; align-items: center; gap: 12px; border-radius: 6px;
  padding: 8px 10px; color: var(--color-text-secondary); cursor: pointer; transition: background 120ms ease, color 120ms ease;
}
.data-row--static { cursor: default; }
.data-row--asset { justify-content: flex-start; }
.data-row--asset .row-main { flex: 1 1 auto; max-width: none; }
.row-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.row-title { overflow: hidden; color: var(--color-text-primary); font-size: 13px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.row-sub { overflow: hidden; color: var(--color-text-tertiary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.type-badge {
  display: inline-flex; width: 30px; height: 24px; flex: 0 0 auto; align-items: center; justify-content: center;
  border-radius: 6px; background: var(--color-accent-subtle); color: var(--color-accent-pressed); font-size: 11px; font-weight: 650;
}
.type-badge--ui { background: var(--color-accent-subtle); color: var(--color-accent-pressed); }

.row-actions { display: inline-flex; position: relative; flex: 0 0 auto; align-items: center; gap: 6px; justify-content: flex-end; margin-left: auto; }
.row-action {
  flex: 0 0 auto; border: 0; border-radius: 5px; background: transparent; padding: 4px 6px;
  color: var(--color-text-secondary); font-size: 12px; cursor: pointer;
}
.row-action:hover { background: var(--color-bg-elevated); color: var(--color-text-primary); }
.row-action:disabled { cursor: wait; opacity: 0.55; }
.row-action--primary { background: var(--color-accent-light); color: var(--color-accent-pressed); font-weight: 650; }
.row-action--primary:hover { background: var(--color-accent-subtle); }
.row-action--danger:hover { color: #ff453a; }

.branch-trigger {
  display: inline-flex; max-width: 210px; align-items: center; gap: 5px;
  border: 1px solid transparent; background: var(--color-bg-elevated); padding-inline: 8px;
}
.branch-trigger:hover, .branch-trigger--open {
  border-color: var(--color-accent-border); background: var(--color-bg-base);
  color: var(--color-text-primary); box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}
.branch-current { min-width: 0; max-width: 104px; overflow: hidden; color: var(--color-text-primary); font-family: SF Mono, Menlo, Consolas, monospace; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.branch-chevron { color: var(--color-text-tertiary); font-size: 11px; }

.external-branch-menu {
  position: absolute; right: 0; top: calc(100% + 7px); z-index: 40;
  width: min(280px, calc(100vw - 64px)); overflow: hidden;
  border: 1px solid var(--color-popover-border); border-radius: 8px; background: var(--color-bg-base);
  padding: 6px; box-shadow: 0 18px 42px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);
}
.branch-menu-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 8px 8px; color: var(--color-text-primary); font-size: 12px; font-weight: 650; }
.branch-menu-head small { min-width: 0; overflow: hidden; color: var(--color-text-tertiary); font-family: SF Mono, Menlo, Consolas, monospace; font-size: 11px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.branch-search {
  width: 100%; height: 32px; margin-bottom: 6px; border: 1px solid var(--color-border);
  border-radius: 6px; background: var(--color-bg-base); padding: 0 9px; color: var(--color-text-primary); font-size: 12px; outline: none;
}
.branch-search:focus { border-color: var(--color-accent); box-shadow: 0 0 0 2px var(--color-info-subtle); }
.branch-search:disabled { cursor: wait; opacity: 0.65; }
.branch-menu-list { max-height: 230px; overflow: auto; }
.branch-option {
  display: flex; width: 100%; min-height: 32px; align-items: center; gap: 8px; border: 0; border-radius: 6px;
  background: transparent; padding: 6px 8px; color: var(--color-text-primary); cursor: pointer; text-align: left;
}
.branch-option:hover:not(:disabled), .branch-option--active { background: var(--color-bg-elevated); }
.branch-option--active { color: var(--color-accent-pressed); font-weight: 650; }
.branch-option:disabled { cursor: wait; opacity: 0.6; }
.branch-check { width: 14px; flex: 0 0 auto; color: var(--color-accent-pressed); text-align: center; }
.branch-name { min-width: 0; overflow: hidden; font-family: SF Mono, Menlo, Consolas, monospace; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.branch-menu-state { display: flex; min-height: 44px; align-items: center; justify-content: center; gap: 8px; border-radius: 6px; background: var(--color-bg-subtle); padding: 10px; color: var(--color-text-secondary); font-size: 12px; }
.branch-menu-state--error { justify-content: space-between; background: rgba(255, 69, 58, 0.08); color: #b42318; }
.branch-menu-state--error button { flex: 0 0 auto; border: 1px solid rgba(180, 35, 24, 0.22); border-radius: 5px; background: var(--color-bg-base); padding: 3px 8px; color: #b42318; font-size: 12px; cursor: pointer; }
.mini-spinner { width: 12px; height: 12px; flex: 0 0 auto; border: 2px solid var(--color-accent-border); border-top-color: var(--color-accent); border-radius: 999px; animation: ai-config-spin 0.75s linear infinite; }
@keyframes ai-config-spin { to { transform: rotate(360deg); } }
.empty-state { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 6px 0; border: 1px dashed var(--color-accent-border); border-radius: 8px; background: var(--color-bg-subtle); padding: 18px; color: var(--color-text-secondary); font-size: 12px; }
.empty-state p { margin: 0; color: var(--color-text-primary); font-size: 13px; font-weight: 600; }
.empty-state span { display: block; margin-top: 3px; }
.empty-state--compact { display: block; }

.config-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 960px) {
  .config-grid { grid-template-columns: 1fr; }
}
@media (max-width: 680px) {
  .builtin-knowledge-head { align-items: flex-start; flex-direction: column; gap: 3px; }
  .builtin-knowledge-grid, .knowledge-resource-grid { grid-template-columns: 1fr; }
}

.search-form { display: flex; gap: 10px; }
.search-input {
  min-width: 0; flex: 1; height: 34px; border: 1px solid var(--color-border);
  border-radius: 6px; background: var(--color-bg-base); padding: 0 10px;
  color: var(--color-text-primary); font-size: 13px; outline: none;
}
.search-input:focus { border-color: var(--color-accent); box-shadow: 0 0 0 2px var(--color-info-subtle); }
.search-results { }
.search-empty, .search-group-empty {
  border-radius: 6px; background: var(--color-bg-subtle); padding: 14px;
  color: var(--color-text-tertiary); font-size: 12px; text-align: center;
}
.search-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.search-group {
  min-width: 0; max-height: 280px; overflow: auto; border: 1px solid var(--color-border);
  border-radius: 8px; background: var(--color-bg-subtle); padding: 8px;
}
.search-group-title { padding: 2px 4px 8px; color: var(--color-text-secondary); font-size: 12px; font-weight: 600; }
.search-result {
  display: block; width: 100%; border-radius: 6px; background: var(--color-bg-base);
  padding: 8px; text-align: left;
}
.search-result + .search-result { margin-top: 6px; }
.search-result:hover { background: var(--color-bg-elevated); }
.search-result-title, .search-result-snippet { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.search-result-title { display: flex; align-items: center; gap: 8px; color: var(--color-text-primary); font-family: SF Mono, Menlo, Consolas, monospace; font-size: 12px; font-weight: 650; white-space: nowrap; }
.search-result-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.search-engine {
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--color-accent-subtle);
  padding: 1px 7px;
  color: var(--color-accent-pressed);
  font-family: inherit;
  font-size: 10px;
  font-style: normal;
  font-weight: 650;
}
.search-result-snippet { margin-top: 4px; color: var(--color-text-secondary); display: -webkit-box; font-size: 12px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
</style>
