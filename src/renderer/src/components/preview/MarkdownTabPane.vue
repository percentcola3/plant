<script setup lang="ts">
// PreviewPanel 内嵌 md 编辑/预览 tab。
// 复用 useEditorStore 的 keyed session API，与全局 WorkspaceEditorPane 互不干扰。
import { markdown as markdownLanguage } from '@codemirror/lang-markdown'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CodeMirrorSurface from '@/components/editor/CodeMirrorSurface.vue'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import { useThemeStore } from '@/stores/theme'
import { renderMarkdownPreview } from '@/lib/editor/markdown-preview'
import type { MarkdownShortcutId } from '@/lib/editor/markdown-shortcuts'

const props = defineProps<{
  tabId: string
  workspaceId: string
  relPath: string
}>()

const ui = useUiStore()
const editor = useEditorStore()
const themeStore = useThemeStore()
const session = editor.tabSession(props.tabId)
const isDirty = editor.tabIsDirty(props.tabId)
const isSaving = editor.tabIsSaving(props.tabId)

const markdownSurfaceRef = ref<InstanceType<typeof CodeMirrorSurface> | null>(null)
const previewSrcdoc = ref('')
const isRenderingPreview = ref(false)
let renderSeq = 0

const currentMode = computed(() => session.value?.mode ?? 'preview')
const isReadonly = computed(() => session.value?.readonly === true)

async function refreshPreview(): Promise<void> {
  const cur = session.value
  if (!cur) {
    previewSrcdoc.value = ''
    return
  }
  const seq = ++renderSeq
  isRenderingPreview.value = true
  const html = await renderMarkdownPreview({
    content: cur.content,
    projectId: cur.projectId,
    relPath: cur.relPath,
    previewBaseUrl: cur.previewBaseUrl,
    theme: themeStore.theme
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    return `<!doctype html><html><body style="font:14px sans-serif;padding:24px;color:#9f1239;background:#fff1f2;">预览渲染失败：${message}</body></html>`
  })
  if (seq !== renderSeq) return
  previewSrcdoc.value = html
  isRenderingPreview.value = false
}

watch(
  () => [session.value?.content, session.value?.previewBaseUrl, session.value?.relPath, themeStore.theme],
  () => { void refreshPreview() }
)

onMounted(() => {
  void editor.openInKey(props.tabId, 'markdown', props.relPath, props.workspaceId)
})
onBeforeUnmount(() => {
  editor.closeKey(props.tabId)
})

function setMode(mode: 'edit' | 'preview'): void { editor.setModeByKey(props.tabId, mode) }
function onContentUpdate(content: string): void { editor.updateContentByKey(props.tabId, content) }
function onSave(): void { void editor.saveByKey(props.tabId) }
function onReload(): void { void editor.reloadByKey(props.tabId) }
async function handleImage(files: File[]): Promise<string | null> {
  return await editor.saveImageAssetByKey(props.tabId, files)
}

async function insertShortcut(id: MarkdownShortcutId): Promise<void> {
  if (isReadonly.value) return
  if (currentMode.value !== 'edit') {
    setMode('edit')
    await nextTick()
  }
  markdownSurfaceRef.value?.insertMarkdownShortcut(id)
}
</script>

