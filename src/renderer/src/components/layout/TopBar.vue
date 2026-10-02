<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { GitCapability, GitStatus } from '@shared/types'
import { isSimpleWorkspace } from '@shared/workspace-policy'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useUiStore } from '@/stores/ui'
import { useAiTasksStore } from '@/stores/ai-tasks'
import { usePreviewStore } from '@/stores/preview'
import { useEditorStore } from '@/stores/editor'
import { call } from '@/lib/api'
import { shouldShowMainlineSyncButton } from '@/lib/git-sync-visibility'
import { autoCommitMessage } from '@/lib/auto-commit-message'
import { shouldRequestWorkspaceGitStatus } from '@/lib/workspace-capabilities'
import { isProjectToolWorkspaceKind } from '@/lib/project-tool-menu'
import { isOutputsFirstUxProject } from '@/lib/fixed-ux-space'
import {
  isTopBarHomeActive,
  isTopBarTabClosable,
  resolveTopBarAddAction,
  resolveTopBarTabTitle,
  shouldShowTopBarContextTab,
} from '@/lib/topbar-navigation'
import OpenWithMenu from '@/components/layout/OpenWithMenu.vue'
import TopBarSettingsButton from '@/components/layout/TopBarSettingsButton.vue'
import OpenProjectDialog from '@/components/preview/OpenProjectDialog.vue'
import { FolderKanban, ListTodo, PenTool, Plus, X } from 'lucide-vue-next'

const ws = useWorkspacesStore()
const ui = useUiStore()
const aiTasks = useAiTasksStore()
const previewStore = usePreviewStore()
const editorStore = useEditorStore()
const { openProjects, activeProjectKey, activeTab } = storeToRefs(previewStore)
const { active, scan } = storeToRefs(ws)
const {
  currentView,
  uxActiveNode,
  viewingExternalAlias,
} = storeToRefs(ui)

const projectDialogOpen = ref(false)

const outputsFirstProject = computed(() =>
  isOutputsFirstUxProject(active.value, active.value?.id === ws.activeId ? scan.value : null)
)

const showProjectTools = computed(() => isProjectToolWorkspaceKind(active.value?.kind))

const currentTabTitle = computed(() => resolveTopBarTabTitle({
  workspaceName: active.value?.name ?? null,
  workspaceKind: active.value?.kind ?? null,
  currentView: currentView.value,
  uxActiveNode: uxActiveNode.value,
  outputsFirstProject: outputsFirstProject.value,
  previewTabTitle: previewStore.activeTab?.title ?? null,
  previewActive: previewStore.isPreviewActive,
  editorTitle: editorStore.session?.title ?? null,
  editorOpen: editorStore.isOpen,
  externalAlias: viewingExternalAlias.value,
}))

const homeActive = computed(() => isTopBarHomeActive({
  previewActive: previewStore.isPreviewActive,
  editorOpen: editorStore.isOpen,
  currentView: currentView.value,
  uxActiveNode: uxActiveNode.value,
  outputsFirstProject: outputsFirstProject.value,
}))

const tabClosable = computed(() => isTopBarTabClosable({
  previewActive: previewStore.isPreviewActive,
  editorOpen: editorStore.isOpen,
  currentView: currentView.value,
  uxActiveNode: uxActiveNode.value,
  outputsFirstProject: outputsFirstProject.value,
  workspaceKind: active.value?.kind ?? null,
}))

const showContextTab = computed(() => shouldShowTopBarContextTab({
  homeActive: homeActive.value,
  previewActive: previewStore.isPreviewActive,
  editorOpen: editorStore.isOpen,
}))

const previewProjectTabs = computed(() => openProjects.value)

const showPreviewFallbackTab = computed(() =>
  previewStore.isPreviewActive && previewProjectTabs.value.length === 0
)

const previewFallbackTitle = computed(() => activeTab.value?.title ?? '预览')

const addAction = computed(() => resolveTopBarAddAction({
  previewActive: previewStore.isPreviewActive,
  hasOpenProjectTabs: previewProjectTabs.value.length > 0,
  workspaceKind: active.value?.kind ?? null,
  currentView: currentView.value,
  uxActiveNode: uxActiveNode.value,
  outputsFirstProject: outputsFirstProject.value,
}))

