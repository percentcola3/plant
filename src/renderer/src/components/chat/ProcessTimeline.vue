<script setup lang="ts">
// ProcessTimeline — assistant 组的过程时间线（ZCode/Claude 风格）
// 左侧垂直轨道（圆点 + 连线），思考收敛为一个胶囊行，工具调用是轨道上的单行节点。
// 收起时保留紧凑检索记录；展开/运行中：工具节点逐行可见，
// 点击行展开 ToolCall 详情。结论正文与交互问答卡不进时间线。
import { ref, computed, watch, onUnmounted } from 'vue'
import { formatClaudeToolCall } from '@shared/claude-display'
import { isRetrievalEntry, summarizeGroup, type ToolCallPair, type ToolGroupEntry } from '@/lib/chat/tool-groups'
import ToolCall from './ToolCall.vue'

const props = defineProps<{
  /** 组内全部思考文本（thinking + 旁白），按时间顺序 */
  thinkingTexts: string[]
  /** 组内是否还有旁白在流式输出 */
  thinkingStreaming: boolean
  /** 组内非交互类工具调用（已分组） */
  toolEntries: ToolGroupEntry[]
  /** 任务运行中：工具节点保持可见（实时进度），结束后自动收起 */
  running: boolean
  /** 用户展开态（受控，toggle 由父组件处理） */
  expanded: boolean
}>()

const emit = defineEmits<{ toggle: [] }>()

const hasThinking = computed(() => props.thinkingTexts.some(t => t.trim()))

// 思考计时：只在真正观察到流式思考后才显示秒数；历史回放（从未 streaming）
// 不编造时长，显示「思考过程」。
const elapsedSec = ref(0)
const sawStreaming = ref(props.thinkingStreaming)
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

watch(() => props.thinkingStreaming, (isStreaming) => {
  if (isStreaming) {
    sawStreaming.value = true
    startTimer()
  } else {
    elapsedSec.value = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
    stopTimer()
  }
}, { immediate: true })

onUnmounted(stopTimer)

const pillLabel = computed(() => {
  if (props.thinkingStreaming) return '思考中'
  if (!hasThinking.value) return '执行过程'
  return sawStreaming.value ? `已思考 ${Math.max(1, elapsedSec.value)}s` : '思考过程'
})

const trimmedText = computed(() => props.thinkingTexts.map(t => t.trim()).filter(Boolean).join('\n\n'))

// 运行中实时展示；结束后仍保留检索节点，便于确认回答是否使用了检索。
const showToolNodes = computed(() => props.running || props.expanded)
const visibleToolEntries = computed(() => props.toolEntries
  .map((entry, index) => ({ entry, index }))
  .filter(({ entry }) => showToolNodes.value || isRetrievalEntry(entry)))

