<script setup lang="ts">
// 可复用「用外部工具打开」分体按钮：主键＝用默认工具打开 relPath（缺省＝项目根），
// 右侧箭头展开菜单选 Cursor/Finder/Codex/VS Code 并可设默认。
// 项目编辑页与项目卡片共用，目录由 relPath 决定；不再提供工作台级入口。
// 视觉对齐 docs/references/peeka-shell 的 shell-tabbar__tool-menu。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import { call } from '@/lib/api'
import {
  DEFAULT_PROJECT_TOOL_KIND,
  buildProjectToolMenuItems,
  findProjectToolMenuItem,
  normalizeProjectToolKind,
  type ProjectToolKind,
  type ProjectToolMenuItem
} from '@/lib/project-tool-menu'
import appCodexIcon from '@/assets/project-tools/app-codex.png'
import appCursorIcon from '@/assets/project-tools/app-cursor.png'
import appFinderIcon from '@/assets/project-tools/app-finder.png'
import appVscodeIcon from '@/assets/project-tools/app-vscode.png'

const props = withDefaults(defineProps<{
  workspaceId: string
  relPath?: string
  size?: 'sm' | 'xs'
}>(), { size: 'sm' })

const ui = useUiStore()
const PROJECT_TOOL_DEFAULT_KEY = 'workspace.defaultProjectTool'
const menuOpen = ref(false)
const menuEl = ref<HTMLElement>()
const opening = ref<ProjectToolKind | null>(null)
const defaultKind = ref<ProjectToolKind>(DEFAULT_PROJECT_TOOL_KIND)

const items = computed(() => buildProjectToolMenuItems(null))
const defaultItem = computed(() => findProjectToolMenuItem(items.value, defaultKind.value))

const toolIcons: Record<ProjectToolKind, string> = {
  cursor: appCursorIcon,
  codex: appCodexIcon,
  finder: appFinderIcon,
  code: appVscodeIcon,
}

onMounted(() => {
  const stored = normalizeProjectToolKind(window.localStorage.getItem(PROJECT_TOOL_DEFAULT_KEY))
  if (stored) defaultKind.value = stored
  document.addEventListener('click', closeOnOutsideClick)
})
onBeforeUnmount(() => document.removeEventListener('click', closeOnOutsideClick))

async function open(item: ProjectToolMenuItem, options: { makeDefault?: boolean } = {}): Promise<void> {
  if (!props.workspaceId || opening.value) return
  if (options.makeDefault) setDefault(item.kind)
  menuOpen.value = false
  opening.value = item.kind
  const run = () => call('system.openProjectTool', { workspaceId: props.workspaceId, kind: item.kind, relativePath: props.relPath })
  const r = await ui.withIdeLaunchFeedback(item.launchLabel, run).finally(() => { opening.value = null })
  if (!r.ok) { ui.showToast('error', `打开失败：${r.message}`, 4500); return }
  if (r.data.message) { ui.showToast('info', r.data.message, 6000); return }
  ui.showToast('success', openedMessage(item.kind), 1800)
}

async function openDefault(): Promise<void> {
  if (defaultItem.value) await open(defaultItem.value)
}

function setDefault(kind: ProjectToolKind): void {
  defaultKind.value = kind
  window.localStorage.setItem(PROJECT_TOOL_DEFAULT_KEY, kind)
}

function toggleMenu(): void {
  if (opening.value) return
  menuOpen.value = !menuOpen.value
}

function closeOnOutsideClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Node)) return
  if (menuEl.value?.contains(target)) return
  menuOpen.value = false
}

function openedMessage(kind: ProjectToolKind): string {
  if (kind === 'finder') return '已在 Finder 中打开'
  if (kind === 'cursor') return '正在打开 Cursor'
  if (kind === 'codex') return '已复制路径'
  return '正在打开 VS Code'
}

const isCompact = computed(() => props.size === 'xs')
</script>

