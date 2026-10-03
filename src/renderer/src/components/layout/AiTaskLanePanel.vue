<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { AiTaskSummary } from '@shared/types'
import { useAiTasksStore } from '@/stores/ai-tasks'
import { useUiStore } from '@/stores/ui'
import { groupAiTasksByLane } from '@/lib/ai-tasks/lanes'
import { aiTaskProjectAttribution } from '@/lib/ai-tasks/notch'
import { Square, X } from 'lucide-vue-next'

const tasksStore = useAiTasksStore()
const ui = useUiStore()

const lanes = computed(() => groupAiTasksByLane(tasksStore.tasks))
const hasTasks = computed(() => tasksStore.tasks.length > 0)

onMounted(() => {
  tasksStore.startWatching()
  void tasksStore.load()
})

onBeforeUnmount(() => {
  tasksStore.stopWatching()
})

function statusLabel(status: AiTaskSummary['status']): string {
  if (status === 'running') return '运行中'
  if (status === 'waiting_user') return '等待补充'
  if (status === 'waiting_approval') return '等待授权'
  if (status === 'completed' || status === 'applied') return '已完成'
  if (status === 'failed') return '失败'
  return '已中止'
}

function areaLabel(task: AiTaskSummary): string {
  if (task.workArea.kind === 'workspace') return '工作区'
  if (task.workArea.kind === 'ui-product' || task.workArea.kind === 'feature') return ''
  return task.workArea.relPath
}

function projectAttributionText(task: AiTaskSummary): string {
  const attribution = aiTaskProjectAttribution(task)
  return attribution.secondary
    ? `${attribution.primary} · ${attribution.secondary}`
    : attribution.primary
}

async function openTask(task: AiTaskSummary): Promise<void> {
  await tasksStore.openTask(task)
  ui.closeAiTaskPanel()
}

function canAbort(task: AiTaskSummary): boolean {
  return task.status === 'running'
    || task.status === 'waiting_user'
    || task.status === 'waiting_approval'
}

async function abortTask(task: AiTaskSummary): Promise<void> {
  const ok = await tasksStore.abortTask(task)
  ui.showToast(ok ? 'info' : 'error', ok ? '已终止任务' : '终止失败')
}

// 从灵动岛/泳道里彻底移除。若仍在跑，先 abort。
async function dismissTask(task: AiTaskSummary): Promise<void> {
  const ok = await tasksStore.dismissTask(task)
  if (!ok) ui.showToast('error', '移除失败')
}
</script>

<template>
  <div class="ai-task-scrim" @click.self="ui.closeAiTaskPanel">
    <aside class="ai-task-panel" aria-label="AI 任务">
      <header class="ai-task-head">
        <div>
          <div class="ai-task-title">AI 任务</div>
          <div class="ai-task-subtitle">后台执行的项目任务</div>
        </div>
        <button class="ai-task-close" type="button" title="关闭" @click="ui.closeAiTaskPanel">
          <X class="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div v-if="tasksStore.loading && !hasTasks" class="ai-task-state">读取任务…</div>
      <div v-else-if="!hasTasks" class="ai-task-state">
        <div class="ai-task-empty-title">暂无任务</div>
        <div class="ai-task-empty-text">从项目 AI 面板发起任务后，会在这里持续显示。</div>
      </div>

      <div v-else class="ai-task-lanes">
        <section v-for="lane in lanes" :key="lane.id" class="ai-task-lane">
          <div class="ai-task-lane-head">
            <span>{{ lane.title }}</span>
            <span class="ai-task-count">{{ lane.tasks.length }}</span>
          </div>
          <div v-if="lane.tasks.length === 0" class="ai-task-lane-empty">没有任务</div>
          <article
            v-for="task in lane.tasks"
            :key="task.id"
            class="ai-task-card"
            role="button"
            tabindex="0"
            @click="openTask(task)"
            @keydown.enter.prevent="openTask(task)"
          >
            <div class="ai-task-card-row">
              <span class="ai-task-card-title">{{ task.title }}</span>
              <span class="ai-task-status" :class="`ai-task-status--${task.status}`">{{ statusLabel(task.status) }}</span>
            </div>
            <div class="ai-task-meta">
              {{ projectAttributionText(task) }}<template v-if="areaLabel(task)"> · {{ areaLabel(task) }}</template>
            </div>
            <div class="ai-task-preview">{{ task.promptPreview }}</div>
            <div v-if="task.changedArtifacts.length > 0" class="ai-task-changed">
              {{ task.changedArtifacts.length }} 个文件变更
            </div>
            <div v-if="task.errorMessage" class="ai-task-error">{{ task.errorMessage }}</div>
            <div class="ai-task-actions">
              <button
                v-if="canAbort(task)"
                type="button"
                class="ai-task-action ai-task-action--danger"
                title="终止任务"
                @click.stop="abortTask(task)"
              >
                <Square class="h-3 w-3" aria-hidden="true" />
                <span>终止</span>
              </button>
              <button
                type="button"
                class="ai-task-action"
                @click.stop="openTask(task)"
              >打开</button>
              <button
                type="button"
                class="ai-task-action ai-task-action--dismiss ml-auto"
                :title="canAbort(task) ? '先终止再从列表移除' : '从列表移除'"
                @click.stop="dismissTask(task)"
              >
                <X class="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          </article>
        </section>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.ai-task-scrim {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.18);
}

