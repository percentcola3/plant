<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useInspectorPicksStore } from '@/stores/inspector-picks'
import { usePreviewStore } from '@/stores/preview'
import { shouldReloadProductPreview } from '@/lib/preview/product-preview'
import { Button } from '@/components/ui/button'
import ElementTuningPanel from './ElementTuningPanel.vue'
import PreviewSizeBar from './PreviewSizeBar.vue'

const props = withDefaults(defineProps<{
  tabId: string
  workspaceId: string
  relPath: string
  editableRootPath: string
  url: string
  loading?: boolean
  showTreeToggle?: boolean
  treeOpen?: boolean
  showHtmlViewMode?: boolean
  htmlMode?: 'preview' | 'source'
  showReload?: boolean
  reloading?: boolean
  reloadDisabled?: boolean
  suppressSizeBar?: boolean
}>(), {
  loading: false,
  showTreeToggle: false,
  treeOpen: false,
  showHtmlViewMode: false,
  htmlMode: 'preview',
  showReload: false,
  reloading: false,
  reloadDisabled: false,
  suppressSizeBar: false
})

const emit = defineEmits<{
  loaded: []
  error: []
  'toggle-tree': []
  'update:htmlMode': [mode: 'preview' | 'source']
  reload: []
  'element-selecting-change': [enabled: boolean]
  'element-editing-change': [enabled: boolean]
  'remarks-visible-change': [visible: boolean]
}>()

const previewStore = usePreviewStore()
const picksStore = useInspectorPicksStore()
const tab = computed(() => previewStore.tabs.find(item => item.id === props.tabId) ?? null)
const meta = computed(() => tab.value?.productMeta)
const isActive = computed(() => previewStore.activeTabId === props.tabId)
const elementSelecting = ref(false)
const elementEditing = ref(false)
const remarksVisible = ref(false)
type ElementTuningSelection = {
  alias: string
  path: string
  tagName: string
  textContent: string
  textPreview: string
  styles: {
    color: string
    backgroundColor: string
    fontSize: number
    fontWeight: string
    lineHeight: string
    textAlign: string
    display: string
    flexDirection: string
    flexWrap: string
    justifyContent: string
    alignItems: string
    gap: number
    rowGap: number
    columnGap: number
    flex: string
    flexGrow: string
    flexShrink: string
    flexBasis: string
    order: string
    margin: number
    padding: number
    width: number
    height: number
    borderRadius: number
  }
}
type ElementEditSaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
const elementEditSelection = ref<ElementTuningSelection | null>(null)
const elementEditSaveState = ref<ElementEditSaveState>('idle')
const activeInspectorRequest = ref('')
const iframeEl = ref<HTMLIFrameElement | null>(null)
const viewportEl = ref<HTMLDivElement | null>(null)
const frameLoading = ref(true)
const frameError = ref(false)
const reloadStamp = ref(0)

type Meta = NonNullable<import('@/stores/preview').PreviewTab['productMeta']>

function metaRenderSize(value: Meta): { w: number; h: number } {
  return value.rotate
    ? { w: value.deviceHeight, h: value.deviceWidth }
    : { w: value.deviceWidth, h: value.deviceHeight }
}

function isMetaResponsive(value: Meta): boolean {
  return value.responsive || value.deviceWidth === 0
}

const wrapperStyle = computed<Record<string, string>>(() => {
  if (!meta.value) return {} as Record<string, string>
  const { w, h } = metaRenderSize(meta.value)
  return {
    width: `${Math.round(w * meta.value.zoom)}px`,
    height: `${Math.round(h * meta.value.zoom)}px`,
    flexShrink: '0'
  }
})

const innerStyle = computed<Record<string, string>>(() => {
  if (!meta.value) return {} as Record<string, string>
  const { w, h } = metaRenderSize(meta.value)
  return {
    width: `${w}px`,
    height: `${h}px`,
    transform: `scale(${meta.value.zoom})`,
    transformOrigin: 'top left'
  }
})

const frameUrl = computed(() => {
  if (!props.url || reloadStamp.value === 0) return props.url
  const [withoutHash, hash = ''] = props.url.split('#')
  const separator = withoutHash.includes('?') ? '&' : '?'
  const stamped = `${withoutHash}${separator}_t=${reloadStamp.value}`
  return hash ? `${stamped}#${hash}` : stamped
})

