<script setup lang="ts">
import { SlidersHorizontal, SquareDashedMousePointer } from 'lucide-vue-next'
import PreviewInspectorMoreMenu from './PreviewInspectorMoreMenu.vue'

defineProps<{
  tabId?: string
  elementSelecting?: boolean
  elementEditing?: boolean
  remarksVisible?: boolean
  workspaceId?: string
  relPath?: string
}>()

const emit = defineEmits<{
  'pick-element': []
  'toggle-remarks': []
  'toggle-element-edit': []
}>()
</script>

<template>
  <div class="preview-inspector-tools" role="group" aria-label="预览检查工具">
    <button
      type="button"
      class="product-workbench-icon-btn preview-inspector-tools__btn"
      :class="{ 'is-active': elementSelecting }"
      :aria-pressed="elementSelecting"
      :title="elementSelecting ? '取消选择元素' : '选择元素并加入 AI 输入框'"
      aria-label="选择元素"
      @click="emit('pick-element')"
    >
      <SquareDashedMousePointer aria-hidden="true" />
    </button>
    <button
      type="button"
      class="product-workbench-icon-btn preview-inspector-tools__btn"
      :class="{ 'is-active': elementEditing }"
      :aria-pressed="elementEditing"
      :title="elementEditing ? '关闭元素微调' : '打开元素微调侧栏'"
      aria-label="元素微调"
      @click="emit('toggle-element-edit')"
    >
      <SlidersHorizontal aria-hidden="true" />
    </button>
    <PreviewInspectorMoreMenu
      :tab-id="tabId"
      :remarks-visible="remarksVisible"
      :workspace-id="workspaceId"
      :rel-path="relPath"
      @toggle-remarks="emit('toggle-remarks')"
    />
  </div>
</template>

<style scoped>
.preview-inspector-tools {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.preview-inspector-tools :deep(.product-workbench-icon-btn) {
  color: var(--color-text-secondary);
}

.preview-inspector-tools :deep(.product-workbench-icon-btn:hover:not(:disabled)) {
  color: var(--color-text-primary);
}

.preview-inspector-tools :deep(.product-workbench-icon-btn.is-active),
.preview-inspector-tools :deep(.product-workbench-icon-btn[aria-expanded='true']) {
  color: var(--color-text-primary);
}
</style>
