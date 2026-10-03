<script setup lang="ts">
// ChatComposer — UI 模式的消息输入组合器
import { ref, computed, watch, nextTick, onBeforeUnmount, onMounted } from 'vue'
import { ArrowUp, ClipboardPaste, ImagePlus, Paperclip } from 'lucide-vue-next'
import { useProjectBrowserStore } from '@/stores/project-browser'
import { browserScopeKey, formatWebPageContext } from '@shared/project-browser'
import ChipInput, { type Token } from './ChipInput.vue'
import SlashPalette from './SlashPalette.vue'
import AccessScopeHint from './AccessScopeHint.vue'
import { useConversationStore } from '@/stores/conversation'
import { useInspectorPicksStore } from '@/stores/inspector-picks'
import { usePreviewStore } from '@/stores/preview'
import { useUiStore } from '@/stores/ui'
import { useWorkspacesStore } from '@/stores/workspaces'
import { call } from '@/lib/api'
import { formatRetrievalPriority } from '@/lib/chat/input-token-text'
import { collectSubmitChips } from '@/lib/chat/chip-context'
import { loadChatDraft, saveChatDraft } from '@/lib/chat/drafts'

type ChipMeta = {
  alias: string
  path: string
  tagName?: string
  textPreview?: string
  edits?: Record<string, string>
}

type SubmitPayload = {
  text: string
  displayText?: string
  chips: ChipMeta[]
  images: Array<{ mediaType: string; data: string }>
  editableArea?: { relPath: string; kind: 'ui-product' | 'ui-component' }
}

const conversationStore = useConversationStore()
const picksStore = useInspectorPicksStore()
const previewStore = usePreviewStore()
const uiStore = useUiStore()
const workspacesStore = useWorkspacesStore()
const props = defineProps<{ draftKey: string }>()
const browser = useProjectBrowserStore()
const readingWebPages = ref(false)
const dismissCurrentWebPage = ref(false)
const explicitWebPageIds = computed(() => draft.value.flatMap(token =>
  token.type === 'resource' && token.resourceKind === 'webpage' ? [token.path.replace(/^webpage:/, '')] : []
))
const automaticWebPage = computed(() => !dismissCurrentWebPage.value && explicitWebPageIds.value.length === 0 ? browser.currentPage : null)
watch(() => [browser.currentPage?.id, props.draftKey], () => { dismissCurrentWebPage.value = false })

const emit = defineEmits<{
  submit: [payload: SubmitPayload]
  abortTurn: []
  newSession: []
  forceReset: []
}>()

const chipInputRef = ref<InstanceType<typeof ChipInput>>()
const slashPaletteRef = ref<InstanceType<typeof SlashPalette> | null>(null)
const composerRoot = ref<HTMLDivElement>()
const attachmentInputRef = ref<HTMLInputElement>()
const attachmentMenuOpen = ref(false)
const draft = ref<Token[]>(loadChatDraft(props.draftKey))
let currentDraftKey = props.draftKey
let previousChipPaths = new Set<string>()
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// / 触发：第一个 token 是 text 且以 "/" 开头时弹 palette。
// 输入框其它位置打 / 不触发（避免误中），符合常见 IDE 命令面板心智。
const slashQuery = computed<string | null>(() => {
  const first = draft.value[0]
  if (!first || first.type !== 'text') return null
  const text = first.text
  if (!text.startsWith('/')) return null
  // 一旦插入了非 text token（chip / image / fileref），不再当命令处理
  if (draft.value.length > 1 && draft.value.some(t => t.type !== 'text')) return null
  // / 后到第一个空格之前
  const space = text.indexOf(' ')
  return space === -1 ? text.slice(1) : null   // 出现空格 = 用户在打正常文字，关闭 palette
})

const palettePos = ref({ x: 0, y: 0 })
const showPalette = computed(() => slashQuery.value !== null)

watch(showPalette, (visible) => {
  if (!visible) return
  nextTick(() => {
    const el = composerRoot.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    palettePos.value = { x: rect.left + 12, y: rect.top - 320 }
  })
})

