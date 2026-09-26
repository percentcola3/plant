<script setup lang="ts">
import { css as cssLanguage } from '@codemirror/lang-css'
import { markdown as markdownLanguage } from '@codemirror/lang-markdown'
import type { Extension } from '@codemirror/state'
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import CodeMirrorSurface from './CodeMirrorSurface.vue'
import SkillFolderSidebar from './SkillFolderSidebar.vue'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import { useThemeStore } from '@/stores/theme'
import { useWorkspacesStore } from '@/stores/workspaces'
import { cssColorSwatches } from '@/lib/editor/css-color-swatches'
import { renderMarkdownPreview } from '@/lib/editor/markdown-preview'
import type { MarkdownShortcutId } from '@/lib/editor/markdown-shortcuts'

const editor = useEditorStore()
const ui = useUiStore()
const themeStore = useThemeStore()
const workspaces = useWorkspacesStore()
const { session, sessions, activeSessionKey, isDirty, isLoading, isSaving, isPublishing, error } = storeToRefs(editor)

const previewSrcdoc = ref('')
const isRenderingPreview = ref(false)
const markdownSurfaceRef = ref<InstanceType<typeof CodeMirrorSurface> | null>(null)
let renderSeq = 0

const isMarkdown = computed(() => session.value?.kind === 'markdown')
const isReadonly = computed(() => session.value?.readonly === true)
const currentMode = computed(() => session.value?.mode ?? 'edit')
const language = computed<Extension>(() => {
  if (session.value?.kind === 'markdown') return markdownLanguage()
  if (session.value?.kind === 'css') return cssLanguage()
  return []
})
const extraExtensions = computed(() => session.value?.kind === 'css' ? [cssColorSwatches()] : [])
const publishStatus = computed<{ label: string; tone: string } | null>(() => {
  if (isPublishing.value) return { label: '发布中', tone: 'loading' }
  const publish = session.value?.publish
  if (!publish) return null
  return publish.isPublished
    ? { label: '已发布', tone: 'ok' }
    : { label: '发布后有更新', tone: 'stale' }
})
const canOpenPublishedUrl = computed(() => !!session.value?.publish?.url)
const skillFolderRoot = computed(() => {
  const relPath = session.value?.relPath ?? ''
  const match = /^(\.(?:claude|agents)\/skills\/(?:\.disabled\/)?[^/]+)(?:\/|$)/.exec(relPath)
  return match?.[1] ?? null
})

const TEXT_FILE_EXTENSIONS = new Set([
  '', 'txt', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'csv',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'sh', 'bash', 'zsh',
  'ini', 'conf', 'properties', 'gitignore'
])

async function openSkillFile(relPath: string): Promise<void> {
  const extension = relPath.includes('.') ? relPath.split('.').pop()?.toLowerCase() ?? '' : ''
  if (extension === 'md' || extension === 'mdx' || extension === 'markdown') {
    await editor.openProjectMarkdown(relPath)
    if (editor.session?.relPath === relPath) editor.setMode('edit')
    return
  }
  if (extension === 'css') {
    await editor.openCss(relPath)
    return
  }
  if (extension === 'html' || extension === 'htm') {
    await editor.openHtml(relPath)
    return
  }
  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    await editor.openText(relPath)
    return
  }
  ui.showToast('info', '该文件不是可编辑的文本文件，请使用外部编辑器打开')
}

function workspaceName(projectId: string): string {
  return workspaces.list.find((item) => item.id === projectId)?.name ?? projectId
}

function sessionKey(item: NonNullable<typeof session.value>): string {
  return editor.sessionKeyOf(item)
}

async function refreshPreview(): Promise<void> {
  const current = session.value
  if (!current || current.kind !== 'markdown') {
    previewSrcdoc.value = ''
    return
  }
  const seq = ++renderSeq
  isRenderingPreview.value = true
  const html = await renderMarkdownPreview({
    content: current.content,
    projectId: current.projectId,
    relPath: current.relPath,
    previewBaseUrl: current.previewBaseUrl,
    theme: themeStore.theme
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    return `<!doctype html><html><body style="font:14px sans-serif;padding:24px;color:#fecdd3;background:#121212;">预览渲染失败：${message}</body></html>`
  })
  if (seq !== renderSeq) return
  previewSrcdoc.value = html
  isRenderingPreview.value = false
}

