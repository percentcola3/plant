<script setup lang="ts">
// ChipInput — chip 输入原语，UI 模式 ChatComposer 和 inspector 共用
// 支持 text / chip / image / fileref 四种 token
// 关键设计：只在 token 结构变化时（增删非 text token）才重渲染 DOM，
// 普通文本编辑完全交给浏览器 contenteditable，避免 IME 光标问题
import { ref, watch, nextTick, onMounted, computed } from 'vue'
import MentionPopover from './MentionPopover.vue'
import { pastePlainTextIntoSelection } from '@/lib/chat/paste-plain-text'
import { displayInputTokens, expandInputTokens } from '@/lib/chat/input-token-text'
import { insertTokenAtMentionTrigger } from '@/lib/chat/mention-insert'
import {
  type MentionItem,
  type MentionResourceKind
} from '@/lib/chat/mention-resources'

export type Token =
  | { type: 'text'; text: string }
  | { type: 'chip'; id: string; alias: string; path: string }
  | { type: 'image'; id: string; mime: string; data: string }
  | { type: 'fileref'; id: string; relPath: string }
  | {
      type: 'resource'
      id: string
      resourceKind: MentionResourceKind
      alias: string
      path: string
    }

const props = withDefaults(defineProps<{
  modelValue: Token[]
  placeholder?: string
  autofocus?: boolean
  disabled?: boolean
  submitDisabled?: boolean
  embedded?: boolean
}>(), {
  placeholder: '输入消息…',
  autofocus: false,
  disabled: false,
  submitDisabled: false,
  embedded: false
})

const emit = defineEmits<{
  'update:modelValue': [tokens: Token[]]
  'submit': [tokens: Token[]]
  'blockedSubmit': [tokens: Token[]]
}>()

const editorEl = ref<HTMLDivElement>()
const isComposing = ref(false)
const mentionVisible = ref(false)
const mentionPos = ref({ x: 0, y: 0 })
const mentionQuery = ref('')

// 上一次渲染的 token 结构签名（只含非 text token 的 id 列表）
// 用于判断是否需要重渲染 DOM
let lastRenderSignature = ''

let _idSeq = 0
function nextId(): string { return `tk_${++_idSeq}` }

const selectedMentionPaths = computed(() => props.modelValue.flatMap((token) => {
  if (token.type === 'resource' || token.type === 'chip') return [token.path]
  if (token.type === 'fileref') return [token.relPath]
  return []
}))

function tokenMatchesMention(token: Token, item: MentionItem): boolean {
  if (item.type === 'fileref') return token.type === 'fileref' && token.relPath === item.relPath
  if (item.type === 'chip') return token.type === 'chip' && token.path === item.path
  return token.type === 'resource' && token.path === item.path
}

// 计算 token 结构签名：只有非 text token 的 id 列表
function signature(tokens: Token[]): string {
  return tokens
    .filter(t => t.type !== 'text')
    .map(t => `${t.type}:${('id' in t) ? t.id : ''}`)
    .join('|')
}

// 序列化 tokens → 纯文本
function expand(tokens: Token[]): string {
  return expandInputTokens(tokens)
}

function expandDisplay(tokens: Token[]): string {
  return displayInputTokens(tokens)
}

