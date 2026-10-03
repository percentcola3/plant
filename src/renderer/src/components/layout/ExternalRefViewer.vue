<script setup lang="ts">
// 外部库内置只读查看器：从项目首页点「打开」进入。
// 知识库：左半文件树 + 右半只读预览。
// UI 资产区：主题 / 图片 / 组件三类资产预览。

import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useExternalRefsStore } from '@/stores/external-refs'
import { useUiStore } from '@/stores/ui'
import { call } from '@/lib/api'
import {
  buildComponentPreviewDetailUrl,
  buildProjectFilePreviewUrl,
  externalRefSourceText,
  isMarkdownPreviewPath
} from '@/lib/external-preview'
import type { AssetLibrary, DocTreeNode, UikitAssetSummary } from '@shared/types'
import FileTree from '@/components/common/FileTree.vue'

const ws = useWorkspacesStore()
const ext = useExternalRefsStore()
const ui = useUiStore()
const { active } = storeToRefs(ws)

const alias = computed(() => ui.viewingExternalAlias)
const initialRelPath = computed(() => ui.viewingExternalRelPath)
const binding = computed(() =>
  ext.resolvedBindings.find((x) => x.binding.alias === alias.value) ?? null
)
const sourceText = computed(() => externalRefSourceText(binding.value?.ref))
const isUikit = computed(() => binding.value?.ref?.category === 'uikit')
const externalRoot = computed(() =>
  alias.value ? `.external/${alias.value}` : null
)
const visibleTreeRoots = computed(() => {
  const root = externalRoot.value
  if (!root || isUikit.value) return []
  const visibleDirs = binding.value?.binding.visibleDirs ?? []
  if (visibleDirs.length === 0) return [{ relDir: root, label: null as string | null }]
  return visibleDirs.map((dir) => ({
    relDir: `${root}/${dir}`,
    label: dir
  }))
})

// 资产库化重构：themes / components 两个 tab 合并为 assets（按资产库分组展示主题 + 组件）。
type UikitTab = 'assets' | 'images'

const tree = ref<DocTreeNode[]>([])
const treeLoading = ref(false)
const selectedRel = ref<string | null>(null)
const fileContent = ref<string>('')
const markdownHtml = ref<string>('')
const markdownRendering = ref(false)
const fileLoading = ref(false)
const fileError = ref<string | null>(null)
const uikitTab = ref<UikitTab>('assets')
const uikitSummary = ref<UikitAssetSummary | null>(null)
const uikitLoading = ref(false)
const uikitError = ref<string | null>(null)
const iconsPreviewUrl = ref('')
const componentsPreviewUrl = ref('')
const selectedAssetLibraryName = ref<string | null>(null)
const selectedComponentPreview = ref<{ libraryName: string; componentName: string } | null>(null)
let renderSeq = 0
let uikitSeq = 0

async function loadTree(): Promise<void> {
  if (!active.value || visibleTreeRoots.value.length === 0 || isUikit.value) {
    tree.value = []
    return
  }
  treeLoading.value = true
  const roots = visibleTreeRoots.value
  const results = await Promise.all(roots.map((root) =>
    call('workspace.listFiles', {
      workspaceId: active.value!.id,
      relDir: root.relDir
    })
  ))
  treeLoading.value = false
  if (roots.length === 1 && roots[0].label === null) {
    tree.value = results[0]?.ok ? results[0].data : []
    return
  }
  tree.value = roots.map((root, index): DocTreeNode => ({
    kind: 'folder',
    name: root.label ?? root.relDir,
    relPath: root.relDir,
    children: results[index]?.ok ? results[index].data : []
  }))
}

