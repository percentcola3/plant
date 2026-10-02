<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MainWindow from './views/MainWindow.vue'
import PlantLogo from './components/brand/PlantLogo.vue'
import AiTaskNotchWindow from './components/layout/AiTaskNotchWindow.vue'
import BranchHistoryDialog from './components/dialogs/BranchHistoryDialog.vue'
import { useUiStore } from './stores/ui'
import { useWorkspacesStore } from './stores/workspaces'
import { useEditorStore } from './stores/editor'

const ui = useUiStore()
const workspaces = useWorkspacesStore()
const editor = useEditorStore()
// URL 里带 ?window=ai-task-notch 的是屏幕顶部灵动岛专用 BrowserWindow，
// 只渲染 AiTaskNotchWindow，主 App 的所有初始化流程都不跑（避免重复起服务）。
const isAiTaskNotchWindow = new URLSearchParams(window.location.search).get('window') === 'ai-task-notch'
const hasUnsavedEditorChanges = computed(() => editor.isDirty)
const startupLoading = ref(true)
const startupStep = ref('正在启动 Plant')
const startupError = ref<string | null>(null)

// 显示 Git 推送总结的提示。
if (!isAiTaskNotchWindow) onMounted(() => {
  const offSummary = window.events.on('git.push-summary-warning', (payload: unknown) => {
    const event = payload as { message: string }
    ui.showToast('info', event.message, 6000)
  })
  onBeforeUnmount(offSummary)
})

// auto-save saga 在 fs-change 触发后会 commit + push 一次 wip。用户对"未察觉自动 push"
// 是有感知诉求的，这里订阅 saga.fs-change-pushed 事件给个右下 toast，让人能及时撤回。
if (!isAiTaskNotchWindow) watch(
  () => workspaces.activeId,
  (workspaceId, _prev, onCleanup) => {
    if (!workspaceId) return
    const unsubscribe = window.events.on(
      `saga.fs-change-pushed:${workspaceId}`,
      (payload: unknown) => {
        const event = payload as { branch?: string; message?: string }
        const summary = formatPushedToast(event.branch, event.message)
        ui.showToast('info', summary, 5000)
      }
    )
    onCleanup(unsubscribe)
  },
  { immediate: true }
)

// 单个项目过大或底层 watcher 异常时，主进程会主动关闭实时监听以保护 AI spawn。
// 明确告知用户降级结果，避免自动保存/预览刷新静默失效。
if (!isAiTaskNotchWindow) watch(
  () => workspaces.activeId,
  (workspaceId, _prev, onCleanup) => {
    if (!workspaceId) return
    const unsubscribe = window.events.on(
      `fs.watch-status:${workspaceId}`,
      (payload: unknown) => {
        const event = payload as { state?: string }
        if (event.state !== 'degraded') return
        ui.showToast(
          'error',
          '项目实时保存和预览刷新已暂停；请先手动保存，若 AI 对话无法启动，请完全退出 App 后重试。',
          8000
        )
      }
    )
    onCleanup(unsubscribe)
  },
  { immediate: true }
)

function formatPushedToast(branch?: string, _message?: string): string {
  // 设计师向：把工程化的 "wip(req/xxx): 2026-..." 翻译成一句人话。
  // branch 形如 req/<id>-<topic-slug> 或 main / feature/xxx 等；提取 topic 部分。
  const topic = topicFromBranch(branch)
  if (topic) return `${topic} 已自动同步到云端`
  if (branch) return `${branch} 已自动同步到云端`
  return '已自动同步到云端'
}

function topicFromBranch(branch?: string): string {
  if (!branch) return ''
  // req/<id>-<slug> → 取 <slug>；main / 其它分支返回空让上层用 branch 兜底
  const match = /^req\/([^/]+)$/.exec(branch)
  if (!match) return ''
  const tail = match[1]
  // <id>-<slug>：id 是 hash 前缀（数字+字母 6-12），slug 是 kebab；尽量丢 id 留 slug
  const slugMatch = /^[0-9a-f]{6,16}-(.+)$/i.exec(tail)
  return slugMatch ? slugMatch[1] : tail
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!hasUnsavedEditorChanges.value) return
  const ok = window.confirm('当前编辑内容还没保存。确定要关闭窗口并放弃这些改动吗？')
  if (ok) return
  event.preventDefault()
  event.returnValue = false
}

async function setStartupStep(step: string): Promise<void> {
  startupStep.value = step
  await nextTick()
}

if (!isAiTaskNotchWindow) onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  try {
    await setStartupStep('连接应用服务')
    await ui.loadRuntimeInfo()
    await setStartupStep('加载工作区')
    // 关键路径：环境检查 + 默认本地工作台初始化并行。
    // .mywork 由系统自动创建并激活，用户无需再新建或导入根项目。
    await Promise.all([
      ui.checkStartupEnvironment(),
      workspaces.initializeDefaultWorkspace()
    ])
    ui.openHome()
    await setStartupStep('准备界面')
  } catch (error) {
    startupError.value = error instanceof Error ? error.message : String(error)
    ui.showToast('error', `启动初始化失败：${startupError.value}`, 6000)
  } finally {
    startupLoading.value = false
    // splash 落幕后，后台异步检测 IDE（cursor / vscode），结果给 project-tool-menu 用
    setTimeout(() => ui.detectIdesInBackground(), 0)
  }
})

if (!isAiTaskNotchWindow) onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<template>
  <AiTaskNotchWindow v-if="isAiTaskNotchWindow" />
  <template v-else>
    <MainWindow />
    <BranchHistoryDialog />
    <Transition name="startup">
      <div v-if="startupLoading" class="startup-overlay">
        <div class="startup-panel">
          <div class="startup-mark" aria-hidden="true">
            <PlantLogo :size="34" />
          </div>
          <div class="startup-copy">
            <strong>正在打开 Plant</strong>
            <p>{{ startupStep }}</p>
          </div>
        </div>
      </div>
    </Transition>
  </template>
</template>

<style scoped>
.startup-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-bg-base) 72%, transparent);
  backdrop-filter: blur(10px);
}

.startup-panel {
  display: flex;
  min-width: 280px;
  align-items: center;
  gap: 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-panel);
  padding: 18px 20px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
}

.startup-mark {
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--color-accent-light);
}

.startup-mark::before {
  position: absolute;
  inset: -4px;
  border: 2px solid var(--color-accent-border);
  border-top-color: var(--color-accent);
  border-radius: 999px;
  content: '';
  animation: startup-spin 0.8s linear infinite;
}

.startup-copy strong {
  display: block;
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 650;
}

.startup-copy p {
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.startup-enter-active,
.startup-leave-active {
  transition: opacity 0.18s ease;
}

.startup-enter-from,
.startup-leave-to {
  opacity: 0;
}

@keyframes startup-spin {
  to { transform: rotate(360deg); }
}
</style>
