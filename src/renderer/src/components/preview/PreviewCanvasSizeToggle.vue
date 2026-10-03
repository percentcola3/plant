<script setup lang="ts">
import { Monitor, Smartphone } from 'lucide-vue-next'
import {
  WORKBENCH_CANVAS_PRESETS,
  isWorkbenchCanvasPresetActive,
  type ProductPreviewMeta,
  type WorkbenchCanvasPreset,
} from '@/lib/preview/product-preview'
import PreviewCanvasSizeMoreMenu from './PreviewCanvasSizeMoreMenu.vue'

defineProps<{
  tabId: string
  meta: ProductPreviewMeta
}>()

const emit = defineEmits<{
  select: [preset: WorkbenchCanvasPreset]
}>()

function presetForKind(kind: WorkbenchCanvasPreset['kind']): WorkbenchCanvasPreset {
  return WORKBENCH_CANVAS_PRESETS.find(preset => preset.kind === kind) ?? WORKBENCH_CANVAS_PRESETS[0]
}
</script>

<template>
  <div class="preview-canvas-size-toggle" role="group" aria-label="画布尺寸">
    <button
      type="button"
      class="product-workbench-icon-btn preview-canvas-size-toggle__btn"
      :class="{ 'is-active': isWorkbenchCanvasPresetActive(meta, presetForKind('desktop')) }"
      :aria-pressed="isWorkbenchCanvasPresetActive(meta, presetForKind('desktop'))"
      title="1440×900"
      aria-label="桌面画布 1440×900"
      @click="emit('select', presetForKind('desktop'))"
    >
      <Monitor aria-hidden="true" />
    </button>
    <button
      type="button"
      class="product-workbench-icon-btn preview-canvas-size-toggle__btn"
      :class="{ 'is-active': isWorkbenchCanvasPresetActive(meta, presetForKind('phone')) }"
      :aria-pressed="isWorkbenchCanvasPresetActive(meta, presetForKind('phone'))"
      title="750×1624"
      aria-label="手机画布 750×1624"
      @click="emit('select', presetForKind('phone'))"
    >
      <Smartphone aria-hidden="true" />
    </button>
    <PreviewCanvasSizeMoreMenu :tab-id="tabId" :meta="meta" />
  </div>
</template>

<style scoped>
.preview-canvas-size-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 3px 4px;
  border-radius: 8px;
  background: var(--color-tab-selected);
}

.preview-canvas-size-toggle :deep(.product-workbench-icon-btn) {
  width: 28px;
  height: 24px;
  border-radius: 6px !important;
  background: transparent;
  color: var(--color-text-tertiary);
}

.preview-canvas-size-toggle :deep(.product-workbench-icon-btn svg) {
  width: 15px;
  height: 15px;
}

.preview-canvas-size-toggle :deep(.product-workbench-icon-btn:hover:not(:disabled):not(.is-active)) {
  color: var(--color-text-secondary);
  background: transparent;
}

.preview-canvas-size-toggle :deep(.product-workbench-icon-btn.is-active) {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  box-shadow: none;
}
</style>