async function loadUikitAsset(): Promise<void> {
  if (!active.value || !externalRoot.value || !isUikit.value) {
    uikitSummary.value = null
    iconsPreviewUrl.value = ''
    componentsPreviewUrl.value = ''
    selectedComponentPreview.value = null
    return
  }
  const workspaceId = active.value.id
  const rootRel = externalRoot.value
  const seq = ++uikitSeq
  uikitLoading.value = true
  uikitError.value = null
  const [summary, iconsUrl, componentsUrl] = await Promise.all([
    call('workspace.uikitSummary', { workspaceId, rootRel }),
    call('preview.iconsUrl', { workspaceId, rootRel }),
    call('preview.componentsUrl', { workspaceId, rootRel })
  ])
  if (seq !== uikitSeq) return
  uikitLoading.value = false
  if (!summary.ok) {
    uikitError.value = `${summary.code}: ${summary.message}`
    return
  }
  if (!iconsUrl.ok) {
    uikitError.value = `${iconsUrl.code}: ${iconsUrl.message}`
    return
  }
  if (!componentsUrl.ok) {
    uikitError.value = `${componentsUrl.code}: ${componentsUrl.message}`
    return
  }
  uikitSummary.value = summary.data
  iconsPreviewUrl.value = iconsUrl.data.url
  componentsPreviewUrl.value = componentsUrl.data.url
  const libs = summary.data.assetLibraries
  if (libs.length > 0 && !libs.some((lib) => lib.name === selectedAssetLibraryName.value)) {
    selectedAssetLibraryName.value = libs[0].name
  }
}

async function loadFile(rel: string): Promise<void> {
  if (!active.value) return
  const workspaceId = active.value.id
  const seq = ++renderSeq
  selectedRel.value = rel
  fileLoading.value = true
  fileError.value = null
  fileContent.value = ''
  markdownHtml.value = ''
  markdownRendering.value = false
  const r = await call('editor.readTextFile', { workspaceId, relPath: rel })
  if (seq !== renderSeq) return
  fileLoading.value = false
  if (!r.ok) {
    fileError.value = `${r.code}: ${r.message}`
    return
  }
  fileContent.value = r.data.content
  if (isMarkdownPreviewPath(rel)) {
    await renderMarkdownFile(seq, workspaceId, rel, r.data.content)
  }
}

function onSelect(rel: string): void {
  void loadFile(rel)
}

function escapeHtmlText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

watch([
  alias,
  initialRelPath,
  () => active.value?.id,
  () => binding.value?.ref?.category,
  () => binding.value?.binding.visibleDirs?.join('\n') ?? ''
], () => {
  renderSeq += 1
  uikitSeq += 1
  selectedRel.value = null
  fileContent.value = ''
  markdownHtml.value = ''
  markdownRendering.value = false
  fileError.value = null
  tree.value = []
  uikitTab.value = 'assets'
  uikitSummary.value = null
  uikitError.value = null
  iconsPreviewUrl.value = ''
  componentsPreviewUrl.value = ''
  selectedAssetLibraryName.value = null
  selectedComponentPreview.value = null
  if (isUikit.value) void loadUikitAsset()
  else {
    void loadTree()
    if (externalRoot.value && initialRelPath.value) {
      void loadFile(`${externalRoot.value}/${initialRelPath.value}`)
    }
  }
}, { immediate: true })

const isMarkdown = computed(() => isMarkdownPreviewPath(selectedRel.value))

const assetLibraries = computed<AssetLibrary[]>(() => uikitSummary.value?.assetLibraries ?? [])

const selectedLibrary = computed<AssetLibrary | null>(() => {
  const libs = assetLibraries.value
  if (libs.length === 0) return null
  return libs.find((lib) => lib.name === selectedAssetLibraryName.value) ?? libs[0]
})

const selectedComponentPreviewUrl = computed(() => {
  const selected = selectedComponentPreview.value
  if (!selected) return ''
  return componentPreviewDetailUrl(selected.libraryName, selected.componentName)
})

function selectAssetLibrary(name: string): void {
  selectedAssetLibraryName.value = name
  selectedComponentPreview.value = null
}

function componentPreviewDetailUrl(category: string, name: string): string {
  if (!componentsPreviewUrl.value) return ''
  return buildComponentPreviewDetailUrl(componentsPreviewUrl.value, category, name)
}

function componentDemoPreviewUrl(demoPath: string | null): string {
  const workspaceId = active.value?.id
  if (!workspaceId || !externalRoot.value || !componentsPreviewUrl.value || !demoPath) return ''
  return buildProjectFilePreviewUrl(componentsPreviewUrl.value, workspaceId, externalRoot.value, demoPath)
}

