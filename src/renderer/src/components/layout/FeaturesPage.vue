<script setup lang="ts">
// 项目管理：集中处理项目的创建、导入、重命名、分组和删除。

import { computed, onMounted, ref, watch } from 'vue'
import { ArrowRight, Ellipsis, FolderPlus, GitBranch, Plus, RefreshCw } from 'lucide-vue-next'
import type { FeatureCard, GitCapability, GitStatus, PersonalSpace } from '@shared/types'
import { isSimpleWorkspace, supportsPersonalSpaces } from '@shared/workspace-policy'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useUiStore } from '@/stores/ui'
import { usePreviewStore } from '@/stores/preview'
import { useExternalRefsStore } from '@/stores/external-refs'
import { call } from '@/lib/api'
import { pushToTeamSpaceFromUi } from '@/lib/team-push'
import { createPreviewProjectContext } from '@/lib/preview/preview-project'
import { autoCommitMessage } from '@/lib/auto-commit-message'
import { formatWorkspaceGitSummary } from '@/lib/workspace-git-summary'
import { shouldApplyWorkspaceGitStatusResult } from '@/lib/workspace-git-status-request'
import { shouldRequestWorkspaceGitStatus } from '@/lib/workspace-capabilities'
import { formatDateTimeMinute } from '@/lib/date-format'
import { featureMatchesSearch as matchesFeatureSearch, fuzzyMatch } from '@/lib/feature-search'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import ProjectCardMoreMenu from '@/components/layout/ProjectCardMoreMenu.vue'
import FeatureResourceDialog from '@/components/dialogs/FeatureResourceDialog.vue'

const props = defineProps<{ workspaceId?: string; searchQuery?: string; actionsTarget?: string }>()
const emit = defineEmits<{ changed: []; searchMatch: [matches: boolean] }>()
const ws = useWorkspacesStore()
const ui = useUiStore()
const previewStore = usePreviewStore()
const externalRefs = useExternalRefsStore()
const active = computed(() => props.workspaceId ? ws.list.find(w => w.id === props.workspaceId) ?? null : ws.active)
const scan = computed(() => ws.activeId === active.value?.id ? ws.scan : null)

type FeatureSection = { group: string | null; items: FeatureCard[] }
type CopySpaceCandidate = {
  value: string
  workspaceId: string
  workspaceName: string
  space: PersonalSpace
}

const UNGROUPED_GROUP_VALUE = '__ungrouped__'
const DEFAULT_FEATURE_GROUP = '默认分组'

const features = ref<FeatureCard[]>([])
const featureGroups = ref<string[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const teamPushingRel = ref<string | null>(null)
const gitStatus = ref<GitStatus | null>(null)
const gitCapability = ref<GitCapability | null>(null)
const gitBinding = ref(false)
const statusLoading = ref(false)
const createResourceDialogOpen = ref(false)
const creatingFeature = ref(false)
const pendingFeatureSlug = ref('')
const pendingFeatureGroup = ref('')
const pendingWorkspaceId = ref('')
const pendingExternalRefIds = ref<string[]>([])
const collapsedFeatureGroups = ref<Set<string>>(new Set())
const featureSearchQuery = computed(() => props.searchQuery ?? '')
let gitStatusRequestSeq = 0
let featureRequestSeq = 0

const projectScan = computed(() => scan.value?.kind === 'project' ? scan.value : null)
const activeFeatureRelPath = computed(() => {
  const project = previewStore.activeProject
  return project && project.workspaceId === active.value?.id ? project.relPath : null
})
const supportsLegacyCollaboration = computed(() => !!active.value && supportsPersonalSpaces(active.value))
const isGitUnbound = computed(() =>
  !!active.value && isSimpleWorkspace(active.value) && !!gitCapability.value && gitCapability.value.state !== 'remote'
)
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
const groupedFeatures = computed<FeatureSection[]>(() => {
  const map = new Map<string | null, FeatureCard[]>()
  for (const group of featureGroups.value) {
    map.set(group, [])
  }
  for (const f of features.value) {
    const arr = map.get(f.group) ?? []
    arr.push(f)
    map.set(f.group, arr)
  }
  if (map.size === 0) map.set(DEFAULT_FEATURE_GROUP, [])
  const sections: FeatureSection[] = []
  for (const g of [...map.keys()].filter((k): k is string => k !== null).sort()) {
    sections.push({ group: g, items: sortFeatures(map.get(g) ?? []) })
  }
  if (map.has(null)) sections.push({ group: null, items: sortFeatures(map.get(null) ?? []) })
  return sections
})

function featureMatchesSearch(card: FeatureCard, query: string): boolean {
  return matchesFeatureSearch(card, query, displayFeatureDocPath, featureGroupOf)
}

const filteredGroupedFeatures = computed<FeatureSection[]>(() => {
  const query = featureSearchQuery.value
  if (!query.trim()) return groupedFeatures.value
  return groupedFeatures.value
    .map((section) => ({
      ...section,
      items: section.items.filter((card) => featureMatchesSearch(card, query)),
    }))
    .filter((section) => section.items.length > 0 || (!!section.group && fuzzyMatch(section.group, query.trim())))
})

const filteredFeatureCount = computed(() =>
  filteredGroupedFeatures.value.reduce((count, section) => count + section.items.length, 0)
)

const hasFeatureSearchQuery = computed(() => featureSearchQuery.value.trim().length > 0)
watch(filteredGroupedFeatures, sections => emit('searchMatch', sections.length > 0), { immediate: true })
const uniqueGroups = computed<string[]>(() => {
  const set = new Set(featureGroups.value)
  for (const f of features.value) {
    const group = featureGroupOf(f)
    if (group) set.add(group)
  }
  return [...set].sort()
})

function sortFeatures(list: FeatureCard[]): FeatureCard[] {
  return [...list].sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''))
}