const isLoading = computed(() => props.loading || frameLoading.value)

function postVisibleRect(): void {
  const viewport = viewportEl.value
  const iframe = iframeEl.value
  if (!viewport || !iframe) return
  const iframeRect = iframe.getBoundingClientRect()
  const viewportRect = viewport.getBoundingClientRect()
  iframe.contentWindow?.postMessage({
    type: '__uikit_visible_rect__',
    clipRight: Math.max(0, iframeRect.right - viewportRect.right),
    clipBottom: Math.max(0, iframeRect.bottom - viewportRect.bottom)
  }, '*')
}

function postHostContext(): void {
  iframeEl.value?.contentWindow?.postMessage({
    type: '__uikit_host_context__',
    tabId: props.tabId,
    mode: 'ui'
  }, '*')
}

function postInspectorRequest(text = activeInspectorRequest.value): void {
  iframeEl.value?.contentWindow?.postMessage({ type: '__uikit_request_set__', text }, '*')
}

function postElementEditMode(enabled = elementEditing.value): void {
  iframeEl.value?.contentWindow?.postMessage({ type: '__uikit_element_edit_mode__', enabled }, '*')
}

function postPickOnce(): void {
  iframeEl.value?.contentWindow?.postMessage({ type: '__uikit_pick_once__' }, '*')
}

function postCancelPick(): void {
  iframeEl.value?.contentWindow?.postMessage({ type: '__uikit_pick_cancel__' }, '*')
}

function postElementStyle(property: string, value: string): void {
  const selection = elementEditSelection.value
  if (!selection) return
  iframeEl.value?.contentWindow?.postMessage({
    type: '__uikit_element_edit_apply__',
    path: selection.path,
    property,
    value,
  }, '*')
}

function postElementText(value: string): void {
  const selection = elementEditSelection.value
  if (!selection) return
  iframeEl.value?.contentWindow?.postMessage({
    type: '__uikit_element_edit_apply__',
    path: selection.path,
    kind: 'text',
    value,
  }, '*')
}

function postElementEditAction(action: 'reset' | 'delete'): void {
  const selection = elementEditSelection.value
  if (!selection) return
  iframeEl.value?.contentWindow?.postMessage({
    type: '__uikit_element_edit_action__',
    path: selection.path,
    action,
  }, '*')
}

function postRemarksVisible(visible = remarksVisible.value): void {
  iframeEl.value?.contentWindow?.postMessage({ type: '__uikit_remarks_visible__', visible }, '*')
}

function postRemovePick(path: string): void {
  iframeEl.value?.contentWindow?.postMessage({ type: '__uikit_remove_pick__', path }, '*')
}

function postSyncPickPaths(paths: string[]): void {
  iframeEl.value?.contentWindow?.postMessage({ type: '__uikit_sync_pick_paths__', paths }, '*')
}

function toggleRemarksVisible(): void {
  remarksVisible.value = !remarksVisible.value
  emit('remarks-visible-change', remarksVisible.value)
  postRemarksVisible()
}

function setElementSelecting(enabled: boolean): void {
  elementSelecting.value = enabled
  emit('element-selecting-change', enabled)
  if (enabled) {
    if (elementEditing.value) setElementEditing(false)
    postPickOnce()
  } else {
    postCancelPick()
  }
}

function toggleElementSelecting(): void {
  setElementSelecting(!elementSelecting.value)
}

function setElementEditing(enabled: boolean): void {
  if (enabled && elementSelecting.value) {
    elementSelecting.value = false
    emit('element-selecting-change', false)
  }
  elementEditing.value = enabled
  if (!enabled) {
    elementEditSelection.value = null
    elementEditSaveState.value = 'idle'
  }
  emit('element-editing-change', enabled)
  postElementEditMode(enabled)
}

function toggleElementEditing(): void {
  setElementEditing(!elementEditing.value)
}

function syncInspectorState(): void {
  postVisibleRect()
  postHostContext()
  postInspectorRequest()
  postElementEditMode()
  if (elementSelecting.value) postPickOnce()
  postRemarksVisible()
}