const addLabel = computed(() => {
  if (addAction.value === 'open-project') return '打开项目'
  if (addAction.value === 'create-product') return '新增项目'
  return '新建项目'
})

const aiTaskBadgeCount = computed(() => aiTasks.activeCount + aiTasks.waitingCount)
const aiTaskBadgeLabel = computed(() =>
  aiTaskBadgeCount.value > 99 ? '99+' : String(aiTaskBadgeCount.value)
)
const aiTaskButtonLabel = computed(() =>
  aiTaskBadgeCount.value > 0 ? `AI 任务（${aiTaskBadgeLabel.value}）` : 'AI 任务'
)

// 公共空间（远端默认分支）有更新时，工作空间名旁弹 chip 提醒 + 一键拉取。
const projectGitStatus = ref<GitStatus | null>(null)
const projectGitCapability = ref<GitCapability | null>(null)
const mainlineBehind = computed(() => projectGitStatus.value?.mainlineBehind ?? 0)
const hasMainlineUpdate = computed(() => shouldShowMainlineSyncButton(projectGitStatus.value))

async function refreshGitStatus(): Promise<void> {
  const current = active.value
  if (!current || current.kind !== 'project') {
    projectGitStatus.value = null
    projectGitCapability.value = null
    return
  }
  let capability: GitCapability | null = null
  if (isSimpleWorkspace(current)) {
    const capabilityResult = await call('git.capability', { workspaceId: current.id })
    if (active.value?.id !== current.id) return
    capability = capabilityResult.ok ? capabilityResult.data : { state: 'unbound' }
  }
  projectGitCapability.value = capability
  if (!shouldRequestWorkspaceGitStatus(current, capability)) {
    projectGitStatus.value = null
    return
  }
  const r = await call('git.status', { workspaceId: current.id })
  if (active.value?.id !== current.id) return
  projectGitStatus.value = r.ok ? r.data : null
}

async function startMainlineSync(): Promise<void> {
  if (!active.value) return
  const status = await call('git.status', { workspaceId: active.value.id })
  const commitMessage = status.ok && status.data.isDirty ? autoCommitMessage('mainline') : undefined
  ui.openSyncProgress(active.value.id, commitMessage, 'mainline')
}

function closeAllEditorSessions(): void {
  while (editorStore.sessions.length > 0) {
    const next = editorStore.sessions[0]
    if (!next) break
    const closed = editorStore.closeSession(editorStore.sessionKeyOf(next), { force: true })
    if (!closed) break
  }
}

function goHome(): void {
  if (previewStore.isPreviewActive) {
    previewStore.hideCanvas()
    if (active.value?.kind === 'ux') {
      ui.setUxActiveNode(outputsFirstProject.value ? 'outputs' : 'home')
    }
    ui.backToProjectHome()
    return
  }
  if (editorStore.isOpen) closeAllEditorSessions()
  if (active.value?.kind === 'ux') {
    ui.setUxActiveNode(outputsFirstProject.value ? 'outputs' : 'home')
  }
  ui.backToProjectHome()
}

function activateProjectTab(projectKey: string): void {
  if (projectKey === activeProjectKey.value && previewStore.isPreviewActive) return
  void previewStore.activateProject(projectKey)
}

function closeProjectTab(projectKey: string): void {
  void previewStore.closeProject(projectKey)
}

function closeCurrentTab(): void {
  if (previewStore.isPreviewActive && previewStore.activeTabId) {
    previewStore.closeTab(previewStore.activeTabId)
    return
  }
  if (editorStore.isOpen && editorStore.session) {
    editorStore.closeSession(editorStore.sessionKeyOf(editorStore.session))
    return
  }
  if (currentView.value === 'external-view') {
    ui.closeExternalView()
    return
  }
  if (
    currentView.value === 'project-management'
    || currentView.value === 'features-page'
    || currentView.value === 'ai-config'
    || currentView.value === 'skills-config'
  ) {
    ui.openHome()
    return
  }
  if (active.value?.kind === 'ux') {
    ui.setUxActiveNode(outputsFirstProject.value ? 'outputs' : 'home')
    ui.backToProjectHome()
  }
}