.ai-task-panel {
  width: min(1100px, 92vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--color-border);
  background: var(--color-bg-panel);
  box-shadow: -12px 0 28px rgba(0, 0, 0, 0.14);
}

.ai-task-head {
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
}

.ai-task-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.ai-task-subtitle {
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.ai-task-close {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-base);
  color: var(--color-text-secondary);
}

.ai-task-state {
  padding: 28px 16px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.ai-task-empty-title {
  font-weight: 700;
  color: var(--color-text-primary);
}

.ai-task-empty-text {
  margin-top: 6px;
}

.ai-task-lanes {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 12px;
}

@media (max-width: 1200px) {
  .ai-task-lanes {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.ai-task-lane {
  min-width: 0;
}

.ai-task-lane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 8px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 700;
}

.ai-task-count {
  min-width: 22px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-size: 11px;
}

.ai-task-lane-empty {
  padding: 12px;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.ai-task-card {
  width: 100%;
  display: block;
  margin-bottom: 8px;
  padding: 10px;
  border: 0;
  border-radius: 12px;
  background: var(--color-card-surface);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.ai-task-card:hover {
  background: var(--color-card-hover);
}

.ai-task-card-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.ai-task-card-title {
  min-width: 0;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 700;
}

.ai-task-status {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-size: 11px;
}

.ai-task-status--running {
  background: var(--color-accent-subtle);
  color: var(--color-accent-pressed);
}

.ai-task-status--waiting_user,
.ai-task-status--waiting_approval {
  background: var(--color-warning-subtle);
  color: var(--color-warning);
}

.ai-task-status--failed {
  background: var(--color-error-subtle);
  color: var(--color-error);
}

.ai-task-meta,
.ai-task-preview,
.ai-task-changed,
.ai-task-error {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.45;
}

.ai-task-meta {
  color: var(--color-text-secondary);
}

.ai-task-preview {
  color: var(--color-text-primary);
}

.ai-task-changed {
  color: var(--color-success);
}

.ai-task-error {
  color: var(--color-error);
}

.ai-task-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 6px;
  margin-top: 8px;
}

.ai-task-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-panel);
  padding: 0 9px;
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.ai-task-action:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.ai-task-action--primary {
  border-color: var(--color-button-bg);
  background: var(--color-button-bg);
  color: var(--color-button-fg);
}
.ai-task-action--primary:hover {
  background: var(--color-button-bg-hover);
  border-color: var(--color-button-bg-hover);
  color: var(--color-button-fg);
}

.ai-task-action--danger {
  border-color: color-mix(in srgb, var(--color-error) 60%, var(--color-border));
  color: var(--color-error);
}
.ai-task-action--danger:hover {
  background: color-mix(in srgb, var(--color-error) 8%, transparent);
  color: var(--color-error);
}

.ai-task-action--dismiss {
  min-width: 26px;
  min-height: 26px;
  padding: 0;
  justify-content: center;
}
.ai-task-action--dismiss:hover {
  border-color: color-mix(in srgb, var(--color-error) 55%, var(--color-border));
  color: var(--color-error);
}

@media (max-width: 720px) {
  .ai-task-lanes {
    grid-template-columns: 1fr;
  }
}
</style>