function onLoad(): void {
  frameLoading.value = false
  frameError.value = false
  emit('loaded')
  void nextTick(() => {
    postVisibleRect()
    postHostContext()
    postInspectorRequest()
    postElementEditMode()
    if (elementSelecting.value) postPickOnce()
    postRemarksVisible()
  })
}

function onError(): void {
  frameLoading.value = false
  frameError.value = true
  emit('error')
}

function reloadFrame(): void {
  frameLoading.value = true
  frameError.value = false
  reloadStamp.value = Date.now()
}

const ZOOM_MIN = 0.25
const ZOOM_MAX = 2
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value))
}

function nearestStepIndex(value: number): number {
  let bestIndex = 0
  let bestDiff = Infinity
  for (let index = 0; index < ZOOM_STEPS.length; index += 1) {
    const diff = Math.abs(ZOOM_STEPS[index] - value)
    if (diff < bestDiff) {
      bestDiff = diff
      bestIndex = index
    }
  }
  return bestIndex
}

function applyZoomDelta(deltaY: number): void {
  if (!meta.value || !deltaY) return
  const current = meta.value.zoom
  let next: number
  if (Math.abs(deltaY) < 20) {
    next = current * Math.exp(-deltaY / 200)
  } else {
    const direction = deltaY > 0 ? -1 : 1
    const stepIndex = nearestStepIndex(current)
    next = ZOOM_STEPS[clamp(stepIndex + direction, 0, ZOOM_STEPS.length - 1)]
  }
  next = clamp(Math.round(next * 100) / 100, ZOOM_MIN, ZOOM_MAX)
  if (next !== current) previewStore.updateDevice(props.tabId, { zoom: next })
}

function onViewportWheel(event: WheelEvent): void {
  if (!(event.ctrlKey || event.metaKey)) return
  event.preventDefault()
  applyZoomDelta(event.deltaY)
}

const SELF_EDIT_SUPPRESS_MS = 1500
const selfEditUntilByPath = new Map<string, number>()

function markSelfEdit(relPath: string): void {
  selfEditUntilByPath.set(relPath, Date.now() + SELF_EDIT_SUPPRESS_MS)
}

function isWithinSelfEditWindow(relPath: string): boolean {
  const until = selfEditUntilByPath.get(relPath)
  if (!until) return false
  if (Date.now() <= until) return true
  selfEditUntilByPath.delete(relPath)
  return false
}

const MORPH_TIMEOUT_MS = 800
const pendingMorphFallback = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleMorphReload(relPath: string): void {
  if (pendingMorphFallback.has(relPath)) return
  const contentWindow = iframeEl.value?.contentWindow
  if (!contentWindow) {
    reloadFrame()
    return
  }
  const timer = setTimeout(() => {
    pendingMorphFallback.delete(relPath)
    reloadFrame()
  }, MORPH_TIMEOUT_MS)
  pendingMorphFallback.set(relPath, timer)
  contentWindow.postMessage({ type: '__uikit_morph_reload__', relPath }, '*')
}

function settleMorph(relPath: string, fallback: boolean): void {
  const timer = pendingMorphFallback.get(relPath)
  if (timer) clearTimeout(timer)
  pendingMorphFallback.delete(relPath)
  if (fallback) reloadFrame()
}

function isElementEditSaveState(value: unknown): value is ElementEditSaveState {
  return value === 'idle'
    || value === 'pending'
    || value === 'saving'
    || value === 'saved'
    || value === 'error'
}