function featureGroupKey(group: string | null): string {
  return group ?? UNGROUPED_GROUP_VALUE
}

function isFeatureGroupCollapsed(group: string | null): boolean {
  return !hasFeatureSearchQuery.value && collapsedFeatureGroups.value.has(featureGroupKey(group))
}

function toggleFeatureGroup(group: string | null): void {
  const key = featureGroupKey(group)
  const next = new Set(collapsedFeatureGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedFeatureGroups.value = next
}

function isFeatureActive(card: FeatureCard): boolean {
  return activeFeatureRelPath.value === card.relPath
}

function formatFeatureModifiedAt(value: string | null): string {
  return formatDateTimeMinute(value, '未记录修改时间')
}

function featureUiSummary(card: FeatureCard): string {
  return card.uiArtifacts.length > 0
    ? `${card.uiArtifacts.length} 个 UI 子页`
    : '无 UI 产物'
}

async function loadFeatures(): Promise<void> {
  if (!active.value || active.value.kind !== 'project') return
  loading.value = true
  error.value = null
  const workspaceId = active.value.id
  const requestSeq = ++featureRequestSeq
  const [featuresResult, groupsResult] = await Promise.all([
    call('feature.list', { workspaceId }),
    call('feature.listGroups', { workspaceId })
  ])
  if (active.value?.id !== workspaceId || requestSeq !== featureRequestSeq) return
  loading.value = false
  if (!featuresResult.ok) {
    error.value = `${featuresResult.code}: ${featuresResult.message}`
    return
  }
  if (!groupsResult.ok) {
    error.value = `${groupsResult.code}: ${groupsResult.message}`
    return
  }
  features.value = featuresResult.data
  featureGroups.value = groupsResult.data
  emit('changed')
}

onMounted(() => {
  void loadFeatures()
  void refreshGitStatus()
})

watch(() => active.value?.id, () => {
  features.value = []
  featureGroups.value = []
  void loadFeatures()
  void refreshGitStatus()
})

watch(() => ui.createFeatureDirectoryId, (id) => {
  if (id && id === active.value?.id) {
    ui.createFeatureDirectoryId = null
    void loadFeatures().then(() => createFeature())
  }
}, { immediate: true })

async function refreshGitStatus(): Promise<void> {
  const current = active.value?.kind === 'project' ? active.value : null
  if (!current) {
    gitStatusRequestSeq += 1
    gitStatus.value = null
    gitCapability.value = null
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
    gitCapability.value = capability
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

async function bindGit(): Promise<void> {
  const current = active.value
  if (!current || gitBinding.value) return
  gitBinding.value = true
  try {
    const remoteUrl = await ui.askPrompt({
      title: '绑定远端 Git',
      message: '输入远端 Git 仓库地址。下一步将读取该仓库的可用分支。',
      placeholder: '例如：https://git.example.com/team/project.git',
      confirmLabel: '读取分支'
    })
    if (!remoteUrl?.trim()) return
    const remote = remoteUrl.trim()
    const branchesResult = await call('git.remoteBranches', { workspaceId: current.id, remoteUrl: remote })
    if (active.value?.id !== current.id) return
    if (!branchesResult.ok) {
      if (branchesResult.code === 'SSH_KEY_REQUIRED' || branchesResult.code === 'SSH_AUTH_FAILED') {
        ui.showToast('info', branchesResult.message, 8000)
        ui.openSettings('ssh')
        return
      }
      ui.showToast('error', `读取远端分支失败：${branchesResult.message}`, 5000)
      return
    }
    const branch = await ui.askPrompt({
      title: '选择绑定分支',
      message: `远端仓库：${remote}`,
      placeholder: '选择远端分支',
      defaultValue: branchesResult.data.defaultBranch ?? branchesResult.data.branches[0],
      confirmLabel: '绑定',
      options: branchesResult.data.branches.map((item) => ({
        label: item,
        value: item,
        description: item === branchesResult.data.defaultBranch ? '默认分支' : undefined
      }))
    })
    if (!branch) return
    const result = await call('git.bind', { workspaceId: current.id, remoteUrl: remote, branch })
    if (active.value?.id !== current.id) return
    if (!result.ok) {
      ui.showToast('error', `绑定 Git 失败：${result.message}`, 5000)
      return
    }
    gitCapability.value = result.data
    ui.showToast('success', `Git 已绑定到 ${branch} 分支`)
    await refreshGitStatus()
    emit('changed')
  } finally {
    gitBinding.value = false
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

async function createFeature(targetGroup?: string): Promise<void> {
  if (!active.value) return
  const directoryId = active.value.id
  let group = targetGroup
  if (!group) {
    if (!featureGroups.value.length) {
      group = DEFAULT_FEATURE_GROUP
    } else {
      group = await ui.askPrompt({ title: '选择项目分组', message: '在当前目录的项目分组内创建项目。', defaultValue: featureGroups.value[0], options: featureGroups.value.map(value => ({ label: value, value })), confirmLabel: '下一步' }) ?? undefined
      if (!group) return
    }
  }
  pendingFeatureGroup.value = group
  pendingWorkspaceId.value = directoryId
  const slug = await ui.askPrompt({
    title: '新建项目',
    message: '创建一个空白项目，稍后可进入编辑页继续构建。',
    placeholder: '例如：订单管理后台',
    defaultValue: '新项目',
    confirmLabel: '创建'
  })
  if (!slug?.trim()) return
  await externalRefs.refreshPool()
  const settings = await call('settings.get', undefined)
  const available = new Set(externalRefs.pool.map((resource) => resource.id))
  pendingFeatureSlug.value = slug.trim()
  pendingExternalRefIds.value = settings.ok
    ? settings.data.defaultExternalRefIds.filter((id) => available.has(id))
    : []
  createResourceDialogOpen.value = true
}

async function confirmCreateFeature(payload: { externalRefIds: string[]; setAsDefault: boolean }): Promise<void> {
  const current = active.value
  if (!current || !pendingFeatureSlug.value || creatingFeature.value) return
  const workspaceId = pendingWorkspaceId.value
  creatingFeature.value = true
  try {
    const r = await call('feature.create', {
      workspaceId,
      group: pendingFeatureGroup.value,
      slug: pendingFeatureSlug.value,
      externalRefIds: [...payload.externalRefIds],
      setResourcesAsDefault: payload.setAsDefault
    })
    if (!r.ok) {
      ui.showToast('error', `创建失败：${r.message}`)
      return
    }
    createResourceDialogOpen.value = false
    pendingFeatureSlug.value = ''
    await loadFeatures()
    await ws.setActive(workspaceId)
    const project = createPreviewProjectContext(
      workspaceId,
      ws.personalSpace?.slug ?? '__public__',
      r.data.featureRelPath,
      r.data.featureRelPath.split('/').at(-1) ?? '新项目'
    )
    await call('uiProduct.seedAgentFiles', {
      workspaceId,
      productRelPath: r.data.featureRelPath
    }).catch(() => undefined)
    previewStore.openProject({
      project,
      primaryRelPath: r.data.indexHtmlRelPath ?? r.data.prdRelPath ?? undefined
    })
    ui.showToast('success', `已创建：${r.data.featureRelPath}`)
  } finally {
    creatingFeature.value = false
  }
}

async function addProject(group: string): Promise<void> {
  const mode = await ui.askPrompt({ title: '新增项目', message: `添加到「${group}」`, defaultValue: 'blank', options: [{ label: '新建空白项目', value: 'blank' }, { label: '导入已有项目', value: 'import' }], confirmLabel: '继续' })
  if (mode === 'blank') await createFeature(group)
  else if (mode === 'import') await importFeatureProject(group)
}

function unbindGit(): void {
  const workspaceId = active.value?.id
  if (!workspaceId) return
  ui.askConfirm({ title: '解绑 Git', message: '解除远端绑定，保留本地目录、文件和提交历史。', confirmLabel: '解绑', onConfirm: async () => {
    const result = await call('git.unbind', { workspaceId })
    if (!result.ok) { ui.showToast('error', result.message); return }
    await refreshGitStatus()
    emit('changed')
    ui.showToast('success', 'Git 已解绑')
  } })
}

async function importFeatureProject(targetGroup?: string): Promise<void> {
  if (!active.value) return
  const workspaceId = active.value.id
  const group = targetGroup ?? (!featureGroups.value.length ? DEFAULT_FEATURE_GROUP : await ui.askPrompt({ title: '选择项目分组', message: '把项目导入当前目录的项目分组。', defaultValue: featureGroups.value[0], options: featureGroups.value.map(value => ({ label: value, value })), confirmLabel: '选择项目目录' }))
  if (!group) return
  const picked = await call('system.selectDirectory', {
    title: '选择要导入的项目目录',
    buttonLabel: '导入'
  })
  if (!picked.ok) {
    ui.showToast('error', `选择目录失败：${picked.message}`)
    return
  }
  if (!picked.data) return
  const r = await call('feature.import', {
    workspaceId,
    sourcePath: picked.data.path,
    group
  })
  if (!r.ok) {
    ui.showToast('error', `导入失败：${r.message}`, 4500)
    return
  }
  await loadFeatures()
  const imported = features.value.find((feature) => feature.relPath === r.data.featureRelPath)
  if (imported) await openFeatureProject(imported)
  ui.showToast('success', '项目已导入')
}

async function pushFeatureToTeamSpace(card: FeatureCard): Promise<void> {
  if (!active.value || !supportsLegacyCollaboration.value || teamPushingRel.value) return
  teamPushingRel.value = card.relPath
  try {
    await pushToTeamSpaceFromUi(active.value.id, { relPath: card.relPath, name: card.name, type: 'feat' })
    await refreshGitStatus()
  } finally {
    teamPushingRel.value = null
  }
}

function deleteFeature(card: FeatureCard): void {
  ui.askConfirm({
    title: '删除 feature',
    message: `确认删除 ${card.name}（${card.relPath}）？整个目录会被删掉。\n\n注意：本地删除后需要在 git 里 commit 才能同步到远端。`,
    confirmLabel: '删除',
    onConfirm: async () => {
      if (!active.value) return
      const r = await call('feature.delete', { workspaceId: active.value.id, relPath: card.relPath })
      if (!r.ok) {
        ui.showToast('error', `删除失败：${r.message}`, 4500)
        return
      }
      closeStaleFeatureTabs(card.relPath)
      ui.showToast('info', `已删除 ${card.name}`)
      await loadFeatures()
    }
  })
}

function featureGroupOf(card: FeatureCard): string | null {
  const stripped = card.relPath.replace(/^features\//, '')
  const segments = stripped.split('/').filter(Boolean)
  if (segments.length <= 1) return null
  return segments.slice(0, -1).join('/')
}

function normalizeFeatureName(input: string): string {
  let rel = input.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!rel) throw new Error('请输入项目名称')
  if (rel.includes('..')) throw new Error('项目路径不能包含 ..')
  if (rel.startsWith('features/')) rel = rel.slice('features/'.length)
  rel = rel.replace(/\/index\.html?$/i, '').replace(/\.html?$/i, '')
  const segments = rel
    .split('/')
    .map((part) => part.trim().replace(/\s+/g, '-').replace(/[<>:"|?*]+/g, ''))
    .filter(Boolean)
  if (segments.length === 0) throw new Error('请输入有效的项目名称')
  return segments.join('/')
}

function buildFeatureRelPath(nameOrPath: string, fallbackGroup: string | null): string {
  const normalized = normalizeFeatureName(nameOrPath)
  if (normalized.includes('/')) return `features/${normalized}`
  return fallbackGroup ? `features/${fallbackGroup}/${normalized}` : `features/${normalized}`
}

function personalSpaceLabel(space: PersonalSpace): string {
  return space.displayName ?? (space.isPublic ? '公共空间' : space.slug)
}

function copySpaceValue(workspaceId: string, slug: string): string {
  return `${workspaceId}::${slug}`
}

async function loadCopySpaceCandidates(): Promise<CopySpaceCandidate[]> {
  const current = active.value
  if (!current || !supportsPersonalSpaces(current)) return []
  const workspaces = ws.list.filter((item) => !item.hidden && item.kind === 'project' && supportsPersonalSpaces(item))
  const candidates: CopySpaceCandidate[] = []
  for (const workspace of workspaces) {
    const listResult = await call('personalSpace.list', { workspaceId: workspace.id })
    if (!listResult.ok) continue
    for (const space of listResult.data.spaces) {
      if (workspace.id === current.id && space.slug === listResult.data.activeSlug) continue
      candidates.push({
        value: copySpaceValue(workspace.id, space.slug),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        space
      })
    }
  }
  return candidates
}

async function askCopyToSpaceTargetName(defaultName: string): Promise<string | null> {
  const input = await ui.askPrompt({
    title: '复制后的名称',
    message: '目标工作空间里如果已有同名项目，可以在这里改名。只修改名称，不改变分组。',
    placeholder: '例如：login-page-copy',
    defaultValue: defaultName,
    confirmLabel: '继续'
  })
  if (input === null) return null
  try {
    const normalized = normalizeFeatureName(input)
    if (normalized.includes('/')) {
      ui.showToast('error', '复制到工作空间时只能重命名，不能修改分组')
      return null
    }
    return normalized
  } catch (e) {
    ui.showToast('error', e instanceof Error ? e.message : String(e))
    return null
  }
}

function normalizeFeatureGroupName(input: string): string {
  const normalized = normalizeFeatureName(input)
  if (normalized.includes('/')) throw new Error('分组名不能包含 /')
  return normalized
}

async function createGroup(): Promise<void> {
  if (!active.value) return
  const input = await ui.askPrompt({
    title: '新建项目分组',
    message: '在当前目录入口的 features/ 下建立项目分组。',
    placeholder: '例如：订单组',
    confirmLabel: '新建'
  })
  if (!input) return
  let groupName: string
  try {
    groupName = normalizeFeatureGroupName(input)
  } catch (e) {
    ui.showToast('error', e instanceof Error ? e.message : String(e))
    return
  }

  const groupRelPath = `features/${groupName}`
  const existing = await call('editor.entryKind', {
    workspaceId: active.value.id,
    relPath: groupRelPath
  })
  if (existing.ok && existing.data.kind !== 'missing') {
    ui.showToast('error', `同名项目或分组已存在：${groupName}`)
    return
  }

  const r = await call('editor.writeTextFile', {
    workspaceId: active.value.id,
    relPath: `${groupRelPath}/.gitkeep`,
    content: '',
    scope: 'project'
  })
  if (!r.ok) {
    ui.showToast('error', `新建分组失败：${r.message}`)
    return
  }
  featureGroups.value = [...new Set([...featureGroups.value, groupName])].sort()
  await loadFeatures()
  ui.showToast('success', `分组 ${groupName} 已创建`)
}

async function renameGroup(group: string): Promise<void> {
  if (!active.value) return
  const input = await ui.askPrompt({
    title: '重命名分组',
    message: `重命名分组 ${group}。分组名不能包含 /。`,
    placeholder: '例如：订单组',
    defaultValue: group,
    confirmLabel: '重命名'
  })
  if (!input) return
  let newGroup: string
  try {
    newGroup = normalizeFeatureGroupName(input)
  } catch (e) {
    ui.showToast('error', e instanceof Error ? e.message : String(e))
    return
  }
  if (newGroup === group) return

  const targetRelPath = `features/${newGroup}`
  const existing = await call('editor.entryKind', {
    workspaceId: active.value.id,
    relPath: targetRelPath
  })
  if (existing.ok && existing.data.kind !== 'missing') {
    ui.showToast('error', `同名项目或分组已存在：${newGroup}`)
    return
  }

  const r = await call('editor.moveEntry', {
    workspaceId: active.value.id,
    sourceRelPath: `features/${group}`,
    targetRelPath,
    scope: 'project'
  })
  if (!r.ok) {
    ui.showToast('error', `重命名分组失败：${r.message}`)
    return
  }
  closeStaleFeatureGroupTabs(group)
  await loadFeatures()
  ui.showToast('success', '分组已重命名')
}

function deleteGroup(group: string, featureCount: number): void {
  if (!active.value) return
  ui.askConfirm({
    title: '删除分组',
    message: featureCount > 0
      ? `确定删除分组 ${group} 及其 ${featureCount} 个项目？`
      : `确定删除分组 ${group}？`,
    confirmLabel: '删除',
    onConfirm: async () => {
      if (!active.value) return
      closeStaleFeatureGroupTabs(group)
      const r = await call('editor.deleteEntry', {
        workspaceId: active.value.id,
        relPath: `features/${group}`,
        scope: 'project'
      })
      if (!r.ok) {
        ui.showToast('error', `删除分组失败：${r.message}`)
        return
      }
      await loadFeatures()
      ui.showToast('success', '分组已删除')
    }
  })
}

async function renameFeature(card: FeatureCard): Promise<void> {
  if (!active.value) return
  const input = await ui.askPrompt({
    title: '重命名项目',
    message: `重命名 ${card.name}。名称不能包含 / （如需改分组请用「移动」）。`,
    placeholder: '例如：login-page',
    defaultValue: card.name,
    confirmLabel: '重命名'
  })
  if (!input) return
  let newSlug: string
  try {
    newSlug = normalizeFeatureName(input)
    if (newSlug.includes('/')) {
      ui.showToast('error', '重命名不支持包含 /，请用「移动」改分组')
      return
    }
  } catch (e) {
    ui.showToast('error', e instanceof Error ? e.message : String(e))
    return
  }
  if (newSlug === card.name) return
  const r = await call('feature.rename', {
    workspaceId: active.value.id,
    relPath: card.relPath,
    newSlug
  })
  if (!r.ok) {
    ui.showToast('error', `重命名失败：${r.message}`)
    return
  }
  closeStaleFeatureTabs(card.relPath)
  await loadFeatures()
  ui.showToast('success', '项目已重命名')
}

function featureMoveOptions(card: FeatureCard): Array<{ label: string; value: string; description?: string }> {
  const currentGroup = featureGroupOf(card)
  const options = uniqueGroups.value.map((group) => ({
    label: group,
    value: group,
    description: group === currentGroup ? '当前分组' : `features/${group}/`
  }))
  return [
    {
      label: '未分组',
      value: UNGROUPED_GROUP_VALUE,
      description: currentGroup === null ? '当前分组' : '移动到 features/ 根目录'
    },
    ...options
  ]
}

async function moveFeatureToGroup(card: FeatureCard): Promise<void> {
  if (!active.value) return
  const currentGroup = featureGroupOf(card)
  const targetValue = await ui.askPrompt({
    title: '移动到分组',
    message: `选择 ${card.name} 的目标分组。需要新分组时请先点右上「新建分组」。`,
    placeholder: '选择目标分组',
    defaultValue: currentGroup ?? UNGROUPED_GROUP_VALUE,
    confirmLabel: '移动',
    options: featureMoveOptions(card)
  })
  if (targetValue === null) return
  let normalizedGroup: string | null
  try {
    normalizedGroup = targetValue === UNGROUPED_GROUP_VALUE ? null : normalizeFeatureGroupName(targetValue)
  } catch (e) {
    ui.showToast('error', e instanceof Error ? e.message : String(e))
    return
  }
  if ((normalizedGroup ?? null) === currentGroup) {
    ui.showToast('info', '已在目标分组')
    return
  }
  const r = await call('feature.move', {
    workspaceId: active.value.id,
    relPath: card.relPath,
    toGroup: normalizedGroup
  })
  if (!r.ok) {
    ui.showToast('error', `移动失败：${r.message}`)
    return
  }
  closeStaleFeatureTabs(card.relPath)
  await loadFeatures()
  ui.showToast('success', '项目已移动')
}

async function copyFeature(card: FeatureCard): Promise<void> {
  if (!active.value) return
  const input = await ui.askPrompt({
    title: '复制项目',
    message: `复制 ${card.name} 为新的 feature 项目。`,
    placeholder: '例如：login-page-copy',
    defaultValue: `${card.name}-copy`,
    confirmLabel: '复制'
  })
  if (!input) return
  let targetRelPath: string
  try {
    targetRelPath = buildFeatureRelPath(input, featureGroupOf(card))
  } catch (e) {
    ui.showToast('error', e instanceof Error ? e.message : String(e))
    return
  }
  const r = await call('editor.copyEntry', {
    workspaceId: active.value.id,
    sourceRelPath: card.relPath,
    targetRelPath,
    scope: 'project'
  })
  if (!r.ok) {
    ui.showToast('error', `复制失败：${r.message}`)
    return
  }
  await loadFeatures()
  const copied = features.value.find((f) => f.relPath === targetRelPath)
  if (copied) await openFeatureProject(copied)
  ui.showToast('success', '项目已复制')
}

async function copyFeatureToSpace(card: FeatureCard): Promise<void> {
  if (!active.value || !supportsLegacyCollaboration.value) return
  const candidates = await loadCopySpaceCandidates()
  if (candidates.length === 0) {
    ui.showToast('info', '没有可复制到的其它工作空间')
    return
  }
  const targetValue = await ui.askPrompt({
    title: '复制到工作空间',
    message: `把 ${card.name} 复制到哪个工作空间？`,
    placeholder: '选择工作空间',
    defaultValue: candidates[0].value,
    confirmLabel: '复制到',
    options: candidates.map((candidate) => ({
      label: `${candidate.workspaceName} / ${personalSpaceLabel(candidate.space)}`,
      value: candidate.value,
      description: candidate.space.branch
    }))
  })
  if (!targetValue) return
  const target = candidates.find((candidate) => candidate.value === targetValue)
  if (!target) {
    ui.showToast('error', '请选择列表里的工作空间')
    return
  }
  const targetName = await askCopyToSpaceTargetName(card.name)
  if (!targetName) return
  const r = await call('feature.copyToSpace', {
    workspaceId: active.value.id,
    relPath: card.relPath,
    targetWorkspaceId: target.workspaceId,
    targetSlug: target.space.slug,
    targetName
  })
  if (!r.ok) {
    ui.showToast('error', `复制到工作空间失败：${r.message}`, 5000)
    return
  }
  ui.showToast('success', `已复制到 ${target.workspaceName} / ${personalSpaceLabel(target.space)}`)
}

function findFeatureFilesTabId(card: FeatureCard): string | null {
  const workspaceId = active.value?.id
  if (!workspaceId) return null
  return previewStore.tabs.find((tab) =>
    tab.type === 'files'
    && tab.workspaceId === workspaceId
    && tab.filesMeta?.rootRelPath === card.relPath
  )?.id ?? null
}

function closeStaleFeatureTabs(oldRelPath: string): void {
  for (const tabItem of [...previewStore.tabs]) {
    if (tabItem.workspaceId !== active.value?.id) continue
    if (
      (tabItem.type === 'product' && tabItem.productMeta?.path === oldRelPath) ||
      (tabItem.type === 'files' && tabItem.filesMeta?.rootRelPath === oldRelPath)
    ) {
      previewStore.closeTab(tabItem.id)
    }
  }
}

function closeStaleFeatureGroupTabs(group: string): void {
  const oldPrefix = `features/${group}/`
  for (const tabItem of [...previewStore.tabs]) {
    if (tabItem.workspaceId !== active.value?.id) continue
    if (
      (tabItem.type === 'product' && tabItem.productMeta?.path?.startsWith(oldPrefix)) ||
      (tabItem.type === 'files' && tabItem.filesMeta?.rootRelPath?.startsWith(oldPrefix))
    ) {
      previewStore.closeTab(tabItem.id)
    }
  }
}

async function openFeatureProject(card: FeatureCard): Promise<void> {
  if (!active.value) return
  const workspaceId = active.value.id
  await ws.setActive(workspaceId)
  const project = createPreviewProjectContext(
    workspaceId,
    ws.personalSpace?.slug ?? '__public__',
    card.relPath,
    card.name
  )
  await call('uiProduct.seedAgentFiles', {
    workspaceId,
    productRelPath: card.relPath
  }).catch(() => undefined)
  const primaryUi = card.uiArtifacts[0]
  previewStore.openProject({
    project,
    primaryRelPath: primaryUi?.htmlRelPath ?? card.prdRelPath ?? undefined
  })
}

function displayFeatureDocPath(card: FeatureCard): string {
  if (!card.prdRelPath) return ''
  const prefix = `${card.relPath}/`
  return card.prdRelPath.startsWith(prefix) ? card.prdRelPath.slice(prefix.length) : card.prdRelPath
}

</script>

<template>
  <main class="directory-projects min-w-0">
    <Teleport :to="props.actionsTarget ?? 'body'" :disabled="!props.actionsTarget" defer>
      <div class="home-header__actions">
        <Button variant="ghost" size="icon-sm" class="directory-icon-action" title="新建分组" aria-label="新建分组" @click="createGroup"><FolderPlus :size="16" aria-hidden="true" /></Button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" class="directory-icon-action" title="更多操作" aria-label="更多操作">
              <Ellipsis :size="16" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-36 text-xs">
            <DropdownMenuItem v-if="isGitUnbound" :disabled="gitBinding" @select="bindGit">{{ gitBinding ? '绑定中…' : '绑定 Git' }}</DropdownMenuItem>
            <DropdownMenuItem v-if="gitCapability?.state === 'remote'" @select="unbindGit">解绑 Git</DropdownMenuItem>
            <slot name="directory-menu" />
            <DropdownMenuSeparator v-if="$slots['directory-menu']" />
            <DropdownMenuItem
              class="text-xs"
              :disabled="loading"
              @select="loadFeatures"
            >
              <RefreshCw
                :class="{ 'home-header__action-icon--spinning': loading }"
                aria-hidden="true"
              />
              {{ loading ? '刷新中…' : '刷新' }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="gitCapability?.state === 'remote'" class="text-xs" :disabled="statusLoading" @select="startSync">同步仓库</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="text-xs" @select="openBranchHistory">
              历史版本
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Teleport>
    <section class="flex-1 px-3 pb-3 pt-0">
      <div
        v-if="!props.actionsTarget && gitCapability?.state === 'remote'"
        class="git-notice git-notice--success"
        role="status"
      >
        <div class="git-notice__content">
          <span class="git-notice__icon git-notice__icon--success" aria-hidden="true">
            <GitBranch :size="18" />
          </span>
          <div class="git-notice__body">
            <h2>Git 已绑定</h2>
            <p class="git-notice__url" :title="gitCapability.remoteUrl">{{ gitCapability.remoteUrl }}</p>
            <div v-if="gitSummary" class="git-notice__meta">
              <span>{{ gitSummary.branchLabel }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ gitSummary.remoteLabel }}</span>
            </div>
            <p v-else>
              {{ statusLoading ? '正在读取 Git 状态…' : '暂时无法读取 Git 状态' }}
            </p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" :disabled="statusLoading" @click="refreshGitStatus">
            {{ statusLoading ? '刷新中…' : '刷新状态' }}
          </Button>
          <Button variant="outline" size="sm" @click="openBranchHistory">版本历史</Button>
          <Button
            size="sm"
            :disabled="statusLoading"
            title="同步整个仓库当前分支：提交全部业务改动，再 pull --rebase 并 push。单个项目请在项目工作台点「提交」。"
            @click="startSync"
          >
            同步仓库
          </Button>
        </div>
      </div>

      <div v-if="!props.actionsTarget" class="mb-4 flex items-center justify-end gap-3">
        <span class="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          {{ hasFeatureSearchQuery ? `${filteredFeatureCount} / ${features.length}` : features.length }} 个项目
        </span>
      </div>
      <div v-if="loading && features.length === 0 && featureGroups.length === 0" class="text-sm text-muted-foreground">加载中…</div>
      <div v-else-if="error" class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{{ error }}</div>
      <div v-else-if="hasFeatureSearchQuery && filteredGroupedFeatures.length === 0" class="flex items-center justify-center text-xs text-muted-foreground" :class="props.actionsTarget ? 'min-h-16' : 'min-h-32'">
        没有匹配「{{ featureSearchQuery.trim() }}」的项目
      </div>

      <div v-else class="feature-groups">
        <section
          v-for="section in filteredGroupedFeatures"
          :key="section.group ?? '__ungrouped__'"
          class="feature-group-section"
        >
          <header class="feature-group-header">
            <button
              type="button"
              class="feature-group-header__toggle"
              :aria-expanded="!isFeatureGroupCollapsed(section.group)"
              aria-label="展开或折叠项目分组"
              @click="toggleFeatureGroup(section.group)"
            >
              <svg
                class="feature-group-header__marker"
                :class="{ 'feature-group-header__marker--expanded': !isFeatureGroupCollapsed(section.group) }"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6 4l4 4-4 4V4z" />
              </svg>
            </button>
            <button
              type="button"
              class="feature-group-header__title-button"
              @click="toggleFeatureGroup(section.group)"
            >
              <h2 class="feature-group-header__title">{{ section.group ?? '未分组项目' }}</h2>
              <span class="feature-group-header__count">{{ section.items.length }}</span>
            </button>
            <Button v-if="section.group" variant="ghost" size="icon-sm" class="directory-icon-action" :title="`新增项目到 ${section.group}`" :aria-label="`新增项目到 ${section.group}`" @click="addProject(section.group)"><Plus :size="16" /></Button>
            <DropdownMenu v-if="section.group">
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="feature-group-header__more"
                  aria-label="分组操作"
                  aria-haspopup="menu"
                  @click.stop
                >
                  <Ellipsis class="feature-group-header__more-icon" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="min-w-32 text-xs">
                <DropdownMenuItem class="text-xs" @select="renameGroup(section.group)">
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  class="text-xs text-destructive focus:text-destructive"
                  @select="deleteGroup(section.group, section.items.length)"
                >
                  删除分组
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          <div
            v-if="!isFeatureGroupCollapsed(section.group) && section.items.length === 0"
            class="feature-group-body rounded-xl bg-[var(--color-card-surface)] px-4 py-3 text-xs text-muted-foreground"
          >
            暂无项目，可用项目卡片里的「移动」放入这个分组。
          </div>
          <div
            v-else-if="!isFeatureGroupCollapsed(section.group)"
            class="feature-group-body feature-group-body--grid"
          >
            <article
              v-for="card in section.items"
              :key="card.relPath"
              class="product-card group/card"
              :class="{ 'product-card--active': isFeatureActive(card) }"
              role="button"
              tabindex="0"
              @click="openFeatureProject(card)"
              @keydown.enter.prevent="openFeatureProject(card)"
              @keydown.space.prevent="openFeatureProject(card)"
            >
              <div
                class="product-card__preview"
                :class="{ 'product-card__preview--active': isFeatureActive(card) }"
              >
                <div class="product-card__preview-cover">
                  <div class="product-card__preview-body">
                    <h3 class="product-card__title">
                      <span class="product-card__preview-title-text">{{ card.name }}</span>
                    </h3>
                    <span class="feature-card__preview-details">
                      <span :title="card.prdRelPath ?? undefined">{{ card.prdRelPath ? '含 PRD' : '无 PRD' }}</span>
                      <span>{{ featureUiSummary(card) }}</span>
                    </span>
                    <div class="product-card__meta">
                      <span class="product-card__time">{{ formatFeatureModifiedAt(card.modifiedAt) }}</span>
                      <span v-if="isFeatureActive(card)" class="product-card__editing">编辑中</span>
                      <ProjectCardMoreMenu
                        :git-available="gitCapability?.state === 'local' || gitCapability?.state === 'remote'"
                        @history="ui.openBranchHistory({ workspaceId: active!.id, workspaceName: card.name, relPath: card.relPath, initialView: 'commits' })"
                        @rename="renameFeature(card)"
                        @move="moveFeatureToGroup(card)"
                        @copy="copyFeature(card)"
                        @delete="deleteFeature(card)"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>
    </section>
  </main>

  <FeatureResourceDialog
    v-model:open="createResourceDialogOpen"
    :resources="externalRefs.pool"
    :selected-ids="pendingExternalRefIds"
    :busy="creatingFeature"
    title="关联项目资源"
    description="选择新项目可使用的知识库和 UX 资产。"
    confirm-label="创建项目"
    @save="confirmCreateFeature"
  />
</template>

<style scoped>
.directory-icon-action { width: 28px; height: 28px; padding: 0; flex: none; }
.home-header__actions { display: inline-flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; }
.home-header__action-icon--spinning { animation: home-header-action-spin 0.8s linear infinite; }
@keyframes home-header-action-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.git-notice {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  overflow: hidden;
  margin-bottom: 16px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 14px 16px;
}
.git-notice--action {
  width: fit-content;
  max-width: min(520px, 100%);
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0;
  overflow: visible;
  margin-bottom: 0;
  border: none;
  border-radius: 12px;
  background: #fff3b0;
  padding: 8px 14px 8px 12px;
  box-shadow: none;
}
.git-notice__lead {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.git-notice--action .git-notice__icon {
  width: auto;
  height: auto;
  flex: none;
  border: none;
  border-radius: 0;
  background: transparent;
  color: #1a1a1a;
  box-shadow: none;
}
.git-notice--action h2 {
  margin: 0;
  color: #1a1a1a;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.35;
}
.git-notice__cta {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  margin-left: 28px;
  border: none;
  background: transparent;
  padding: 0;
  color: #1a1a1a;
  font: inherit;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.35;
  cursor: pointer;
}
.git-notice__cta:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
.git-notice__cta-arrow {
  flex: none;
}
.git-notice__cta:hover:not(:disabled) {
  color: #000;
}
.git-notice__cta:focus-visible {
  outline: 2px solid rgba(0, 0, 0, 0.25);
  outline-offset: 2px;
  border-radius: 4px;
}
.git-notice--success {
  background: color-mix(in srgb, var(--color-success-subtle) 40%, var(--color-bg-panel));
}
.git-notice__content {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 13px;
}
.git-notice__icon {
  display: inline-flex;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 12px;
}
.git-notice__icon--success {
  background: var(--color-success-subtle);
  color: var(--color-success);
}
.git-notice__body {
  min-width: 0;
}
.git-notice__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.git-notice__body h2 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 650;
  line-height: 1.4;
}
.git-notice__body p,
.git-notice__meta {
  margin: 4px 0 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.git-notice__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.git-notice__url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}
.feature-groups { display: flex; flex-direction: column; gap: 14px; }
.feature-group-section { display: flex; flex-direction: column; gap: 8px; }
.feature-group-header { display: flex; min-height: 32px; max-width: 100%; align-items: center; gap: 6px; }
.feature-group-header__toggle {
  display: flex;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.feature-group-header__marker {
  width: 10px;
  height: 10px;
  transition: transform 180ms cubic-bezier(0.25, 0.1, 0.25, 1);
}
.feature-group-header__marker--expanded { transform: rotate(90deg); }
.feature-group-header__title-button {
  display: inline-flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
}
.feature-group-header__title {
  min-width: 0;
  overflow: hidden;
  margin: 0;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.feature-group-header__count { color: var(--color-text-tertiary); font-size: 11px; }
.feature-group-header__more {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  margin-left: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  opacity: 0;
  cursor: pointer;
  transition:
    background 180ms cubic-bezier(0.25, 0.1, 0.25, 1),
    color 180ms cubic-bezier(0.25, 0.1, 0.25, 1),
    opacity 180ms cubic-bezier(0.25, 0.1, 0.25, 1);
}
.feature-group-header__more-icon { width: 16px; height: 16px; }
.feature-group-header:hover .feature-group-header__more,
.feature-group-header__more:hover,
.feature-group-header__more:focus-visible,
.feature-group-header__more[aria-expanded='true'] { opacity: 1; }
.feature-group-header__more:hover,
.feature-group-header__more:focus-visible,
.feature-group-header__more[aria-expanded='true'] {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.directory-empty-art { margin-right: 10px; width: 110px; }
.feature-group-body { padding-left: 26px; }
.feature-group-body--grid {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 240px));
  gap: 16px;
}
.product-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-normal, 180ms) var(--ease-out, ease);
}
.product-card:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; border-radius: 10px; }
.product-card__preview {
  position: relative;
  width: 100%;
  height: 148px;
  overflow: hidden;
  border: 0;
  border-radius: 12px;
  background: var(--color-card-surface);
  box-shadow: var(--shadow-card);
}
.product-card__preview-cover {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 16px 12px;
  background-color: var(--color-card-surface);
  background-image: url('@/assets/project-placeholder.svg'), radial-gradient(ellipse at 100% 0%, color-mix(in srgb, var(--color-leaf) 23%, var(--color-bg-elevated)) 0%, color-mix(in srgb, var(--color-leaf-bright) 12%, var(--color-bg-elevated)) 48%, var(--color-bg-elevated) 100%);
  background-size: cover;
  background-position: center;
}
.product-card__preview-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 8px;
  color: var(--color-leaf);
  background: color-mix(in srgb, var(--color-leaf) 4%, var(--color-bg-elevated));
}
.product-card__preview-body {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}
.product-card__preview-title-text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  color: var(--color-text-primary);
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.3;
}
.feature-card__preview-details {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 500;
  line-height: 1.35;
}
.feature-card__preview-details span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.product-card__preview--active,
.product-card--active .product-card__preview {
  box-shadow: var(--shadow-card-hover);
}
.product-card--active .product-card__preview-cover {
  background-color: var(--color-card-hover);
}
.product-card__meta { display: flex; width: 100%; align-items: center; gap: 6px; margin-top: 7px; }
.product-card__meta :deep(.project-card-more-menu__trigger) { margin-left: auto; opacity: 1; }
.product-card__title { width: 100%; min-width: 0; margin: 0; }
.product-card__meta-line { display: flex; min-width: 0; align-items: center; gap: 8px; }
.product-card__time {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: 10px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.product-card__editing {
  flex: 0 0 auto;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent-light) 70%, transparent);
  padding: 0 6px;
  color: var(--color-accent);
  font-size: 10px;
  font-weight: 600;
  line-height: 18px;
}
@media (max-width: 720px) {
  .git-notice:not(.git-notice--action) {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }
  .git-notice--action .git-notice__cta { margin-left: 16px; }
  .feature-group-body { padding-left: 0; }
}
</style>