function getImages(tokens: Token[]): Token[] {
  return tokens.filter(t => t.type === 'image')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// token 数组 → DOM 渲染（仅在结构变化时调用）
function renderToDom(tokens: Token[]) {
  const el = editorEl.value
  if (!el) return

  let html = ''
  for (const token of tokens) {
    if (token.type === 'text') {
      html += escapeHtml(token.text)
    } else if (token.type === 'chip') {
      html += `<span contenteditable="false" data-token-id="${token.id}" class="chip-token chip-token--chip" title="${escapeHtml(token.path)}"><span>@${escapeHtml(token.alias)}</span><button type="button" data-token-remove="${token.id}" class="chip-token__remove" aria-label="删除 @${escapeHtml(token.alias)}">×</button></span>`
    } else if (token.type === 'image') {
      html += `<span contenteditable="false" data-token-id="${token.id}" class="chip-token chip-token--image" title="图片"><span>🖼️</span><button type="button" data-token-remove="${token.id}" class="chip-token__remove" aria-label="删除图片">×</button></span>`
    } else if (token.type === 'fileref') {
      html += `<span contenteditable="false" data-token-id="${token.id}" class="chip-token chip-token--fileref" title="${escapeHtml(token.relPath)}"><span>@${escapeHtml(token.relPath)}</span><button type="button" data-token-remove="${token.id}" class="chip-token__remove" aria-label="删除 ${escapeHtml(token.relPath)}">×</button></span>`
    } else if (token.type === 'resource') {
      // 标签只显示文件名（含后缀）：去掉「知识库」类目前缀，完整路径放 title。
      // 过长由 CSS 省略（.chip-token max-width + ellipsis）。
      const fileLabel = token.alias.split('/').filter(Boolean).pop() ?? token.alias
      html += `<span contenteditable="false" data-token-id="${token.id}" class="chip-token chip-token--resource" title="${escapeHtml(token.path)}"><span class="chip-token__label">${escapeHtml(fileLabel)}</span><button type="button" data-token-remove="${token.id}" class="chip-token__remove" aria-label="删除 ${escapeHtml(fileLabel)}">×</button></span>`
    }
  }

  el.innerHTML = html
  lastRenderSignature = signature(tokens)
  // 渲染后光标放到末尾
  placeCursorAtEnd(el)
}

function placeCursorAtEnd(el: HTMLDivElement) {
  const range = document.createRange()
  const sel = window.getSelection()
  if (!sel || !el.lastChild) return
  range.selectNodeContents(el)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

// 从 DOM 重新解析回 token 数组
function parseDom(extraTokens: Token[] = []): Token[] {
  const el = editorEl.value
  if (!el) return []
  const tokens: Token[] = []
  const knownTokens = [...props.modelValue, ...extraTokens]

  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const elem = node as HTMLElement
      const tokenId = elem.dataset.tokenId
      if (tokenId) {
        const found = knownTokens.find(t => ('id' in t) && t.id === tokenId)
        if (found) tokens.push(found)
      } else {
        const text = elem.textContent ?? ''
        if (text) tokens.push({ type: 'text', text })
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (text) tokens.push({ type: 'text', text })
    }
  }
  return tokens
}

// IME 防抖：composition 期间完全不干预 DOM
function onCompositionStart() { isComposing.value = true }
function onCompositionEnd() {
  // 用 queueMicrotask 确保 IME 的最终文本已写入 DOM
  queueMicrotask(() => {
    isComposing.value = false
    syncFromDom()
    checkMentionTrigger()
  })
}

// 从 DOM 同步回 modelValue（仅同步文本变化，不触发重渲染）
function syncFromDom() {
  if (isComposing.value) return
  const tokens = parseDom()
  emit('update:modelValue', tokens)
}

// 监听 modelValue 变化：只在结构签名变化时才重渲染 DOM
// 文本编辑不会改变签名，所以不会触发 DOM 替换 → IME 光标不受影响
watch(() => props.modelValue, (tokens) => {
  if (isComposing.value) return
  const sig = signature(tokens)
  if (sig !== lastRenderSignature) {
    nextTick(() => renderToDom(tokens))
  }
}, { deep: true })

// 输入事件：IME 期间不做任何处理
function onInput(_e: InputEvent) {
  if (isComposing.value) return
  syncFromDom()
  checkMentionTrigger()
}

// 检测 @ 触发 mention 弹层
function checkMentionTrigger() {
  const sel = window.getSelection()
  if (!sel || !sel.focusNode) { closeMention(); return }

  const textNode = sel.focusNode.nodeType === Node.TEXT_NODE ? sel.focusNode as Text : null
  if (!textNode) { closeMention(); return }

  const textBefore = (textNode.textContent ?? '').slice(0, sel.focusOffset)
  const atIndex = textBefore.lastIndexOf('@')
  if (atIndex === -1) { closeMention(); return }

  const query = textBefore.slice(atIndex + 1)
  if (query.includes(' ') || query.length > 30) {
    closeMention()
    return
  }

  mentionQuery.value = query
  const range = document.createRange()
  range.setStart(textNode, atIndex)
  range.collapse(true)
  const rect = range.getBoundingClientRect()
  mentionPos.value = { x: rect.left, y: rect.bottom }
  mentionVisible.value = true
}

function closeMention(): void {
  mentionVisible.value = false
}

// mention 选中 → 结构变化，会触发 renderToDom。勾选可连续添加，Esc 关闭。
function onMentionSelect(item: MentionItem): void {
  const current = parseDom()
  const existingIndex = current.findIndex((token) => tokenMatchesMention(token, item))
  if (existingIndex >= 0) {
    emit('update:modelValue', current.filter((_, index) => index !== existingIndex))
    mentionQuery.value = ''
    return
  }

  let token: Token
  if (item.type === 'fileref') {
    token = { type: 'fileref', id: nextId(), relPath: item.relPath }
  } else if (item.type === 'chip') {
    token = { type: 'chip', id: nextId(), alias: item.alias, path: item.path }
  } else {
    token = {
      type: 'resource',
      id: nextId(),
      resourceKind: item.resourceKind,
      alias: item.alias,
      path: item.path
    }
  }

  emit('update:modelValue', insertTokenAtMentionTrigger(current, mentionQuery.value, token))
  mentionQuery.value = ''
}

// 键盘事件
function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
    return
  }
  if (e.key === 'Backspace') handleBackspace(e)
  if (e.key === 'Escape') closeMention()
}