type PaletteItem =
  | {
      kind: 'skill'
      name: string
      description: string
      source: 'project' | 'user'
      quickInvocation: boolean
      defaultPrompt: string | null
    }
  | { kind: 'builtin'; name: string; description: string; insertText: string }

function skillInvocationText(skill: Extract<PaletteItem, { kind: 'skill' }>): string {
  const defaultPrompt = skill.defaultPrompt?.trim()
  return [
    `请使用 skill: ${skill.name} 处理这条请求：`,
    ...(defaultPrompt ? [defaultPrompt] : [])
  ].join('\n')
}

function onPaletteSelect(item: PaletteItem): void {
  if (item.kind === 'builtin' && item.insertText.startsWith('__APP_ACTION__:')) {
    const action = item.insertText.slice('__APP_ACTION__:'.length)
    chipInputRef.value?.clear()
    if (action === 'new') emit('newSession')
    else if (action === 'reset') emit('forceReset')
    return
  }
  // skill / 普通命令 → 直接用作 prompt 文本
  const text = item.kind === 'skill'
    ? `${skillInvocationText(item)}\n`
    : `${item.insertText}\n`
  chipInputRef.value?.clear()
  draft.value = [{ type: 'text', text }]
  nextTick(() => chipInputRef.value?.focus())
}

function onComposerKeydown(e: KeyboardEvent): void {
  if (attachmentMenuOpen.value && e.key === 'Escape') {
    e.preventDefault()
    attachmentMenuOpen.value = false
    return
  }
  if (!showPalette.value) return
  if (e.key === 'ArrowDown') { e.preventDefault(); slashPaletteRef.value?.moveActive(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); slashPaletteRef.value?.moveActive(-1) }
  else if (e.key === 'Enter' && !e.shiftKey) {
    if (slashPaletteRef.value?.pickActive()) e.preventDefault()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    chipInputRef.value?.clear()
  }
}

const turnInFlight = computed(() => conversationStore.currentTurnInFlight)
const hasDraft = computed(() => draft.value.some(t => t.type === 'text' ? t.text.trim().length > 0 : true))
const quickSkills = ref<Array<Extract<PaletteItem, { kind: 'skill' }>>>([])
let quickSkillsRefreshSeq = 0

async function refreshQuickSkills(): Promise<void> {
  const workspaceId = workspacesStore.activeId
  const seq = ++quickSkillsRefreshSeq
  if (!workspaceId) {
    quickSkills.value = []
    return
  }
  const result = await call('claude.commandCatalog', { workspaceId })
  if (seq !== quickSkillsRefreshSeq || workspaceId !== workspacesStore.activeId) return
  if (!result.ok) {
    quickSkills.value = []
    return
  }
  quickSkills.value = result.data.skills
    .filter(skill => skill.quickInvocation && !!skill.defaultPrompt?.trim())
    .map(skill => ({ kind: 'skill' as const, ...skill }))
}

function invokeQuickSkill(skill: Extract<PaletteItem, { kind: 'skill' }>): void {
  if (turnInFlight.value) return
  draft.value = [{ type: 'text', text: skillInvocationText(skill) }]
  nextTick(() => chipInputRef.value?.submit())
}

function toggleAttachmentMenu(): void {
  attachmentMenuOpen.value = !attachmentMenuOpen.value
}

function openImagePicker(): void {
  attachmentMenuOpen.value = false
  attachmentInputRef.value?.click()
}

function readImageBlob(blob: Blob, mime: string): Promise<{ mime: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('图片读取失败'))
        return
      }
      resolve({ mime, data: result.split(',')[1] ?? '' })
    }
    reader.readAsDataURL(blob)
  })
}

