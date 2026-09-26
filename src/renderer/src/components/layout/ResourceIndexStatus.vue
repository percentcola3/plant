<script setup lang="ts">
import { computed } from 'vue'
import type { ExternalRefIndexStatus } from '@shared/types'
import { AlertCircle, CheckCircle2, Clock3, LoaderCircle } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  status?: ExternalRefIndexStatus
  buildable?: boolean
  busy?: boolean
}>(), {
  buildable: false,
  busy: false
})
const emit = defineEmits<{ build: [] }>()

const state = computed(() => props.status?.state ?? 'missing')
const label = computed(() => {
  if (state.value === 'queued') return '等待构建'
  if (state.value === 'building') return '正在构建'
  if (state.value === 'ready') return '构建完成'
  if (state.value === 'error') return '构建失败'
  return '尚未构建'
})
const description = computed(() => {
  const status = props.status
  if (!status || status.state === 'missing') return '导入后会自动构建 zg 混合检索索引（本地，无需 AI）'
  if (status.state === 'queued') return '已进入后台队列，将按顺序处理'
  if (status.state === 'building') {
    // 分步进度（参照 zg TUI）：扫描 → 模型(仅首次) → 索引
    const phase = status.progress?.phase
    if (phase === 'scan') return '① 扫描文件中…'
    if (phase === 'model') {
      const percent = status.progress?.percent
      return percent !== undefined
        ? `② 准备嵌入模型（首次）· ${percent}%`
        : '② 准备嵌入模型（首次，约 32MB）'
    }
    if (phase === 'index') return '③ 构建索引中…'
    return '正在构建 zg 混合索引：代码符号 + 文档语义 + 向量'
  }
  if (status.state === 'error') return status.message || '后台构建失败，下次启动时会自动重试'
  return `zg检索 ${zgSearchPercent(status)}%`
})
const detailTitle = computed(() => {
  const status = props.status
  if (status?.state !== 'ready') return description.value
  const parts = [`已索引 ${formatFileCount(status.fileCount)} 个文件`]
  if (status.embedding) parts.push(status.embedding)
  if (status.entities !== undefined) parts.push(`${formatFileCount(status.entities)} 个实体`)
  if (status.enhancing && status.enhancing.pending > 0) {
    parts.push(`向量增强剩余 ${status.enhancing.pending}`)
  }
  if (status.builtAt) parts.push(formatBuiltAt(status.builtAt))
  return parts.join(' · ')
})
const buildLabel = computed(() => {
  if (props.busy || state.value === 'queued' || state.value === 'building') return '构建中'
  if (state.value === 'ready') return '重新构建'
  return '构建索引'
})
const buildDisabled = computed(() => props.busy || state.value === 'queued' || state.value === 'building')

function zgSearchPercent(status: ExternalRefIndexStatus): number {
  const enhancing = status.enhancing
  if (enhancing && enhancing.pending > 0) {
    const total = enhancing.total
    if (total && total > 0) {
      return Math.min(100, Math.max(0, Math.round(((total - enhancing.pending) / total) * 100)))
    }
    return 0
  }
  return 100
}

function formatFileCount(value: number | undefined): string {
  return new Intl.NumberFormat('zh-CN').format(value ?? 0)
}

function formatBuiltAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚更新'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}
</script>

<template>
  <div class="resource-index-status" :class="`resource-index-status--${state}`">
    <span class="resource-index-status__icon" aria-hidden="true">
      <LoaderCircle v-if="state === 'building'" :size="15" class="resource-index-status__spinner" />
      <CheckCircle2 v-else-if="state === 'ready'" :size="15" />
      <AlertCircle v-else-if="state === 'error'" :size="15" />
      <Clock3 v-else :size="15" />
    </span>
    <div class="resource-index-status__copy">
      <strong>检索索引</strong>
      <span :title="detailTitle">{{ description }}</span>
    </div>
    <div class="resource-index-status__actions">
      <span class="resource-index-status__badge">{{ label }}</span>
      <button
        v-if="props.buildable"
        type="button"
        class="resource-index-status__button"
        :disabled="buildDisabled"
        @click.stop="emit('build')"
      >{{ buildLabel }}</button>
    </div>
  </div>
</template>

<style scoped>
.resource-index-status {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin-top: 5px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-subtle);
  padding: 7px 9px;
}

.resource-index-status__icon {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: var(--color-bg-base);
  color: var(--color-text-secondary);
}

.resource-index-status__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.resource-index-status__copy strong {
  color: var(--color-text-primary);
  font-size: 11px;
  font-weight: 650;
}

.resource-index-status__copy span {
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: 10px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-index-status__badge {
  border-radius: 999px;
  background: var(--color-bg-base);
  padding: 3px 7px;
  color: var(--color-text-secondary);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.resource-index-status__actions { display: inline-flex; align-items: center; gap: 6px; }
.resource-index-status__button {
  cursor: pointer;
  border: 1px solid var(--color-accent-border);
  border-radius: 7px;
  background: var(--color-bg-panel);
  padding: 4px 8px;
  color: var(--color-accent);
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;
}
.resource-index-status__button:hover:not(:disabled) { background: var(--color-accent-light); }
.resource-index-status__button:disabled { cursor: default; opacity: 0.55; }

.resource-index-status--queued,
.resource-index-status--building {
  border-color: color-mix(in srgb, var(--color-info) 30%, var(--color-border));
  background: color-mix(in srgb, var(--color-info) 9%, var(--color-bg-panel));
}

.resource-index-status--queued .resource-index-status__icon,
.resource-index-status--building .resource-index-status__icon,
.resource-index-status--queued .resource-index-status__badge,
.resource-index-status--building .resource-index-status__badge {
  color: var(--color-info);
}

.resource-index-status--ready {
  border-color: color-mix(in srgb, var(--color-success) 30%, var(--color-border));
  background: color-mix(in srgb, var(--color-success) 9%, var(--color-bg-panel));
}

.resource-index-status--ready .resource-index-status__icon,
.resource-index-status--ready .resource-index-status__badge {
  color: var(--color-success);
}

.resource-index-status--error {
  border-color: color-mix(in srgb, var(--color-error) 30%, var(--color-border));
  background: color-mix(in srgb, var(--color-error) 9%, var(--color-bg-panel));
}

.resource-index-status--error .resource-index-status__icon,
.resource-index-status--error .resource-index-status__badge {
  color: var(--color-error);
}

.resource-index-status__spinner { animation: resource-index-spin 900ms linear infinite; }

@keyframes resource-index-spin {
  to { transform: rotate(360deg); }
}
</style>
