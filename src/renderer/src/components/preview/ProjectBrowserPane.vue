<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { browserOverlayVisible } from '@/lib/preview/browser-visibility'
import { call } from '@/lib/api'
import type { BrowserScope, WebPageDesign } from '@shared/project-browser'
import { useProjectBrowserStore } from '@/stores/project-browser'
import { usePreviewStore } from '@/stores/preview'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ scope: BrowserScope; pageId: string; visible: boolean }>()
const emit = defineEmits<{ 'design-created': [design: WebPageDesign] }>()
const browser = useProjectBrowserStore()
const preview = usePreviewStore()
const ui = useUiStore()
const surface = ref<HTMLElement>()
const address = computed({
  get: () => browser.addressDrafts[props.pageId] ?? page.value?.url ?? '',
  set: value => { browser.addressDrafts[props.pageId] = value }
})
const addressInput = ref<HTMLInputElement>()
const isBlank = computed(() => !page.value?.url)
const page = computed(() => browser.pages.find(p => p.id === props.pageId))
const creatingDesign = ref(false)
const canCreateDesign = computed(() => !creatingDesign.value && !isBlank.value && !page.value?.loading && !page.value?.error)
let observer: ResizeObserver | undefined
let mutation: MutationObserver | undefined
let frame = 0
let lastLayout = ''
let layoutRevision = 0
const layoutError = ref('')
let disposed = false
watch(() => [props.pageId, page.value?.url], ([id, url], [oldId, oldUrl]) => {
  if (id === oldId && url !== oldUrl) delete browser.addressDrafts[props.pageId]
})
watch(() => props.pageId, async () => {
  await nextTick()
  if (isBlank.value) addressInput.value?.focus()
}, { immediate: true })

async function createDesign(): Promise<void> {
  if (!canCreateDesign.value) return
  const request = { ...props.scope, id: props.pageId }
  creatingDesign.value = true
  try {
    const result = await call('projectBrowser.createDesign', request)
    if (!result.ok) {
      ui.showToast('error', `转为设计稿失败：${result.message}`)
      return
    }
    const design = result.data
    const warning = design.warnings.length ? `；${design.warnings.join('；')}` : ''
    ui.showToast(design.warnings.length ? 'info' : 'success', `已保存设计稿：${design.relPath}${warning}`, warning ? 8000 : 3000)
    if (!disposed && props.visible && props.pageId === request.id && page.value?.url === design.url
      && props.scope.workspaceId === request.workspaceId && props.scope.projectRelPath === request.projectRelPath) {
      emit('design-created', design)
    }
  } catch (error) {
    ui.showToast('error', `转为设计稿失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    creatingDesign.value = false
  }
}

async function control(action: 'navigate' | 'back' | 'forward' | 'reload'): Promise<void> {
  const result = await call('projectBrowser.control', { ...props.scope, id: props.pageId, action, url: address.value })
  if (!result.ok) ui.showToast('error', result.message)
  lastLayout = ''
  scheduleLayout()
}
function scheduleLayout(): void {
  if (!frame && !disposed) frame = requestAnimationFrame(() => { frame = 0; layout() })
}
function layout(): void {
  const rect = surface.value?.getBoundingClientRect()
  // Native views sit above DOM overlays. Hide them while an app dialog/menu
  // is open, and restore afterward; never cover app controls with a website.
  const overlay = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .mention-popover')]
    .some(el => !!rect && browserOverlayVisible(el, rect))
  const activeProject = preview.activeProject
  const visible = props.visible && !isBlank.value && preview.isPreviewActive && !overlay
    && activeProject?.workspaceId === props.scope.workspaceId && activeProject.relPath === props.scope.projectRelPath
    && rect && rect.width > 0 && rect.height > 0
  const bounds = visible ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
  const key = JSON.stringify([props.pageId, bounds])
  if (key === lastLayout) return
  lastLayout = key
  const revision = ++layoutRevision
  void call('projectBrowser.layout', { ...props.scope, id: props.pageId, bounds }).then(result => {
    if (disposed || revision !== layoutRevision) return
    if (!result.ok) {
      layoutError.value = `网页显示失败：${result.message}`
    } else layoutError.value = ''
  }).catch(error => {
    if (!disposed && revision === layoutRevision) layoutError.value = `网页显示失败：${error instanceof Error ? error.message : String(error)}`
  })
}
watch(() => [props.visible, props.pageId, preview.isPreviewActive, preview.activeTabId, isBlank.value], async (_now, old) => {
  if (old?.[1] && old[1] !== props.pageId) void call('projectBrowser.layout', { ...props.scope, id: String(old[1]), bounds: null })
  await nextTick()
  scheduleLayout()
})
onMounted(() => {
  observer = new ResizeObserver(scheduleLayout)
  if (surface.value) observer.observe(surface.value)
  mutation = new MutationObserver(scheduleLayout)
  mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-state', 'hidden', 'aria-hidden'] })
  window.addEventListener('resize', scheduleLayout)
  window.addEventListener('scroll', scheduleLayout, true)
  scheduleLayout()
})
onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  mutation?.disconnect()
  cancelAnimationFrame(frame)
  window.removeEventListener('resize', scheduleLayout)
  window.removeEventListener('scroll', scheduleLayout, true)
  void call('projectBrowser.layout', { ...props.scope, id: props.pageId, bounds: null })
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col">
    <form class="flex shrink-0 items-center gap-1 border-b border-border p-2" @submit.prevent="control('navigate')">
      <button type="button" class="rounded px-2 py-1 disabled:opacity-40" title="后退" :disabled="!page?.canGoBack" @click="control('back')">←</button>
      <button type="button" class="rounded px-2 py-1 disabled:opacity-40" title="前进" :disabled="!page?.canGoForward" @click="control('forward')">→</button>
      <button type="button" class="rounded px-2 py-1" title="刷新网页" @click="control('reload')">↻</button>
      <input ref="addressInput" v-model="address" aria-label="网页地址" placeholder="输入网址，按 Enter 访问" @focus="addressInput?.select()" class="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-xs" spellcheck="false" />
      <button type="submit" class="rounded px-2 py-1 text-xs">访问</button>
      <button type="button" class="shrink-0 rounded border border-input px-2 py-1 text-xs hover:bg-muted disabled:opacity-40" :disabled="!canCreateDesign" :aria-busy="creatingDesign" title="将当前网页保存为可修改的 HTML 设计稿" @click="createDesign">{{ creatingDesign ? '正在生成…' : '转为设计稿' }}</button>
    </form>
    <div v-if="layoutError" role="alert" class="shrink-0 px-3 py-2 text-xs text-destructive">{{ layoutError }}<button type="button" class="ml-2 underline" @click="lastLayout = ''; scheduleLayout()">重试显示</button></div>
    <div v-if="page?.error || page?.loading" class="shrink-0 px-3 py-1 text-xs text-muted-foreground">{{ page?.error || '网页加载中…' }}</div>
    <div ref="surface" class="min-h-0 flex-1 bg-background" aria-label="项目网页">
      <div v-if="isBlank" class="flex h-full flex-col items-center justify-center gap-5 text-muted-foreground">
        <div class="text-lg font-medium text-foreground">新标签页</div>
        <p class="text-sm">在地址栏输入你要访问的网址</p>
      </div>
    </div>
  </section>
</template>