async function attachImageBlobs(blobs: Blob[]): Promise<void> {
  const supported = blobs.filter(blob => blob.type.startsWith('image/'))
  const accepted = supported.filter(blob => blob.size <= MAX_IMAGE_BYTES)
  if (supported.length !== accepted.length) {
    uiStore.showToast('error', '单张图片不能超过 5MB', 4000)
  }
  if (accepted.length === 0) return

  try {
    const images = await Promise.all(accepted.map(blob => readImageBlob(blob, blob.type)))
    chipInputRef.value?.insertImages(images)
    await nextTick()
    chipInputRef.value?.focus()
  } catch (error) {
    uiStore.showToast('error', error instanceof Error ? error.message : '图片读取失败', 4000)
  }
}

function onAttachmentFiles(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  void attachImageBlobs(files)
}

async function pasteClipboardScreenshot(): Promise<void> {
  attachmentMenuOpen.value = false
  if (!navigator.clipboard?.read) {
    uiStore.showToast('error', '当前环境不支持读取剪贴板图片', 4000)
    return
  }

  try {
    const items = await navigator.clipboard.read()
    const imageBlobs: Blob[] = []
    for (const item of items) {
      const imageType = item.types.find(type => type.startsWith('image/'))
      if (!imageType) continue
      imageBlobs.push(await item.getType(imageType))
    }
    if (imageBlobs.length === 0) {
      uiStore.showToast('info', '剪贴板里没有截图', 3000)
      return
    }
    await attachImageBlobs(imageBlobs)
  } catch (error) {
    console.error('[ChatComposer] clipboard image read failed:', error)
    uiStore.showToast('error', '读取剪贴板截图失败，请直接粘贴或上传图片', 5000)
  }
}

function onWindowPointerDown(event: PointerEvent): void {
  if (!attachmentMenuOpen.value) return
  const target = event.target
  if (target instanceof Node && composerRoot.value?.contains(target)) return
  attachmentMenuOpen.value = false
}

function chipPaths(tokens: Token[]): Set<string> {
  return new Set(tokens
    .filter((t): t is Extract<Token, { type: 'chip' }> => t.type === 'chip')
    .map(t => t.path))
}

function samePathSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const path of a) {
    if (!b.has(path)) return false
  }
  return true
}

watch(draft, (tokens) => {
  saveChatDraft(currentDraftKey, tokens)
  const current = chipPaths(tokens)
  const changed = !samePathSet(previousChipPaths, current)
  for (const path of previousChipPaths) {
    if (!current.has(path)) {
      window.dispatchEvent(new CustomEvent('__uikit_host_remove_chip__', { detail: { path } }))
    }
  }
  previousChipPaths = current
  if (changed) {
    window.dispatchEvent(new CustomEvent('__uikit_host_sync_chip_paths__', {
      detail: { paths: [...current] }
    }))
  }
}, { deep: true, flush: 'sync' })

watch(() => props.draftKey, (next) => {
  saveChatDraft(currentDraftKey, draft.value)
  currentDraftKey = next
  draft.value = loadChatDraft(next)
  previousChipPaths = chipPaths(draft.value)
}, { flush: 'sync' })

onBeforeUnmount(() => saveChatDraft(currentDraftKey, draft.value))

