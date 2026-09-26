<script setup lang="ts">
import { ref } from 'vue'
import {
  mentionItemPath,
  type MentionItem,
  type MentionTreeNode
} from '@/lib/chat/mention-resources'

const props = withDefaults(defineProps<{
  nodes: MentionTreeNode[]
  depth?: number
  queryActive?: boolean
  selectedPaths?: string[]
}>(), {
  depth: 0,
  queryActive: false,
  selectedPaths: () => []
})

const emit = defineEmits<{
  select: [item: MentionItem]
}>()

const expanded = ref<Record<string, boolean>>({})

function hasChildren(node: MentionTreeNode): boolean {
  return (node.children?.length ?? 0) > 0
}

function isExpanded(node: MentionTreeNode): boolean {
  if (props.queryActive) return true
  return expanded.value[node.key] ?? props.depth === 0
}

function isChecked(node: MentionTreeNode): boolean {
  return !!node.item && props.selectedPaths.includes(mentionItemPath(node.item))
}

function toggle(node: MentionTreeNode): void {
  if (!hasChildren(node)) return
  expanded.value = { ...expanded.value, [node.key]: !isExpanded(node) }
}

function activate(node: MentionTreeNode): void {
  if (hasChildren(node)) {
    toggle(node)
    return
  }
  if (node.item) emit('select', node.item)
}

function toggleSelect(node: MentionTreeNode): void {
  if (node.item) emit('select', node.item)
}
</script>

<template>
  <ul class="mention-tree" :class="{ 'mention-tree--nested': depth > 0 }">
    <li v-for="node in nodes" :key="node.key">
      <div
        class="mention-tree__row"
        :class="{
          'is-selectable': !!node.item,
          'is-checked': isChecked(node)
        }"
      >
        <button
          v-if="hasChildren(node)"
          type="button"
          class="mention-tree__toggle"
          :aria-label="isExpanded(node) ? `收起 ${node.label}` : `展开 ${node.label}`"
          :aria-expanded="isExpanded(node)"
          @mousedown.prevent.stop="toggle(node)"
        >{{ isExpanded(node) ? '▾' : '▸' }}</button>
        <span v-else class="mention-tree__toggle mention-tree__toggle--empty" />
        <button
          v-if="node.item"
          type="button"
          class="mention-tree__check"
          role="checkbox"
          :aria-checked="isChecked(node)"
          :aria-label="`选择 ${node.label}`"
          @mousedown.prevent.stop="toggleSelect(node)"
        >
          <span v-if="isChecked(node)">✓</span>
        </button>
        <span v-else class="mention-tree__check mention-tree__check--empty" />
        <button
          type="button"
          class="mention-tree__main"
          :title="node.detail || node.label"
          @mousedown.prevent="activate(node)"
        >
          <span class="mention-tree__icon" aria-hidden="true">
            {{ node.icon === 'folder' ? '📁' : node.icon === 'component' ? '◇' : node.icon === 'effect' ? '✦' : '📄' }}
          </span>
          <span class="mention-tree__copy">
            <span class="mention-tree__label">{{ node.label }}</span>
            <span v-if="node.detail" class="mention-tree__detail">{{ node.detail }}</span>
          </span>
        </button>
      </div>
      <MentionResourceTree
        v-if="hasChildren(node) && isExpanded(node)"
        :nodes="node.children ?? []"
        :depth="depth + 1"
        :query-active="queryActive"
        :selected-paths="selectedPaths"
        @select="emit('select', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
.mention-tree {
  margin: 0;
  padding: 0;
  list-style: none;
}
.mention-tree--nested {
  margin-left: 12px;
  border-left: 1px solid var(--color-border-subtle);
  padding-left: 6px;
}
.mention-tree__row {
  display: flex;
  min-width: 0;
  align-items: center;
  border-radius: 7px;
}
.mention-tree__row:hover,
.mention-tree__row.is-selectable:focus-within {
  background: var(--color-bg-hover);
}
.mention-tree__row.is-checked {
  background: var(--color-accent-subtle);
}
.mention-tree__toggle {
  width: 22px;
  height: 28px;
  flex: 0 0 22px;
  border: 0;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
}
.mention-tree__toggle--empty { display: inline-block; }
.mention-tree__check {
  display: grid;
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  place-content: center;
  border: 1px solid var(--color-border-strong);
  border-radius: 3px;
  background: var(--color-bg-panel);
  color: var(--color-accent-pressed);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}
.mention-tree__check[aria-checked="true"] {
  border-color: var(--color-accent);
  background: var(--color-accent-subtle);
}
.mention-tree__check--empty {
  visibility: hidden;
  pointer-events: none;
}
.mention-tree__main {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  padding: 5px 7px 5px 6px;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
}
.mention-tree__icon { flex: 0 0 auto; color: var(--color-accent); font-size: 12px; }
.mention-tree__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1px; }
.mention-tree__label {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mention-tree__detail {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
