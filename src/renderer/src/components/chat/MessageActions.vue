<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import { extractMessageText } from '@/lib/chat/message-text'

const props = defineProps<{
  content: Array<{ type: string; text?: string }>
}>()

const copied = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | null = null

const sourceText = computed(() => extractMessageText(props.content))

async function copyMessage(): Promise<void> {
  if (!sourceText.value) return
  try {
    await navigator.clipboard.writeText(sourceText.value)
    copied.value = true
    if (resetTimer) clearTimeout(resetTimer)
    resetTimer = setTimeout(() => { copied.value = false }, 1500)
  } catch (error) {
    console.error('[MessageActions] clipboard write failed:', error)
  }
}

onBeforeUnmount(() => {
  if (resetTimer) clearTimeout(resetTimer)
})
</script>

<template>
  <div class="msg-actions">
    <button
      type="button"
      class="ma-copy"
      :class="{ 'ma-copy--success': copied }"
      :aria-label="copied ? '已复制' : '复制消息'"
      :title="copied ? '已复制' : '复制消息'"
      @click="copyMessage"
    >
      <Check v-if="copied" class="ma-icon" :stroke-width="2" aria-hidden="true" />
      <Copy v-else class="ma-icon" :stroke-width="1.8" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.msg-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-fast, 120ms) var(--ease-out, ease);
}
.msg-actions:focus-within {
  opacity: 1;
  pointer-events: auto;
}
.ma-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-elevated);
  color: var(--color-text-tertiary);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition:
    background-color var(--duration-fast, 120ms) var(--ease-out, ease),
    border-color var(--duration-fast, 120ms) var(--ease-out, ease),
    color var(--duration-fast, 120ms) var(--ease-out, ease);
}
.ma-copy:hover {
  border-color: var(--color-accent-border);
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.ma-copy:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-info-subtle);
}
.ma-copy--success {
  border-color: color-mix(in srgb, var(--color-success) 30%, transparent);
  color: var(--color-success);
}
.ma-icon {
  width: 12px;
  height: 12px;
  flex: none;
}
</style>
