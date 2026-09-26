<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AiTaskSummary } from '@shared/types'
import { useAiTasksStore } from '@/stores/ai-tasks'
import { call } from '@/lib/api'
import {
  aiTaskCanAbort,
  aiTaskNotchStatusLabel,
  aiTaskProjectAttribution,
  sortAiTasksForNotch
} from '@/lib/ai-tasks/notch'
import { ExternalLink, Loader2, Minus, Sparkles, Square, X } from 'lucide-vue-next'

// 屏幕顶部常驻的灵动岛监控（参考 OpenSource/vibe-notch NotchWindow.swift）。
//
// 两态：
//   - mini：44×44 透明窗口内放置 36×36 主题图标和右上角角标。双击展开 panel。
//   - panel：620×最高 360 展开；任务列表 + abort/open 动作，高度随内容收缩。
//
// 拖动：mini/panel 头部都走 JS delta，确保双击和拖动可以共存。
// 用户拖到哪就停哪；主进程 `moved` 事件把位置写盘，下次启动读回。
//
// 不做 click-through：mini 图标可点；panel 只额外保留 12px 阴影缓冲。

type NotchState = 'mini' | 'panel'

const tasksStore = useAiTasksStore()
const state = ref<NotchState>('mini')
const abortingTaskId = ref<string | null>(null)

const now = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

const sortedTasks = computed(() => sortAiTasksForNotch(tasksStore.tasks))
const activeCount = computed(() => tasksStore.activeCount)
const waitingCount = computed(() => tasksStore.waitingCount)
const totalCount = computed(() => tasksStore.tasks.length)
const hasAttention = computed(() => waitingCount.value > 0)
const PANEL_SHADOW_GUTTER = 12
const PANEL_BORDER_HEIGHT = 2
const panelHeadEl = ref<HTMLElement | null>(null)
const panelBodyEl = ref<HTMLElement | null>(null)
let panelBodyObserver: ResizeObserver | null = null

function syncPanelHeight(): void {
  if (state.value !== 'panel') return
  const head = panelHeadEl.value
  const body = panelBodyEl.value
  if (!head || !body) return
  const height = Math.ceil(
    head.getBoundingClientRect().height
    + body.scrollHeight
    + PANEL_BORDER_HEIGHT
    + PANEL_SHADOW_GUTTER
  )
  void call('aiTask.notch.setPanelHeight', { height })
}

function schedulePanelHeightSync(): void {
  void nextTick(syncPanelHeight)
}

function statusText(task: AiTaskSummary): string {
  return aiTaskNotchStatusLabel(task.status)
}
function projectAttributionText(task: AiTaskSummary): string {
  const attribution = aiTaskProjectAttribution(task)
  return attribution.secondary
    ? `${attribution.primary} · ${attribution.secondary}`
    : attribution.primary
}
function activityText(task: AiTaskSummary): string {
  return task.lastMessagePreview || task.promptPreview
}
function elapsedText(task: AiTaskSummary): string {
  const startMs = new Date(task.createdAt).getTime()
  if (!startMs) return ''
  const diffSec = Math.max(0, Math.floor((now.value - startMs) / 1000))
  if (diffSec < 60) return `${diffSec}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h`
  return `${Math.floor(diffH / 24)}d`
}

async function closeNotch(): Promise<void> {
  const result = await call('settings.update', { aiTaskNotchEnabled: false })
  if (!result.ok) window.alert(result.message)
}

function minimize(): void {
  state.value = 'mini'
}
function expandAllTasks(): void {
  state.value = 'panel'
}

// —— JS 手写拖动（mini + panel 头部）
// mousedown 记录起点 → mousemove 超过 DRAG_THRESHOLD 就切 drag 模式，通过 IPC
// 让主进程 setBounds({x+dx, y+dy}) → mouseup 若没触发 drag 就当 click。
const DRAG_THRESHOLD = 3
type DragClickAction = () => void
const dragState = ref<{
  lastX: number
  lastY: number
  startX: number
  startY: number
  dragging: boolean
  clickAction: DragClickAction
} | null>(null)

