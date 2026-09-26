<script setup lang="ts">
// 工具调用折叠卡片：显示 tool_use + 配对 tool_result
// 展开后按工具类型渲染人类可读的分段。
// 状态指示用 CSS spinner / 状态圆点替代 emoji，更精致。
import { ref, computed } from 'vue'
import { formatClaudeToolCall } from '@shared/claude-display'

const props = defineProps<{
  name: string
  input: unknown
  result?: { content: unknown; isError?: boolean }
  status: 'pending' | 'done' | 'error'
}>()

const collapsed = ref(true)

const formatted = computed(() => formatClaudeToolCall(props.name, props.input, props.result, props.status))
</script>

<template>
  <div class="tool-call" :class="{ 'tool-call--error': status === 'error', 'tool-call--pending': status === 'pending' }">
    <button class="tc-header" type="button" @click="collapsed = !collapsed">
      <span class="tc-status">
        <!-- pending: CSS spinner 旋转环；done/error: 实心圆点带 ✓/✕ -->
        <span v-if="status === 'pending'" class="chat-spinner" />
        <span v-else class="chat-status-dot" :class="status === 'error' ? 'chat-status-dot--error' : 'chat-status-dot--ok'" />
      </span>
      <span class="tc-main">
        <span class="tc-name-row">
          <span class="tc-name">{{ formatted.title }}</span>
        </span>
        <span class="tc-summary-row">
          <span class="tc-summary">{{ formatted.summary }}</span>
        </span>
      </span>
      <span class="tc-toggle" :class="{ 'tc-toggle--open': !collapsed }">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M4 2.5 8 6l-4 3.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </button>
    <div v-if="formatted.needsApproval" class="tc-approval">
      <div class="tc-approval-title">⚠ 需要人工授权</div>
      <div class="tc-approval-hint">{{ formatted.approvalHint }}</div>
    </div>
    <transition name="tc-collapse">
      <div v-show="!collapsed" class="tc-body">
        <div v-if="formatted.resultSummary" class="tc-result">{{ formatted.resultSummary }}</div>
        <div
          v-for="(section, i) in formatted.sections"
          :key="i"
          class="tc-section"
        >
          <div class="tc-label">{{ section.label }}</div>
          <pre
            v-if="section.kind !== 'plain'"
            class="tc-pre"
            :class="{ 'tc-pre--error': result?.isError }"
          >{{ section.body }}</pre>
          <div v-else class="tc-plain">{{ section.body }}</div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.tool-call {
  border: 1px solid var(--color-border-border/60);
  border-radius: var(--radius-lg);
  margin: 5px 0;
  font-size: 13px;
  background: var(--color-bg-panel);
  transition: border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}
/* pending 时用 accent 色边框（半透明混合，不刺眼）提示正在执行 */
.tool-call--pending {
  border-color: color-mix(in srgb, var(--color-accent) 35%, var(--color-border-border/60));
}
.tool-call--error {
  border-color: color-mix(in srgb, var(--color-error) 35%, var(--color-border-border/60));
}
.tool-call:hover {
  box-shadow: var(--shadow-sm);
}
.tc-header {
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
.tc-header:hover { background: var(--color-bg-subtle); }
.tc-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.tc-main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 3px;
}
.tc-name-row,
.tc-summary-row {
  display: flex;
  min-width: 0;
  align-items: center;
}
.tc-name {
  font-weight: 600;
  font-size: 12.5px;
  color: var(--color-text-primary);
  white-space: nowrap;
}
.tc-summary {
  min-width: 0;
  max-width: 100%;
  color: var(--color-text-tertiary);
  font-size: 11.5px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tc-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--color-text-muted);
  transition: transform var(--duration-fast) var(--ease-out);
}
.tc-toggle svg { width: 10px; height: 10px; }
.tc-toggle--open { transform: rotate(90deg); }
.tc-result {
  padding: 0 11px 7px 35px;
  color: var(--color-text-secondary);
  font-size: 11.5px;
  line-height: 1.5;
}
.tc-body {
  padding: 2px 11px 9px;
  border-top: 1px solid var(--color-border-border/60);
  margin-top: 2px;
}
.tc-section { margin-top: 8px; }
.tc-section:first-child { margin-top: 6px; }
.tc-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}
.tc-pre {
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-border/60);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 360px;
  overflow-y: auto;
  margin: 0;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  color: var(--color-text-primary);
}
.tc-pre--error {
  border-color: var(--color-error);
  background: var(--color-error-subtle);
  color: var(--color-error);
}
.tc-plain {
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-text-secondary);
}
.tc-approval {
  margin: 4px 11px 7px 35px;
  padding: 8px 11px;
  background: var(--color-warning-subtle);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-md);
  font-size: 12px;
}
.tc-approval-title {
  font-weight: 600;
  color: var(--color-warning);
  margin-bottom: 3px;
}
.tc-approval-hint {
  color: var(--color-warning);
  opacity: 0.85;
  line-height: 1.5;
}

/* 折叠展开过渡 */
.tc-collapse-enter-active,
.tc-collapse-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out),
              max-height var(--duration-normal) var(--ease-out);
  overflow: hidden;
}
.tc-collapse-enter-from,
.tc-collapse-leave-to {
  opacity: 0;
  max-height: 0;
}
.tc-collapse-enter-to,
.tc-collapse-leave-from {
  opacity: 1;
  max-height: 600px;
}
</style>
