<script setup lang="ts">
// 消息内容渲染：text 中的 [:path] → chip，tool_use → ToolCall 卡片
import { computed } from 'vue'
import type { ContentBlock } from '@/stores/conversation'
import { useConversationStore } from '@/stores/conversation'
import { useWorkspacesStore } from '@/stores/workspaces'
import { usePreviewStore } from '@/stores/preview'
import { useUiStore } from '@/stores/ui'
import { call } from '@/lib/api'
import { parseClaudeInteraction, type ClaudeInteraction } from '@shared/claude-interactions'
import { sanitizeClaudeText } from '@shared/claude-display'
import { renderChatMarkdown } from '@/lib/chat/markdown-message'
import { createDefaultProductMeta } from '@/lib/preview/product-preview'
import { groupToolCalls, type ToolCallPair } from '@/lib/chat/tool-groups'
import ToolCall from './ToolCall.vue'
import ToolGroup from './ToolGroup.vue'
import ClaudeInteractionCard from './ClaudeInteractionCard.vue'
import ThinkingBlock from './ThinkingBlock.vue'

const props = defineProps<{
  content: ContentBlock[]
  sessionId: string
  interactionDisabled?: boolean
  /** 这条 message 是否还在流式输出。用于在最后一个 text block 显示打字光标。 */
  streaming?: boolean
  /** text block 是过程旁白（组内还有后续内容）：按折叠块渲染而非正文 markdown。 */
  processText?: boolean
  /** 过程块（旁白 text + thinking）已在组级合并渲染，消息内跳过，避免重复。 */
  suppressProcess?: boolean
  /** 工具命令卡归属组级过程时间线：消息内整体跳过（交互问答卡不受影响）。 */
  hideToolCalls?: boolean
}>()

const emit = defineEmits<{
  submitInteraction: [payload: { toolUseId: string; text: string }]
}>()

const conversationStore = useConversationStore()
const workspaces = useWorkspacesStore()
const previewStore = usePreviewStore()
const uiStore = useUiStore()

function renderTextBlock(text: string): string {
  return renderChatMarkdown(
    sanitizeClaudeText(text),
    path => conversationStore.resolveAlias(props.sessionId, path)
  )
}

// 点击 markdown 渲染后的交互元素：
// - [data-preview-path] 文件路径按钮 → 预览面板打开
// - [data-code] 复制按钮 → 复制代码到剪贴板
// - .chat-code-block--collapsible header 点击 → 折叠/展开
async function onMarkdownClick(e: MouseEvent): Promise<void> {
  const target = e.target as HTMLElement | null

  // 复制代码按钮
  const copyBtn = target?.closest<HTMLElement>('.chat-code-copy')
  if (copyBtn) {
    e.preventDefault()
    e.stopPropagation()
    const raw = copyBtn.dataset.code ?? ''
    // dataset 已做一次 HTML 反转义（浏览器），这里得到的是原始代码文本
    try {
      await navigator.clipboard.writeText(raw)
      copyBtn.textContent = '✓ 已复制'
      copyBtn.classList.add('chat-code-copy--done')
      setTimeout(() => {
        copyBtn.textContent = '复制'
        copyBtn.classList.remove('chat-code-copy--done')
      }, 1500)
    } catch {
      uiStore.showToast('error', '复制失败')
    }
    return
  }

  // 代码块折叠切换（点 header 区域切换，点代码本身不触发）
  const codeBlock = target?.closest<HTMLElement>('.chat-code-block--collapsible')
  const codeHeader = target?.closest<HTMLElement>('.chat-code-header')
  if (codeBlock && codeHeader) {
    e.preventDefault()
    codeBlock.classList.toggle('chat-code-block--collapsed')
    return
  }

  // 文件路径按钮
  const button = target?.closest<HTMLElement>('[data-preview-path]')
  if (!button) return
  e.preventDefault()
  e.stopPropagation()
  const relPath = button.dataset.previewPath
  const workspaceId = workspaces.activeId
  if (!relPath || !workspaceId) return

  const r = await call('preview.fileUrl', { workspaceId, relPath })
  if (!r.ok) {
    uiStore.showToast('error', `无法打开预览：${r.message}`)
    return
  }
  if (e.metaKey || e.ctrlKey) {
    // 新窗口（系统浏览器）打开
    await call('system.openExternal', { url: r.data.url })
    return
  }
  // md/mdx 走 markdown tab（PreviewPanel 内嵌 CodeMirror + 渲染）；HTML 走 product tab。
  const isMd = /\.(md|mdx|markdown)$/i.test(relPath)
  if (isMd) {
    previewStore.openTab({
      type: 'markdown',
      title: relPath.split('/').pop() ?? relPath,
      url: '',
      workspaceId,
      markdownMeta: { relPath }
    })
    return
  }
  const isHtml = /\.html?$/i.test(relPath)
  const folderRel = relPath.replace(/\/[^/]+$/, '')
  previewStore.openTab({
    type: 'product',
    title: relPath.split('/').pop() ?? relPath,
    url: r.data.url,
    workspaceId,
    productMeta: isHtml ? createDefaultProductMeta(folderRel) : undefined
  })
}

