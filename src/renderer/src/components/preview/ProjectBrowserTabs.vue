<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { reconcileTabOrder, moveWorkbenchTab, tabsToClose } from '@/lib/preview/workbench-tabs'
import type { BrowserScope } from '@shared/project-browser'
import { useProjectBrowserStore } from '@/stores/project-browser'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  scope: BrowserScope
  files: { id: string; title: string; dirty: boolean }[]
  activeFile: string | null
  closeFile: (id: string) => boolean
}>()
const emit = defineEmits<{ selectFile: [id: string]; selectOverview: [] }>()
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
    <button class="overview" type="button" title="项目预览" :class="{ active: !activeKey }" @click="browser.activate(scope, null); emit('selectOverview')">⌂</button>
    <div ref="strip" class="tab-strip" role="tablist" aria-label="文件与网页标签">
      <div v-for="tab in tabs" :key="tab.key" class="tab" :class="{ active: activeKey === tab.key }" draggable="true" @dragstart="dragging = tab.key" @dragend="dragging = null" @dragover.prevent @drop.prevent="drop(tab.key)" @contextmenu.prevent="context($event, tab.key)">
        <button type="button" role="tab" :aria-selected="activeKey === tab.key" :title="tab.id" class="tab-label" @click="select(tab.key)">{{ tab.web ? '◎' : '▤' }} {{ tab.title }}</button>
        <span v-if="tab.dirty" title="未保存" class="dirty">●</span>
        <button type="button" class="close" :aria-label="`关闭 ${tab.title}`" @click="close(tab.key)">×</button>
      </div>
    </div>
    <button class="new-tab" type="button" title="新建网页标签页" aria-label="新建网页标签页" :disabled="opening" @click="add">＋</button>
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
.workbench-tabs { display: flex; align-items: center; min-width: 0; width: 100%; height: 38px; gap: 3px; padding: 3px 8px; background: var(--color-bg-panel); }
.tab-strip { display: flex; min-width: 0; flex: 0 1 auto; overflow-x: auto; gap: 3px; scrollbar-width: thin; }
.tab { display: flex; flex: 1 1 190px; min-width: 76px; max-width: 220px; height: 30px; align-items: center; border-radius: 8px; color: var(--color-text-muted); padding: 0 6px; gap: 3px; }
.tab { border: 0; transition: background 120ms, color 120ms; }
.tab.active, .tab.active:hover, .overview.active {
  background: var(--color-tab-selected);
  color: var(--color-text-primary);
  box-shadow: none;
}
.tab.active .tab-label { font-weight: 650; }
.tab:hover, .new-tab:hover, .overview:hover { background: var(--color-button-outline-hover); }
.tab-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; text-align: left; }
.close { flex: none; width: 20px; border-radius: 4px; }
.close:hover { background: var(--color-button-outline-hover); }
.new-tab, .overview { flex: 0 0 28px; height: 28px; border-radius: 5px; font-size: 19px; }
.dirty { font-size: 8px; color: var(--color-accent); }
.tab-menu-mask { position: fixed; inset: 0; z-index: 9999; }
.tab-menu { position: absolute; width: 180px; padding: 4px; border-radius: 7px; border: 1px solid var(--color-border-border); background: var(--color-bg-panel); box-shadow: 0 6px 24px #0002; }
.tab-menu button { display: block; width: 100%; text-align: left; padding: 7px 10px; font-size: 12px; border-radius: 4px; }
.tab-menu button:hover { background: var(--color-button-outline-hover); }
</style>