function handleBackspace(e: KeyboardEvent) {
  const sel = window.getSelection()
  if (!sel || sel.focusNode?.nodeType !== Node.TEXT_NODE) return
  if (sel.focusOffset === 0) {
    const container = editorEl.value
    if (!container) return
    const nodes = Array.from(container.childNodes)
    const idx = nodes.indexOf(sel.focusNode as ChildNode)
    if (idx > 0) {
      const prev = nodes[idx - 1] as HTMLElement
      if (prev.dataset?.tokenId) {
        e.preventDefault()
        const tokenId = prev.dataset.tokenId
        const tokens = props.modelValue.filter(t => !('id' in t) || t.id !== tokenId)
        emit('update:modelValue', tokens)
      }
    }
  }
}

function removeToken(tokenId: string): void {
  const tokens = props.modelValue.filter(t => !('id' in t) || t.id !== tokenId)
  emit('update:modelValue', tokens)
}

function onClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  const button = target?.closest<HTMLElement>('[data-token-remove]')
  if (!button) return
  e.preventDefault()
  e.stopPropagation()
  const tokenId = button.dataset.tokenRemove
  if (tokenId) removeToken(tokenId)
}

// 单张图片 blob → image token，>5MB 丢弃。粘贴 / 拖拽都走这里。
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
function ingestImageBlob(blob: Blob, mime: string): void {
  if (!mime.startsWith('image/')) return
  if (blob.size > MAX_IMAGE_BYTES) return
  const reader = new FileReader()
  reader.onload = () => {
    const base64 = (reader.result as string).split(',')[1]
    const tokens = [...parseDom()]
    tokens.push({ type: 'image', id: nextId(), mime, data: base64 })
    emit('update:modelValue', tokens)
  }
  reader.readAsDataURL(blob)
}

// 粘贴事件
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (items) {
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) continue
        ingestImageBlob(blob, item.type)
        return
      }
    }
  }

  const text = e.clipboardData?.getData('text/plain') ?? ''
  pastePlainTextIntoSelection({
    text,
    preventDefault: () => e.preventDefault()
  })
  queueMicrotask(() => syncFromDom())
}

// 拖拽图片（支持多文件）。dragDepth 处理 dragenter/leave 在子元素间冒泡的成对触发，
// 单 boolean flag 在从子元素 enter 时会被立刻清掉，看不到拖入态。
const dragDepth = ref(0)
const dragOver = ref(false)
function dataTransferHasFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false
  // types 在 dragenter/dragover 阶段比 files 更可靠（部分浏览器在拖入时不暴露 files）
  return Array.from(dt.types ?? []).includes('Files')
}
function onDragEnter(e: DragEvent) {
  if (props.disabled) return
  if (!dataTransferHasFiles(e.dataTransfer)) return
  e.preventDefault()
  dragDepth.value += 1
  dragOver.value = true
}
function onDragOver(e: DragEvent) {
  if (props.disabled) return
  if (!dataTransferHasFiles(e.dataTransfer)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}
function onDragLeave(_e: DragEvent) {
  if (props.disabled) return
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) dragOver.value = false
}
function onDrop(e: DragEvent) {
  if (props.disabled) return
  e.preventDefault()
  dragDepth.value = 0
  dragOver.value = false
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  for (const file of Array.from(files)) {
    if (file.type.startsWith('image/')) ingestImageBlob(file, file.type)
  }
}

function submit() {
  if (props.disabled) return
  const tokens = props.modelValue.filter(t => {
    if (t.type === 'text') return t.text.trim().length > 0
    return true
  })
  if (tokens.length === 0) return
  if (props.submitDisabled) {
    emit('blockedSubmit', tokens)
    return
  }
  emit('submit', tokens)
}

// 对外暴露方法
function insertChip(payload: { alias: string; path: string }): void {
  const tokens = [...parseDom()]
  if (tokens.some(t => t.type === 'chip' && t.path === payload.path)) return
  tokens.push({ type: 'chip', id: nextId(), alias: payload.alias, path: payload.path })
  emit('update:modelValue', tokens)
}

