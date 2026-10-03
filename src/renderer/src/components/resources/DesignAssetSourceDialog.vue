<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, FileText, Loader2 } from 'lucide-vue-next'
import { DESIGN_TEMPLATES, type DesignTemplate, type DesignTemplateFileContent, type DesignTemplateId } from '@shared/design-templates'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const ui = useUiStore()
const copying = ref(false)
const selected = ref<DesignTemplate | null>(null)
const files = ref<DesignTemplateFileContent[]>([])
const selectedPath = ref('README.md')
const loading = ref(false)
const error = ref('')
const copiedPath = ref('')
const open = ref(false)
let previewRequest = 0
const selectedFile = computed(() => files.value.find(file => file.path === selectedPath.value))
function show(templateId: DesignTemplateId): void {
  const template = DESIGN_TEMPLATES.find(item => item.id === templateId)
  if (template) void preview(template)
}
defineExpose({ show })
async function preview(template: DesignTemplate): Promise<void> {
  const request = ++previewRequest
  selected.value = template
  selectedPath.value = 'README.md'
  files.value = []
  error.value = ''
  copiedPath.value = ''
  open.value = true
  loading.value = true
  const result = await call('external.readTemplate', { templateId: template.id })
  if (request !== previewRequest) return
  loading.value = false
  if (result.ok) files.value = result.data
  else error.value = result.message
}
async function copy(template: DesignTemplate): Promise<void> {
  if (copying.value) return
  copying.value = true
  try {
    const directory = await call('system.selectDirectory', { title: '选择模板副本的保存目录' })
    if (!directory.ok) throw new Error(directory.message)
    if (!directory.data) return
    const result = await call('external.copyTemplate', { templateId: template.id, parentPath: directory.data.path })
    if (!result.ok) throw new Error(result.message)
    if (selected.value?.id === template.id) copiedPath.value = result.data.path
    ui.showToast('success', '模板已复制，可修改后添加为自己的 UX 资产库')
  } catch (failure) {
    ui.showToast('error', failure instanceof Error ? failure.message : String(failure), 4500)
  } finally { copying.value = false }
}
</script>

<template>
    <Dialog v-model:open="open">
      <DialogContent class="template-dialog max-w-[900px]">
        <DialogHeader>
          <DialogTitle>{{ selected?.name }} 资产文件</DialogTitle>
          <DialogDescription>查看内置资产的目录与源码，复制后可编写自己的 UI 资产库。</DialogDescription>
        </DialogHeader>
        <div v-if="loading" class="template-message"><Loader2 :size="16" class="animate-spin" />正在读取模板…</div>
        <div v-else-if="error" class="template-message" role="alert">{{ error }}<Button v-if="selected" size="sm" variant="outline" @click="preview(selected)">重试</Button></div>
        <div v-else class="template-browser">
          <nav class="template-files" aria-label="资产文件">
            <button v-for="file in files" :key="file.path" type="button" :class="{ 'is-selected': selectedPath === file.path }" :aria-current="selectedPath === file.path ? 'true' : undefined" @click="selectedPath = file.path">
              <FileText :size="13" aria-hidden="true" /><span>{{ file.path }}</span>
            </button>
          </nav>
          <div class="template-source">
            <div class="template-file-purpose">{{ selectedFile?.purpose }}</div>
            <pre tabindex="0" :aria-label="selectedFile?.path">{{ selectedFile?.content }}</pre>
          </div>
        </div>
        <div class="template-footer">
          <p>资源包通过 AI_USAGE.md 提供设计上下文；SKILL.md 可单独安装。</p>
          <div v-if="selected" class="template-footer__actions">
            <Button size="sm" variant="outline" :disabled="copying || loading || !!error" @click="copy(selected)"><Loader2 v-if="copying" :size="14" class="animate-spin" aria-hidden="true" /><Copy v-else :size="14" aria-hidden="true" />复制到本地</Button>
          </div>
        </div>
        <p v-if="copiedPath" class="template-copy-path">已保存：{{ copiedPath }}。修改后，通过「UX 资产库 → 添加 → 本地目录」接入。</p>
      </DialogContent>
    </Dialog>
</template>

<style scoped>
.template-browser { display: grid; grid-template-columns: 190px minmax(0, 1fr); height: min(54vh, 470px); min-height: 200px; overflow: hidden; border: 1px solid var(--color-border); border-radius: 10px; }
.template-files { min-width: 0; overflow: auto; padding: 8px; border-right: 1px solid var(--color-border); background: var(--color-bg-subtle); }
.template-files button { display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 6px; border-radius: 6px; text-align: left; color: var(--color-text-secondary); font-size: 11px; }
.template-files button svg { flex: none; }
.template-files button span { overflow-wrap: anywhere; }
.template-files button:hover { background: var(--color-bg-hover); }
.template-files button.is-selected { background: var(--color-accent-light); color: var(--color-leaf); }
.template-source { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.template-file-purpose { flex: none; padding: 10px 14px; border-bottom: 1px solid var(--color-border); color: var(--color-text-secondary); font-size: 11px; }
.template-source pre { flex: 1; min-height: 0; margin: 0; overflow: auto; padding: 14px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--color-text-primary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; line-height: 1.7; user-select: text; }
.template-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.template-footer p, .template-copy-path { margin: 0; color: var(--color-text-secondary); font-size: 11px; line-height: 1.6; }
.template-footer__actions { display: flex; flex: none; align-items: center; gap: 8px; }
.template-copy-path { overflow-wrap: anywhere; }
.template-message { display: flex; gap: 10px; align-items: center; justify-content: center; min-height: 200px; font-size: 12px; color: var(--color-text-secondary); }
@media (max-width: 680px) {
  .template-browser { grid-template-columns: minmax(120px, 30%) minmax(0, 1fr); }
  .template-footer { align-items: flex-start; flex-direction: column; }
}
</style>
