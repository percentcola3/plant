<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import {
  WORKBENCH_CANVAS_PRESETS,
  matchWorkbenchCanvasPreset,
  type WorkbenchCanvasPreset,
} from '@/lib/preview/product-preview'
import { usePreviewStore } from '@/stores/preview'
import HtmlViewModeToggle from './HtmlViewModeToggle.vue'
import PreviewCanvasSizeToggle from './PreviewCanvasSizeToggle.vue'
import PreviewInspectorTools from './PreviewInspectorTools.vue'
import ProductFilesReloadButton from './ProductFilesReloadButton.vue'
import ProductFilesTreeToggle from './ProductFilesTreeToggle.vue'

const previewStore = usePreviewStore()
const props = withDefaults(defineProps<{
  tabId?: string
  elementSelecting?: boolean
  elementEditing?: boolean
  remarksVisible?: boolean
  showTreeToggle?: boolean
  treeOpen?: boolean
  showHtmlViewMode?: boolean
  htmlMode?: 'preview' | 'source'
  showReload?: boolean
  reloading?: boolean
  reloadDisabled?: boolean
  showPreviewControls?: boolean
  previewRelPath?: string
}>(), {
  tabId: undefined,
  elementSelecting: false,
  elementEditing: false,
  remarksVisible: false,
  showTreeToggle: false,
  treeOpen: false,
  showHtmlViewMode: false,
  htmlMode: 'preview',
  showReload: false,
  reloading: false,
  reloadDisabled: false,
  showPreviewControls: true,
  previewRelPath: undefined,
})
const tab = computed(() => (
  props.tabId
    ? previewStore.tabs.find(item => item.id === props.tabId) ?? null
    : previewStore.activeTab
))
const emit = defineEmits<{
  (e: 'pick-element'): void
  (e: 'toggle-element-edit'): void
  (e: 'toggle-remarks'): void
  (e: 'toggle-tree'): void
  (e: 'update:htmlMode', mode: 'preview' | 'source'): void
  (e: 'reload'): void
}>()

function applyCanvasPreset(preset: WorkbenchCanvasPreset): void {
  if (!tab.value?.productMeta) return
  if (matchWorkbenchCanvasPreset(tab.value.productMeta)?.id === preset.id) return
  previewStore.updateDevice(tab.value.id, {
    devicePreset: preset.id,
    deviceWidth: preset.width,
    deviceHeight: preset.height,
    responsive: false,
    rotate: false,
  })
}

function ensureCanvasPreset(): void {
  if (!tab.value?.productMeta) return
  const meta = tab.value.productMeta
  if (meta.responsive) return
  if (matchWorkbenchCanvasPreset(meta)) return
  if (meta.deviceWidth > 0 && meta.deviceHeight > 0) return
  applyCanvasPreset(WORKBENCH_CANVAS_PRESETS[0])
}

onMounted(ensureCanvasPreset)
watch(() => tab.value?.id, ensureCanvasPreset)
</script>

<template>
  <div
    v-if="tab?.productMeta"
    class="product-workbench-bar preview-size-bar flex items-center gap-2 text-xs text-muted-foreground"
  >
    <div v-if="showTreeToggle || showReload || showHtmlViewMode" class="flex items-center gap-0.5 shrink-0">
      <ProductFilesTreeToggle
        v-if="showTreeToggle"
        :open="treeOpen"
        @toggle="emit('toggle-tree')"
      />
      <ProductFilesReloadButton
        v-if="showReload"
        :loading="reloading"
        :disabled="reloadDisabled"
        @reload="emit('reload')"
      />
      <HtmlViewModeToggle
        v-if="showHtmlViewMode"
        :mode="htmlMode"
        @update:mode="emit('update:htmlMode', $event)"
      />
    </div>

    <div class="preview-size-bar__center flex flex-1 items-center justify-center min-w-0">
      <PreviewCanvasSizeToggle
        v-if="tab"
        :tab-id="tab.id"
        :meta="tab.productMeta"
        @select="applyCanvasPreset"
      />
    </div>

    <div v-if="showPreviewControls" class="ml-auto flex items-center shrink-0">
      <PreviewInspectorTools
        :tab-id="tab?.id"
        :element-selecting="props.elementSelecting"
        :element-editing="props.elementEditing"
        :remarks-visible="props.remarksVisible"
        :workspace-id="tab?.workspaceId"
        :rel-path="props.previewRelPath"
        @pick-element="emit('pick-element')"
        @toggle-remarks="emit('toggle-remarks')"
        @toggle-element-edit="emit('toggle-element-edit')"
      />
    </div>
  </div>
</template>

<style scoped>
.preview-size-bar__center {
  pointer-events: none;
}

.preview-size-bar__center :deep(.preview-canvas-size-toggle) {
  pointer-events: auto;
}
</style>