function insertFileRef(payload: { relPath: string }): void {
  const relPath = payload.relPath.trim()
  if (!relPath) return
  const tokens = [...parseDom()]
  tokens.push({ type: 'fileref', id: nextId(), relPath })
  emit('update:modelValue', tokens)
}

function insertImage(payload: { mime: string; data: string }): void {
  insertImages([payload])
}

function insertImages(payloads: Array<{ mime: string; data: string }>): void {
  if (payloads.length === 0) return
  const tokens = [...parseDom()]
  for (const payload of payloads) {
    tokens.push({ type: 'image', id: nextId(), mime: payload.mime, data: payload.data })
  }
  emit('update:modelValue', tokens)
}

function focus(): void { editorEl.value?.focus() }
function clear(): void {
  emit('update:modelValue', [])
  renderToDom([])
}

defineExpose({
  insertChip,
  insertFileRef,
  insertImage,
  insertImages,
  focus,
  clear,
  submit,
  expand,
  expandDisplay,
  getImages
})

onMounted(() => {
  if (props.autofocus) nextTick(() => focus())
  renderToDom(props.modelValue)
})
</script>

<template>
  <div
    class="chip-input-wrap"
    :class="{
      'chip-input--disabled': disabled,
      'chip-input--drag-over': dragOver,
      'chip-input-wrap--embedded': embedded,
    }"
  >
    <div
      ref="editorEl"
      class="chip-input"
      :contenteditable="!disabled"
      :data-placeholder="placeholder"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
      @input="onInput"
      @keydown="onKeyDown"
      @click="onClick"
      @paste="onPaste"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    />
    <MentionPopover
      v-if="mentionVisible"
      :query="mentionQuery"
      :position="mentionPos"
      :selected-paths="selectedMentionPaths"
      @select="onMentionSelect"
      @close="closeMention"
    />
  </div>
</template>

<style scoped>
.chip-input-wrap {
  position: relative;
  width: 100%;
}
.chip-input {
  min-height: 36px;
  max-height: 160px;
  overflow-y: auto;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  outline: none;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-primary);
  background: var(--color-bg-panel, #fff);
  word-break: break-word;
}
.chip-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-info-subtle);
}
.chip-input:empty::before {
  content: attr(data-placeholder);
  color: var(--color-text-muted);
  pointer-events: none;
}
.chip-input--disabled .chip-input {
  opacity: 0.5;
  pointer-events: none;
}
.chip-input--drag-over .chip-input {
  border-color: var(--color-accent);
  background: var(--color-accent-subtle);
  box-shadow: 0 0 0 2px var(--color-info-subtle);
}
.chip-input-wrap--embedded .chip-input {
  min-height: 44px;
  max-height: 180px;
  padding: 10px 12px 6px;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.chip-input-wrap--embedded .chip-input:focus {
  border-color: transparent;
  box-shadow: none;
}
.chip-input-wrap--embedded.chip-input--drag-over .chip-input {
  background: var(--color-accent-subtle);
  box-shadow: none;
}
</style>

<!-- chip 样式：非 scoped。innerHTML 注入的 span 没有 scoped data 属性，scoped 选择器命不中，必须放全局。
     用 .chip-input .chip-token 限定作用域，避免污染其它组件。 -->
<style>
.chip-input .chip-token {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin: 0 2px;
  border-radius: var(--radius-button);
  border: 1px solid;
  font-size: 12px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-weight: 600;
  line-height: 1.3;
  cursor: default;
  user-select: none;
  vertical-align: baseline;
  white-space: nowrap;
  caret-color: transparent;
  /* 标签防过长：超宽省略，完整内容看 title 提示 */
  max-width: 240px;
}
.chip-input .chip-token > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip-input .chip-token__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.16);
  color: inherit;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}
.chip-input .chip-token__remove:hover {
  background: rgba(15, 23, 42, 0.28);
}
.chip-input .chip-token--chip {
  background: var(--color-success-subtle);
  border-color: color-mix(in srgb, var(--color-success) 20%, transparent);
  color: var(--color-success);
}
.chip-input .chip-token--image {
  background: var(--color-accent-subtle);
  border-color: var(--color-accent-border);
  color: var(--color-accent-pressed);
}
.chip-input .chip-token--fileref {
  background: var(--color-warning-subtle);
  border-color: color-mix(in srgb, var(--color-warning) 20%, transparent);
  color: var(--color-warning);
}
.chip-input .chip-token--resource {
  background: var(--color-accent-light);
  border-color: var(--color-accent-border);
  color: var(--color-accent-pressed);
  font-family: inherit;
  font-weight: 500;
}
</style>
