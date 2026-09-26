<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  FeaturePublishProgressEvent,
  FeaturePublishRecord,
  UiProductPublishProgressEvent,
  UiProductPublishRecord,
} from '@shared/types'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'

const props = withDefaults(defineProps<{
  workspaceId: string
  productRelPath: string
  fileCount?: number
}>(), {
  fileCount: 1,
})

const ui = useUiStore()
const publish = ref<UiProductPublishRecord | FeaturePublishRecord | null>(null)
const gitHeadSha = ref<string | null>(null)
const publishing = ref(false)
const progressLabel = ref<string | null>(null)
let unsubscribeProgress: (() => void) | null = null

const publishKind = computed<'ux' | 'feature' | null>(() => {
  const relPath = props.productRelPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (relPath.startsWith('outputs/')) return 'ux'
  if (relPath.startsWith('features/')) return 'feature'
  return null
})

const isStale = computed(() => {
  const publishedSha = publish.value?.headSha
  return !!publishedSha && !!gitHeadSha.value && publishedSha !== gitHeadSha.value
})

const tone = computed<'idle' | 'shared' | 'stale' | 'busy'>(() => {
  if (publishing.value) return 'busy'
  if (publish.value && isStale.value) return 'stale'
  if (publish.value) return 'shared'
  return 'idle'
})

const label = computed(() => publishing.value ? (progressLabel.value ?? '分享中…') : '分享')

const title = computed(() => {
  if (publishing.value) return progressLabel.value ?? '分享中…'
  if (publish.value && isStale.value) return `有未分享的改动，点击重新分享：${publish.value.url}`
  if (publish.value) return `复制分享链接：${publish.value.url}`
  return '分享链接'
})

onMounted(() => {
  void refreshPublishState()
  subscribeProgress()
})

onBeforeUnmount(() => {
  unsubscribeProgress?.()
  unsubscribeProgress = null
})

watch(() => [props.workspaceId, props.productRelPath] as const, () => {
  void refreshPublishState()
  subscribeProgress()
})

async function refreshPublishState(): Promise<void> {
  publish.value = await loadPublishRecord(props.workspaceId, props.productRelPath, publishKind.value)
  gitHeadSha.value = await loadGitHeadSha(props.workspaceId)
}

