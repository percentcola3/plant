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
  gap: 2px;
  flex-shrink: 0;
}

.preview-canvas-size-toggle__btn :deep(svg) {
  width: var(--product-workbench-icon-size, 14px);
  height: var(--product-workbench-icon-size, 14px);
}
</style>