function beginPointerDrag(e: MouseEvent, clickAction: DragClickAction): void {
  if (e.button !== 0) return
  dragState.value = {
    lastX: e.screenX,
    lastY: e.screenY,
    startX: e.screenX,
    startY: e.screenY,
    dragging: false,
    clickAction
  }
  window.addEventListener('mousemove', onPointerDragMove)
  window.addEventListener('mouseup', onPointerDragEnd)
}
function onPointerDragMove(e: MouseEvent): void {
  const s = dragState.value
  if (!s) return
  const totalDx = e.screenX - s.startX
  const totalDy = e.screenY - s.startY
  if (!s.dragging && Math.abs(totalDx) + Math.abs(totalDy) < DRAG_THRESHOLD) return
  s.dragging = true
  const dx = e.screenX - s.lastX
  const dy = e.screenY - s.lastY
  s.lastX = e.screenX
  s.lastY = e.screenY
  if (dx !== 0 || dy !== 0) void call('aiTask.notch.moveBy', { dx, dy })
}
function onPointerDragEnd(): void {
  const s = dragState.value
  window.removeEventListener('mousemove', onPointerDragMove)
  window.removeEventListener('mouseup', onPointerDragEnd)
  dragState.value = null
  if (s && !s.dragging) s.clickAction()
}
function onMiniMouseDown(e: MouseEvent): void {
  beginPointerDrag(e, () => undefined)
}
function onPanelHeadMouseDown(e: MouseEvent): void {
  beginPointerDrag(e, () => undefined)
}

async function openTask(task: AiTaskSummary): Promise<void> {
  await call('aiTask.open', { taskId: task.id })
  state.value = 'mini'
}

async function abortTask(task: AiTaskSummary): Promise<void> {
  abortingTaskId.value = task.id
  try {
    await tasksStore.abortTask(task)
  } finally {
    abortingTaskId.value = null
  }
}

// 从列表移除任务记录。如果任务还活着，dismissTask 内部会先 abort 再删。
async function dismissTask(task: AiTaskSummary): Promise<void> {
  await tasksStore.dismissTask(task)
}
function canDismiss(task: AiTaskSummary): boolean {
  // 灵动岛列表所有任务都允许 dismiss，运行中的走 abort 后移除
  return true
  void task
}

function toggleTransparentRoot(add: boolean): void {
  const method = add ? 'add' : 'remove'
  document.documentElement.classList[method]('ai-task-notch-body')
  document.body.classList[method]('ai-task-notch-body')
  const appEl = document.getElementById('app')
  appEl?.classList[method]('ai-task-notch-body')
}
onMounted(() => {
  toggleTransparentRoot(true)
  tasksStore.startWatching()
  void tasksStore.load()
  tickTimer = setInterval(() => { now.value = Date.now() }, 30_000)
})
onBeforeUnmount(() => {
  toggleTransparentRoot(false)
  tasksStore.stopWatching()
  if (tickTimer) clearInterval(tickTimer)
  panelBodyObserver?.disconnect()
  window.removeEventListener('mousemove', onPointerDragMove)
  window.removeEventListener('mouseup', onPointerDragEnd)
  dragState.value = null
})

// 有 waiting 任务时若在 mini，自动展开面板
watch(hasAttention, (value) => {
  if (value && state.value !== 'panel') state.value = 'panel'
})

// 状态变化 → 通知主进程调整窗口尺寸（保持位置不变）
watch(state, (value) => {
  void call('aiTask.notch.setState', { state: value })
}, { immediate: true })

watch(panelBodyEl, (body) => {
  panelBodyObserver?.disconnect()
  panelBodyObserver = null
  if (!body) return
  panelBodyObserver = new ResizeObserver(syncPanelHeight)
  panelBodyObserver.observe(body)
  schedulePanelHeightSync()
}, { flush: 'post' })

watch(
  [state, () => sortedTasks.value.length, () => tasksStore.loading],
  schedulePanelHeightSync,
  { immediate: true }
)
</script>

