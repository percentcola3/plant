<script setup lang="ts">
// ToolGroup — 同 family 工具的折叠卡片
// 一个 turn 改了 3 个文件时，3 张 ToolCall 卡会显得碎长；合并成一张可展开的 group 卡。
// 折叠态：summary 行 "编辑 ×3 · 已完成"；展开后是各个 ToolCall。
import { ref, computed } from 'vue'
import ToolCall from './ToolCall.vue'
import { summarizeGroup, type ToolCallPair } from '@/lib/chat/tool-groups'

const props = defineProps<{
  family: string
  pairs: ToolCallPair[]
}>()

const expanded = ref(false)

const summary = computed(() => summarizeGroup(props.family, props.pairs))
</script>

<template>
  <div class="tool-group" :class="[`tool-group--${summary.status}`]">
    <button class="tg-header" type="button" @click="expanded = !expanded">
      <span class="tg-status">
        <span v-if="summary.status === 'pending'" class="chat-spinner" />
        <span v-else class="chat-status-dot" :class="summary.status === 'error' ? 'chat-status-dot--error' : 'chat-status-dot--ok'" />
      </span>
      <span class="tg-main">
        <span class="tg-title-row">
          <span class="tg-label">{{ summary.label }}</span>
          <span class="tg-status-label">{{ summary.statusLabel }}</span>
        </span>
        <!-- 文件名预览：截断展示涉及的前几个文件，让用户一眼看到改了啥 -->
        <span class="tg-detail-row">
          <span class="tg-files">
            <span
              v-for="(p, i) in pairs.slice(0, 3)"
              :key="p.toolUseId"
              class="tg-file"
            >{{ fileName(p) }}<span v-if="i < Math.min(pairs.length, 3) - 1" class="tg-file-sep">,</span></span>
            <span v-if="pairs.length > 3" class="tg-file-more">+{{ pairs.length - 3 }}</span>
          </span>
        </span>
      </span>
      <span class="tg-toggle" :class="{ 'tg-toggle--open': expanded }">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M4 2.5 8 6l-4 3.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </button>
    <transition name="tg-collapse">
      <div v-show="expanded" class="tg-body">
        <ToolCall
          v-for="p in pairs"
          :key="p.toolUseId"
          :name="p.name"
          :input="p.input"
          :result="p.result"
          :status="p.status"
        />
      </div>
    </transition>
  </div>
</template>

<script lang="ts">
// 从 input 里摘取文件名（file_path / path 的 basename），用于 group 预览。
// 失败时返回工具名 fallback。
function fileName(p: { name: string; input: unknown }): string {
  const inp = p.input as Record<string, unknown> | null
  const raw = (inp?.file_path ?? inp?.path ?? inp?.pattern) as string | undefined
  if (!raw || typeof raw !== 'string') return p.name
  return raw.split('/').pop() ?? raw
}
export default { name: 'ToolGroup' }
</script>

<style scoped>
.tool-group {
  border: 1px solid var(--color-border-border/60);
  border-radius: var(--radius-lg);
  margin: 5px 0;
  background: var(--color-bg-panel);
  transition: border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}
.tool-group--pending {
  border-color: color-mix(in srgb, var(--color-accent) 35%, var(--color-border-border/60));
}
.tool-group--error {
  border-color: color-mix(in srgb, var(--color-error) 35%, var(--color-border-border/60));
}
.tool-group:hover { box-shadow: var(--shadow-sm); }
.tg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 11px;
  border: 0;
  background: transparent;
  cursor: pointer;
  user-select: none;
  text-align: left;
  border-radius: var(--radius-lg);
}
.tg-header:hover { background: var(--color-bg-subtle); }
.tg-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.tg-label {
  font-weight: 600;
  font-size: 12.5px;
  color: var(--color-text-primary);
  white-space: nowrap;
}
.tg-status-label {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
}
.tg-main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 3px;
}
.tg-title-row,
.tg-detail-row {
  display: flex;
  min-width: 0;
  align-items: center;
}
.tg-title-row {
  gap: 8px;
}
.tg-files {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 3px;
  overflow: hidden;
  justify-content: flex-start;
}
.tg-file {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
}
.tg-file-sep {
  margin-right: 2px;
  color: var(--color-text-muted);
  opacity: 0.5;
}
.tg-file-more {
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-weight: 600;
  margin-left: 2px;
}
.tg-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--color-text-muted);
  transition: transform var(--duration-fast) var(--ease-out);
  flex-shrink: 0;
}
.tg-toggle svg { width: 10px; height: 10px; }
.tg-toggle--open { transform: rotate(90deg); }
.tg-body {
  padding: 0 11px 9px;
  border-top: 1px solid var(--color-border-border/60);
  margin-top: 2px;
}
/* group 内的 ToolCall 去掉外边距和边框，融入 group */
.tg-body :deep(.tool-call) {
  margin: 4px 0 0;
  border: 0;
  background: transparent;
}
.tg-body :deep(.tool-call:hover) {
  box-shadow: none;
  background: var(--color-bg-subtle);
}

.tg-collapse-enter-active,
.tg-collapse-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out),
              max-height var(--duration-normal) var(--ease-out);
  overflow: hidden;
}
.tg-collapse-enter-from,
.tg-collapse-leave-to {
  opacity: 0;
  max-height: 0;
}
.tg-collapse-enter-to,
.tg-collapse-leave-from {
  opacity: 1;
  max-height: 2000px;
}
</style>