<template>
  <div
    ref="menuEl"
    class="open-with-menu"
    :class="{ 'open-with-menu--compact': isCompact }"
    data-no-drag
  >
    <button
      type="button"
      class="open-with-menu__tool-btn open-with-menu__tool-btn--active"
      :disabled="!!opening || !defaultItem"
      :aria-label="defaultItem?.label ?? '打开'"
      :aria-pressed="true"
      :title="defaultItem ? `默认用 ${defaultItem.label} 打开` : '打开'"
      @click.stop="openDefault"
    >
      <span class="open-with-menu__tool-btn-icon" aria-hidden="true">
        <img
          v-if="defaultItem"
          class="open-with-menu__tool-app-icon"
          :src="toolIcons[defaultItem.kind]"
          alt=""
        >
        <span
          v-if="opening"
          class="open-with-menu__tool-spinner"
          aria-hidden="true"
        />
      </span>
    </button>
    <button
      type="button"
      class="open-with-menu__tool-chevron"
      :disabled="!!opening"
      aria-label="Tool options"
      :aria-expanded="menuOpen"
      aria-haspopup="menu"
      title="选择打开方式"
      @click.stop="toggleMenu"
    >
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 4.5l3 3 3-3" />
      </svg>
    </button>

    <div
      v-if="menuOpen"
      class="open-with-menu__dropdown"
      role="menu"
      aria-label="Open with"
    >
      <div class="open-with-menu__dropdown-header">Open with</div>
      <div class="open-with-menu__dropdown-list" role="group" aria-label="Open with">
        <button
          v-for="item in items"
          :key="item.kind"
          type="button"
          class="open-with-menu__dropdown-item"
          :class="{ 'open-with-menu__dropdown-item--active': item.kind === defaultKind }"
          role="menuitemradio"
          :aria-checked="item.kind === defaultKind"
          :disabled="!!opening"
          @click.stop="open(item, { makeDefault: true })"
        >
          <img class="open-with-menu__dropdown-icon" :src="toolIcons[item.kind]" alt="" aria-hidden="true">
          <span class="open-with-menu__dropdown-label">{{ item.label }}</span>
          <span
            v-if="opening === item.kind"
            class="open-with-menu__dropdown-spinner"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.open-with-menu {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.open-with-menu__tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background 180ms cubic-bezier(0.25, 0.1, 0.25, 1),
    opacity 180ms cubic-bezier(0.25, 0.1, 0.25, 1);
}

.open-with-menu--compact .open-with-menu__tool-btn {
  width: 22px;
  height: 24px;
}

.open-with-menu__tool-btn:hover,
.open-with-menu__tool-btn:focus-visible {
  background: var(--color-bg-hover);
  outline: none;
}

.open-with-menu__tool-btn:disabled {
  cursor: wait;
  opacity: 0.55;
}

.open-with-menu__tool-btn-icon {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.open-with-menu__tool-app-icon {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  object-fit: cover;
}

.open-with-menu--compact .open-with-menu__tool-app-icon {
  width: 18px;
  height: 18px;
}

.open-with-menu__tool-spinner,
.open-with-menu__dropdown-spinner {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--color-text-muted) 30%, transparent);
  border-top-color: var(--color-accent);
  animation: open-with-menu-spin 0.8s linear infinite;
}

.open-with-menu__dropdown-spinner {
  position: static;
  margin-left: auto;
}

.open-with-menu__tool-btn:not(.open-with-menu__tool-btn--active) {
  opacity: 0.55;
}

.open-with-menu__tool-chevron {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 180ms cubic-bezier(0.25, 0.1, 0.25, 1),
    color 180ms cubic-bezier(0.25, 0.1, 0.25, 1);
}

.open-with-menu--compact .open-with-menu__tool-chevron {
  height: 24px;
}

.open-with-menu__tool-chevron:hover,
.open-with-menu__tool-chevron[aria-expanded="true"] {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.open-with-menu__tool-chevron:disabled {
  cursor: wait;
  opacity: 0.55;
}

.open-with-menu__tool-chevron svg {
  width: 12px;
  height: 12px;
}

.open-with-menu__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 50;
  display: flex;
  width: 220px;
  max-width: calc(100vw - 32px);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-popover-border);
  border-radius: 12px;
  background: var(--color-bg-elevated);
  padding: 8px 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}

.open-with-menu__dropdown-header {
  flex: 0 0 auto;
  padding: 4px 14px 8px;
  color: var(--color-text-tertiary);
  font-size: 12px;
  font-weight: 400;
}

.open-with-menu__dropdown-list {
  display: flex;
  flex-direction: column;
}

.open-with-menu__dropdown-item {
  display: flex;
  width: 100%;
  min-height: 40px;
  align-items: center;
  gap: 10px;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 8px 14px;
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 180ms cubic-bezier(0.25, 0.1, 0.25, 1);
}

.open-with-menu__dropdown-item:hover,
.open-with-menu__dropdown-item:focus-visible {
  background: var(--color-bg-hover);
  outline: none;
}

.open-with-menu__dropdown-item:disabled {
  cursor: wait;
  opacity: 0.72;
}

.open-with-menu__dropdown-icon {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  object-fit: cover;
}

.open-with-menu__dropdown-label {
  min-width: 0;
  line-height: 1.3;
}

.open-with-menu__dropdown-item--active {
  color: var(--color-accent);
}

@keyframes open-with-menu-spin {
  to { transform: rotate(360deg); }
}
</style>