// tool_use / tool_result 配对（从 tool-groups 模块复用类型）
type InteractionPair = ToolCallPair & {
  interaction: ClaudeInteraction
}

const toolCallPairs = computed<ToolCallPair[]>(() => {
  const pairs: Map<string, ToolCallPair> = new Map()

  for (const block of props.content) {
    if (block.type === 'tool_use') {
      pairs.set(block.toolUseId, {
        toolUseId: block.toolUseId,
        name: block.name,
        input: block.input,
        status: 'pending'
      })
    }
    if (block.type === 'tool_result') {
      const pair = pairs.get(block.toolUseId)
      if (pair) {
        pair.result = { content: block.content, isError: block.isError }
        pair.status = block.isError ? 'error' : 'done'
      }
    }
  }

  return Array.from(pairs.values())
})

// 最后一个 text block 的索引：流式时给它挂打字光标。
// 从后往前找第一个 text block。
const lastTextBlockIndex = computed(() => {
  for (let i = props.content.length - 1; i >= 0; i--) {
    if (props.content[i].type === 'text') return i
  }
  return -1
})

const interactionPairs = computed<InteractionPair[]>(() => {
  return toolCallPairs.value.flatMap((pair) => {
    const interaction = parseClaudeInteraction(pair.name, pair.input)
    return interaction ? [{ ...pair, interaction }] : []
  })
})

// interaction 工具的 id 集合（ClaudeInteractionCard 渲染，不进 ToolCall/ToolGroup）
const interactionIds = computed(() => new Set(interactionPairs.value.map(p => p.toolUseId)))

// 同 family 工具分组：连续的 Edit/Read 等合并成 group 卡，避免一列碎卡。
// 过滤掉 interaction 工具（它们走 ClaudeInteractionCard）。
const groupedToolCalls = computed(() =>
  groupToolCalls(toolCallPairs.value.filter(p => !interactionIds.value.has(p.toolUseId)))
)
</script>

<template>
  <div class="msg-content">
    <template v-for="(block, i) in content" :key="i">
      <!-- text block: 过程旁白 → 折叠块（组级合并渲染时跳过）；结论正文 → 渲染 chip segments -->
      <template v-if="block.type === 'text'">
        <ThinkingBlock
          v-if="processText && !suppressProcess"
          :text="block.text"
          :streaming="streaming && i === lastTextBlockIndex"
        />
        <div
          v-else-if="!processText"
          class="mc-markdown"
          :class="{ 'stream-cursor': streaming && i === lastTextBlockIndex }"
          @click="onMarkdownClick"
          v-html="renderTextBlock(block.text)"
        />
      </template>

      <!-- thinking block（组级合并渲染时跳过） -->
      <ThinkingBlock
        v-else-if="block.type === 'thinking' && !suppressProcess"
        :text="block.text"
        :streaming="streaming && i === content.length - 1"
      />

      <!-- image block -->
      <div v-else-if="block.type === 'image'" class="mc-image">
        <img :src="`data:${block.source.mediaType};base64,${block.source.data}`" alt="图片" />
      </div>
    </template>

    <!-- tool calls（折叠卡片） -->
    <ClaudeInteractionCard
      v-for="prompt in interactionPairs"
      :key="prompt.toolUseId"
      :tool-use-id="prompt.toolUseId"
      :interaction="prompt.interaction"
      :result="prompt.result"
      :disabled="interactionDisabled"
      @submit="emit('submitInteraction', $event)"
    />

    <!-- 同 family 工具分组渲染：single → ToolCall；group → ToolGroup 折叠。
         工具命令属于思考过程，组级过程区收起时整体隐藏 -->
    <template v-if="!hideToolCalls">
      <template v-for="(entry, gi) in groupedToolCalls" :key="gi">
        <ToolGroup
          v-if="entry.kind === 'group'"
          :family="entry.family"
          :pairs="entry.pairs"
        />
        <ToolCall
          v-else
          :name="entry.pair.name"
          :input="entry.pair.input"
          :result="entry.pair.result"
          :status="entry.pair.status"
        />
      </template>
    </template>
  </div>
</template>

