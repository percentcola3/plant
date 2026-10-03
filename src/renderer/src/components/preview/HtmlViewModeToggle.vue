<script setup lang="ts">
import { CodeXml, MonitorPlay } from 'lucide-vue-next'

defineProps<{
  mode: 'preview' | 'source'
}>()

const emit = defineEmits<{
  'update:mode': [mode: 'preview' | 'source']
}>()

function setMode(mode: 'preview' | 'source'): void {
  emit('update:mode', mode)
}
</script>

<template>
  <div class="html-view-mode-toggle" role="group" aria-label="HTML 查看模式">
    <button
      type="button"
      class="product-workbench-icon-btn html-view-mode-toggle__btn"
      :class="{ 'is-active': mode === 'preview' }"
      :aria-pressed="mode === 'preview'"
      aria-label="预览"
      title="预览"
      @click="setMode('preview')"
    >
      <MonitorPlay aria-hidden="true" />
    </button>
    <button
      type="button"
      class="product-workbench-icon-btn html-view-mode-toggle__btn"
      :class="{ 'is-active': mode === 'source' }"
      :aria-pressed="mode === 'source'"
      aria-label="源码"
      title="源码"
      @click="setMode('source')"
    >
      <CodeXml aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.html-view-mode-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 3px 4px;
  border-radius: 8px;
  background: var(--color-tab-selected);
}

.html-view-mode-toggle :deep(.product-workbench-icon-btn) {
  width: 28px;
  height: 24px;
  border-radius: 6px !important;
  background: transparent;
  color: var(--color-text-tertiary);
}

.html-view-mode-toggle :deep(.product-workbench-icon-btn svg) {
  width: 15px;
  height: 15px;
}

.html-view-mode-toggle :deep(.product-workbench-icon-btn:hover:not(:disabled):not(.is-active)) {
  color: var(--color-text-secondary);
  background: transparent;
}

.html-view-mode-toggle :deep(.product-workbench-icon-btn.is-active) {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  box-shadow: none;
}
</style>
