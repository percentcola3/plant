<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RotateCcw } from 'lucide-vue-next'
import {
  PREVIEW_ZOOM_DEFAULT,
  formatPreviewZoomPercent,
  parsePreviewZoomPercent,
  stepPreviewZoom,
} from '@/lib/preview/preview-zoom'
import { usePreviewStore } from '@/stores/preview'

const props = defineProps<{
  tabId?: string
}>()

const previewStore = usePreviewStore()
const draftPercent = ref('')

const tab = computed(() => {
  if (!props.tabId) return null
  return previewStore.tabs.find(item => item.id === props.tabId) ?? null
})

const zoom = computed(() => tab.value?.productMeta?.zoom ?? PREVIEW_ZOOM_DEFAULT)
const zoomLabel = computed(() => formatPreviewZoomPercent(zoom.value))

watch(
  zoomLabel,
  (value) => {
    draftPercent.value = value
  },
  { immediate: true },
)

function setZoom(value: number): void {
  if (!tab.value?.productMeta) return
  previewStore.updateDevice(tab.value.id, { zoom: value })
}

function step(delta: number): void {
  setZoom(stepPreviewZoom(zoom.value, delta))
}

function resetZoom(): void {
  setZoom(PREVIEW_ZOOM_DEFAULT)
}

function commitDraft(): void {
  const parsed = parsePreviewZoomPercent(draftPercent.value)
  if (parsed == null) {
    draftPercent.value = zoomLabel.value
    return
  }
  setZoom(parsed)
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    ;(event.target as HTMLInputElement).blur()
  }
}
</script>

<template>
  <div
    v-if="tab?.productMeta"
    class="preview-zoom-stepper"
    role="group"
    aria-label="视觉缩放"
    @pointerdown.stop
  >
    <span class="preview-zoom-stepper__label">Zoom</span>
    <div class="preview-zoom-stepper__controls">
      <button
        type="button"
        class="preview-zoom-stepper__btn"
        aria-label="缩小"
        title="缩小"
        @click="step(-1)"
      >
        −
      </button>
      <input
        v-model="draftPercent"
        type="text"
        inputmode="decimal"
        class="preview-zoom-stepper__input"
        aria-label="缩放百分比"
        @blur="commitDraft"
        @keydown="onInputKeydown"
      >
      <button
        type="button"
        class="preview-zoom-stepper__btn"
        aria-label="放大"
        title="放大"
        @click="step(1)"
      >
        +
      </button>
      <button
        type="button"
        class="preview-zoom-stepper__btn preview-zoom-stepper__btn--reset"
        aria-label="恢复默认缩放"
        title="恢复默认缩放"
        @click="resetZoom"
      >
        <RotateCcw aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.preview-zoom-stepper {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
}

.preview-zoom-stepper__label {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-primary);
}

.preview-zoom-stepper__controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 2px;
  border-radius: 8px;
  background: var(--color-bg-canvas);
}

.preview-zoom-stepper__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition:
    background var(--duration-fast, 120ms) var(--ease-out, ease),
    color var(--duration-fast, 120ms) var(--ease-out, ease);
}

.preview-zoom-stepper__btn:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.preview-zoom-stepper__btn--reset svg {
  width: 13px;
  height: 13px;
}

.preview-zoom-stepper__input {
  width: 44px;
  height: 22px;
  padding: 0 2px;
  border: none;
  border-radius: 5px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-align: center;
}

.preview-zoom-stepper__input:focus {
  outline: none;
  box-shadow: 0 0 0 1px var(--color-popover-border);
}
</style>