async function onSubmit(tokens: Token[]) {
  if (readingWebPages.value) return
  if (turnInFlight.value) {
    emit('abortTurn')
    return
  }
  if (!chipInputRef.value) return

  // 资源 token 对用户显示别名，对 AI 展开为工作区内的真实路径。
  const text = chipInputRef.value.expand(tokens)
  const displayText = chipInputRef.value.expandDisplay(tokens)
  if (!text.trim() && tokens.every(t => t.type !== 'image')) return

  // chip token 和普通文本里的 @A 都要带 selector 上下文给 Claude。
  const chips: ChipMeta[] = collectSubmitChips({
    text,
    tokens,
    currentPicks: picksStore.currentPicks
  })

  const images = tokens
    .filter((t): t is Extract<Token, { type: 'image' }> => t.type === 'image')
    .map(t => ({ mediaType: t.mime, data: t.data }))

  const scope = browser.currentScope ? { ...browser.currentScope } : null
  const sendDraftKey = props.draftKey
  const editableArea = currentEditableArea()
  const referencedIds = tokens.flatMap(token => token.type === 'resource' && token.resourceKind === 'webpage'
    ? [token.path.replace(/^webpage:/, '')] : [])
  const ids = referencedIds.length ? referencedIds : automaticWebPage.value ? [automaticWebPage.value.id] : []
  readingWebPages.value = ids.length > 0
  try {
    if (ids.length && !scope) throw new Error('请先打开网页所属项目，再发送消息')
    const pages = scope && ids.length ? await browser.read(scope, ids) : []
    if (props.draftKey !== sendDraftKey || (scope && browserScopeKey(scope) !== (browser.currentScope ? browserScopeKey(browser.currentScope) : ''))) {
      throw new Error('读取网页时切换了项目，请在原对话中重新发送')
    }
    if (pages.some(page => page.truncated)) uiStore.showToast('info', '网页正文较长，本次引用已截取部分内容并告知 AI', 4500)
    const visibleText = pages.length && !referencedIds.length
      ? `${displayText}\n\n参考网页：${pages.map(page => `${page.title}（${page.url}）`).join('、')}` : displayText
    emit('submit', { text: text + formatRetrievalPriority(tokens) + formatWebPageContext(pages), displayText: visibleText, chips, images, editableArea })
    chipInputRef.value?.clear()
    dismissCurrentWebPage.value = false
  } catch (error) {
    uiStore.showToast('error', error instanceof Error ? error.message : String(error), 6000)
  } finally { readingWebPages.value = false }
}

function currentEditableArea(): SubmitPayload['editableArea'] {
  const tab = previewStore.activeTab
  if (tab?.type === 'product' && tab.productMeta?.path) {
    return { relPath: tab.productMeta.path, kind: 'ui-product' }
  }
  if (tab?.type === 'component' && tab.componentMeta?.path) {
    return { relPath: tab.componentMeta.path, kind: 'ui-component' }
  }
  return undefined
}

function onBlockedSubmit() {
  if (readingWebPages.value) return
  emit('abortTurn')
}

function onPrimaryAction() {
  if (turnInFlight.value) {
    emit('abortTurn')
    return
  }
  chipInputRef.value?.submit()
}

// inspector 选中元素 → 注入 chip 到输入框
function insertChipFromInspector(payload: { alias: string; path: string }) {
  chipInputRef.value?.insertChip(payload)
}

function insertFileRefFromProductFiles(payload: { relPath: string }): void {
  const relPath = payload.relPath.trim()
  if (!relPath) return
  chipInputRef.value?.insertFileRef({ relPath })
  nextTick(() => chipInputRef.value?.focus())
}

function onInsertFileRef(event: Event): void {
  const detail = (event as CustomEvent<{ relPath?: string }>).detail
  if (typeof detail?.relPath !== 'string') return
  insertFileRefFromProductFiles({ relPath: detail.relPath })
}

function syncChipsWithInspector(paths: string[]): void {
  const alive = new Set(paths)
  const next = draft.value.filter(token => token.type !== 'chip' || alive.has(token.path))
  if (next.length !== draft.value.length) draft.value = next
}

function replaceTextDraft(text: string): void {
  const value = text.trim()
  if (!value) return
  draft.value = [{ type: 'text', text: value }]
  nextTick(() => chipInputRef.value?.focus())
}

// 外部注入的 initialDraft（首页「开始构建」）填入后直接发送。
// turn 进行中时不动作（返回 false），草稿留在输入框里等用户手动处理。
function submitDraft(): boolean {
  if (turnInFlight.value) return false
  if (!hasDraft.value) return false
  nextTick(() => chipInputRef.value?.submit())
  return true
}

onMounted(() => {
  window.addEventListener('__uikit_insert_file_ref__', onInsertFileRef)
  window.addEventListener('pointerdown', onWindowPointerDown)
  void refreshQuickSkills()
})

onBeforeUnmount(() => {
  window.removeEventListener('__uikit_insert_file_ref__', onInsertFileRef)
  window.removeEventListener('pointerdown', onWindowPointerDown)
})