function onWindowMessage(e: MessageEvent): void {
  if (e.source !== iframeEl.value?.contentWindow) return
  const data = e.data
  if (!data || typeof data !== 'object') return

  if (data.type === '__uikit_picks_sync__') {
    const picks = data.picks as Array<{
      alias: string
      path: string
      tagName?: string
      textPreview?: string
      edits?: Record<string, string>
    }> | undefined
    if (Array.isArray(picks)) {
      picksStore.sync(props.tabId, picks)
      window.dispatchEvent(new CustomEvent('__uikit_host_picks_sync__', {
        detail: { tabId: props.tabId, paths: picks.map(item => item.path) }
      }))
    }
    return
  }

  if (data.type === '__uikit_picker_state__' && data.mode === 'select') {
    const enabled = Boolean(data.active)
    if (elementSelecting.value !== enabled) {
      elementSelecting.value = enabled
      emit('element-selecting-change', enabled)
    }
    return
  }

  if (data.type === '__uikit_element_edit_selection__') {
    elementEditSelection.value = data.selection && typeof data.selection === 'object'
      ? data.selection as ElementTuningSelection
      : null
    return
  }

  if (
    data.type === '__uikit_element_edit_save_state__'
    && isElementEditSaveState(data.state)
  ) {
    elementEditSaveState.value = data.state
    return
  }

  if (data.type === '__uikit_insert_chip__') {
    const alias = data.alias as string | undefined
    const path = data.path as string | undefined
    if (alias && path) {
      window.dispatchEvent(new CustomEvent('__uikit_host_insert_chip__', { detail: { alias, path } }))
    }
    return
  }

  if (data.type === '__uikit_request_sync__' && typeof data.text === 'string') {
    activeInspectorRequest.value = data.text
    return
  }

  if (data.type === '__uikit_zoom_wheel__') {
    applyZoomDelta(typeof data.deltaY === 'number' ? data.deltaY : 0)
  } else if (data.type === '__uikit_self_edit_done__' && typeof data.relPath === 'string') {
    markSelfEdit(data.relPath)
  } else if (data.type === '__uikit_morph_done__' && typeof data.relPath === 'string') {
    settleMorph(data.relPath, false)
  } else if (data.type === '__uikit_morph_failed__' && typeof data.relPath === 'string') {
    settleMorph(data.relPath, true)
  }
}

function onHostRemoveChip(event: Event): void {
  if (!isActive.value) return
  const detail = (event as CustomEvent).detail as { path?: string }
  if (detail?.path) postRemovePick(detail.path)
}

function onHostSyncChipPaths(event: Event): void {
  if (!isActive.value) return
  const detail = (event as CustomEvent).detail as { paths?: string[] }
  if (Array.isArray(detail?.paths)) postSyncPickPaths(detail.paths)
}

let resizeObserver: ResizeObserver | null = null

watch(viewportEl, (next, previous) => {
  previous?.removeEventListener('scroll', postVisibleRect)
  previous?.removeEventListener('wheel', onViewportWheel)
  resizeObserver?.disconnect()
  if (!next) return
  next.addEventListener('scroll', postVisibleRect, { passive: true })
  next.addEventListener('wheel', onViewportWheel, { passive: false })
  resizeObserver = new ResizeObserver(postVisibleRect)
  resizeObserver.observe(next)
})

watch(
  () => [props.url, props.relPath],
  () => {
    frameLoading.value = true
    frameError.value = false
    reloadStamp.value = 0
    setElementSelecting(false)
    setElementEditing(false)
  }
)

watch(
  () => [isActive.value, meta.value?.deviceWidth, meta.value?.deviceHeight, meta.value?.rotate, meta.value?.zoom],
  () => {
    if (!isActive.value) {
      setElementSelecting(false)
      setElementEditing(false)
      return
    }
    picksStore.setActiveTab(props.tabId)
    void nextTick(syncInspectorState)
  },
  { immediate: true }
)

// 文件监听触发实时刷新暂时关闭：主进程 chokidar 仍在跑（其他链路依赖它），
// 只在这里丢弃 fs.change 事件，改由用户点 SizeBar 上的手动 reload。
// 恢复只需把这个常量置 true，回调逻辑本身保持不动。
const AUTO_RELOAD_ON_FS_CHANGE = false
watch(
  () => props.workspaceId,
  (workspaceId, _previous, onCleanup) => {
    const unsubscribe = window.events.on(`fs.change:${workspaceId}`, (payload: unknown) => {
      if (!AUTO_RELOAD_ON_FS_CHANGE) return
      const event = payload as { relPath?: string }
      if (!event.relPath || isWithinSelfEditWindow(event.relPath)) return
      if (!shouldReloadProductPreview(event.relPath, [props.editableRootPath])) return
      scheduleMorphReload(event.relPath)
    })
    onCleanup(unsubscribe)
  },
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('message', onWindowMessage)
  window.addEventListener('__uikit_host_remove_chip__', onHostRemoveChip)
  window.addEventListener('__uikit_host_sync_chip_paths__', onHostSyncChipPaths)
})