<template>
  <main class="notch-root" :class="{ 'notch-root--panel': state === 'panel' }">
    <!-- Mini 态：主题图标
         同一元素既要双击又要拖动。CSS -webkit-app-region: drag 会吞掉双击，
         所以走 JS：mousedown 记起点，mousemove 累计位移超阈值就切
         drag 模式并 IPC 让主进程按 delta 移窗口。 -->
    <button
      v-if="state === 'mini'"
      class="notch-mini"
      type="button"
      title="双击展开全部任务，按住拖动"
      aria-label="双击展开全部 AI 任务"
      @mousedown="onMiniMouseDown"
      @dblclick.stop="expandAllTasks"
      @keydown.enter.prevent="expandAllTasks"
      @keydown.space.prevent="expandAllTasks"
    >
      <Sparkles class="h-5 w-5" aria-hidden="true" />
      <span
        v-if="activeCount > 0"
        class="notch-mini-count"
        :title="`${activeCount} 个任务正在执行`"
      >{{ activeCount > 9 ? '9+' : activeCount }}</span>
      <span
        v-else-if="hasAttention"
        class="notch-mini-dot"
        :title="`${waitingCount} 个任务待处理`"
      />
    </button>

    <button v-if="state === 'mini'" class="notch-close" type="button" title="关闭悬浮任务球，可在设置中重新开启" aria-label="关闭悬浮任务球" @mousedown.stop @dblclick.stop @click.stop="closeNotch">
      <X :size="10" aria-hidden="true" />
    </button>

    <!-- Panel 态：展开面板 -->
    <section
      v-else
      class="notch-panel"
      aria-label="AI 任务状态"
    >
      <header
        ref="panelHeadEl"
        class="notch-panel-head"
        title="按住拖动，双击最小化"
        @mousedown="onPanelHeadMouseDown"
        @dblclick="minimize"
      >
        <div class="notch-panel-title no-drag">
          <span class="notch-dot" :class="{ 'notch-dot--attention': hasAttention }" />
          <span>AI 任务</span>
          <span v-if="totalCount > 0" class="notch-total">{{ totalCount }} sessions</span>
        </div>
        <div class="notch-panel-actions no-drag" @mousedown.stop @dblclick.stop>
          <button class="notch-icon-button" type="button" title="关闭悬浮任务球" aria-label="关闭悬浮任务球" @click="closeNotch"><X class="h-4 w-4" aria-hidden="true" /></button>
          <button class="notch-icon-button" type="button" title="缩小为图标" @click="minimize">
            <Minus class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div v-if="tasksStore.loading && sortedTasks.length === 0" ref="panelBodyEl" class="notch-empty no-drag">
        <Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>读取任务</span>
      </div>
      <div v-else-if="sortedTasks.length === 0" ref="panelBodyEl" class="notch-empty no-drag">暂无后台任务</div>

      <div v-else ref="panelBodyEl" class="notch-list no-drag">
        <article
          v-for="task in sortedTasks"
          :key="task.id"
          class="notch-task"
          :class="{ 'notch-task--attention': task.status === 'waiting_user' || task.status === 'waiting_approval' }"
        >
          <button class="notch-task-main" type="button" @click="openTask(task)">
            <span class="notch-task-head">
              <span class="notch-task-title">{{ task.title }}</span>
              <span class="notch-task-status">{{ statusText(task) }}</span>
              <span class="notch-task-elapsed">{{ elapsedText(task) }}</span>
            </span>
            <span class="notch-task-meta">{{ projectAttributionText(task) }}</span>
            <span class="notch-task-output">{{ activityText(task) }}</span>
          </button>
          <div class="notch-task-actions">
            <button
              v-if="aiTaskCanAbort(task)"
              class="notch-action notch-action--danger"
              type="button"
              title="终止任务"
              :disabled="abortingTaskId === task.id"
              @click="abortTask(task)"
            >
              <Square class="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button class="notch-action" type="button" title="跳转到任务" @click="openTask(task)">
              <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              v-if="canDismiss(task)"
              class="notch-action notch-action--danger"
              type="button"
              :title="aiTaskCanAbort(task) ? '终止并从列表移除' : '从列表移除'"
              @click="dismissTask(task)"
            >
              <X class="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* 灵动岛窗口是透明 BrowserWindow，但全局 CSS 里 body 有 bg-background（浅色）
 * 会漏白边到窗口透明区域。给这个专用窗口的 html/body/#app 全部覆盖成透明。
 * onMounted 里同步给 html/#app 也挂上同名 class，:global() 精准覆盖。 */
:global(html.ai-task-notch-body),
:global(body.ai-task-notch-body),
:global(#app.ai-task-notch-body) {
  background: transparent !important;
  background-color: transparent !important;
  overflow: hidden;
}