// 每个工具节点自己的展开态（看详情）
const openNodes = ref(new Set<number>())
function toggleNode(index: number): void {
  const next = new Set(openNodes.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  openNodes.value = next
}

function entryPairs(entry: ToolGroupEntry): ToolCallPair[] {
  return entry.kind === 'group' ? entry.pairs : [entry.pair]
}

function rowTitle(entry: ToolGroupEntry): string {
  if (entry.kind === 'group') return summarizeGroup(entry.family, entry.pairs).label
  return formatClaudeToolCall(entry.pair.name, entry.pair.input, entry.pair.result, entry.pair.status).title
}

function rowSummary(entry: ToolGroupEntry): string {
  if (entry.kind === 'group') return summarizeGroup(entry.family, entry.pairs).statusLabel
  const formatted = formatClaudeToolCall(entry.pair.name, entry.pair.input, entry.pair.result, entry.pair.status)
  return isRetrievalEntry(entry) ? `${formatted.resultSummary} · ${formatted.summary}` : formatted.summary
}

function rowStatus(entry: ToolGroupEntry): ToolCallPair['status'] {
  if (entry.kind === 'group') return summarizeGroup(entry.family, entry.pairs).status
  return entry.pair.status
}
</script>

<template>
  <div class="ptimeline" :class="{ 'ptimeline--active': thinkingStreaming || running }">
    <!-- 思考胶囊节点 -->
    <div class="pt-node pt-node--thinking">
      <span class="pt-dot" :class="{ 'pt-dot--live': thinkingStreaming }">
        <span v-if="thinkingStreaming" class="chat-spinner" />
      </span>
      <button class="pt-pill" type="button" @click="emit('toggle')">
        <span :class="{ 'chat-shimmer': thinkingStreaming }">{{ pillLabel }}</span>
        <span class="pt-chevron" :class="{ 'pt-chevron--open': expanded }">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 2.5 8 6l-4 3.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </button>
    </div>
    <transition name="pt-collapse">
      <pre v-if="expanded && trimmedText" class="pt-thinking-body">{{ trimmedText }}</pre>
    </transition>

    <!-- 检索记录在结束后仍可见，点击查看原始结果。 -->
    <template v-if="visibleToolEntries.length">
      <div
        v-for="{ entry, index: i } in visibleToolEntries"
        :key="entry.kind === 'group' ? `g${i}` : entry.pair.toolUseId"
        class="pt-node pt-node--tool"
      >
        <span class="pt-dot" :class="`pt-dot--${rowStatus(entry)}`">
          <span v-if="rowStatus(entry) === 'pending'" class="chat-spinner" />
        </span>
        <button class="pt-row" type="button" :title="rowSummary(entry)" :aria-expanded="openNodes.has(i)" @click="toggleNode(i)">
          <span class="pt-row-title">{{ rowTitle(entry) }}</span>
          <span class="pt-row-summary">{{ rowSummary(entry) }}</span>
          <span class="pt-chevron" :class="{ 'pt-chevron--open': openNodes.has(i) }">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M4 2.5 8 6l-4 3.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
        </button>
        <div v-if="openNodes.has(i)" class="pt-detail">
          <ToolCall
            v-for="pair in entryPairs(entry)"
            :key="pair.toolUseId"
            :name="pair.name"
            :input="pair.input"
            :result="pair.result"
            :status="pair.status"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ptimeline {
  position: relative;
  margin: 2px 0 6px;
  padding-left: 4px;
  font-size: 12px;
}
/* 垂直轨道 */
.ptimeline::before {
  content: '';
  position: absolute;
  left: 9px;
  top: 9px;
  bottom: 9px;
  width: 1px;
  background: var(--color-border-border/60);
}
.pt-node {
  position: relative;
  display: flex;
  align-items: flex-start;
  padding-left: 16px;
}
.pt-node + .pt-node,
.pt-thinking-body + .pt-node { margin-top: 6px; }
.pt-dot {
  position: absolute;
  left: 0;
  top: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  border-radius: 999px;
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border-border/60);
  color: var(--color-text-muted);
}
.pt-dot--live { border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border-border/60)); }
.pt-dot--error { border-color: color-mix(in srgb, var(--color-error) 55%, var(--color-border-border/60)); }
.pt-dot--done { background: color-mix(in srgb, var(--color-success) 14%, var(--color-bg-panel)); border-color: color-mix(in srgb, var(--color-success) 40%, transparent); }

/* 思考胶囊 */
.pt-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px 2px 10px;
  border: 1px solid var(--color-border-border/60);
  border-radius: 999px;
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}
.pt-pill:hover { background: var(--color-bg-hover); }
.ptimeline--active .pt-pill {
  border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-border-border/60));
}
.pt-thinking-body {
  margin: 4px 0 0 16px;
  padding: 6px 10px 8px;
  border-radius: var(--radius-md);
  background: var(--color-bg-base);
  color: var(--color-text-muted);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 工具节点单行 */
.pt-row {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 7px;
  padding: 1px 4px;
  margin-left: -4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.pt-row:hover { background: var(--color-bg-subtle); }
.pt-row-title {
  flex: none;
  font-weight: 600;
  font-size: 11.5px;
  white-space: nowrap;
}
.pt-row-summary {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: 11px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pt-row-summary:empty { display: none; }
.pt-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--color-text-muted);
  transition: transform var(--duration-fast) var(--ease-out);
}
.pt-chevron svg { width: 9px; height: 9px; }
.pt-chevron--open { transform: rotate(90deg); }
.pt-detail { flex: 1; min-width: 0; margin: 4px 0 2px; }

.pt-collapse-enter-active, .pt-collapse-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out),
              max-height var(--duration-normal) var(--ease-out);
  overflow: hidden;
}
.pt-collapse-enter-from, .pt-collapse-leave-to { opacity: 0; max-height: 0; }
.pt-collapse-enter-to, .pt-collapse-leave-from { opacity: 1; max-height: 800px; }
</style>