watch(() => workspacesStore.activeId, () => void refreshQuickSkills())
watch(() => {
  const workspaceId = workspacesStore.activeId
  if (!workspaceId) return ''
  return (workspacesStore.skillsByWorkspace[workspaceId] ?? [])
    .map(skill => `${skill.name}:${skill.quickInvocation}:${skill.defaultPrompt ?? ''}:${skill.disabled}`)
    .join('|')
}, () => void refreshQuickSkills())

defineExpose({
  insertChipFromInspector,
  insertFileRefFromProductFiles,
  syncChipsWithInspector,
  replaceTextDraft,
  submitDraft
})
</script>

<template>
  <div ref="composerRoot" class="chat-composer" @keydown.capture="onComposerKeydown">
    <div class="chat-composer__surface">
      <div v-if="quickSkills.length > 0" class="cc-quick-actions" aria-label="快捷调用">
        <span class="cc-quick-actions__label">快捷调用</span>
        <button
          v-for="skill in quickSkills"
          :key="skill.name"
          type="button"
          class="cc-quick-action"
          :disabled="turnInFlight"
          :title="`${skill.name}：${skill.defaultPrompt}`"
          @click="invokeQuickSkill(skill)"
        >{{ skill.defaultPrompt }}</button>
      </div>
      <div v-if="automaticWebPage || readingWebPages" class="mx-3 mt-2 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <span class="min-w-0 truncate" :title="automaticWebPage?.url">{{ readingWebPages ? '正在读取网页文本…' : `当前网页：${automaticWebPage?.title}` }}</span>
        <button v-if="!readingWebPages" type="button" class="shrink-0 px-1" title="本次不引用当前网页" aria-label="本次不引用当前网页" @click="dismissCurrentWebPage = true">×</button>
      </div>
      <AccessScopeHint :workspace-id="workspacesStore.activeId" :context-key="props.draftKey" />
      <ChipInput
        ref="chipInputRef"
        v-model="draft"
        embedded
        :disabled="readingWebPages"
        :submit-disabled="turnInFlight || readingWebPages"
        placeholder="输入 @ 可引用网页、项目文件、知识库和组件资产"
        title="Enter 发送，Shift+Enter 换行，/ 打开命令"
        :autofocus="true"
        @submit="onSubmit"
        @blocked-submit="onBlockedSubmit"
      />
      <div class="cc-toolbar">
        <div class="cc-attachment-wrap">
          <button
            type="button"
            class="cc-icon-btn"
            title="添加图片或截图"
            aria-label="添加图片或截图"
            aria-haspopup="menu"
            :aria-expanded="attachmentMenuOpen"
            @click="toggleAttachmentMenu"
          >
            <Paperclip class="cc-action-icon" :stroke-width="1.8" aria-hidden="true" />
          </button>
          <div v-if="attachmentMenuOpen" class="cc-attachment-menu" role="menu">
            <button type="button" role="menuitem" @click="openImagePicker">
              <ImagePlus aria-hidden="true" />
              <span>上传图片</span>
            </button>
            <button type="button" role="menuitem" @click="pasteClipboardScreenshot">
              <ClipboardPaste aria-hidden="true" />
              <span>粘贴截图</span>
            </button>
          </div>
          <input
            ref="attachmentInputRef"
            class="cc-file-input"
            type="file"
            accept="image/*"
            multiple
            @change="onAttachmentFiles"
          />
        </div>
        <button
          type="button"
          class="cc-send-btn"
          :class="{
            'cc-send-btn--stop': turnInFlight,
            'cc-send-btn--ready': !turnInFlight && hasDraft,
            'cc-send-btn--idle': !turnInFlight && !hasDraft,
          }"
          :disabled="!turnInFlight && !hasDraft"
          :title="turnInFlight ? '停止当前回合' : '发送消息'"
          :aria-label="turnInFlight ? '停止当前回合' : '发送消息'"
          @click="onPrimaryAction"
        >
          <svg v-if="turnInFlight" class="cc-send-icon cc-send-icon--stop" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
            <rect x="5.25" y="5.25" width="7.5" height="7.5" rx="1.5" />
          </svg>
          <ArrowUp v-else class="cc-send-icon" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </div>
    </div>
    <SlashPalette
      v-if="showPalette && slashQuery !== null"
      ref="slashPaletteRef"
      :query="slashQuery"
      :position="palettePos"
      @select="onPaletteSelect"
      @close="chipInputRef?.clear()"
    />
  </div>
