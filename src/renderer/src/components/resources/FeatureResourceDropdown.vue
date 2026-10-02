<script setup lang="ts">
import { computed } from 'vue'
import type { ExternalRef } from '@shared/types'
import { BookOpen, Boxes, ChevronDown, PackageOpen } from 'lucide-vue-next'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const props = withDefaults(defineProps<{
  resources: ExternalRef[]
  disabled?: boolean
}>(), {
  disabled: false
})

const selectedIds = defineModel<string[]>('selectedIds', { required: true })

const knowledgeResources = computed(() => props.resources.filter((resource) => resource.category === 'knowledge'))
const uxResources = computed(() => props.resources.filter((resource) => resource.category === 'uikit'))
const selectedCount = computed(() => selectedIds.value.length)

function isSelected(id: string): boolean {
  return selectedIds.value.includes(id)
}

function toggle(id: string, checked: boolean | 'indeterminate'): void {
  const next = new Set(selectedIds.value)
  if (checked === true) next.add(id)
  else next.delete(id)
  selectedIds.value = [...next]
}

function indexLabel(resource: ExternalRef): string {
  if (resource.indexStatus?.state === 'ready') return `索引 ${resource.indexStatus.fileCount ?? 0} 个文件`
  if (resource.indexStatus?.state === 'building') return '索引构建中'
  if (resource.indexStatus?.state === 'queued') return '索引排队中'
  if (resource.indexStatus?.state === 'error') return '索引失败'
  return '待构建索引'
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button
        type="button"
        class="feature-resource-dropdown__trigger"
        :disabled="props.disabled"
        aria-haspopup="listbox"
        :aria-expanded="undefined"
      >
        <PackageOpen :size="15" aria-hidden="true" />
        <span>关联资源</span>
        <strong>{{ selectedCount }}</strong>
        <ChevronDown class="feature-resource-dropdown__chevron" :size="14" aria-hidden="true" />
      </button>
    </PopoverTrigger>

    <PopoverContent
      align="start"
      :side-offset="8"
      class="feature-resource-dropdown__panel z-50 !rounded-[14px] border border-popover-border bg-popover p-0 shadow-md outline-none"
    >
      <div v-if="props.resources.length === 0" class="feature-resource-dropdown__empty">
        <PackageOpen :size="20" aria-hidden="true" />
        <strong>还没有可关联的资源</strong>
        <span>请先到知识库页面安装知识库或 UX 资产。</span>
      </div>

      <div v-else class="feature-resource-dropdown__sections">
        <section v-if="knowledgeResources.length > 0" class="feature-resource-dropdown__section">
          <h3 class="feature-resource-dropdown__section-title">知识库</h3>
          <label
            v-for="resource in knowledgeResources"
            :key="resource.id"
            class="feature-resource-dropdown__option"
          >
            <span class="feature-resource-dropdown__option-main">
              <BookOpen class="feature-resource-dropdown__option-icon" :size="17" aria-hidden="true" />
              <span class="feature-resource-dropdown__option-copy">
                <strong>{{ resource.alias }}</strong>
                <small>{{ resource.kind === 'git' ? 'Git' : '本地目录' }} · {{ indexLabel(resource) }}</small>
              </span>
            </span>
            <Checkbox
              class="feature-resource-dropdown__checkbox"
              :model-value="isSelected(resource.id)"
              :aria-label="`关联 ${resource.alias}`"
              @update:model-value="toggle(resource.id, $event)"
              @click.stop
            />
          </label>
        </section>

        <section v-if="uxResources.length > 0" class="feature-resource-dropdown__section">
          <h3 class="feature-resource-dropdown__section-title">UX 资产</h3>
          <label
            v-for="resource in uxResources"
            :key="resource.id"
            class="feature-resource-dropdown__option"
          >
            <span class="feature-resource-dropdown__option-main">
              <Boxes class="feature-resource-dropdown__option-icon" :size="17" aria-hidden="true" />
              <span class="feature-resource-dropdown__option-copy">
                <strong>{{ resource.alias }}</strong>
                <small>{{ resource.kind === 'git' ? 'Git' : '本地目录' }} · {{ indexLabel(resource) }}</small>
              </span>
            </span>
            <Checkbox
              class="feature-resource-dropdown__checkbox"
              :model-value="isSelected(resource.id)"
              :aria-label="`关联 ${resource.alias}`"
              @update:model-value="toggle(resource.id, $event)"
              @click.stop
            />
          </label>
        </section>
      </div>
    </PopoverContent>
  </Popover>
</template>

<style scoped>
.feature-resource-dropdown__trigger {
  display: inline-flex;
  cursor: pointer;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-subtle);
  padding: 7px 9px;
  color: var(--color-text-secondary);
  font-size: 11px;
}
.feature-resource-dropdown__trigger:hover:not(:disabled) {
  border-color: var(--color-accent-border);
  color: var(--color-accent);
}
.feature-resource-dropdown__trigger:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.feature-resource-dropdown__trigger strong {
  display: inline-flex;
  min-width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--color-accent-light);
  color: var(--color-accent);
  font-size: 10px;
}
.feature-resource-dropdown__chevron {
  opacity: 0.65;
}
.feature-resource-dropdown__sections {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.feature-resource-dropdown__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.feature-resource-dropdown__section-title {
  margin: 0;
  padding: 0 4px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.3;
}
.feature-resource-dropdown__option {
  display: grid;
  cursor: pointer;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  padding: 8px 10px;
  transition: background-color 140ms ease;
}
.feature-resource-dropdown__option:hover {
  background: var(--color-bg-hover);
}
.feature-resource-dropdown__option-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}
.feature-resource-dropdown__option-icon {
  flex: none;
  color: var(--color-text-primary);
}
.feature-resource-dropdown__checkbox {
  border-color: color-mix(in srgb, var(--color-text-tertiary) 12%, transparent) !important;
  background: transparent !important;
  color: var(--color-text-secondary) !important;
  opacity: 1;
}
.feature-resource-dropdown__checkbox[data-state='checked'] {
  border-color: color-mix(in srgb, var(--color-text-tertiary) 22%, transparent) !important;
  background: color-mix(in srgb, var(--color-text-primary) 4%, transparent) !important;
  color: var(--color-text-primary) !important;
}
.feature-resource-dropdown__checkbox :deep(svg) {
  width: 12px;
  height: 12px;
}
.feature-resource-dropdown__option-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.feature-resource-dropdown__option-copy strong {
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.feature-resource-dropdown__option-copy small {
  color: var(--color-text-muted);
  font-size: 10px;
  line-height: 1.35;
}
.feature-resource-dropdown__empty {
  display: flex;
  min-height: 120px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 6px;
  color: var(--color-text-muted);
  text-align: center;
}
.feature-resource-dropdown__empty strong {
  color: var(--color-text-primary);
  font-size: 12px;
}
.feature-resource-dropdown__empty span {
  font-size: 10px;
}
</style>

<!-- Popover 通过 Portal 挂到 body，scoped 样式无法作用到面板根节点 -->
<style>
.feature-resource-dropdown__panel {
  width: min(340px, calc(100vw - 32px));
  max-height: min(420px, calc(100vh - 120px));
  overflow-y: auto;
  border-color: var(--color-popover-border) !important;
  border-radius: 14px !important;
  background: var(--color-bg-panel) !important;
  padding: 12px 16px 14px !important;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(31, 35, 40, 0.08));
}
</style>
