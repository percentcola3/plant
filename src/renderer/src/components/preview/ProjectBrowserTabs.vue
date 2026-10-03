<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import ProductFilesTreeToggle from './ProductFilesTreeToggle.vue'
import WorkbenchTabIcon from './WorkbenchTabIcon.vue'
import { reconcileTabOrder, moveWorkbenchTab, tabsToClose } from '@/lib/preview/workbench-tabs'
import type { BrowserScope } from '@shared/project-browser'
import { useProjectBrowserStore } from '@/stores/project-browser'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  scope: BrowserScope
  files: { id: string; title: string; dirty: boolean }[]
  activeFile: string | null
  closeFile: (id: string) => boolean
  treeOpen: boolean
}>()
const emit = defineEmits<{ selectFile: [id: string]; selectOverview: []; toggleTree: [] }>()
const browser = useProjectBrowserStore()
const ui = useUiStore()
const opening = ref(false)
const strip = ref<HTMLElement>()
const order = defineModel<string[]>('order', { default: () => [] })
const menu = ref<{ id: string; x: number; y: number } | null>(null)
const dragging = ref<string | null>(null)
const available = computed(() => [
  ...props.files.map(file => ({ ...file, key: `file:${file.id}`, web: false })),
  ...browser.scopedPages(props.scope).map(page => ({ id: page.id, key: `web:${page.id}`, title: page.title, dirty: false, web: true }))
])
watch(() => available.value.map(tab => tab.key), keys => {
  order.value = reconcileTabOrder(order.value, keys)
}, { immediate: true })
const tabs = computed(() => order.value.flatMap(key => available.value.filter(tab => tab.key === key)))
const activeKey = computed(() => {
  const web = browser.activePage(props.scope)
  return web ? `web:${web.id}` : props.activeFile ? `file:${props.activeFile}` : null
})
watch(activeKey, async () => {
  await nextTick()
  strip.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
})
function select(key: string): void {
  const tab = tabs.value.find(tab => tab.key === key)
  if (!tab) return
  if (tab.web) browser.activate(props.scope, tab.id)
  else emit('selectFile', tab.id)
}
async function add(): Promise<void> {
  if (opening.value) return
  opening.value = true
  try { await browser.open(props.scope, '') }
  catch (error) { ui.showToast('error', error instanceof Error ? error.message : String(error)) }
  finally { opening.value = false }
}
async function close(key: string): Promise<boolean> {
  const index = tabs.value.findIndex(tab => tab.key === key)
  const tab = tabs.value[index]
  if (!tab) return true
  const wasActive = activeKey.value === key
  const neighbor = tabs.value[index + 1] ?? tabs.value[index - 1]
  try {
    if (tab.web) await browser.close(props.scope, tab.id)
    else if (!props.closeFile(tab.id)) return false
    if (wasActive) {
      if (neighbor) select(neighbor.key)
      else { browser.activate(props.scope, null); emit('selectOverview') }
    }
    return true
  } catch (error) {
    ui.showToast('error', error instanceof Error ? error.message : String(error))
    return false
  }
}
async function closeMany(mode: 'left' | 'right' | 'others' | 'all'): Promise<void> {
  const keys = tabsToClose(order.value, menu.value?.id ?? '', mode)
  menu.value = null
  for (const key of keys) if (!await close(key)) break
}
function drop(key: string): void {
  const from = dragging.value
  if (!from || from === key) return
  order.value = moveWorkbenchTab(order.value, from, key)
  dragging.value = null
}
function context(event: MouseEvent, id: string): void {
  menu.value = { id, x: Math.min(event.clientX, window.innerWidth - 180), y: Math.min(event.clientY, window.innerHeight - 200) }
}
</script>