</template>

<style scoped>
.chat-composer {
  flex-shrink: 0;
  padding: 12px 16px 16px;
  background: transparent;
}
.chat-composer__surface {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-popover-border);
  border-radius: 12px;
  background: var(--color-bg-panel);
  transition: border-color 120ms;
}
.chat-composer__surface:focus-within {
  border-color: var(--color-border-strong);
}
.cc-quick-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding: 9px 12px 0;
}
.cc-quick-actions__label {
  flex: 0 0 auto;
  color: var(--color-text-tertiary);
  font-size: 11px;
}
.cc-quick-action {
  flex: 0 0 auto;
  max-width: 180px;
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-button);
  background: var(--color-accent-light);
  padding: 3px 8px;
  color: var(--color-accent-pressed);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.cc-quick-action:hover:not(:disabled) { background: var(--color-accent-subtle); }
.cc-quick-action:disabled { opacity: 0.5; cursor: not-allowed; }
.cc-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 10px 10px;
}
.cc-attachment-wrap {
  position: relative;
}
.cc-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  line-height: 1;
  transition:
    background-color var(--duration-fast, 120ms) var(--ease-out, ease),
    color var(--duration-fast, 120ms) var(--ease-out, ease);
}
.cc-icon-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.cc-icon-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-info-subtle);
}
.cc-icon-btn:disabled {
  opacity: 0.34;
  cursor: default;
}
.cc-attachment-menu {
  position: absolute;
  bottom: 36px;
  left: 0;
  z-index: 20;
  display: grid;
  min-width: 148px;
  overflow: hidden;
  border: 1px solid var(--color-popover-border);
  border-radius: 10px;
  background: var(--color-bg-elevated);
  padding: 4px;
  box-shadow: var(--shadow-md);
}
.cc-attachment-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  border-radius: 7px;
  background: transparent;
  padding: 8px 9px;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--duration-fast, 120ms) var(--ease-out, ease),
    color var(--duration-fast, 120ms) var(--ease-out, ease);
}
.cc-attachment-menu button:hover,
.cc-attachment-menu button:focus-visible {
  outline: none;
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.cc-attachment-menu svg {
  width: 15px;
  height: 15px;
  flex: none;
}
.cc-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
.cc-send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--radius-button);
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background-color var(--duration-fast, 120ms) var(--ease-out, ease),
    color var(--duration-fast, 120ms) var(--ease-out, ease),
    transform var(--duration-fast, 120ms) var(--ease-out, ease);
}
.cc-send-btn--ready {
  background: var(--color-button-bg);
  color: var(--color-button-fg);
  box-shadow: inset 0 0 0 1px var(--color-accent-border);
}
.cc-send-btn--ready:hover:not(:disabled) {
  background: var(--color-button-bg-hover);
  color: var(--color-button-fg);
}
.cc-send-btn--idle:disabled {
  background: var(--color-bg-subtle);
  color: var(--color-text-muted);
  opacity: 1;
  cursor: default;
}
.cc-send-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-info-subtle);
}
.cc-send-btn:disabled:not(.cc-send-btn--idle):not(.cc-send-btn--stop) {
  opacity: 0.38;
  cursor: default;
}
.cc-send-btn--stop {
  background: var(--color-error);
  color: #fff;
}
.cc-send-btn--stop:hover:not(:disabled) {
  background: var(--color-error);
  color: #fff;
}
.cc-action-icon,
.cc-send-icon {
  width: 14px;
  height: 14px;
  flex: none;
}
.cc-send-icon--stop {
  width: 11px;
  height: 11px;
}
</style>