function onAdd(): void {
  if (addAction.value === 'open-project') {
    projectDialogOpen.value = true
    return
  }
  if (addAction.value === 'create-product') {
    ui.requestCreateProduct()
    return
  }
  previewStore.hideCanvas()
  editorStore.hide()
  if (active.value) ui.requestCreateFeatureProject(active.value.id)
}

watch(() => active.value?.id, () => { void refreshGitStatus() }, { immediate: true })

onMounted(() => {
  aiTasks.startWatching()
  void aiTasks.load()
})
onBeforeUnmount(() => {
  aiTasks.stopWatching()
})

watch(
  () => active.value?.id,
  (workspaceId, _prev, onCleanup) => {
    if (!workspaceId) return
    const unsubscribe = window.events.on(`git.remote-updated:${workspaceId}`, () => {
      void refreshGitStatus()
    })
    onCleanup(unsubscribe)
  },
  { immediate: true }
)
</script>

<template>
  <header class="app-tabbar app-chrome topbar-drag shrink-0">
    <div class="app-tabbar__inset" aria-hidden="true" />
    <nav class="app-tabbar__nav" aria-label="File tabs">
      <button
        type="button"
        class="app-tabbar__home"
        :class="{ 'app-tabbar__home--active': homeActive }"
        aria-label="工作台"
        @click="goHome"
      >
        <FolderKanban class="app-tabbar__glyph app-tabbar__glyph--md" aria-hidden="true" />
      </button>

      <div class="app-tabbar__tabs" role="tablist" aria-label="Open files">
        <template v-if="previewProjectTabs.length > 0">
          <button
            v-for="project in previewProjectTabs"
            :key="project.key"
            type="button"
            class="app-tab"
            :class="{ 'app-tab--active': previewStore.isPreviewActive && project.key === activeProjectKey }"
            role="tab"
            :aria-selected="previewStore.isPreviewActive && project.key === activeProjectKey ? 'true' : 'false'"
            :title="project.name"
            @click="activateProjectTab(project.key)"
          >
            <span class="app-tab__icon" aria-hidden="true">
              <PenTool class="app-tabbar__glyph app-tabbar__glyph--sm" />
            </span>
            <span class="app-tab__title">{{ project.name }}</span>
            <span
              class="app-tab__close"
              role="button"
              tabindex="-1"
              aria-label="Close tab"
              title="关闭"
              @click.stop="closeProjectTab(project.key)"
            >
              <X class="app-tabbar__glyph app-tabbar__glyph--xs" aria-hidden="true" />
            </span>
          </button>
        </template>

        <div
          v-else-if="showPreviewFallbackTab"
          class="app-tab app-tab--active"
          role="tab"
          tabindex="0"
          aria-selected="true"
          :title="previewFallbackTitle"
        >
          <span class="app-tab__icon" aria-hidden="true">
            <PenTool class="app-tabbar__glyph app-tabbar__glyph--sm" />
          </span>
          <span class="app-tab__title">{{ previewFallbackTitle }}</span>
          <button
            type="button"
            class="app-tab__close"
            aria-label="Close tab"
            title="关闭"
            @click.stop="closeCurrentTab"
          >
            <X class="app-tabbar__glyph app-tabbar__glyph--xs" aria-hidden="true" />
          </button>
        </div>

        <div
          v-else-if="editorStore.isOpen"
          class="app-tab app-tab--active"
          role="tab"
          tabindex="0"
          aria-selected="true"
          :title="currentTabTitle"
        >
          <span class="app-tab__icon" aria-hidden="true">
            <PenTool class="app-tabbar__glyph app-tabbar__glyph--sm" />
          </span>
          <span class="app-tab__title">{{ currentTabTitle }}</span>
          <button
            type="button"
            class="app-tab__close"
            aria-label="Close tab"
            title="关闭"
            @click.stop="closeCurrentTab"
          >
            <X class="app-tabbar__glyph app-tabbar__glyph--xs" aria-hidden="true" />
          </button>
        </div>

        <div
          v-else-if="showContextTab"
          class="app-tab app-tab--active"
          role="tab"
          tabindex="0"
          aria-selected="true"
          :title="currentTabTitle"
        >
          <span class="app-tab__icon" aria-hidden="true">
            <PenTool class="app-tabbar__glyph app-tabbar__glyph--sm" />
          </span>
          <span class="app-tab__title">{{ currentTabTitle }}</span>
          <button
            v-if="tabClosable"
            type="button"
            class="app-tab__close"
            aria-label="Close tab"
            title="关闭"
            @click.stop="closeCurrentTab"
          >
            <X class="app-tabbar__glyph app-tabbar__glyph--xs" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          class="app-tabbar__add"
          :aria-label="addLabel"
          :title="addLabel"
          @click="onAdd"
        >
          <Plus class="app-tabbar__glyph app-tabbar__glyph--md" aria-hidden="true" />
        </button>
      </div>
    </nav>

    <div class="app-tabbar__actions topbar-actions">
      <button
        v-if="hasMainlineUpdate"
        type="button"
        class="team-space-chip"
        :title="`公共空间领先本地 ${mainlineBehind} 个提交，点击拉取`"
        @click="startMainlineSync"
      >
        <span aria-hidden="true">⬇</span>
        <span>公共空间有更新</span>
        <span v-if="mainlineBehind > 0" class="font-mono">({{ mainlineBehind }})</span>
      </button>
      <button
        type="button"
        class="ai-task-topbar-btn"
        :aria-label="aiTaskButtonLabel"
        title="打开 AI 任务面板"
        @click="ui.openAiTaskPanel"
      >
        <ListTodo class="ai-task-topbar-btn__icon" aria-hidden="true" />
        <span v-if="aiTaskBadgeCount > 0" class="ai-task-topbar-btn__badge">{{ aiTaskBadgeLabel }}</span>
      </button>
      <OpenWithMenu v-if="showProjectTools && active" :workspace-id="active.id" />
      <TopBarSettingsButton />
    </div>

    <OpenProjectDialog v-model:open="projectDialogOpen" />
  </header>