function openExternalComponentPreview(libraryName: string, componentName: string): void {
  if (!componentPreviewDetailUrl(libraryName, componentName)) return
  selectedComponentPreview.value = { libraryName, componentName }
}

async function resolvePreviewBaseUrl(workspaceId: string, relPath: string): Promise<string | null> {
  const r = await call('preview.docUrl', { workspaceId, relPath })
  if (!r.ok) return null
  return new URL(r.data.url).origin
}

async function renderMarkdownFile(seq: number, workspaceId: string, relPath: string, content: string): Promise<void> {
  markdownRendering.value = true
  let html = ''
  try {
    const previewBaseUrl = await resolvePreviewBaseUrl(workspaceId, relPath)
    if (seq !== renderSeq) return
    const { renderMarkdownPreview } = await import('@/lib/editor/markdown-preview')
    if (seq !== renderSeq) return
    html = await renderMarkdownPreview({
      content,
      projectId: workspaceId,
      relPath,
      previewBaseUrl
    })
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    html = `<!doctype html><html><body style="font:14px sans-serif;padding:24px;color:#9f1239;background:#fff1f2;">预览渲染失败：${escapeHtmlText(message)}</body></html>`
  }
  if (seq !== renderSeq) return
  markdownHtml.value = html
  markdownRendering.value = false
}
</script>

