<script setup lang="ts">
import TopBar from '@/components/layout/TopBar.vue'
import WorkspaceSidebar from '@/components/layout/WorkspaceSidebar.vue'
import WorkbenchPage from '@/components/layout/WorkbenchPage.vue'
import ProjectAiConfigPanel from '@/components/layout/ProjectAiConfigPanel.vue'
import ExternalRefViewer from '@/components/layout/ExternalRefViewer.vue'
import TerminalPane from '@/components/layout/TerminalPane.vue'
import AiTaskLanePanel from '@/components/layout/AiTaskLanePanel.vue'
import WorkspaceEditorPane from '@/components/editor/WorkspaceEditorPane.vue'
import PreviewPanel from '@/components/preview/PreviewPanel.vue'
import ConfirmDangerDialog from '@/components/dialogs/ConfirmDangerDialog.vue'
import PromptDialog from '@/components/dialogs/PromptDialog.vue'
import UiProductRenameDialog from '@/components/dialogs/UiProductRenameDialog.vue'
import PATPromptDialog from '@/components/dialogs/PATPromptDialog.vue'
import SettingsDialog from '@/components/dialogs/SettingsDialog.vue'
import StartupEnvironmentDialog from '@/components/dialogs/StartupEnvironmentDialog.vue'
import SyncProgressDialog from '@/components/dialogs/SyncProgressDialog.vue'
import ConflictResolveDialog from '@/components/dialogs/ConflictResolveDialog.vue'
import AiRepairPromptDialog from '@/components/dialogs/AiRepairPromptDialog.vue'
import AddExternalRefDialog from '@/components/dialogs/AddExternalRefDialog.vue'
import ToastStack from '@/components/layout/ToastStack.vue'
import IdeLaunchIndicator from '@/components/layout/IdeLaunchIndicator.vue'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { usePreviewStore } from '@/stores/preview'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useAiTasksStore } from '@/stores/ai-tasks'
import { shouldShowTerminalPane } from '@/lib/terminal/terminal-panel-visibility'

const previewStore = usePreviewStore()
const editorStore = useEditorStore()
const ui = useUiStore()
const workspacesStore = useWorkspacesStore()
const aiTasks = useAiTasksStore()

// 灵动岛点了某个任务卡片 → 主进程 focus 本窗口 + send('ai-task.open') → 打开
onMounted(() => {
  const unsubscribe = window.events.on('ai-task.open', (payload: unknown) => {
    const taskId = typeof payload === 'object' && payload
      ? (payload as { taskId?: unknown }).taskId
      : null
    if (typeof taskId === 'string') void aiTasks.openTaskById(taskId)
  })
  onBeforeUnmount(unsubscribe)
})
const { hasOpenTabs, isPreviewActive, activeTab } = storeToRefs(previewStore)
const { currentView, terminalPanelOpen, aiTaskPanelOpen } = storeToRefs(ui)
const { isOpen: editorOpen } = storeToRefs(editorStore)
const { checkingOutHomeId } = storeToRefs(workspacesStore)

const suppressTerminalHeader = computed(() =>
  isPreviewActive.value && activeTab.value?.type === 'files'
)

// 终端在编辑器/预览态自动显示，也允许首页手动展开。
const branchSwitching = computed(() => !!checkingOutHomeId.value)
const showTerminal = computed(() => shouldShowTerminalPane({
  previewActive: isPreviewActive.value,
  editorOpen: editorOpen.value,
  terminalPanelOpen: terminalPanelOpen.value,
  branchSwitching: branchSwitching.value
}))

</script>

<template>
  <div class="app-shell h-full flex flex-col">
    <TopBar />
    <div class="app-shell__workspace flex flex-1 min-h-0 flex-col">
      <div
        v-if="suppressTerminalHeader"
        id="product-workbench-topbar"
        class="shrink-0 border-b border-[var(--color-border-subtle)]"
      />
      <div class="flex min-h-0 flex-1 min-w-0 overflow-hidden">
        <!-- 首页与项目 Tab 切换时保留预览实例，避免项目内编辑状态被卸载。 -->
        <PreviewPanel v-if="hasOpenTabs" v-show="isPreviewActive" />
        <template v-if="!isPreviewActive">
          <WorkspaceSidebar />
          <div class="app-content-surface min-w-0 flex flex-1 flex-col overflow-hidden">
            <main
              v-if="editorOpen"
              class="min-h-0 flex-1 overflow-hidden"
            >
              <WorkspaceEditorPane />
            </main>
            <ProjectAiConfigPanel v-else-if="currentView === 'ai-config'" section="resources" />
            <ProjectAiConfigPanel v-else-if="currentView === 'skills-config'" section="skills" />
            <ExternalRefViewer v-else-if="currentView === 'external-view'" />
            <WorkbenchPage v-else />
          </div>
        </template>
        <TerminalPane v-if="showTerminal" :suppress-header="suppressTerminalHeader" />
      </div>
    </div>
    <ConfirmDangerDialog />
    <PromptDialog />
    <UiProductRenameDialog />
    <PATPromptDialog />
    <SettingsDialog />
    <StartupEnvironmentDialog />
    <SyncProgressDialog />
    <ConflictResolveDialog />
    <AiRepairPromptDialog />
    <AddExternalRefDialog />
    <AiTaskLanePanel v-if="aiTaskPanelOpen" />
    <ToastStack />
    <IdeLaunchIndicator />
  </div>
</template>