</template>

<style scoped>
.app-tabbar {
  display: flex;
  align-items: stretch;
  min-height: 36px;
  height: 36px;
  width: 100%;
  border-bottom: 1px solid var(--color-chrome-border);
  color: var(--color-text-primary);
  font-size: 12px;
  user-select: none;
}
.app-tabbar__inset {
  flex: 0 0 80px;
  width: 80px;
  min-width: 80px;
  -webkit-app-region: drag;
}
.app-tabbar__nav {
  display: flex;
  align-items: stretch;
  min-width: 0;
  flex: 1 1 auto;
}
.app-tabbar__home,
.app-tabbar__add {
  flex: 0 0 36px;
  width: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--duration-fast, 120ms) var(--ease-out, ease),
    color var(--duration-fast, 120ms) var(--ease-out, ease);
}
.app-tabbar__home {
}
.app-tabbar__add {
}
.app-tabbar__home:hover,
.app-tabbar__add:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.app-tabbar__home--active {
  background: var(--color-tab-selected);
  color: var(--color-text-primary);
}
.app-tabbar__glyph {
  flex-shrink: 0;
}
.app-tabbar__glyph--md {
  width: 16px;
  height: 16px;
  stroke-width: 1.6px;
}
.app-tabbar__glyph--sm {
  width: 14px;
  height: 14px;
  stroke-width: 1.6px;
}
.app-tabbar__glyph--xs {
  width: 12px;
  height: 12px;
  stroke-width: 2px;
}
.app-tabbar__tabs {
  display: flex;
  align-items: stretch;
  min-width: 0;
  flex: 1 1 auto;
  overflow-x: auto;
  scrollbar-width: none;
}
.app-tabbar__tabs::-webkit-scrollbar {
  display: none;
}
.app-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(240px, 42vw);
  min-width: 0;
  flex: 0 0 auto;
  padding: 0 8px 0 12px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  white-space: nowrap;
  cursor: pointer;
  font: inherit;
}
.app-tab { margin: 4px 2px; border-radius: 8px; }
.app-tab--active {
  background: var(--color-tab-selected);
  color: var(--color-text-primary);
}
.app-tab__icon {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent);
}
.app-tab__title {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1 1 auto;
  font-weight: 600;
}
.app-tab__close {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 2px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity var(--duration-fast, 120ms) var(--ease-out, ease),
    background var(--duration-fast, 120ms) var(--ease-out, ease),
    color var(--duration-fast, 120ms) var(--ease-out, ease);
}
.app-tab--active .app-tab__close,
.app-tab:hover .app-tab__close {
  opacity: 1;
}
.app-tab__close:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.app-tabbar__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  margin-left: auto;
  padding: 0 8px 0 12px;
}
.team-space-chip {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--color-chrome-border, var(--color-popover-border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-bg-content, var(--color-bg-elevated)) 55%, transparent);
  padding: 0 8px;
  color: var(--color-text-primary);
  font-size: 11px;
  cursor: pointer;
  transition:
    background var(--duration-fast, 120ms) var(--ease-out, ease),
    color var(--duration-fast, 120ms) var(--ease-out, ease);
}
.team-space-chip:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.ai-task-topbar-btn {
  position: relative;
  display: flex;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--duration-fast, 120ms) var(--ease-out, ease),
    color var(--duration-fast, 120ms) var(--ease-out, ease);
}
.ai-task-topbar-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.ai-task-topbar-btn:focus-visible {
  outline: 2px solid hsl(var(--ring) / 0.35);
  outline-offset: 2px;
}
.ai-task-topbar-btn__icon {
  width: 16px;
  height: 16px;
  stroke-width: 1.6px;
}
.ai-task-topbar-btn__badge {
  position: absolute;
  top: 2px;
  right: 1px;
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 999px;
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  font-size: 9px;
  font-weight: 600;
  line-height: 12px;
  text-align: center;
}
.topbar-drag {
  -webkit-app-region: drag;
}
.topbar-drag :deep(button),
.topbar-drag :deep(a),
.topbar-drag :deep(input),
.topbar-drag :deep([data-no-drag]) {
  -webkit-app-region: no-drag;
}

