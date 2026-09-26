<script setup lang="ts">
// 助手推理过程折叠块：默认收起，点击展开看 thinking 文本。
// streaming 时 header 显示 shimmer "思考中..."，结束后显示"已深度思考 Ns"。
// 秒数客户端测（thinking 事件不带服务端时间戳），streaming=false 时冻结最终值。
// 任务结束后收起态降级为无边框脚注行（--quiet），思考文本不再露出，
// 对话流里只突出最终结论；点开仍能回看完整思考过程。
//
// expanded prop 传入时为受控模式（组级合并块用）：点击只 emit toggle，
// 展开状态由父组件统一管理（还要联动隐藏组内工具卡片）。
import { ref, computed, onUnmounted, watch } from 'vue'

const props = defineProps<{
  text: string
  /** 这个 thinking block 是否还在流式接收（通常是 message 的最后一个 block） */
  streaming?: boolean
  /** 受控展开态；不传则组件内部自管理 */
  expanded?: boolean
}>()

const emit = defineEmits<{ toggle: [] }>()

const localExpanded = ref(false)
const isControlled = computed(() => props.expanded !== undefined)
const expandedState = computed(() => (isControlled.value ? props.expanded! : localExpanded.value))
function onToggle(): void {
  if (isControlled.value) emit('toggle')
  else localExpanded.value = !localExpanded.value
}

const trimmed = computed(() => props.text.trim())

const elapsedSec = ref(0)
let intervalId: ReturnType<typeof setInterval> | null = null
const startedAt = Date.now()

function startTimer() {
  stopTimer()
  intervalId = setInterval(() => {
    elapsedSec.value = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
  }, 200)
}
function stopTimer() {
  if (intervalId !== null) { clearInterval(intervalId); intervalId = null }
}

watch(() => props.streaming, (isStreaming) => {
  if (isStreaming) startTimer()
  else {
    elapsedSec.value = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
    stopTimer()
  }
}, { immediate: true })

onUnmounted(stopTimer)

const headerLabel = computed(() => props.streaming ? '思考中' : `已深度思考 ${elapsedSec.value}s`)
</script>

<template>
  <div
    class="thinking-block"
    :class="{
      'thinking-block--open': expandedState,
      'thinking-block--active': streaming,
      'thinking-block--quiet': !streaming && !expandedState
    }"
  >
    <button class="tb-head" type="button" @click="onToggle">
      <span class="tb-icon">
        <span v-if="streaming" class="chat-spinner" />
        <span v-else class="tb-icon-static">💭</span>
      </span>
      <span class="tb-label">
        <span :class="{ 'chat-shimmer': streaming }">{{ headerLabel }}</span>
      </span>
      <span class="tb-toggle" :class="{ 'tb-toggle--open': expandedState }">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M4 2.5 8 6l-4 3.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </button>
    <transition name="tb-collapse">
      <pre v-show="expandedState && trimmed" class="tb-body">{{ trimmed }}</pre>
    </transition>
  </div>
</template>

<style scoped>
.thinking-block {
  margin: 5px 0;
  border: 1px solid var(--color-border-border/60);
  border-radius: var(--radius-lg);
  background: var(--color-bg-panel);
  font-size: 12px;
  color: var(--color-text-secondary);
  transition: border-color var(--duration-fast) var(--ease-out);
}
.thinking-block--active {
  border-color: color-mix(in srgb, var(--color-accent) 25%, var(--color-border-border/60));
}
/* 任务结束后：收起态是无边框脚注行，只留"已深度思考 Ns"入口，不占视觉重量 */
.thinking-block--quiet {
  margin: 2px 0;
  border-color: transparent;
  background: transparent;
}
.thinking-block--quiet .tb-head {
  padding: 2px 4px;
  margin-left: -4px;
}
.thinking-block--quiet .tb-label {
  font-weight: 500;
  color: var(--color-text-muted);
}
.thinking-block--quiet .tb-icon,
.thinking-block--quiet .tb-toggle {
  color: var(--color-text-muted);
  opacity: 0.75;
}
.tb-head {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 7px 11px;
  border: 0; background: transparent;
  color: inherit; font-size: inherit; text-align: left;
  cursor: pointer;
}
.tb-head:hover { background: var(--color-bg-subtle); }
.tb-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; flex-shrink: 0;
}
.tb-icon-static { font-size: 13px; line-height: 1; }
.tb-label { font-weight: 600; font-size: 12px; color: var(--color-text-secondary); white-space: nowrap; }
.tb-toggle {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; color: var(--color-text-muted);
  transition: transform var(--duration-fast) var(--ease-out); flex-shrink: 0;
}
.tb-toggle svg { width: 10px; height: 10px; }
.tb-toggle--open { transform: rotate(90deg); }
.tb-body {
  margin: 0; padding: 6px 10px 8px;
  border-top: 1px solid var(--color-border-border/60);
  background: var(--color-bg-base);
  color: var(--color-text-muted);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word;
}
.tb-collapse-enter-active, .tb-collapse-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out),
              max-height var(--duration-normal) var(--ease-out);
  overflow: hidden;
}
.tb-collapse-enter-from, .tb-collapse-leave-to { opacity: 0; max-height: 0; }
.tb-collapse-enter-to, .tb-collapse-leave-from { opacity: 1; max-height: 800px; }
</style>