.notch-root {
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  color: var(--color-text-primary);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  user-select: none;
}
.notch-root--panel {
  padding-bottom: 12px;
}

/* 拖动区域统一走 JS delta，避免原生 drag 区域吞掉双击。 */

/* ─── Mini 态 ─── */
.notch-mini {
  position: relative;
  margin-top: 4px;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 0;
  outline: none;
  background: var(--color-accent);
  color: var(--color-bg-base);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--color-accent) 24%, transparent);
  /* 双击展开 + JS 手写拖动共存，禁用 CSS 层的 drag（会吞双击）。 */
  -webkit-app-region: no-drag;
}
.notch-mini:focus-visible {
  box-shadow:
    0 4px 12px color-mix(in srgb, var(--color-accent) 24%, transparent),
    inset 0 0 0 2px var(--color-accent-pressed);
}
.notch-mini:active {
  cursor: grabbing;
}
.notch-mini-dot {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--color-warning);
  box-shadow: 0 0 10px color-mix(in srgb, var(--color-warning) 75%, transparent);
}
.notch-mini-count {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--color-warning);
  padding: 0 3px;
  color: var(--color-text-primary);
  font-size: 9px;
  font-weight: 800;
  line-height: 14px;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-warning) 72%, transparent);
  animation: notch-mini-count-pulse 1.2s ease-in-out infinite;
}
@keyframes notch-mini-count-pulse {
  0%, 100% {
    opacity: 1;
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-warning) 68%, transparent);
  }
  50% {
    opacity: 0.66;
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-warning) 0%, transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .notch-mini-count {
    animation: none;
  }
}

.notch-task-title,
.notch-task-output,
.notch-total {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── Panel 态 ─── */
.notch-panel {
  width: 620px;
  max-height: calc(100vh - 12px);
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--color-bg-panel) 96%, transparent);
  box-shadow: 0 8px 18px color-mix(in srgb, var(--color-text-primary) 16%, transparent);
  backdrop-filter: blur(24px);
  display: flex;
  flex-direction: column;
}

.notch-panel-head {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--color-border-subtle);
  -webkit-app-region: no-drag;
  cursor: grab;
}
.notch-panel-head:active {
  cursor: grabbing;
}

.notch-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 700;
}
.notch-panel-actions {
  display: inline-flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.notch-total {
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 500;
}

.notch-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--color-accent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--color-accent) 45%, transparent);
}
.notch-dot--attention {
  background: var(--color-warning);
  box-shadow: 0 0 12px color-mix(in srgb, var(--color-warning) 45%, transparent);
}

.notch-icon-button,
.notch-action {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.notch-icon-button:hover,
.notch-action:hover {
  background: var(--color-accent-light);
  color: var(--color-accent);
}
.notch-action--danger:hover {
  border-color: color-mix(in srgb, var(--color-error) 45%, var(--color-border));
  color: var(--color-error);
}
.notch-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.notch-list {
  flex: 1;
  overflow: auto;
  padding: 8px;
  -webkit-app-region: no-drag;
}
.notch-empty {
  flex: 1;
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.notch-task {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  background: var(--color-bg-subtle);
  padding: 8px 10px;
}
.notch-task--attention {
  border-color: color-mix(in srgb, var(--color-warning) 32%, var(--color-border));
  background: var(--color-warning-subtle);
}

.notch-task-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.notch-task-head {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.notch-task-title {
  min-width: 0;
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 700;
}
.notch-task-status {
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--color-accent-subtle);
  padding: 1px 7px;
  color: var(--color-accent-pressed);
  font-size: 10px;
}
.notch-task--attention .notch-task-status {
  background: var(--color-warning-subtle);
  color: var(--color-warning);
}
.notch-task-elapsed {
  margin-left: auto;
  color: var(--color-text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.notch-task-meta {
  color: var(--color-text-muted);
  font-size: 10px;
}
.notch-task-output {
  max-width: 440px;
  color: var(--color-text-secondary);
  font-size: 11px;
}
.notch-task-actions {
  display: inline-flex;
  gap: 5px;
}
</style>

<style scoped>
.notch-close { position: absolute; left: 0; top: 0; display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: var(--color-bg-panel); color: var(--color-text-primary); cursor: pointer; opacity: 0; }
.notch-root:hover .notch-close, .notch-close:focus-visible { opacity: 1; }
</style>