.topbar-tabs {
  display: flex;
  min-width: 0;
  max-width: 100%;
  flex: 1;
  align-items: center;
  gap: 4px;
}

.topbar-home-tab,
.topbar-project-tab {
  height: 30px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-muted);
  transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease;
}

.topbar-home-tab {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
}

.topbar-project-tabs {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.topbar-project-tabs::-webkit-scrollbar {
  display: none;
}

.topbar-project-tab {
  display: flex;
  min-width: 112px;
  max-width: 210px;
  flex: 0 0 176px;
  align-items: center;
  overflow: hidden;
}

.topbar-project-tab__main {
  display: flex;
  min-width: 0;
  height: 100%;
  flex: 1;
  align-items: center;
  gap: 7px;
  padding: 0 4px 0 8px;
  color: inherit;
}

.topbar-project-tab__mark {
  display: inline-flex;
  width: 17px;
  height: 17px;
  flex: 0 0 17px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: white;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
}

.topbar-project-tab__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.topbar-project-tab__close {
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  align-items: center;
  justify-content: center;
  margin-right: 3px;
  border-radius: 5px;
  color: inherit;
  opacity: 0;
  transition: opacity 120ms ease, background-color 120ms ease;
}

.topbar-project-tab:hover .topbar-project-tab__close,
.topbar-project-tab.is-active .topbar-project-tab__close,
.topbar-project-tab__close:focus-visible {
  opacity: 1;
}

.topbar-project-tab__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 9%, transparent);
}

.topbar-home-tab:hover,
.topbar-project-tab:hover {
  border-color: color-mix(in srgb, var(--color-border) 74%, transparent);
  background: var(--color-bg-subtle);
  color: var(--color-text-primary);
}

.topbar-home-tab.is-active,
.topbar-project-tab.is-active {
  border-color: color-mix(in srgb, var(--color-accent) 24%, var(--color-border));
  background: var(--color-accent-light);
  color: var(--color-accent);
  font-weight: 600;
}

.topbar-home-tab:focus-visible,
.topbar-project-tab__main:focus-visible,
.topbar-project-tab__close:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}
</style>