<template>
  <main class="external-ref-viewer flex-1 flex flex-col overflow-hidden">
    <header class="external-ref-viewer__header border-b border-border/60 px-5 py-3 flex items-center gap-3">
      <div class="flex-1 min-w-0">
        <div class="flex min-w-0 items-baseline gap-2">
          <h2 class="shrink-0 text-base font-medium truncate">{{ alias }}</h2>
          <span class="shrink-0 text-xs text-muted-foreground">
            {{ binding?.ref?.category === 'uikit' ? 'UI 资产区' : '知识库' }} · 只读
          </span>
          <span v-if="sourceText" class="min-w-0 truncate text-xs text-muted-foreground font-mono">
            {{ sourceText }}
          </span>
        </div>
      </div>
    </header>

    <div v-if="isUikit" class="uikit-assets-view flex-1 flex flex-col overflow-hidden">
      <div class="uikit-assets-view__tabs border-b border-border/60 px-5 py-3">
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="h-8 rounded-md px-3 text-sm"
            :class="uikitTab === 'assets' ? 'bg-accent/15 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'"
            @click="uikitTab = 'assets'"
          >资产</button>
          <button
            type="button"
            class="h-8 rounded-md px-3 text-sm"
            :class="uikitTab === 'images' ? 'bg-accent/15 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'"
            @click="uikitTab = 'images'"
          >图片</button>
          <span v-if="uikitSummary" class="ml-auto text-xs text-muted-foreground">
            {{ uikitSummary.assetLibraries.length }} 资产库 · {{ uikitSummary.iconsCount }} 图片 · {{ uikitSummary.componentsCount }} 组件
          </span>
        </div>
      </div>

      <section class="flex-1 min-h-0 overflow-hidden">
        <div v-if="uikitLoading" class="p-5 text-sm text-muted-foreground">加载中…</div>
        <div v-else-if="uikitError" class="p-5 text-sm text-destructive">{{ uikitError }}</div>
        <div v-else-if="!uikitSummary" class="p-5 text-sm text-muted-foreground">未读取到 UI 资产区</div>

        <div v-else-if="uikitTab === 'assets'" class="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)]">
          <aside class="uikit-assets-view__sidebar min-h-0 overflow-y-auto border-r border-border/60 p-3">
            <div v-if="uikitSummary.warnings.length > 0" class="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {{ uikitSummary.warnings[0] }}
              <span v-if="uikitSummary.warnings.length > 1"> +{{ uikitSummary.warnings.length - 1 }}</span>
            </div>
            <div v-if="assetLibraries.length === 0" class="text-sm text-muted-foreground">
              components/ 下未发现资产库
            </div>
            <button
              v-for="lib in assetLibraries"
              :key="lib.name"
              type="button"
              class="mb-2 flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition-colors"
              :class="selectedLibrary?.name === lib.name ? 'border-primary/45 bg-accent/20 ring-1 ring-primary/15' : 'border-border/60 hover:bg-muted'"
              @click="selectAssetLibrary(lib.name)"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm text-foreground">{{ lib.name }}</span>
                <span class="block truncate text-xs text-muted-foreground">
                  {{ lib.theme ? `${lib.theme.variants.length} 主题` : '无主题' }} · {{ lib.components.length }} 组件
                </span>
              </span>
            </button>
          </aside>
          <main class="uikit-assets-view__content min-h-0 overflow-y-auto bg-background p-4">
            <div v-if="selectedComponentPreviewUrl" class="flex h-full min-h-0 flex-col">
              <div class="uikit-assets-view__detail-header flex shrink-0 items-center gap-3 border-b border-border/60 bg-background px-3 py-2">
                <span class="min-w-0 truncate text-sm font-semibold text-foreground">
                  组件预览 · {{ selectedComponentPreview?.componentName }}
                </span>
              </div>
              <iframe
                class="min-h-0 flex-1 border-0 bg-white"
                sandbox="allow-same-origin allow-scripts allow-forms"
                :src="selectedComponentPreviewUrl"
              />
            </div>
            <div v-else-if="!selectedLibrary" class="flex h-full items-center justify-center text-sm text-muted-foreground">
              选择左侧的资产库查看详情
            </div>
            <template v-else>
              <section class="mb-6">
                <header class="mb-2"><h3 class="text-sm font-semibold text-foreground">主题（只读）</h3></header>
                <div v-if="!selectedLibrary.theme" class="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                  该资产库没有 theme/ 目录
                </div>
                <ul v-else class="space-y-1.5">
                  <li>
                    <div class="flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs">
                      <span class="font-mono text-foreground">palette.css</span>
                      <span class="ml-auto truncate text-muted-foreground/70">{{ selectedLibrary.theme.palette.cssPath }}</span>
                    </div>
                  </li>
                  <li v-for="variant in selectedLibrary.theme.variants" :key="variant.name">
                    <div class="flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs">
                      <span class="font-mono text-foreground">{{ variant.name === 'default' ? 'theme.css' : `theme-${variant.name}.css` }}</span>
                      <span class="ml-auto truncate text-muted-foreground/70">{{ variant.cssPath }}</span>
                    </div>
                  </li>
                </ul>
              </section>
              <section>
                <header class="mb-2"><h3 class="text-sm font-semibold text-foreground">组件</h3></header>
                <div v-if="selectedLibrary.components.length === 0" class="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                  该资产库下没有组件目录
                </div>
                <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                  <article
                    v-for="comp in selectedLibrary.components"
                    :key="comp.name"
                    role="button"
                    :tabindex="comp.hasDemo ? 0 : -1"
                    :aria-disabled="!comp.hasDemo"
                    class="component-card flex min-h-[206px] flex-col rounded-lg border p-3 text-left"
                    :class="comp.hasDemo
                      ? 'cursor-pointer hover:border-accent/70 focus:outline-none focus:ring-1 focus:ring-accent/25'
                      : 'cursor-default opacity-75'"
                    @click="comp.hasDemo && openExternalComponentPreview(selectedLibrary.name, comp.name)"
                    @keydown.enter.prevent="comp.hasDemo && openExternalComponentPreview(selectedLibrary.name, comp.name)"
                    @keydown.space.prevent="comp.hasDemo && openExternalComponentPreview(selectedLibrary.name, comp.name)"
                  >
                    <div class="flex items-center gap-2">
                      <span class="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-foreground">{{ comp.name }}</span>
                      <span v-if="comp.hasDemo" class="rounded bg-accent/10 px-1.5 py-0.5 text-xxs text-primary">组件预览</span>
                      <span v-else class="rounded bg-muted px-1.5 py-0.5 text-xxs text-muted-foreground">无 demo</span>
                    </div>
                    <div class="component-card__preview mt-3">
                      <iframe
                        v-if="comp.hasDemo && componentDemoPreviewUrl(comp.demoPath)"
                        class="component-card__preview-frame"
                        sandbox="allow-same-origin allow-scripts allow-forms"
                        :src="componentDemoPreviewUrl(comp.demoPath)"
                      />
                      <div v-else class="component-card__preview-empty">暂无预览</div>
                    </div>
                  </article>
                </div>
              </section>
            </template>
          </main>
        </div>

        <iframe
          v-else-if="uikitTab === 'images' && iconsPreviewUrl"
          class="h-full w-full border-0 bg-white"
          sandbox="allow-same-origin allow-scripts allow-forms"
          :src="iconsPreviewUrl"
        />
      </section>
    </div>

    <div v-else class="flex-1 flex overflow-hidden">
      <!-- 左侧文件树 -->
      <aside class="w-64 border-r border-border/60 overflow-y-auto p-2">
        <div v-if="treeLoading" class="text-xs text-muted-foreground px-2 py-2">加载中…</div>
        <FileTree
          v-else
          :nodes="tree"
          :active-rel-path="selectedRel ?? null"
          empty-text="外部库为空或路径丢失"
          @select="onSelect"
        />
      </aside>

      <!-- 右侧预览 -->
      <section class="flex-1 overflow-y-auto p-5">
        <div v-if="!selectedRel" class="text-muted-foreground text-sm">
          从左侧选择文件查看
        </div>
        <div v-else-if="fileLoading" class="text-muted-foreground text-sm">加载中…</div>
        <div v-else-if="fileError" class="text-destructive text-sm">{{ fileError }}</div>
        <div v-else>
          <div class="mb-3 text-xs text-muted-foreground font-mono break-all">{{ selectedRel }}</div>
          <div v-if="isMarkdown" class="relative h-[calc(100vh-180px)] min-h-[420px] overflow-hidden rounded-md border border-border/60 bg-white">
            <div
              v-if="markdownRendering"
              class="absolute right-3 top-3 z-10 rounded-full bg-white/90 px-2 py-1 text-xs text-muted-foreground shadow-sm"
            >渲染中…</div>
            <iframe
              class="h-full w-full bg-white"
              sandbox="allow-same-origin"
              :srcdoc="markdownHtml"
            />
          </div>
          <pre
            v-else
            class="whitespace-pre-wrap break-all text-sm font-mono leading-relaxed"
          >{{ fileContent }}</pre>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.external-ref-viewer {
  background: var(--color-bg-base);
  color: var(--color-text-primary);
}

