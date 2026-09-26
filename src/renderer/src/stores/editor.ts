import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { call } from '@/lib/api'
import { useWorkspacesStore } from './workspaces'
import { useUiStore } from './ui'
import { dispatchEditorDocumentOpened } from '@/lib/editor/editor-document-events'
import type { DocPublishStatus } from '@shared/types'

export type EditorKind = 'markdown' | 'css' | 'html' | 'text'
export type EditorMode = 'edit' | 'preview'

type Session = {
  projectId: string
  kind: EditorKind
  scope: 'docs' | 'project'
  relPath: string
  title: string
  content: string
  savedContent: string
  mtime: string
  mode: EditorMode
  previewBaseUrl: string | null
  publish?: DocPublishStatus | null
  readonly?: boolean
}

function fileTitle(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
}

function imageAltText(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  return base || 'image'
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export const useEditorStore = defineStore('editor', () => {
  const projects = useWorkspacesStore()
  const ui = useUiStore()

  const session = ref<Session | null>(null)
  const sessions = ref<Session[]>([])
  const activeSessionKey = ref<string | null>(null)
  const visible = ref(false)
  const isLoading = ref(false)
  const isSaving = ref(false)
  const isPublishing = ref(false)
  const error = ref<string | null>(null)

  // 多 tab 共享同一个 store：key（通常是 PreviewTab.id）→ 独立 session。
  // 全局 WorkspaceEditorPane 走单 session；PreviewPanel 内嵌 md tab 走 keyed session。
  const tabSessions = ref<Map<string, Session>>(new Map())
  const tabSavingKeys = ref<Set<string>>(new Set())
  const tabPublishingKeys = ref<Set<string>>(new Set())

  const isOpen = computed(() => visible.value && sessions.value.length > 0)
  const isDirty = computed(() => !!session.value && session.value.content !== session.value.savedContent)
  const currentKind = computed(() => session.value?.kind ?? null)

  function sessionKeyOf(input: Pick<Session, 'projectId' | 'kind' | 'scope' | 'relPath'>): string {
    return `${input.projectId}:${input.kind}:${input.scope}:${input.relPath}`
  }

  function setActiveSession(next: Session): void {
    const key = sessionKeyOf(next)
    const idx = sessions.value.findIndex((item) => sessionKeyOf(item) === key)
    const list = [...sessions.value]
    if (idx >= 0) list[idx] = next
    else list.push(next)
    sessions.value = list
    activeSessionKey.value = key
    session.value = next
    visible.value = true
    error.value = null
  }

  function activateSession(key: string): void {
    const found = sessions.value.find((item) => sessionKeyOf(item) === key)
    if (!found) return
    activeSessionKey.value = key
    session.value = found
    visible.value = true
    error.value = null
  }

  function closeSession(key: string, options?: { force?: boolean }): boolean {
    const idx = sessions.value.findIndex((item) => sessionKeyOf(item) === key)
    if (idx === -1) return true
    const target = sessions.value[idx]
    const dirty = target.content !== target.savedContent
    if (!options?.force && dirty) {
      const ok = window.confirm(`${target.title} 还没保存。确定要关闭吗？`)
      if (!ok) return false
    }
    const next = sessions.value.filter((item) => sessionKeyOf(item) !== key)
    sessions.value = next
    if (activeSessionKey.value !== key) return true
    const fallback = next[Math.min(idx, next.length - 1)] ?? next[idx - 1] ?? null
    activeSessionKey.value = fallback ? sessionKeyOf(fallback) : null
    session.value = fallback
    if (!fallback) visible.value = false
    error.value = null
    return true
  }

  function clearSession(): void {
    session.value = null
    sessions.value = []
    activeSessionKey.value = null
    visible.value = false
    error.value = null
  }

  function confirmDiscardChanges(targetLabel?: string): boolean {
    if (!isDirty.value) return true
    const suffix = targetLabel ? `，并打开 ${targetLabel}` : ''
    return window.confirm(`当前改动还没保存。确定要放弃这些改动${suffix}吗？`)
  }

  async function resolvePreviewBaseUrl(workspaceId: string, relPath: string): Promise<string | null> {
    const r = await call('preview.docUrl', { workspaceId, relPath })
    if (!r.ok) return null
    return new URL(r.data.url).origin
  }

  async function open(
    kind: EditorKind,
    relPath: string,
    options?: { skipDiscardConfirm?: boolean; scope?: 'docs' | 'project' }
  ): Promise<void> {
    const workspaceId = projects.activeId
    if (!workspaceId) return
    const scope = options?.scope ?? (kind === 'markdown' ? 'docs' : 'project')
    const existingKey = sessionKeyOf({ projectId: workspaceId, kind, scope, relPath })
    const existing = sessions.value.find((item) => sessionKeyOf(item) === existingKey)
    if (existing && !options?.skipDiscardConfirm) {
      activateSession(existingKey)
      return
    }
    isLoading.value = true
    error.value = null
    try {
      const r = await call('editor.readTextFile', { workspaceId, relPath, scope })
      if (!r.ok) {
        error.value = `${r.code}: ${r.message}`
        ui.showToast('error', `打开失败：${r.message}`)
        return
      }
      const previewBaseUrl = kind === 'markdown'
        ? await resolvePreviewBaseUrl(workspaceId, relPath)
        : null
      setActiveSession({
        projectId: workspaceId,
        kind,
        scope,
        relPath,
        title: fileTitle(relPath),
        content: r.data.content,
        savedContent: r.data.content,
        mtime: r.data.mtime,
        mode: kind === 'markdown' ? 'preview' : 'edit',
        previewBaseUrl,
        publish: r.data.publish ?? null,
        readonly: false
      })
      emitDocumentOpened({
        projectId: workspaceId,
        kind,
        relPath,
        readonly: false
      })
    } finally {
      isLoading.value = false
    }
  }

  async function openMarkdown(relPath: string): Promise<void> {
    await open('markdown', relPath)
  }

  async function openProjectMarkdown(relPath: string): Promise<void> {
    await open('markdown', relPath, { scope: 'project' })
  }

  async function openCss(relPath: string): Promise<void> {
    await open('css', relPath)
  }

  async function openHtml(relPath: string): Promise<void> {
    await open('html', relPath)
  }

  async function openText(relPath: string): Promise<void> {
    await open('text', relPath)
  }

  function close(options?: { force?: boolean }): boolean {
    const key = activeSessionKey.value
    if (!key) return true
    return closeSession(key, options)
  }

  function hide(): void {
    visible.value = false
  }

  function updateContent(content: string): void {
    if (!session.value) return
    if (session.value.readonly) return
    setActiveSession({ ...session.value, content, publish: null })
  }

  function emitDocumentOpened(detail: {
    projectId: string
    relPath: string
    kind: EditorKind
    readonly?: boolean
  }): void {
    if (typeof window === 'undefined') return
    dispatchEditorDocumentOpened(window, detail)
  }

  function setMode(mode: EditorMode): void {
    if (!session.value || session.value.kind !== 'markdown') return
    setActiveSession({ ...session.value, mode })
  }

  async function reload(): Promise<void> {
    const current = session.value
    if (!current) return
    if (!confirmDiscardChanges(current.title)) return
    isLoading.value = true
    error.value = null
    try {
      const r = await call('editor.readTextFile', {
        workspaceId: current.projectId,
        relPath: current.relPath,
        scope: current.scope
      })
      if (!r.ok) {
        error.value = `${r.code}: ${r.message}`
        ui.showToast('error', `重载失败：${r.message}`)
        return
      }
      const previewBaseUrl = current.kind === 'markdown'
        ? await resolvePreviewBaseUrl(current.projectId, current.relPath)
        : null
      setActiveSession({
        ...current,
        content: r.data.content,
        savedContent: r.data.content,
        mtime: r.data.mtime,
        previewBaseUrl,
        publish: r.data.publish ?? null
      })
    } finally {
      isLoading.value = false
    }
  }

  async function save(): Promise<void> {
    const current = session.value
    if (!current || current.content === current.savedContent) return
    if (current.readonly) return
    isSaving.value = true
    error.value = null
    const r = await call('editor.writeTextFile', {
      workspaceId: current.projectId,
      relPath: current.relPath,
      content: current.content,
      expectedMtime: current.mtime,
      scope: current.scope
    })
    isSaving.value = false
    if (!r.ok) {
      error.value = `${r.code}: ${r.message}`
      ui.showToast('error', `保存失败：${r.message}`)
      return
    }
    setActiveSession({
      ...current,
      mtime: r.data.mtime,
      savedContent: current.content
    })
    ui.showToast('success', `已保存 ${current.title}`, 1800)
  }

  async function publishCurrentDocument(): Promise<void> {
    const current = session.value
    if (!current || current.kind !== 'markdown') return
    if (current.readonly) return
    if (isDirty.value) {
      ui.showToast('info', '请先保存当前文档，再发布', 2200)
      return
    }
    isPublishing.value = true
    error.value = null
    const r = await call('editor.publishMarkdown', {
      workspaceId: current.projectId,
      relPath: current.relPath
    })
    isPublishing.value = false
    if (!r.ok) {
      error.value = `${r.code}: ${r.message}`
      ui.showToast('error', `发布失败：${r.message}`, 3600)
      return
    }
    setActiveSession({ ...current, publish: r.data })
    await call('system.copyToClipboard', { text: r.data.url })
    ui.showToast('success', '文档已发布，链接已复制', 2400)
  }

  async function copyPublishUrl(): Promise<void> {
    const url = session.value?.publish?.url
    if (!url) return
    await call('system.copyToClipboard', { text: url })
    ui.showToast('success', '链接已复制', 1600)
  }

  async function openPublishUrl(): Promise<void> {
    const url = session.value?.publish?.url
    if (!url) return
    await call('system.openExternal', { url })
  }

  async function saveImageAsset(files: File[]): Promise<string | null> {
    const current = session.value
    if (!current || current.kind !== 'markdown' || current.readonly) return null
    const snippets: string[] = []
    for (const file of files) {
      const bytes = await file.arrayBuffer()
      const base64 = bytesToBase64(new Uint8Array(bytes))
      const r = await call('editor.saveAsset', {
        workspaceId: current.projectId,
        contextRelPath: current.relPath,
        mimeType: file.type || 'application/octet-stream',
        dataBase64: base64,
        originalName: file.name
      })
      if (!r.ok) {
        ui.showToast('error', `图片保存失败：${r.message}`)
        return null
      }
      snippets.push(`![${imageAltText(file.name)}](${r.data.markdownPath})`)
    }
    ui.showToast('success', `已插入 ${snippets.length} 张图片`, 1800)
    return snippets.join('\n\n')
  }

  // ── Keyed sessions（PreviewPanel 多 md tab 共用此 store） ──

  function tabSession(key: string): import('vue').ComputedRef<Session | null> {
    return computed(() => tabSessions.value.get(key) ?? null)
  }
  function tabIsDirty(key: string): import('vue').ComputedRef<boolean> {
    return computed(() => {
      const s = tabSessions.value.get(key)
      return !!s && s.content !== s.savedContent
    })
  }
  function tabIsSaving(key: string): import('vue').ComputedRef<boolean> {
    return computed(() => tabSavingKeys.value.has(key))
  }
  function tabIsPublishing(key: string): import('vue').ComputedRef<boolean> {
    return computed(() => tabPublishingKeys.value.has(key))
  }

  function setTabSession(key: string, next: Session | null): void {
    const m = new Map(tabSessions.value)
    if (next) m.set(key, next)
    else m.delete(key)
    tabSessions.value = m
  }

  async function openInKey(key: string, kind: EditorKind, relPath: string, workspaceId = projects.activeId ?? ''): Promise<void> {
    if (!workspaceId) return
    const scope = kind === 'markdown' ? 'docs' : 'project'
    const r = await call('editor.readTextFile', { workspaceId, relPath, scope })
    if (!r.ok) {
      ui.showToast('error', `打开失败：${r.message}`)
      return
    }
    const previewBaseUrl = kind === 'markdown'
      ? await resolvePreviewBaseUrl(workspaceId, relPath)
      : null
    setTabSession(key, {
      projectId: workspaceId,
      kind,
      scope,
      relPath,
      title: fileTitle(relPath),
      content: r.data.content,
      savedContent: r.data.content,
      mtime: r.data.mtime,
      mode: kind === 'markdown' ? 'preview' : 'edit',
      previewBaseUrl,
      publish: r.data.publish ?? null,
      readonly: false
    })
    emitDocumentOpened({ projectId: workspaceId, kind, relPath, readonly: false })
  }

  function updateContentByKey(key: string, content: string): void {
    const cur = tabSessions.value.get(key)
    if (!cur || cur.readonly) return
    setTabSession(key, { ...cur, content, publish: null })
  }

  function setModeByKey(key: string, mode: EditorMode): void {
    const cur = tabSessions.value.get(key)
    if (!cur || cur.kind !== 'markdown') return
    setTabSession(key, { ...cur, mode })
  }

  async function saveByKey(key: string): Promise<void> {
    const cur = tabSessions.value.get(key)
    if (!cur || cur.content === cur.savedContent || cur.readonly) return
    const next = new Set(tabSavingKeys.value); next.add(key); tabSavingKeys.value = next
    const r = await call('editor.writeTextFile', {
      workspaceId: cur.projectId,
      relPath: cur.relPath,
      content: cur.content,
      expectedMtime: cur.mtime,
      scope: cur.scope
    })
    const after = new Set(tabSavingKeys.value); after.delete(key); tabSavingKeys.value = after
    if (!r.ok) {
      ui.showToast('error', `保存失败：${r.message}`)
      return
    }
    setTabSession(key, { ...cur, mtime: r.data.mtime, savedContent: cur.content })
    ui.showToast('success', `已保存 ${cur.title}`, 1800)
  }

  async function reloadByKey(key: string): Promise<void> {
    const cur = tabSessions.value.get(key)
    if (!cur) return
    if (cur.content !== cur.savedContent) {
      const ok = window.confirm(`${cur.title} 还没保存，要放弃改动重新加载吗？`)
      if (!ok) return
    }
    await openInKey(key, cur.kind, cur.relPath, cur.projectId)
  }

  async function publishByKey(key: string): Promise<void> {
    const cur = tabSessions.value.get(key)
    if (!cur || cur.kind !== 'markdown' || cur.readonly) return
    if (cur.content !== cur.savedContent) {
      ui.showToast('info', '请先保存当前文档，再发布', 2200)
      return
    }
    const next = new Set(tabPublishingKeys.value); next.add(key); tabPublishingKeys.value = next
    const r = await call('editor.publishMarkdown', { workspaceId: cur.projectId, relPath: cur.relPath })
    const after = new Set(tabPublishingKeys.value); after.delete(key); tabPublishingKeys.value = after
    if (!r.ok) {
      ui.showToast('error', `发布失败：${r.message}`, 3600)
      return
    }
    setTabSession(key, { ...cur, publish: r.data })
    await call('system.copyToClipboard', { text: r.data.url })
    ui.showToast('success', '文档已发布，链接已复制', 2400)
  }

  async function copyPublishUrlByKey(key: string): Promise<void> {
    const url = tabSessions.value.get(key)?.publish?.url
    if (!url) return
    await call('system.copyToClipboard', { text: url })
    ui.showToast('success', '链接已复制', 1600)
  }

  async function openPublishUrlByKey(key: string): Promise<void> {
    const url = tabSessions.value.get(key)?.publish?.url
    if (!url) return
    await call('system.openExternal', { url })
  }

  async function saveImageAssetByKey(key: string, files: File[]): Promise<string | null> {
    const cur = tabSessions.value.get(key)
    if (!cur || cur.kind !== 'markdown' || cur.readonly) return null
    const snippets: string[] = []
    for (const file of files) {
      const bytes = await file.arrayBuffer()
      const base64 = bytesToBase64(new Uint8Array(bytes))
      const r = await call('editor.saveAsset', {
        workspaceId: cur.projectId,
        contextRelPath: cur.relPath,
        mimeType: file.type || 'application/octet-stream',
        dataBase64: base64,
        originalName: file.name
      })
      if (!r.ok) {
        ui.showToast('error', `图片保存失败：${r.message}`)
        return null
      }
      snippets.push(`![${imageAltText(file.name)}](${r.data.markdownPath})`)
    }
    ui.showToast('success', `已插入 ${snippets.length} 张图片`, 1800)
    return snippets.join('\n\n')
  }

  function closeKey(key: string): void {
    setTabSession(key, null)
    const s = new Set(tabSavingKeys.value); s.delete(key); tabSavingKeys.value = s
    const p = new Set(tabPublishingKeys.value); p.delete(key); tabPublishingKeys.value = p
  }

  watch(
    () => projects.activeId,
    (activeId) => {
      if (!activeId) {
        clearSession()
        tabSessions.value = new Map()
        tabSavingKeys.value = new Set()
        tabPublishingKeys.value = new Set()
      }
    }
  )

  return {
    session,
    sessions,
    activeSessionKey,
    isOpen,
    isDirty,
    isLoading,
    isSaving,
    isPublishing,
    error,
    currentKind,
    openMarkdown,
    openProjectMarkdown,
    openCss,
    openHtml,
    openText,
    confirmDiscardChanges,
    sessionKeyOf,
    activateSession,
    closeSession,
    close,
    hide,
    updateContent,
    setMode,
    reload,
    save,
    publishCurrentDocument,
    copyPublishUrl,
    openPublishUrl,
    saveImageAsset,
    // keyed (per-tab) session API
    tabSession,
    tabIsDirty,
    tabIsSaving,
    tabIsPublishing,
    openInKey,
    updateContentByKey,
    setModeByKey,
    saveByKey,
    reloadByKey,
    publishByKey,
    copyPublishUrlByKey,
    openPublishUrlByKey,
    saveImageAssetByKey,
    closeKey
  }
})