onBeforeUnmount(() => {
  postCancelPick()
  postElementEditMode(false)
  window.removeEventListener('message', onWindowMessage)
  window.removeEventListener('__uikit_host_remove_chip__', onHostRemoveChip)
  window.removeEventListener('__uikit_host_sync_chip_paths__', onHostSyncChipPaths)
  resizeObserver?.disconnect()
  for (const timer of pendingMorphFallback.values()) clearTimeout(timer)
  pendingMorphFallback.clear()
})

defineExpose({
  setElementSelecting,
  toggleElementSelecting,
  setElementEditing,
  toggleElementEditing,
  toggleRemarksVisible,
})
</script>

<template>
  <section v-if="meta" class="html-preview-surface">
    <PreviewSizeBar
      v-if="!suppressSizeBar"
      :tab-id="props.tabId"
      :element-selecting="elementSelecting"
      :element-editing="elementEditing"
      :remarks-visible="remarksVisible"
      :show-tree-toggle="props.showTreeToggle"
      :tree-open="props.treeOpen"
      :show-html-view-mode="props.showHtmlViewMode"
      :html-mode="props.htmlMode"
      :show-reload="props.showReload"
      :reloading="props.reloading"
      :reload-disabled="props.reloadDisabled"
      :preview-rel-path="props.relPath"
      @pick-element="toggleElementSelecting"
      @toggle-element-edit="toggleElementEditing"
      @toggle-remarks="toggleRemarksVisible"
      @toggle-tree="emit('toggle-tree')"
      @update:html-mode="emit('update:htmlMode', $event)"
      @reload="emit('reload')"
    />

    <div class="html-preview-workspace">
      <div
        ref="viewportEl"
        class="html-preview-viewport preview-viewport-stars p-3 pt-8"
      >
        <div class="relative m-auto shrink-0" :style="wrapperStyle">
          <div
            v-if="!isMetaResponsive(meta)"
            class="html-preview-size-chip"
          >
            <span>{{ metaRenderSize(meta).w }} × {{ metaRenderSize(meta).h }}</span>
            <span aria-hidden="true">·</span>
            <span>{{ Math.round(meta.zoom * 100) }}%</span>
          </div>

          <div
            class="absolute inset-0 overflow-hidden bg-white"
            :class="!isMetaResponsive(meta) ? 'preview-frame-outline rounded-sm shadow-lg' : ''"
          >
            <div v-if="isLoading" class="html-preview-overlay">加载中…</div>
            <div v-else-if="frameError" class="html-preview-overlay">
              <Button size="sm" class="text-xs" @click="reloadFrame">加载失败，点击重试</Button>
            </div>
            <div :style="innerStyle">
              <iframe
                ref="iframeEl"
                v-show="!isLoading && !frameError"
                :src="frameUrl"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                class="h-full w-full border-none bg-white"
                :title="`HTML 预览：${props.relPath}`"
                @load="onLoad"
                @error="onError"
              />
            </div>
          </div>
        </div>
      </div>
      <ElementTuningPanel
        v-if="elementEditing"
        :selection="elementEditSelection"
        :save-state="elementEditSaveState"
        @close="setElementEditing(false)"
        @apply-text="postElementText"
        @apply-style="postElementStyle"
        @reset="postElementEditAction('reset')"
        @delete-element="postElementEditAction('delete')"
      />
    </div>
  </section>
  <div v-else class="html-preview-missing">缺少预览设备状态。</div>
</template>

<style scoped>
.html-preview-surface {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg-base);
}
.html-preview-workspace {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.html-preview-viewport {
  display: flex;
  flex: 1 1 auto;
  width: 0;
  min-height: 0;
  overflow: auto;
}
.html-preview-size-chip {
  position: absolute;
  top: -22px;
  left: 0;
  z-index: 1;
  display: flex;
  height: 18px;
  align-items: center;
  gap: 4px;
  padding: 0;
  background: transparent;
  color: var(--color-text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}
.html-preview-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-base);
  color: var(--color-text-muted);
  font-size: 12px;
}
.html-preview-missing {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 12px;
}
.preview-frame-outline {
  outline: 1px dashed rgb(59 130 246 / 0.6);
  outline-offset: 1px;
}
</style>