watch(
  () => [session.value?.kind, session.value?.content, session.value?.previewBaseUrl, session.value?.relPath, themeStore.theme],
  () => {
    void refreshPreview()
  },
  { immediate: true }
)

async function insertMarkdownShortcut(id: MarkdownShortcutId): Promise<void> {
  if (!isMarkdown.value || isReadonly.value) return
  if (currentMode.value !== 'edit') {
    editor.setMode('edit')
    await nextTick()
  }
  markdownSurfaceRef.value?.insertMarkdownShortcut(id)
}

async function publishDocument(): Promise<void> {
  await editor.publishCurrentDocument()
}

async function copyPublishedUrl(): Promise<void> {
  await editor.copyPublishUrl()
}

async function openPublishedUrl(): Promise<void> {
  await editor.openPublishUrl()
}
</script>

<template>
  <section
    v-if="session"
    class="workspace-editor"
  >
    <div
      v-if="sessions.length > 1"
      class="workspace-editor__tabs"
    >
      <button
        v-for="item in sessions"
        :key="sessionKey(item)"
        type="button"
        class="editor-tab"
        :class="{ 'is-active': activeSessionKey === sessionKey(item), 'is-dirty': item.content !== item.savedContent }"
        :title="`${workspaceName(item.projectId)} · ${item.relPath}`"
        @click="editor.activateSession(sessionKey(item))"
      >
        <span class="editor-tab__workspace">{{ workspaceName(item.projectId) }}</span>
        <span class="editor-tab__title">{{ item.title }}</span>
        <span v-if="item.content !== item.savedContent" class="editor-tab__dot" />
        <span
          class="editor-tab__close"
          title="关闭"
          @click.stop="editor.closeSession(sessionKey(item))"
        >×</span>
      </button>
    </div>
    <div class="workspace-editor__header">
      <div class="mb-3 flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="mb-1 flex items-center gap-2">
            <span class="truncate text-[15px] font-semibold">{{ session.title }}</span>
            <span class="workspace-editor__kind">
            {{ session.kind }}
          </span>
          <span
            v-if="isReadonly"
            class="rounded-full bg-emerald-50 px-2 py-0.5 text-xxs text-emerald-700"
          >只读</span>
          <span
            v-if="isDirty && !isReadonly"
            class="rounded-full bg-amber-100 px-2 py-0.5 text-xxs text-amber-700"
          >未保存</span>
          <span
            v-if="publishStatus"
            class="rounded-full px-2 py-0.5 text-xxs"
            :class="publishStatus.tone === 'ok'
              ? 'bg-emerald-50 text-emerald-700'
              : publishStatus.tone === 'loading'
                ? 'bg-sky-50 text-sky-700'
                : 'bg-orange-50 text-orange-700'"
          >{{ publishStatus.label }}</span>
        </div>
          <div class="workspace-editor__path">{{ session.relPath }}</div>
        </div>

        <div class="flex items-center gap-2">
          <template v-if="isMarkdown && !isReadonly && !skillFolderRoot">
            <Button
              variant="outline"
              size="sm"
              :disabled="isLoading || isSaving || isPublishing"
              @click="publishDocument"
            >{{ isPublishing ? '发布中…' : '发布' }}</Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="!canOpenPublishedUrl"
              @click="copyPublishedUrl"
            >复制链接</Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="!canOpenPublishedUrl"
              @click="openPublishedUrl"
            >打开链接</Button>
          </template>
          <Button variant="outline" size="sm" :disabled="isLoading || isSaving" @click="editor.reload">重载</Button>
          <Button v-if="!isReadonly" size="sm" :disabled="isSaving || !isDirty" @click="editor.save">
            {{ isSaving ? '保存中…' : '保存' }}
          </Button>
          <Button variant="outline" size="sm" @click="() => editor.close()">关闭</Button>
        </div>
      </div>

      <div v-if="isMarkdown && !isReadonly" class="flex flex-wrap items-center gap-2">
        <span class="workspace-editor__control-label">查看模式</span>
        <div class="workspace-editor__segmented">
          <button
            class="workspace-editor__segment"
            :class="{ 'is-active': currentMode === 'preview' }"
            @click="editor.setMode('preview')"
          >预览</button>
          <button
            class="workspace-editor__segment"
            :class="{ 'is-active': currentMode === 'edit' }"
            @click="editor.setMode('edit')"
          >编辑</button>
        </div>
        <span class="workspace-editor__control-label ml-2">快捷插入</span>
        <div class="workspace-editor__segmented">
          <button class="md-tool-btn" @click="insertMarkdownShortcut('emphasis')">强调</button>
          <button class="md-tool-btn" @click="insertMarkdownShortcut('heading')">标题</button>
          <button class="md-tool-btn" @click="insertMarkdownShortcut('quote')">引用</button>
          <button class="md-tool-btn" @click="insertMarkdownShortcut('table')">表格</button>
          <button class="md-tool-btn" @click="insertMarkdownShortcut('chart')">图表</button>
        </div>
      </div>
    </div>

    <div v-if="error" class="shrink-0 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive">
      {{ error }}
    </div>

    <div class="flex flex-1 min-h-0">
      <SkillFolderSidebar
        v-if="skillFolderRoot"
        :workspace-id="session.projectId"
        :root-rel-path="skillFolderRoot"
        :active-rel-path="session.relPath"
        @select="openSkillFile"
      />
      <div class="min-w-0 flex-1">
        <div v-if="session.kind === 'markdown'" class="h-full">
          <div v-if="currentMode === 'edit'" class="h-full">
            <CodeMirrorSurface
              ref="markdownSurfaceRef"
              :model-value="session.content"
              :language="language"
              text-variant="markdown"
              :theme="themeStore.theme"
              :handle-image-files="editor.saveImageAsset"
              :on-save="editor.save"
              @update:model-value="editor.updateContent"
            />
          </div>

          <div v-else class="workspace-editor__preview">
            <div v-if="isRenderingPreview" class="workspace-editor__rendering">渲染中…</div>
            <iframe class="h-full w-full border-0 bg-background" sandbox="allow-same-origin" :srcdoc="previewSrcdoc" />
          </div>
        </div>

        <div v-else class="h-full">
          <CodeMirrorSurface
            :model-value="session.content"
            :language="language"
            :extra-extensions="extraExtensions"
            :theme="themeStore.theme"
            :on-save="editor.save"
            @update:model-value="editor.updateContent"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.workspace-editor {
  display: flex;
  height: 100%;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg-base);
  color: var(--color-text-primary);
}

