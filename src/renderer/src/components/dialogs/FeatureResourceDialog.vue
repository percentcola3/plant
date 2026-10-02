<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ExternalRef } from '@shared/types'
import { BookOpen, Boxes, PackageOpen } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

const props = withDefaults(defineProps<{
  open: boolean
  resources: ExternalRef[]
  selectedIds: string[]
  title?: string
  description?: string
  confirmLabel?: string
  busy?: boolean
  allowSetDefault?: boolean
}>(), {
  title: '关联项目资源',
  description: '选择当前项目可使用的知识库和 UX 资产，可同时选择多个。',
  confirmLabel: '保存关联',
  busy: false,
  allowSetDefault: true
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [payload: { externalRefIds: string[]; setAsDefault: boolean }]
}>()

const draftIds = ref<string[]>([])
const setAsDefault = ref(false)
const knowledgeResources = computed(() => props.resources.filter((resource) => resource.category === 'knowledge'))
const uxResources = computed(() => props.resources.filter((resource) => resource.category === 'uikit'))
const selectedCount = computed(() => draftIds.value.length)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const available = new Set(props.resources.map((resource) => resource.id))
    draftIds.value = [...new Set(props.selectedIds.filter((id) => available.has(id)))]
    setAsDefault.value = false
  },
  { immediate: true }
)

function isSelected(id: string): boolean {
  return draftIds.value.includes(id)
}

function toggle(id: string, checked: boolean | 'indeterminate'): void {
  const next = new Set(draftIds.value)
  if (checked === true) next.add(id)
  else next.delete(id)
  draftIds.value = [...next]
}

function indexLabel(resource: ExternalRef): string {
  if (resource.indexStatus?.state === 'ready') return `索引 ${resource.indexStatus.fileCount ?? 0} 个文件`
  if (resource.indexStatus?.state === 'building') return '索引构建中'
  if (resource.indexStatus?.state === 'queued') return '索引排队中'
  if (resource.indexStatus?.state === 'error') return '索引失败'
  return '待构建索引'
}

function save(): void {
  emit('save', { externalRefIds: [...draftIds.value], setAsDefault: setAsDefault.value })
}
</script>

<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent class="flex max-h-[78vh] flex-col gap-0 p-0 sm:max-w-[680px]">
      <DialogHeader class="border-b border-border px-6 py-5">
        <DialogTitle>{{ props.title }}</DialogTitle>
        <DialogDescription>{{ props.description }}</DialogDescription>
      </DialogHeader>

      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div v-if="props.resources.length === 0" class="feature-resource-empty">
          <PackageOpen :size="24" aria-hidden="true" />
          <strong>还没有可关联的资源</strong>
          <span>请先到知识库页面安装知识库或 UX 资产。</span>
        </div>

        <div v-else class="feature-resource-sections">
          <section v-if="knowledgeResources.length > 0" class="feature-resource-section">
            <div class="feature-resource-section__head">
              <BookOpen :size="16" aria-hidden="true" />
              <div><strong>知识库</strong><span>业务文档、产品规范和代码知识</span></div>
            </div>
            <label v-for="resource in knowledgeResources" :key="resource.id" class="feature-resource-option">
              <Checkbox
                :model-value="isSelected(resource.id)"
                :aria-label="`关联 ${resource.alias}`"
                @update:model-value="toggle(resource.id, $event)"
              />
              <span class="feature-resource-option__copy">
                <strong>{{ resource.alias }}</strong>
                <small>{{ resource.kind === 'git' ? 'Git' : '本地目录' }} · {{ indexLabel(resource) }}</small>
              </span>
              <span class="feature-resource-option__type">KB</span>
            </label>
          </section>

          <section v-if="uxResources.length > 0" class="feature-resource-section">
            <div class="feature-resource-section__head">
              <Boxes :size="16" aria-hidden="true" />
              <div><strong>UX 资产</strong><span>组件、设计 Token、图片和图标</span></div>
            </div>
            <label v-for="resource in uxResources" :key="resource.id" class="feature-resource-option">
              <Checkbox
                :model-value="isSelected(resource.id)"
                :aria-label="`关联 ${resource.alias}`"
                @update:model-value="toggle(resource.id, $event)"
              />
              <span class="feature-resource-option__copy">
                <strong>{{ resource.alias }}</strong>
                <small>{{ resource.kind === 'git' ? 'Git' : '本地目录' }} · {{ indexLabel(resource) }}</small>
              </span>
              <span class="feature-resource-option__type feature-resource-option__type--ux">UX</span>
            </label>
          </section>
        </div>
      </div>

      <div v-if="props.allowSetDefault" class="feature-resource-default">
        <Checkbox
          id="feature-resource-default"
          :model-value="setAsDefault"
          @update:model-value="setAsDefault = $event === true"
        />
        <label for="feature-resource-default">
          <strong>设为默认关联</strong>
          <span>以后新建项目时自动选中这组资源，仍可修改。</span>
        </label>
      </div>

      <DialogFooter class="items-center border-t border-border px-6 py-4 sm:justify-between">
        <span class="feature-resource-count">已选择 {{ selectedCount }} 个资源</span>
        <div class="flex gap-2">
          <Button variant="outline" :disabled="props.busy" @click="emit('update:open', false)">取消</Button>
          <Button :disabled="props.busy" @click="save">{{ props.busy ? '保存中…' : props.confirmLabel }}</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.feature-resource-sections { display: flex; flex-direction: column; gap: 20px; }
.feature-resource-section { display: flex; flex-direction: column; gap: 8px; }
.feature-resource-section__head { display: flex; align-items: center; gap: 9px; color: var(--color-text-primary); }
.feature-resource-section__head > div { display: flex; min-width: 0; flex-direction: column; }
.feature-resource-section__head strong { font-size: 13px; }
.feature-resource-section__head span { color: var(--color-text-muted); font-size: 11px; }
.feature-resource-option {
  display: grid; cursor: pointer; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 10px;
  border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-bg-panel); padding: 11px 12px;
  transition: border-color 140ms ease, background-color 140ms ease;
}
.feature-resource-option:hover { border-color: var(--color-accent-border); background: var(--color-accent-light); }
.feature-resource-option__copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.feature-resource-option__copy strong { overflow: hidden; color: var(--color-text-primary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.feature-resource-option__copy small { color: var(--color-text-muted); font-size: 10px; }
.feature-resource-option__type { border-radius: 6px; background: var(--color-accent-light); padding: 3px 6px; color: var(--color-accent); font-size: 10px; font-weight: 700; }
.feature-resource-option__type--ux { background: color-mix(in srgb, #7c3aed 10%, var(--color-bg-panel)); color: #7c3aed; }
.feature-resource-default { display: flex; align-items: flex-start; gap: 10px; border-top: 1px solid var(--color-border); background: var(--color-bg-subtle); padding: 13px 24px; }
.feature-resource-default label { display: flex; cursor: pointer; flex-direction: column; gap: 2px; }
.feature-resource-default strong { color: var(--color-text-primary); font-size: 12px; }
.feature-resource-default span, .feature-resource-count { color: var(--color-text-muted); font-size: 11px; }
.feature-resource-empty { display: flex; min-height: 180px; align-items: center; justify-content: center; flex-direction: column; gap: 7px; color: var(--color-text-muted); }
.feature-resource-empty strong { color: var(--color-text-primary); font-size: 13px; }
.feature-resource-empty span { font-size: 11px; }
</style>