.external-ref-viewer__header,
.uikit-assets-view__tabs,
.uikit-assets-view__detail-header {
  background: var(--color-bg-panel);
  color: var(--color-text-primary);
}

.uikit-assets-view {
  background: var(--color-bg-base);
  color: var(--color-text-primary);
}

.uikit-assets-view__sidebar {
  background: var(--color-bg-panel);
}

.uikit-assets-view__content {
  background: var(--color-bg-base);
}

.uikit-assets-view :deep(.text-foreground) {
  color: var(--color-text-primary);
}

.uikit-assets-view :deep(.text-muted-foreground),
.uikit-assets-view :deep(.text-muted-foreground\/70) {
  color: var(--color-text-secondary);
}

.uikit-assets-view :deep(.bg-background) {
  background: var(--color-bg-subtle);
}

.uikit-assets-view :deep(.hover\:bg-muted:hover) {
  background: var(--color-bg-hover);
}

.uikit-assets-view :deep(.bg-muted) {
  background: var(--color-bg-subtle);
}

.component-card {
  background: var(--color-card-surface);
  border: 0;
  border-radius: 12px;
  color: var(--color-text-primary);
  transition: background-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}

.component-card[aria-disabled="false"]:hover {
  background: var(--color-card-hover);
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-1px);
}

.component-card__preview {
  position: relative;
  height: 148px;
  overflow: hidden;
  border: 0;
  border-radius: 10px;
  background: var(--color-bg-subtle);
}

.component-card__preview-frame {
  position: absolute;
  top: 0;
  left: 0;
  width: 200%;
  height: 200%;
  border: 0;
  background: var(--color-bg-subtle);
  pointer-events: none;
  transform: scale(0.5);
  transform-origin: top left;
}

.component-card__preview-empty {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  font-size: 12px;
}
</style>