.workspace-editor__tabs {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg-panel);
  padding: 8px 12px;
}

.workspace-editor__header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg-base);
  padding: 16px 20px;
}

.workspace-editor__kind {
  border-radius: 999px;
  background: var(--color-bg-elevated);
  padding: 2px 8px;
  color: var(--color-text-secondary);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.workspace-editor__path {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-editor__control-label {
  color: var(--color-text-tertiary);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.workspace-editor__segmented {
  display: flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-panel);
}

.workspace-editor__segment {
  height: 32px;
  border-left: 1px solid var(--color-border);
  padding: 0 16px;
  color: var(--color-text-secondary);
  font-size: 12px;
  transition: background-color 0.12s, color 0.12s;
}

.workspace-editor__segment:first-child {
  border-left: 0;
}

.workspace-editor__segment:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.workspace-editor__segment.is-active {
  background: var(--color-button-bg);
  color: var(--color-button-fg);
}

.workspace-editor__preview {
  position: relative;
  height: 100%;
  background: var(--color-bg-base);
}

.workspace-editor__rendering {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
  border: 1px solid var(--color-border-subtle);
  border-radius: 999px;
  background: var(--color-bg-elevated);
  padding: 4px 8px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.md-tool-btn {
  height: 32px;
  border-left: 1px solid var(--color-border);
  padding: 0 10px;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1;
  transition: background-color 0.12s, color 0.12s;
}

.md-tool-btn:first-child {
  border-left: 0;
}

.md-tool-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.editor-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 240px;
  height: 30px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-base);
  padding: 0 8px;
  color: var(--color-text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.editor-tab.is-active {
  border-color: var(--color-border-strong);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.editor-tab__workspace {
  max-width: 86px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-tertiary);
}

.editor-tab__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.editor-tab__dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 9999px;
  background: #f59e0b;
}

.editor-tab__close {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  color: var(--color-text-tertiary);
}

.editor-tab__close:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
</style>