async function loadPublishRecord(
  workspaceId: string,
  productRelPath: string,
  kind: 'ux' | 'feature' | null
): Promise<UiProductPublishRecord | FeaturePublishRecord | null> {
  if (!kind) return null
  const relPath = kind === 'ux'
    ? `${productRelPath.replace(/\/+$/, '')}/meta.json`
    : `${productRelPath.replace(/\/+$/, '')}/.publish.json`
  const exists = await call('editor.entryExists', {
    workspaceId,
    relPath,
    scope: 'project',
  })
  if (!exists.ok || !exists.data.exists) return null
  const r = await call('editor.readTextFile', {
    workspaceId,
    relPath,
    scope: 'project',
  })
  if (!r.ok) return null
  try {
    const parsed = JSON.parse(r.data.content) as Record<string, unknown>
    if (kind === 'ux') {
      const record = parsed.publish
      if (!isUiPublishRecord(record) || normalizeRelPath(record.productRelPath) !== normalizeRelPath(productRelPath)) {
        return null
      }
      return record
    }
    if (!isFeaturePublishRecord(parsed) || normalizeRelPath(parsed.featureRelPath) !== normalizeRelPath(productRelPath)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function loadGitHeadSha(workspaceId: string): Promise<string | null> {
  const r = await call('git.status', { workspaceId })
  if (!r.ok) return null
  return r.data.headSha ?? null
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function isUiPublishRecord(value: unknown): value is UiProductPublishRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.productRelPath === 'string' && typeof record.url === 'string' && record.url.length > 0
}

function isFeaturePublishRecord(value: unknown): value is FeaturePublishRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.featureRelPath === 'string' && typeof record.url === 'string' && record.url.length > 0
}

function subscribeProgress(): void {
  unsubscribeProgress?.()
  unsubscribeProgress = null
  if (!props.workspaceId || !publishKind.value) return
  const channel = publishKind.value === 'ux'
    ? `ui-product.publish-progress:${props.workspaceId}`
    : `feature.publish-progress:${props.workspaceId}`
  unsubscribeProgress = window.events.on(channel, (payload: unknown) => {
    if (publishKind.value === 'ux') {
      const event = payload as UiProductPublishProgressEvent
      if (normalizeRelPath(event.productRelPath) !== normalizeRelPath(props.productRelPath)) return
      if (!publishing.value) publishing.value = true
      progressLabel.value = formatProgressLabel(event)
      return
    }
    const event = payload as FeaturePublishProgressEvent
    if (normalizeRelPath(event.featureRelPath) !== normalizeRelPath(props.productRelPath)) return
    if (!publishing.value) publishing.value = true
    progressLabel.value = formatProgressLabel(event)
  })
}

function formatProgressLabel(event: UiProductPublishProgressEvent | FeaturePublishProgressEvent): string {
  if (event.phase === 'preparing') return '准备中'
  if (event.phase === 'comparing') return '对比改动中'
  if (event.phase === 'rendering-md') return '渲染文档中'
  if (event.phase === 'collecting-ui') return '收集页面中'
  if (event.phase === 'zipping') return '打包中'
  if (event.phase === 'finalizing') return '收尾中'
  if (event.phase === 'completed') return '100%'
  const total = Math.max(event.total, 1)
  const percent = Math.min(Math.round((event.uploaded / total) * 100), 99)
  return `上传 ${percent}%`
}

async function copyPublishedUrl(url: string): Promise<void> {
  const r = await call('system.copyToClipboard', { text: url })
  if (!r.ok) {
    ui.showToast('error', `复制失败：${r.message}`, 2400)
    return
  }
    ui.showToast('success', '分享链接已复制', 1600)
}

async function publishProject(): Promise<void> {
  if (!publishKind.value || publishing.value) return
  publishing.value = true
  progressLabel.value = '准备中'
  try {
    const r = publishKind.value === 'ux'
      ? await call('uiProduct.publish', {
          workspaceId: props.workspaceId,
          productRelPath: props.productRelPath,
        })
      : await call('feature.publish', {
          workspaceId: props.workspaceId,
          featureRelPath: props.productRelPath,
        })
    if (!r.ok) {
      ui.showToast('error', `分享失败：${r.message}`, 4200)
      return
    }
    const clip = await call('system.copyToClipboard', { text: r.data.url })
    if (!clip.ok) {
      ui.showToast('error', `复制失败：${clip.message}`, 2400)
      return
    }
    await refreshPublishState()
    ui.showToast('success', '项目已分享，链接已复制', 2400)
  } finally {
    publishing.value = false
    progressLabel.value = null
  }
}

async function onShare(): Promise<void> {
  if (publish.value && !isStale.value) {
    await copyPublishedUrl(publish.value.url)
    return
  }
  await publishProject()
}
</script>

<template>
  <div v-if="publishKind" class="product-share-menu">
    <button
      type="button"
      class="product-share-button"
      :data-tone="tone"
      :disabled="publishing"
      :title="title"
      :aria-label="title"
      @click.stop="onShare"
    >
      {{ label }}
    </button>
  </div>
</template>

<style scoped>
.product-share-menu {
  position: relative;
  flex: 0 0 auto;
}

.product-share-button {
  display: inline-flex;
  height: var(--product-workbench-control-height, 26px);
  min-width: 48px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  border-radius: 6px;
  background: var(--color-button-bg);
  padding: 0 12px;
  color: var(--color-button-fg);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  box-sizing: border-box;
  transition:
    background var(--duration-fast, 120ms) var(--ease-out, ease),
    opacity var(--duration-fast, 120ms) var(--ease-out, ease);
}

.product-share-button:hover:not(:disabled) {
  background: var(--color-button-bg-hover);
}

.product-share-button:active:not(:disabled) {
  background: var(--color-button-bg-pressed);
}

.product-share-button:disabled {
  cursor: default;
  opacity: 0.72;
}

.product-share-button[data-tone='busy'] {
  min-width: 68px;
}
</style>