<template>
  <div class="workbench-tabs">
    <ProductFilesTreeToggle class="tree-toggle" :open="treeOpen" @toggle="emit('toggleTree')" />
    <div ref="strip" class="tab-strip" role="tablist" aria-label="文件与网页标签">
      <div v-for="tab in tabs" :key="tab.key" class="tab" :class="{ active: activeKey === tab.key }" draggable="true" @dragstart="dragging = tab.key" @dragend="dragging = null" @dragover.prevent @drop.prevent="drop(tab.key)" @contextmenu.prevent="context($event, tab.key)">
        <button type="button" role="tab" :aria-selected="activeKey === tab.key" :title="tab.id" class="tab-label" @click="select(tab.key)">
          <span class="tab-mark" aria-hidden="true">
            <WorkbenchTabIcon :rel-path="tab.id" :web="tab.web" />
          </span>
          <span class="tab-title">{{ tab.title }}</span>
        </button>
        <span v-if="tab.dirty" title="未保存" class="dirty" aria-label="未保存" />
        <button type="button" class="close" :aria-label="`关闭 ${tab.title}`" @click="close(tab.key)"><X aria-hidden="true" /></button>
      </div>
    </div>
    <button class="new-tab" type="button" title="新建网页标签页" aria-label="新建网页标签页" :disabled="opening" @click="add"><Plus aria-hidden="true" /></button>
    <div class="tab-actions"><slot name="actions" /></div>
    <Teleport to="body">
      <div v-if="menu" class="tab-menu-mask" @pointerdown.self="menu = null" @contextmenu.prevent="menu = null" @keydown.esc="menu = null">
        <div role="menu" class="tab-menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }">
          <button role="menuitem" @click="close(menu.id); menu = null">关闭标签页</button>
          <button role="menuitem" @click="closeMany('left')">关闭左侧标签页</button>
          <button role="menuitem" @click="closeMany('right')">关闭右侧标签页</button>
          <button role="menuitem" @click="closeMany('others')">关闭其他标签页</button>
          <button role="menuitem" @click="closeMany('all')">关闭全部标签页</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
<style scoped>
.workbench-tabs { display: flex; align-items: center; min-width: 0; width: 100%; height: 40px; gap: 4px; padding: 6px 8px 0; background: var(--color-bg-panel); }
.tab-strip { display: flex; min-width: 0; flex: 0 1 auto; overflow-x: auto; gap: 4px; scrollbar-width: none; }
.tab-strip::-webkit-scrollbar { display: none; }
.tab {
  display: flex; flex: 1 1 190px; min-width: 76px; max-width: 220px; height: 28px;
  align-items: center; gap: 2px; padding: 0 4px 0 8px;
  border: 0; border-radius: 8px;
  color: var(--color-text-secondary);
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}
.tab:hover, .new-tab:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
.tab.active, .tab.active:hover {
  background: var(--color-tab-selected);
  color: var(--color-text-primary);
}
.tab-label { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; height: 100%; font-size: 12px; text-align: left; }
.tab-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab.active .tab-label { font-weight: 600; }
.tab-mark { position: relative; flex: none; width: 16px; height: 16px; display: inline-grid; place-items: center; }
.close {
  display: inline-grid; place-items: center; flex: none; width: 20px; height: 20px;
  color: var(--color-text-tertiary); opacity: 0;
  --radius-button: 6px;
  transition: opacity var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out);
}
.tab:hover .close, .tab.active .close, .close:focus-visible { opacity: 1; }
.close:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
.close svg { width: 12px; height: 12px; stroke-width: 2; }
.new-tab {
  display: inline-grid; place-items: center; flex: 0 0 28px; height: 28px;
  color: var(--color-text-secondary);
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}
.new-tab svg { width: 15px; height: 15px; stroke-width: 1.75; }
.tree-toggle { flex: none; }
.dirty { flex: none; width: 6px; height: 6px; margin: 0 4px; border-radius: 999px; background: var(--color-accent); }
.tab-menu-mask { position: fixed; inset: 0; z-index: 9999; }
.tab-menu {
  position: absolute; width: 180px; padding: 4px;
  border: 1px solid var(--color-popover-border); border-radius: 10px;
  background: var(--color-bg-elevated); box-shadow: var(--shadow-md);
  --radius-button: 6px;
}
.tab-menu button { display: block; width: 100%; text-align: left; padding: 7px 10px; font-size: 12px; color: var(--color-text-secondary); }
.tab-menu button:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
</style>

<style scoped>
.tab-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; margin-left: auto; }
</style>