<template>
  <section v-if="session" class="md-tab-pane">
    <div class="md-tab-pane__header">
      <div class="md-tab-pane__header-row">
        <div class="md-tab-pane__title-block">
          <div class="flex items-center gap-2">
            <span class="text-[14px] font-semibold truncate">{{ session.title }}</span>
            <span v-if="isReadonly" class="md-tab-pane__pill md-tab-pane__pill--readonly">只读</span>
            <span v-if="isDirty && !isReadonly" class="md-tab-pane__pill md-tab-pane__pill--dirty">未保存</span>
          </div>
          <div class="text-xs text-muted-foreground/70 font-mono truncate">{{ session.relPath }}</div>
        </div>

        <div class="flex items-center gap-1.5">
          <Button variant="outline" size="sm" class="text-xxs" @click="ui.openBranchHistory({ workspaceId: props.workspaceId, relPath: props.relPath, initialView: 'pushes' })">变更记录</Button>
          <Button variant="outline" size="sm" class="text-xxs" :disabled="isSaving" @click="onReload">重载</Button>
          <Button
            v-if="!isReadonly"
            size="sm"
            class="text-xxs"
            :disabled="isSaving || !isDirty"
            @click="onSave"
          >{{ isSaving ? '保存中…' : '保存' }}</Button>
        </div>
      </div>

      <div v-if="!isReadonly" class="md-tab-pane__toolbar">
        <span class="md-tab-pane__toolbar-label">查看模式</span>
        <div class="md-tab-pane__seg">
          <button
            class="md-tab-pane__seg-btn"
            :class="{ 'is-active': currentMode === 'preview' }"
            @click="setMode('preview')"
          >预览</button>
          <button
            class="md-tab-pane__seg-btn"
            :class="{ 'is-active': currentMode === 'edit' }"
            @click="setMode('edit')"
          >编辑</button>
        </div>
        <span class="md-tab-pane__toolbar-label ml-2">快捷插入</span>
        <div class="md-tab-pane__seg">
          <button class="md-tool-btn" @click="insertShortcut('emphasis')">强调</button>
          <button class="md-tool-btn" @click="insertShortcut('heading')">标题</button>
          <button class="md-tool-btn" @click="insertShortcut('quote')">引用</button>
          <button class="md-tool-btn" @click="insertShortcut('table')">表格</button>
          <button class="md-tool-btn" @click="insertShortcut('chart')">图表</button>
        </div>
      </div>
    </div>

    <div class="md-tab-pane__body">
      <div v-if="currentMode === 'edit'" class="h-full">
        <CodeMirrorSurface
          ref="markdownSurfaceRef"
          :model-value="session.content"
          :language="markdownLanguage()"
          text-variant="markdown"
          :handle-image-files="handleImage"
          :on-save="onSave"
          @update:model-value="onContentUpdate"
        />
      </div>
      <div v-else class="relative h-full bg-[#f8fafc]">
        <div v-if="isRenderingPreview" class="md-tab-pane__rendering">渲染中…</div>
        <iframe class="h-full w-full bg-white" sandbox="allow-same-origin" :srcdoc="previewSrcdoc" />
      </div>
    </div>
  </section>
  <div v-else class="flex h-full items-center justify-center text-xs text-muted-foreground/70">
    加载中…
  </div>
</template>

<style scoped>
.md-tab-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-panel);
}
.md-tab-pane__header {
  flex-shrink: 0;
  padding: 10px 14px 8px;
  background: var(--color-bg-panel);
}
.md-tab-pane__header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.md-tab-pane__title-block { min-width: 0; flex: 1 1 auto; }
.md-tab-pane__pill {
  border-radius: 9999px;
  padding: 1px 8px;
  font-size: 10px;
  line-height: 16px;
}
.md-tab-pane__pill--readonly { background: #ecfdf5; color: #047857; }
.md-tab-pane__pill--dirty { background: #fef3c7; color: #b45309; }
.md-tab-pane__pill--ok { background: #ecfdf5; color: #047857; }
.md-tab-pane__pill--loading { background: #e0f2fe; color: #0369a1; }
.md-tab-pane__pill--stale { background: #fff7ed; color: #c2410c; }
.md-tab-pane__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.md-tab-pane__toolbar-label {
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--color-text-secondary);
  text-transform: uppercase;
}
.md-tab-pane__seg {
  display: flex;
  border: 0;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--color-bg-panel);
}
.md-tab-pane__seg-btn {
  padding: 4px 12px;
  font-size: 11px;
  color: var(--color-text-secondary);
  transition: background 0.12s, color 0.12s;
}
.md-tab-pane__seg-btn { border-radius: 6px; }
.md-tab-pane__seg-btn.is-active { background: var(--color-tab-selected); color: var(--color-text-primary); }
.md-tab-pane__seg-btn:not(.is-active):hover { background: var(--color-bg-subtle); color: var(--color-text-primary); }
.md-tool-btn {
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--color-text-secondary);
  transition: background 0.12s, color 0.12s;
}
.md-tool-btn:first-child { border-left: 0; }
.md-tool-btn:hover { background: var(--color-bg-subtle); color: var(--color-text-primary); }
.md-tab-pane__body { flex: 1 1 auto; min-height: 0; }
.md-tab-pane__rendering {
  position: absolute;
  top: 12px;
  right: 12px;
  border-radius: 9999px;
  background: rgba(255,255,255,0.9);
  padding: 4px 10px;
  font-size: 11px;
  color: var(--color-text-secondary);
  box-shadow: 0 1px 4px rgba(0,0,0,0.05);
}
</style>
