<script setup lang="ts">
// 通用文件树。深度递归用 <FileTree> 自身。
// props: nodes（DocTreeNode[]）+ activeRelPath（高亮当前选中）
// emits: select(relPath, kind='file') / copy-path(relPath, kind)

import { computed, ref } from 'vue'
import type { DocTreeNode } from '@shared/types'

const props = defineProps<{
  nodes: DocTreeNode[]
  activeRelPath?: string | null
  emptyText?: string
  copyable?: boolean
  // 内部递归用：标记是否是顶层（顶层会显示 emptyText）
  depth?: number
}>()

const emit = defineEmits<{
  (e: 'select', relPath: string, kind: 'file'): void
  (e: 'copy-path', relPath: string, kind: 'file' | 'folder'): void
}>()

const expanded = ref<Record<string, boolean>>({})
function toggle(relPath: string): void {
  expanded.value = { ...expanded.value, [relPath]: !expanded.value[relPath] }
}
function isExpanded(relPath: string): boolean {
  return expanded.value[relPath] !== false  // 默认展开
}

const isTopLevel = computed(() => (props.depth ?? 0) === 0)
</script>

<template>
  <div class="text-sm">
    <ul v-if="nodes.length > 0" class="space-y-0.5">
      <li v-for="n in nodes" :key="n.relPath">
        <template v-if="n.kind === 'folder'">
          <div class="file-tree-row">
            <button
              type="button"
              class="file-tree-node text-muted-foreground"
              @click="toggle(n.relPath)"
            >
              <span class="text-muted-foreground/70 text-xs w-3 inline-block">{{ isExpanded(n.relPath) ? '▾' : '▸' }}</span>
              <span class="text-muted-foreground/70">📁</span>
              <span class="truncate flex-1 text-left">{{ n.name }}</span>
            </button>
            <button
              v-if="copyable"
              type="button"
              class="file-tree-copy"
              title="复制路径"
              aria-label="复制路径"
              @click.stop="emit('copy-path', n.relPath, 'folder')"
            >复制</button>
          </div>
          <div v-if="isExpanded(n.relPath)" class="ml-3 border-l border-border/60 pl-2 mt-0.5">
            <FileTree
              :nodes="n.children"
              :active-rel-path="activeRelPath"
              :copyable="copyable"
              :depth="(depth ?? 0) + 1"
              @select="(rel, kind) => emit('select', rel, kind)"
              @copy-path="(rel, kind) => emit('copy-path', rel, kind)"
            />
          </div>
        </template>
        <div
          v-else
          class="file-tree-row"
          :class="{ 'is-active': activeRelPath === n.relPath }"
        >
          <button
            type="button"
            class="file-tree-node"
            :class="activeRelPath === n.relPath ? 'text-foreground font-medium' : 'text-muted-foreground'"
            @click="emit('select', n.relPath, 'file')"
          >
            <span class="w-3" />
            <span class="text-muted-foreground/70">📄</span>
            <span class="truncate flex-1 text-left">{{ n.name }}</span>
          </button>
          <button
            v-if="copyable"
            type="button"
            class="file-tree-copy"
            title="复制路径"
            aria-label="复制路径"
            @click.stop="emit('copy-path', n.relPath, 'file')"
          >复制</button>
        </div>
      </li>
    </ul>
    <div v-else-if="isTopLevel" class="text-xs text-muted-foreground px-2 py-2">
      {{ emptyText ?? '空目录' }}
    </div>
  </div>
</template>

<style scoped>
.file-tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 6px;
}

.file-tree-row:hover,
.file-tree-row.is-active {
  background: var(--color-bg-elevated);
}

.file-tree-node {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  padding: 4px 8px;
  text-align: left;
}

.file-tree-copy {
  flex: 0 0 auto;
  margin-right: 4px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  padding: 2px 6px;
  color: var(--color-accent-pressed);
  font-size: 11px;
  opacity: 0.48;
}

.file-tree-row:hover .file-tree-copy,
.file-tree-copy:focus-visible {
  opacity: 1;
}

.file-tree-copy:hover {
  background: var(--color-accent-light);
}
</style>