<style scoped>
.msg-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-primary);
  word-break: break-word;
  overflow-wrap: anywhere;
  /* 自身也是 flex 子项时同样需要允许收缩到 0，pre/table 才能被父级宽度约束 */
  min-width: 0;
  max-width: 100%;
}
.mc-markdown {
  /* markdown 容器内任何子块的最大宽度都不能超过它，pre 出滚动条而不是撑容器 */
  min-width: 0;
  max-width: 100%;
}
.mc-markdown :deep(.chat-md-chip) {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  margin: 0 2px;
  border-radius: 4px;
  border: 1px solid var(--color-success);
  background: var(--color-success-subtle);
  color: var(--color-success);
  font-weight: 600;
  font-size: 13px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  cursor: default;
  white-space: nowrap;
}
.mc-markdown :deep(.chat-md-chip--stale) {
  background: var(--color-bg-subtle);
  border-color: var(--color-border-border/60);
  color: var(--color-text-muted);
  opacity: 0.7;
}
.mc-markdown :deep(p) {
  margin: 0.45em 0;
}
.mc-markdown :deep(p:first-child),
.mc-markdown :deep(h1:first-child),
.mc-markdown :deep(h2:first-child),
.mc-markdown :deep(h3:first-child) {
  margin-top: 0;
}
.mc-markdown :deep(p:last-child),
.mc-markdown :deep(ul:last-child),
.mc-markdown :deep(ol:last-child),
.mc-markdown :deep(table:last-child) {
  margin-bottom: 0;
}
.mc-markdown :deep(h1),
.mc-markdown :deep(h2),
.mc-markdown :deep(h3),
.mc-markdown :deep(h4) {
  margin: 1em 0 0.45em;
  line-height: 1.35;
  font-weight: 700;
}
.mc-markdown :deep(h1) { font-size: 17px; }
.mc-markdown :deep(h2) { font-size: 15px; }
.mc-markdown :deep(h3) { font-size: 14px; }
.mc-markdown :deep(ul),
.mc-markdown :deep(ol) {
  margin: 0.55em 0;
  padding-left: 1.35em;
}
.mc-markdown :deep(li + li) {
  margin-top: 0.2em;
}
.mc-markdown :deep(hr) {
  border: 0;
  border-top: 1px solid var(--color-border-border/60);
  margin: 1em 0;
}
.mc-markdown :deep(table) {
  width: 100%;
  margin: 0.75em 0;
  border-collapse: collapse;
  font-size: 13px;
}
.mc-markdown :deep(th),
.mc-markdown :deep(td) {
  border: 1px solid var(--color-border-border/60);
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}
.mc-markdown :deep(th) {
  background: var(--color-bg-panel);
  font-weight: 700;
}
.mc-markdown :deep(code) {
  border-radius: 4px;
  background: var(--color-bg-subtle);
  padding: 0.12em 0.35em;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.92em;
}
.mc-markdown :deep(.chat-md-preview) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border: 1px solid #93c5fd;
  border-radius: 4px;
  background: var(--color-accent-subtle);
  color: var(--color-accent-hover);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.92em;
  font-weight: 500;
  line-height: 1.5;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.mc-markdown :deep(.chat-md-preview:hover) {
  background: var(--color-accent-subtle);
  border-color: var(--color-accent);
}
.mc-markdown :deep(.chat-md-preview-icon) {
  font-size: 11px;
  color: var(--color-accent);
}
.mc-markdown :deep(pre) {
  overflow-x: auto;
  max-width: 100%;
  margin: 0;
  background: #1e1e2e;
  color: #cdd6f4;
  padding: 10px 13px;
}
.mc-markdown :deep(table) {
  display: block;
  overflow-x: auto;
}
.mc-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
}
/* 代码块容器（带 header + 折叠）*/
.mc-markdown :deep(.chat-code-block) {
  margin: 8px 0;
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid #313244;
  background: #1e1e2e;
}
.mc-markdown :deep(.chat-code-block .chat-code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #181825;
  border-bottom: 1px solid #313244;
  cursor: default;
}
.mc-markdown :deep(.chat-code-block--collapsible .chat-code-header) {
  cursor: pointer;
}
.mc-markdown :deep(.chat-code-block--collapsible .chat-code-header:hover) {
  background: #1e1e2e;
}
.mc-markdown :deep(.chat-code-block .chat-code-lang) {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  color: #7f849c;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
/* 折叠态：隐藏 pre，显示 header */
.mc-markdown :deep(.chat-code-block--collapsed > pre) {
  display: none;
}
.mc-markdown :deep(.chat-code-block--collapsed .chat-code-lang)::after {
  content: ' · 已折叠';
  opacity: 0.6;
  text-transform: none;
}
/* hex 色块 inline code */
.mc-markdown :deep(.chat-color-swatch) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.mc-markdown :deep(.chat-color-swatch-chip) {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 3px;
  border: 1px solid rgba(0,0,0,0.2);
  vertical-align: middle;
}
.mc-markdown :deep(blockquote) {
  margin: 0.75em 0;
  border-left: 3px solid var(--color-border);
  padding: 0.15em 0 0.15em 0.8em;
  color: var(--color-text-secondary);
}
.mc-markdown :deep(a) {
  color: var(--color-accent);
  text-decoration: none;
}
.mc-markdown :deep(a:hover) {
  text-decoration: underline;
}
.mc-image {
  margin: 6px 0;
}
.mc-image img {
  max-width: 100%;
  max-height: 300px;
  border-radius: 6px;
}
</style>
