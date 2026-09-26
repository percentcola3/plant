<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CodeMirrorSurface from '@/components/editor/CodeMirrorSurface.vue'
import { call } from '@/lib/api'
import { renderMarkdownPreview } from '@/lib/editor/markdown-preview'
import type { MarkdownShortcutId } from '@/lib/editor/markdown-shortcuts'
import { productFileLanguageExtension } from '@/lib/preview/product-file-language'
import {
  buildProductFileTree,
  defaultExpandedProductFolderPaths,
  flattenProductFiles,
  isDocFolderName,
  isProductImageFile,
  nextSketchFileRelPath,
  productFileDisplayName,
  productFileIcon,
  productFileAncestorDirs,
  productAssetUploadDir,
  productAssetUploadFileNameError,
  productTreeChangeMarks,
  selectProductFileAfterDelete,
  type ProductFileChangeKind,
  type ProductFileItem,
  type ProductFileTreeNode
} from '@/lib/preview/product-files'
import {
  buildSketchDocument,
  isSketchJsonFileName,
  parseSketchDocument,
  type SketchItem
} from '@/lib/preview/sketch-model'
import {
  loadUiProductCardMeta,
  resolveWorkbenchBrandTitle,
  saveUiProductCardMeta,
} from '@/lib/preview/ui-product-card-meta'
import { outputGroupOfRelPath } from '@/lib/preview/ui-products'
import type { SourceProjectInfo, UiProductCardMeta } from '@shared/types'
import { usePreviewStore } from '@/stores/preview'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'
import { useExternalRefsStore } from '@/stores/external-refs'
import HtmlPreviewSurface from './HtmlPreviewSurface.vue'
import PreviewSizeBar from './PreviewSizeBar.vue'
import ProductFilesBrandMenu from './ProductFilesBrandMenu.vue'
import ProductFilesTreeToggle from './ProductFilesTreeToggle.vue'
import ProjectBrowserPane from './ProjectBrowserPane.vue'
import ProjectBrowserTabs from './ProjectBrowserTabs.vue'
import { useProjectBrowserStore } from '@/stores/project-browser'
import type { WebPageDesign } from '@shared/project-browser'
import { WORKBENCH_CUSTOM_DEVICE_PRESET } from '@/lib/preview/product-preview'
import FeatureGitSubmitButton from './FeatureGitSubmitButton.vue'
import SketchEditor from './SketchEditor.vue'
import { Button } from '@/components/ui/button'
import FeatureResourceDialog from '@/components/dialogs/FeatureResourceDialog.vue'
import { BookOpen, ChevronDown, ChevronRight, Folder, FolderOpen, GitBranch, PackageOpen } from 'lucide-vue-next'

const props = defineProps<{
  tabId: string
  workspaceId: string
  rootRelPath: string
  primaryRelPath?: string
  activeRelPath?: string
}>()

type TextSession = {
  relPath: string
  content: string
  savedContent: string
  mtime: string
}

type ProductFileTreeRow = {
  node: ProductFileTreeNode
  depth: number
}

const browser = useProjectBrowserStore()
const browserScope = computed(() => ({ workspaceId: props.workspaceId, projectRelPath: props.rootRelPath }))
const activeWebPage = computed(() => browser.activePage(browserScope.value))
const openFilePaths = ref<string[]>([])
const workbenchTabOrder = ref<string[]>([])
type FileDraft = { text: TextSession | null; sketch: SketchItem[]; savedSketch: string; sketchMtime: string; dirty: boolean; markdownMode: 'preview' | 'edit' }
const fileDrafts = ref<Record<string, FileDraft>>({})
let fileLoadSeq = 0
let previewLoadSeq = 0
let disposed = false
function cacheFile(path: string | null): void {
  if (!path || (textSession.value?.relPath !== path && !sketchMtime.value)) return
  const dirty = !!textSession.value && textSession.value.content !== textSession.value.savedContent
    || (isSketchJsonFileName(path) && sketchContent.value !== sketchSavedContent.value)
  if (!dirty) { delete fileDrafts.value[path]; return }
  fileDrafts.value[path] = {
    text: textSession.value ? { ...textSession.value } : null,
    sketch: JSON.parse(JSON.stringify(sketchItems.value)), savedSketch: sketchSavedContent.value,
    sketchMtime: sketchMtime.value, dirty, markdownMode: markdownMode.value
  }
}
const fileTabs = computed(() => openFilePaths.value.map(id => ({
  id, title: id.split('/').at(-1) || id,
  dirty: id === selectedRelPath.value ? isDirty.value : !!fileDrafts.value[id]?.dirty
})))
function activateFileTab(id: string): void {
  const file = files.value.find(item => item.relPath === id)
  if (file) selectFile(file)
}
function closeFileTab(id: string): boolean {
  if (saving.value) { ui.showToast('info', '正在保存，请稍后关闭文件'); return false }
  if (fileTabs.value.find(tab => tab.id === id)?.dirty && !window.confirm('此文件尚未保存，关闭并放弃改动？')) return false
  delete fileDrafts.value[id]
  openFilePaths.value = openFilePaths.value.filter(path => path !== id)
  if (selectedRelPath.value === id) {
    resetLoadedContent()
    detailMode.value = 'preview'
    selectedRelPath.value = null
  }
  return true
}
function showProjectOverview(): void {
  if (saving.value) { ui.showToast('info', '正在保存，请稍后切换'); return }
  cacheFile(selectedRelPath.value)
  detailMode.value = 'preview'
  selectedRelPath.value = null
  resetLoadedContent()
  void loadPreviewUrl()
}
const previewStore = usePreviewStore()
const themeStore = useThemeStore()
const ui = useUiStore()
const externalRefs = useExternalRefsStore()
const fileInputRef = ref<HTMLInputElement | null>(null)
const markdownSurfaceRef = ref<InstanceType<typeof CodeMirrorSurface> | null>(null)
const files = ref<ProductFileItem[]>([])
const expandedDirs = ref<Set<string>>(new Set())
const appliedDefaultExpandRoot = ref<string | null>(null)
const gitChangeMarks = ref<Map<string, ProductFileChangeKind>>(new Map())
const treeOpen = ref(true)
const createMenuOpen = ref(false)
const detailMode = ref<'preview' | 'edit'>('preview')
const markdownMode = ref<'preview' | 'edit'>('preview')
const htmlMode = ref<'preview' | 'source'>('preview')
const htmlModeByFile = ref<Record<string, 'preview' | 'source'>>({})
const selectedRelPath = ref<string | null>(props.activeRelPath ?? props.primaryRelPath ?? null)
const textSession = ref<TextSession | null>(null)
const sketchItems = ref<SketchItem[]>([])
const sketchSavedContent = ref('')
const sketchMtime = ref('')
const imageUrl = ref('')
const previewUrl = ref('')
const markdownPreviewBaseUrl = ref<string | null>(null)
const markdownPreviewSrcdoc = ref('')
const loadingTree = ref(false)
const loadingPreview = ref(false)
const loadingContent = ref(false)
const renderingMarkdownPreview = ref(false)
const saving = ref(false)
const uploading = ref(false)
const deleting = ref(false)
const creating = ref(false)
const error = ref<string | null>(null)
const resourceDialogOpen = ref(false)
const resourceSaving = ref(false)
const selectedExternalRefIds = ref<string[]>([])
const sourceProject = ref<SourceProjectInfo>({
  binding: null,
  state: 'unlinked',
  dirty: false,
  launch: { state: 'stopped' }
})
const sourceLoading = ref(false)
const sourceAssociating = ref(false)
const sourceCommitting = ref(false)
const sourceLaunching = ref(false)
let markdownRenderSeq = 0

const selectedFile = computed(() =>
  files.value.find((file) => file.relPath === selectedRelPath.value) ?? null
)
const previewFile = computed(() => {
  const root = props.rootRelPath.replace(/\/+$/, '')
  const primary = props.primaryRelPath && /\.html?$/i.test(props.primaryRelPath)
    ? files.value.find((file) => file.relPath === props.primaryRelPath)
    : null
  return (
    primary
    ?? files.value.find((file) => file.relPath === `${root}/index.html`)
    ?? files.value.find((file) => /\.html?$/i.test(file.relPath))
    ?? null
  )
})
const activeTargetFile = computed(() =>
  (detailMode.value === 'edit' && selectedFile.value) ? selectedFile.value : previewFile.value
)
const previewDisplayPath = computed(() => previewFile.value?.relPath ?? props.rootRelPath)
const productCardMeta = ref<UiProductCardMeta | null>(null)
const headerBrandTitle = computed(() =>
  resolveWorkbenchBrandTitle(productCardMeta.value, props.rootRelPath)
)
const canManageProject = computed(() =>
  !deleting.value && !saving.value && !uploading.value && !creating.value
)
const canRenameHeader = computed(() => canManageProject.value)
const canDeleteHeader = computed(() => canManageProject.value)
const sourceProjectLabel = computed(() => sourceProject.value.binding?.runtime.name ?? '源码')
const sourceLaunchUrl = computed(() => sourceProject.value.launch.url ?? sourceProject.value.binding?.runtime.readyUrl ?? '')
const fileTree = computed(() => buildProductFileTree(files.value, props.rootRelPath))
const fileTreeRows = computed(() => visibleProductFileTreeRows(fileTree.value, expandedDirs.value))
const textDirty = computed(() =>
  !!textSession.value && textSession.value.content !== textSession.value.savedContent
)
const sketchContent = computed(() =>
  JSON.stringify(buildSketchDocument(sketchItems.value), null, 2) + '\n'
)

async function loadFeatureResources(): Promise<void> {
  await externalRefs.refreshPool()
  const result = await call('feature.resources.get', {
    workspaceId: props.workspaceId,
    featureRelPath: props.rootRelPath
  })
  if (result.ok) selectedExternalRefIds.value = result.data.externalRefIds
}

async function openResourceDialog(): Promise<void> {
  await loadFeatureResources()
  resourceDialogOpen.value = true
}

async function saveFeatureResources(payload: { externalRefIds: string[]; setAsDefault: boolean }): Promise<void> {
  if (resourceSaving.value) return
  resourceSaving.value = true
  try {
    const result = await call('feature.resources.update', {
      workspaceId: props.workspaceId,
      featureRelPath: props.rootRelPath,
      externalRefIds: [...payload.externalRefIds],
      setAsDefault: payload.setAsDefault
    })
    if (!result.ok) {
      ui.showToast('error', `资源关联失败：${result.message}`, 5000)
      return
    }
    selectedExternalRefIds.value = result.data.externalRefIds
    resourceDialogOpen.value = false
    ui.showToast('success', `已关联 ${result.data.externalRefIds.length} 个资源`)
  } finally {
    resourceSaving.value = false
  }
}

async function loadSourceProject(): Promise<void> {
  sourceLoading.value = true
  try {
    const result = await call('sourceProject.get', {
      workspaceId: props.workspaceId,
      projectRelPath: props.rootRelPath
    })
    if (result.ok) sourceProject.value = result.data
  } finally {
    sourceLoading.value = false
  }
}

async function associateSourceProject(): Promise<void> {
  if (sourceAssociating.value) return
  const picked = await call('system.selectDirectory', {
    title: '选择要关联的前端源码目录',
    buttonLabel: '关联源码'
  })
  if (!picked.ok) {
    ui.showToast('error', `选择目录失败：${picked.message}`)
    return
  }
  if (!picked.data) return
  sourceAssociating.value = true
  try {
    const result = await call('sourceProject.associate', {
      workspaceId: props.workspaceId,
      projectRelPath: props.rootRelPath,
      sourcePath: picked.data.path
    })
    if (!result.ok) {
      ui.showToast('error', `关联源码失败：${result.message}`, 5000)
      return
    }
    sourceProject.value = result.data
    ui.showToast('success', `${result.data.binding?.runtime.name ?? '源码'} 已关联`)
  } finally {
    sourceAssociating.value = false
  }
}

async function commitSourceProject(): Promise<void> {
  if (!sourceProject.value.binding || sourceCommitting.value) return
  const message = await ui.askPrompt({
    title: '提交源码',
    message: '只会提交当前项目的私有源码副本，不会提交 PRD、设计稿或 Mock 运行文件。',
    placeholder: '例如：feat: 调整订单列表布局',
    confirmLabel: '提交'
  })
  if (!message?.trim()) return
  sourceCommitting.value = true
  try {
    const result = await call('sourceProject.commit', {
      workspaceId: props.workspaceId,
      projectRelPath: props.rootRelPath,
      message
    })
    if (!result.ok) {
      ui.showToast('error', `提交源码失败：${result.message}`, 5000)
      return
    }
    sourceProject.value = result.data
    ui.showToast('success', '源码已提交')
  } finally {
    sourceCommitting.value = false
  }
}

async function toggleSourcePreview(): Promise<void> {
  if (!sourceProject.value.binding || sourceLaunching.value) return
  sourceLaunching.value = true
  try {
    const running = sourceProject.value.launch.state === 'running'
    const result = await call(running ? 'sourceProject.stop' : 'sourceProject.start', {
      workspaceId: props.workspaceId,
      projectRelPath: props.rootRelPath
    })
    if (!result.ok) {
      ui.showToast('error', `${running ? '停止' : '启动'}源码失败：${result.message}`, 5000)
      return
    }
    sourceProject.value = result.data
    if (!running && sourceLaunchUrl.value) {
      previewUrl.value = sourceLaunchUrl.value
      detailMode.value = 'preview'
    }
    ui.showToast('success', running ? '源码预览已停止' : '源码 Mock 预览已启动')
  } finally {
    sourceLaunching.value = false
  }
}
const sketchDirty = computed(() =>
  !!selectedFile.value && isSketchJsonFileName(selectedFile.value.relPath) && sketchContent.value !== sketchSavedContent.value
)
const isDirty = computed(() => textDirty.value || sketchDirty.value)
const canSave = computed(() => isDirty.value && !saving.value)
const selectedKind = computed<'empty' | 'sketch' | 'text' | 'image' | 'unsupported'>(() => {
  const file = selectedFile.value
  if (!file) return 'empty'
  if (isSketchJsonFileName(file.relPath)) return 'sketch'
  if (isProductImageFile(file.relPath)) return 'image'
  if (file.editable) return 'text'
  return 'unsupported'
})
const isSelectedMarkdown = computed(() =>
  selectedKind.value === 'text'
  && !!textSession.value
  && isMarkdownFilePath(textSession.value.relPath)
)
const isSelectedHtml = computed(() =>
  selectedKind.value === 'text'
  && !!textSession.value
  && /\.html?$/i.test(textSession.value.relPath)
)
const htmlWorkbenchTabMeta = computed(() =>
  previewStore.tabs.find(item => item.id === props.tabId)?.productMeta ?? null
)
const previewBarReloading = computed(() => loadingPreview.value || loadingContent.value)
const previewBarReloadDisabled = computed(() =>
  previewBarReloading.value || saving.value || uploading.value || deleting.value || creating.value
)
const htmlPreviewRef = ref<InstanceType<typeof HtmlPreviewSurface> | null>(null)
const htmlElementSelecting = ref(false)
const htmlElementEditing = ref(false)
const htmlRemarksVisible = ref(false)

function isMarkdownFilePath(relPath: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(relPath)
}

function imageAltText(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  return base || 'image'
}

function visibleProductFileTreeRows(
  nodes: ProductFileTreeNode[],
  expanded: Set<string>,
  depth = 0,
  rows: ProductFileTreeRow[] = []
): ProductFileTreeRow[] {
  for (const node of nodes) {
    rows.push({ node, depth })
    if (node.kind === 'folder' && expanded.has(node.relPath)) {
      visibleProductFileTreeRows(node.children, expanded, depth + 1, rows)
    }
  }
  return rows
}

function isFolderExpanded(node: Extract<ProductFileTreeNode, { kind: 'folder' }>): boolean {
  return expandedDirs.value.has(node.relPath)
}

function toggleFolder(node: Extract<ProductFileTreeNode, { kind: 'folder' }>): void {
  const next = new Set(expandedDirs.value)
  if (next.has(node.relPath)) next.delete(node.relPath)
  else next.add(node.relPath)
  expandedDirs.value = next
}

function ensureDefaultExpandedFolders(): void {
  const root = props.rootRelPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (appliedDefaultExpandRoot.value === root) return
  appliedDefaultExpandRoot.value = root
  const next = new Set(expandedDirs.value)
  for (const dir of defaultExpandedProductFolderPaths(root, files.value)) next.add(dir)
  expandedDirs.value = next
}

async function refreshGitChangeMarks(force = true): Promise<void> {
  const r = await call('git.snapshot', { workspaceId: props.workspaceId, force })
  if (!r.ok) {
    gitChangeMarks.value = new Map()
    return
  }
  const files = r.data.working.kind === 'dirty' ? r.data.working.files : []
  gitChangeMarks.value = productTreeChangeMarks(props.rootRelPath, files)
}

let gitMarkRefreshTimer: ReturnType<typeof setTimeout> | null = null
function scheduleGitMarkRefresh(): void {
  if (gitMarkRefreshTimer) clearTimeout(gitMarkRefreshTimer)
  gitMarkRefreshTimer = setTimeout(() => {
    gitMarkRefreshTimer = null
    void refreshGitChangeMarks(true)
  }, 200)
}

function treeRowChangeMark(row: ProductFileTreeRow): ProductFileChangeKind | null {
  if (row.node.kind !== 'file') return null
  const relPath = row.node.relPath.normalize('NFC')
  return gitChangeMarks.value.get(relPath)
    ?? gitChangeMarks.value.get(row.node.relPath)
    ?? null
}

function treeRowChangeLabel(row: ProductFileTreeRow): string {
  const mark = treeRowChangeMark(row)
  if (mark === 'added') return 'A'
  if (mark === 'modified') return 'M'
  return ''
}

function treeRowChangeTitle(row: ProductFileTreeRow): string {
  const mark = treeRowChangeMark(row)
  if (mark === 'added') return '新增'
  if (mark === 'modified') return '已修改'
  return treeRowTitle(row)
}

function expandSelectedAncestors(relPath: string | null): void {
  if (!relPath) return
  const dirs = productFileAncestorDirs(props.rootRelPath, relPath)
  if (dirs.length === 0) return
  const next = new Set(expandedDirs.value)
  for (const dir of dirs) next.add(dir)
  expandedDirs.value = next
}

function treeRowKey(row: ProductFileTreeRow): string {
  return row.node.relPath
}

function treeRowTitle(row: ProductFileTreeRow): string {
  return row.node.relPath
}

function treeRowName(row: ProductFileTreeRow): string {
  if (row.node.kind === 'folder') return row.node.name
  return productFileDisplayName(row.node.file, files.value)
}

function treeRowIcon(row: ProductFileTreeRow): string {
  if (row.node.kind === 'folder') return '/'
  return productFileIcon(row.node.file.name)
}

function treeRowDisclosure(row: ProductFileTreeRow): 'expanded' | 'collapsed' | 'file' {
  if (row.node.kind !== 'folder') return 'file'
  return isFolderExpanded(row.node) ? 'expanded' : 'collapsed'
}

function isTreeRowActive(row: ProductFileTreeRow): boolean {
  if (activeWebPage.value) return false
  return detailMode.value === 'edit' && row.node.kind === 'file' && selectedRelPath.value === row.node.file.relPath
}

function selectTreeRow(row: ProductFileTreeRow): void {
  if (row.node.kind === 'folder') {
    toggleFolder(row.node)
    return
  }
  selectFile(row.node.file)
}

function confirmDeleteTreeRow(row: ProductFileTreeRow): void {
  if (deleting.value) return
  const relPath = row.node.relPath
  const root = props.rootRelPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (relPath === root) return
  const isFolder = row.node.kind === 'folder'
  const name = treeRowName(row)
  const coversSelection = selectedRelPath.value === relPath
    || (!!selectedRelPath.value && selectedRelPath.value.startsWith(`${relPath}/`))
  const dirtyHint = coversSelection && isDirty.value ? '\n当前未保存改动会一起丢弃。' : ''
  ui.askConfirm({
    title: isFolder ? '删除文件夹' : '删除文件',
    message: isFolder
      ? `确定删除文件夹 ${name}？其中的文件会一并删除。${dirtyHint}`
      : `确定删除 ${name}？${dirtyHint}`,
    confirmLabel: '删除',
    onConfirm: () => { void deleteTreeEntry(relPath) }
  })
}

async function deleteTreeEntry(relPath: string): Promise<void> {
  deleting.value = true
  try {
    const nextRelPath = selectProductFileAfterDelete(files.value, relPath)
    const r = await call('editor.deleteEntry', {
      workspaceId: props.workspaceId,
      relPath,
      scope: 'project'
    })
    if (!r.ok) {
      ui.showToast('error', `删除失败：${r.message}`)
      return
    }
    const coversSelection = selectedRelPath.value === relPath
      || (!!selectedRelPath.value && selectedRelPath.value.startsWith(`${relPath}/`))
    if (coversSelection) {
      previewStore.setTabDirty(props.tabId, false)
      resetLoadedContent()
      selectedRelPath.value = nextRelPath
      detailMode.value = nextRelPath ? 'edit' : 'preview'
    }
    const nextExpanded = new Set(expandedDirs.value)
    nextExpanded.delete(relPath)
    expandedDirs.value = nextExpanded
    await reloadTree(true)
    if (detailMode.value === 'preview') await loadPreviewUrl(true)
    else if (coversSelection) await loadSelectedFile()
    previewStore.reloadAllProductTabs()
    ui.showToast('success', '已删除', 1600)
  } finally {
    deleting.value = false
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function reloadProductCardMeta(): Promise<void> {
  const workspaceId = props.workspaceId
  const rootRelPath = props.rootRelPath
  if (!rootRelPath.replace(/\\/g, '/').startsWith('outputs/')) {
    productCardMeta.value = null
    return
  }
  const meta = await loadUiProductCardMeta(workspaceId, rootRelPath)
  if (!disposed && props.workspaceId === workspaceId && props.rootRelPath === rootRelPath) productCardMeta.value = meta
}

async function reloadTree(keepSelection = true): Promise<void> {
  const workspaceId = props.workspaceId
  const rootRelPath = props.rootRelPath
  loadingTree.value = true
  error.value = null
  const r = await call('workspace.listFiles', {
    workspaceId,
    relDir: rootRelPath,
    recursive: true
  })
  if (disposed || props.workspaceId !== workspaceId || props.rootRelPath !== rootRelPath) return
  loadingTree.value = false
  if (!r.ok) {
    error.value = r.message
    files.value = []
    productCardMeta.value = null
    return
  }
  files.value = flattenProductFiles(r.data)
  await reloadProductCardMeta()
  if (disposed || props.workspaceId !== workspaceId || props.rootRelPath !== rootRelPath) return
  void refreshGitChangeMarks()
  ensureDefaultExpandedFolders()
  if (keepSelection && selectedRelPath.value && files.value.some((file) => file.relPath === selectedRelPath.value)) {
    expandSelectedAncestors(selectedRelPath.value)
    return
  }
  const preferred = [props.activeRelPath, props.primaryRelPath]
    .find((path) => path && files.value.some((file) => file.relPath === path))
  if (detailMode.value === 'edit' || (preferred && preferred === props.activeRelPath)) {
    selectedRelPath.value = preferred ?? (detailMode.value === 'edit' ? files.value[0]?.relPath ?? null : null)
  } else {
    selectedRelPath.value = null
  }
  expandSelectedAncestors(selectedRelPath.value)
}

function resetLoadedContent(): void {
  textSession.value = null
  sketchItems.value = []
  sketchSavedContent.value = ''
  sketchMtime.value = ''
  imageUrl.value = ''
  markdownPreviewBaseUrl.value = null
  markdownPreviewSrcdoc.value = ''
}

async function loadPreviewUrl(forceReload = false): Promise<void> {
  const seq = ++previewLoadSeq
  const file = isSelectedHtml.value ? selectedFile.value : previewFile.value
  previewUrl.value = ''
  if (!file) { loadingPreview.value = false; return }
  loadingPreview.value = true
  error.value = null
  try {
    const r = await call('preview.fileUrl', {
      workspaceId: props.workspaceId,
      relPath: file.relPath
    })
    if (seq !== previewLoadSeq) return
    if (!r.ok) {
      error.value = r.message
      return
    }
    previewUrl.value = forceReload ? withReloadStamp(r.data.url) : r.data.url
  } finally {
    if (seq === previewLoadSeq) loadingPreview.value = false
  }
}

function withReloadStamp(url: string): string {
  const stamp = Date.now()
  const [withoutHash, hash = ''] = url.split('#')
  const sep = withoutHash.includes('?') ? '&' : '?'
  const stamped = `${withoutHash}${sep}_t=${stamp}`
  return hash ? `${stamped}#${hash}` : stamped
}

async function loadSelectedFile(): Promise<void> {
  const seq = ++fileLoadSeq
  previewLoadSeq++
  const file = selectedFile.value
  resetLoadedContent()
  if (!file) { loadingContent.value = false; return }
  error.value = null
  const draft = fileDrafts.value[file.relPath]
  if (draft) {
    textSession.value = draft.text ? { ...draft.text } : null
    sketchItems.value = JSON.parse(JSON.stringify(draft.sketch))
    sketchSavedContent.value = draft.savedSketch
    sketchMtime.value = draft.sketchMtime
    markdownMode.value = draft.markdownMode
    loadingContent.value = false
    if (isMarkdownFilePath(file.relPath)) await loadMarkdownPreviewBaseUrl(file.relPath)
    else if (/\.html?$/i.test(file.relPath)) await loadPreviewUrl()
    return
  }
  loadingContent.value = true
  error.value = null
  try {
    if (isSketchJsonFileName(file.relPath)) {
      const r = await call('editor.readTextFile', {
        workspaceId: props.workspaceId,
        relPath: file.relPath,
        scope: 'project'
      })
      if (seq !== fileLoadSeq) return
      if (!r.ok) {
        error.value = r.message
        return
      }
      sketchItems.value = parseSketchDocument(r.data.content)
      sketchSavedContent.value = JSON.stringify(buildSketchDocument(sketchItems.value), null, 2) + '\n'
      sketchMtime.value = r.data.mtime
      return
    }
    if (isProductImageFile(file.relPath)) {
      const r = await call('preview.fileUrl', {
        workspaceId: props.workspaceId,
        relPath: file.relPath
      })
      if (seq !== fileLoadSeq) return
      if (!r.ok) {
        error.value = r.message
        return
      }
      imageUrl.value = r.data.url
      return
    }
    if (file.editable) {
      const r = await call('editor.readTextFile', {
        workspaceId: props.workspaceId,
        relPath: file.relPath,
        scope: 'project'
      })
      if (seq !== fileLoadSeq) return
      if (!r.ok) {
        error.value = r.message
        return
      }
      textSession.value = {
        relPath: file.relPath,
        content: r.data.content,
        savedContent: r.data.content,
        mtime: r.data.mtime
      }
      if (isMarkdownFilePath(file.relPath)) {
        markdownMode.value = 'preview'
        await loadMarkdownPreviewBaseUrl(file.relPath)
      } else if (/\.html?$/i.test(file.relPath)) {
        htmlMode.value = htmlModeByFile.value[file.relPath] ?? 'preview'
        await loadPreviewUrl()
      }
    }
  } finally {
    if (seq === fileLoadSeq) loadingContent.value = false
  }
}

async function loadMarkdownPreviewBaseUrl(relPath: string): Promise<void> {
  const r = await call('preview.fileUrl', {
    workspaceId: props.workspaceId,
    relPath
  })
  if (!r.ok || textSession.value?.relPath !== relPath) return
  try {
    markdownPreviewBaseUrl.value = new URL(r.data.url).origin
  } catch {
    markdownPreviewBaseUrl.value = null
  }
}

function selectFile(file: ProductFileItem): void {
  if (saving.value) { ui.showToast('info', '正在保存，请稍后切换文件'); return }
  browser.activate(browserScope.value, null)
  detailMode.value = 'edit'
  selectedRelPath.value = file.relPath
}

async function onDesignCreated(design: WebPageDesign): Promise<void> {
  const workspaceId = props.workspaceId
  const rootRelPath = props.rootRelPath
  const sourcePageId = activeWebPage.value?.id
  const isCurrent = () => !disposed && props.workspaceId === workspaceId && props.rootRelPath === rootRelPath
    && previewStore.activeTabId === props.tabId
  try {
    await reloadTree(true)
    if (!isCurrent() || activeWebPage.value?.id !== sourcePageId) return
    const file = files.value.find(item => item.relPath === design.relPath)
    if (!file) throw new Error(error.value || '文件列表未能读取到新设计稿')
    if (saving.value) {
      ui.showToast('info', `设计稿已保存到 ${design.relPath}，当前文件保存完成后可从文件树打开`, 6000)
      return
    }
    const { width, height } = design.viewport
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      previewStore.updateDevice(props.tabId, {
        deviceWidth: Math.round(width), deviceHeight: Math.round(height),
        devicePreset: WORKBENCH_CUSTOM_DEVICE_PRESET, responsive: false, rotate: false
      })
    }
    htmlModeByFile.value = { ...htmlModeByFile.value, [design.relPath]: 'preview' }
    selectFile(file)
    await loadSelectedFile()
    if (isCurrent() && selectedRelPath.value === design.relPath && (!textSession.value || !previewUrl.value)) {
      throw new Error(error.value || 'HTML 预览未能加载')
    }
  } catch (cause) {
    if (isCurrent()) {
      ui.showToast('error', `设计稿已保存到 ${design.relPath}，打开失败：${cause instanceof Error ? cause.message : String(cause)}`, 6000)
    }
  }
}

function setHtmlMode(mode: 'preview' | 'source'): void {
  const relPath = textSession.value?.relPath
  htmlMode.value = mode
  if (relPath) htmlModeByFile.value = { ...htmlModeByFile.value, [relPath]: mode }
  if (mode === 'source') {
    htmlElementSelecting.value = false
    htmlPreviewRef.value?.setElementSelecting(false)
    htmlElementEditing.value = false
    htmlPreviewRef.value?.setElementEditing(false)
  }
  if (mode === 'preview') void loadPreviewUrl()
}

function onHtmlPickElement(): void {
  htmlPreviewRef.value?.toggleElementSelecting()
}

function onHtmlToggleElementEdit(): void {
  htmlPreviewRef.value?.toggleElementEditing()
}

function onHtmlToggleRemarks(): void {
  htmlPreviewRef.value?.toggleRemarksVisible()
}

async function backToPreview(): Promise<void> {
  showProjectOverview()
}

function updateTextContent(content: string): void {
  if (!textSession.value) return
  textSession.value = { ...textSession.value, content }
}

async function refreshMarkdownPreview(): Promise<void> {
  const current = textSession.value
  if (!current || !isMarkdownFilePath(current.relPath)) {
    markdownPreviewSrcdoc.value = ''
    renderingMarkdownPreview.value = false
    return
  }
  const seq = ++markdownRenderSeq
  renderingMarkdownPreview.value = true
  const html = await renderMarkdownPreview({
    content: current.content,
    projectId: props.workspaceId,
    relPath: current.relPath,
    previewBaseUrl: markdownPreviewBaseUrl.value,
    theme: themeStore.theme
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    return `<!doctype html><html><body style="font:14px sans-serif;padding:24px;color:#9f1239;background:#fff1f2;">预览渲染失败：${message}</body></html>`
  })
  if (seq !== markdownRenderSeq) return
  markdownPreviewSrcdoc.value = html
  renderingMarkdownPreview.value = false
}

async function insertMarkdownShortcut(id: MarkdownShortcutId): Promise<void> {
  if (!isSelectedMarkdown.value) return
  if (markdownMode.value !== 'edit') {
    markdownMode.value = 'edit'
    await nextTick()
  }
  markdownSurfaceRef.value?.insertMarkdownShortcut(id)
}

async function handleMarkdownImageFiles(files: File[]): Promise<string | null> {
  const current = textSession.value
  if (!current || !isMarkdownFilePath(current.relPath)) return null
  const snippets: string[] = []
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const r = await call('editor.saveAsset', {
      workspaceId: props.workspaceId,
      contextRelPath: current.relPath,
      mimeType: file.type || 'application/octet-stream',
      dataBase64: bytesToBase64(bytes),
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

async function saveCurrent(): Promise<void> {
  const file = selectedFile.value
  if (!file || !canSave.value) return
  saving.value = true
  let saved = false
  try {
    if (isSketchJsonFileName(file.relPath)) {
      const content = sketchContent.value
      const r = await call('editor.writeTextFile', {
        workspaceId: props.workspaceId,
        relPath: file.relPath,
        content,
        expectedMtime: sketchMtime.value,
        scope: 'project'
      })
      if (!r.ok) {
        ui.showToast('error', `保存失败：${r.message}`)
        return
      }
      sketchMtime.value = r.data.mtime
      sketchSavedContent.value = content
      saved = true
      ui.showToast('success', `已保存 ${file.name}`, 1600)
      return
    }
    const current = textSession.value
    if (!current) return
    const r = await call('editor.writeTextFile', {
      workspaceId: props.workspaceId,
      relPath: current.relPath,
      content: current.content,
      expectedMtime: current.mtime,
      scope: 'project'
    })
    if (!r.ok) {
      ui.showToast('error', `保存失败：${r.message}`)
      return
    }
    textSession.value = {
      ...(textSession.value ?? current),
      mtime: r.data.mtime,
      savedContent: current.content
    }
    saved = true
    ui.showToast('success', `已保存 ${file.name}`, 1600)
  } finally {
    saving.value = false
    if (saved) {
      previewStore.reloadAllProductTabs()
      await reloadTree(true)
      if (isSelectedHtml.value) await loadPreviewUrl(true)
    }
  }
}

async function saveIfDirty(): Promise<void> {
  if (canSave.value) await saveCurrent()
}

function openUploadPicker(): void {
  fileInputRef.value?.click()
}

function normalizeNewFileRelPath(raw: string): string | null {
  const cleaned = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned || cleaned.endsWith('/')) return null
  const parts = cleaned.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return null
  const root = props.rootRelPath.replace(/\/+$/, '')
  if (cleaned === root) return null
  return cleaned.startsWith(`${root}/`) ? cleaned : `${root}/${cleaned}`
}

function defaultNewFileContent(relPath: string): string {
  if (isSketchJsonFileName(relPath)) return JSON.stringify(buildSketchDocument([]), null, 2) + '\n'
  if (/\.json$/i.test(relPath)) return '{}\n'
  return ''
}

async function createFileInTree(): Promise<void> {
  if (creating.value) return
  const value = await ui.askPrompt({
    title: '新建文件',
    message: `将在 ${props.rootRelPath}/ 下创建文件。可输入子目录，例如 assets/data.json。`,
    placeholder: '例如 notes.md / assets/data.json',
    confirmLabel: '新建'
  })
  if (value === null) return
  const relPath = normalizeNewFileRelPath(value)
  if (!relPath) {
    ui.showToast('error', '文件路径不合法')
    return
  }
  creating.value = true
  try {
    const exists = await call('editor.entryExists', {
      workspaceId: props.workspaceId,
      relPath,
      scope: 'project'
    })
    if (exists.ok && exists.data.exists) {
      ui.showToast('error', `已存在：${relPath}`)
      return
    }
    const r = await call('editor.writeTextFile', {
      workspaceId: props.workspaceId,
      relPath,
      content: defaultNewFileContent(relPath),
      scope: 'project'
    })
    if (!r.ok) {
      ui.showToast('error', `新建失败：${r.message}`)
      return
    }
    detailMode.value = 'edit'
    selectedRelPath.value = relPath
    await reloadTree(true)
    await loadSelectedFile()
    previewStore.reloadAllProductTabs()
    ui.showToast('success', `已新建 ${relPath}`, 1600)
  } finally {
    creating.value = false
  }
}

async function createSketchInTree(): Promise<void> {
  if (creating.value) return
  createMenuOpen.value = false
  const relPath = nextSketchFileRelPath(props.rootRelPath, files.value)
  creating.value = true
  try {
    const r = await call('editor.writeTextFile', {
      workspaceId: props.workspaceId,
      relPath,
      content: JSON.stringify(buildSketchDocument([]), null, 2) + '\n',
      scope: 'project'
    })
    if (!r.ok) {
      ui.showToast('error', `新建草图失败：${r.message}`)
      return
    }
    detailMode.value = 'edit'
    selectedRelPath.value = relPath
    await reloadTree(true)
    await loadSelectedFile()
    ui.showToast('success', `已新建 ${relPath}`, 1600)
  } finally {
    creating.value = false
  }
}

async function uploadFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const picked = [...(input.files ?? [])]
  input.value = ''
  if (picked.length === 0) return
  const fileNameError = picked
    .map((file) => productAssetUploadFileNameError(file.name))
    .find((message) => message !== null)
  if (fileNameError) {
    ui.showToast('error', fileNameError, 4200)
    return
  }
  uploading.value = true
  const targetRelDir = productAssetUploadDir(props.rootRelPath)
  let lastUploaded: string | null = null
  try {
    for (const file of picked) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const r = await call('editor.saveBinaryFile', {
        workspaceId: props.workspaceId,
        targetRelDir,
        mimeType: file.type || 'application/octet-stream',
        dataBase64: bytesToBase64(bytes),
        originalName: file.name
      })
      if (!r.ok) {
        ui.showToast('error', `上传失败：${r.message}`)
        return
      }
      lastUploaded = r.data.relPath
    }
    if (lastUploaded) {
      detailMode.value = 'edit'
      selectedRelPath.value = lastUploaded
    }
    await reloadTree(true)
    await loadSelectedFile()
    previewStore.reloadAllProductTabs()
    ui.showToast('success', `已上传 ${picked.length} 个文件`, 1600)
  } finally {
    uploading.value = false
  }
}

async function reloadSelectedFile(): Promise<void> {
  if (detailMode.value === 'preview') {
    await reloadTree(true)
    await loadPreviewUrl(true)
    return
  }
  await reloadTree(true)
  await loadSelectedFile()
}

function normalizeProductSlug(input: string): string {
  let rel = input.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!rel) throw new Error('请输入项目名称')
  if (rel.includes('..')) throw new Error('项目路径不能包含 ..')
  if (rel.startsWith('outputs/')) rel = rel.slice('outputs/'.length)
  rel = rel.replace(/\/index\.html?$/i, '').replace(/\.html?$/i, '')
  const segments = rel
    .split('/')
    .map((part) => part.trim().replace(/\s+/g, '-').replace(/[<>:"|?*]+/g, ''))
    .filter(Boolean)
  if (segments.length === 0) throw new Error('请输入有效的项目名称')
  return segments.join('/')
}

function normalizeFeatureSlug(input: string): string {
  let rel = input.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!rel) throw new Error('请输入项目名称')
  if (rel.includes('..')) throw new Error('项目路径不能包含 ..')
  if (rel.startsWith('features/')) rel = rel.slice('features/'.length)
  rel = rel.replace(/\/index\.html?$/i, '').replace(/\.html?$/i, '')
  const segments = rel
    .split('/')
    .map((part) => part.trim().replace(/\s+/g, '-').replace(/[<>:"|?*]+/g, ''))
    .filter(Boolean)
  if (segments.length === 0) throw new Error('请输入有效的项目名称')
  return segments.join('/')
}

function featureGroupOfRelPath(relPath: string): string | null {
  const stripped = relPath.replace(/^features\//, '')
  const segments = stripped.split('/').filter(Boolean)
  if (segments.length <= 1) return null
  return segments.slice(0, -1).join('/')
}

async function renameHeaderFile(): Promise<void> {
  if (!canRenameHeader.value) return
  const rootRelPath = props.rootRelPath.replace(/\\/g, '/').replace(/\/+$/, '')

  if (rootRelPath.startsWith('outputs/')) {
    const input = await ui.askUiProductRename({
      title: '编辑 UX 项目',
      message: '修改项目名称，或在高级设置里配置封面标签与 UX / PM 负责人。',
      productName: productCardMeta.value?.title ?? headerBrandTitle.value,
      coverTag: productCardMeta.value?.coverTag ?? '',
      uxName: productCardMeta.value?.uxName ?? '',
      pmName: productCardMeta.value?.pmName ?? '',
      confirmLabel: '保存',
    })
    if (!input) return
    let newName: string
    try {
      const normalized = normalizeProductSlug(input.name)
      if (normalized.includes('/')) {
        ui.showToast('error', '项目名称不能包含 /，如需改分组请在工作区列表操作')
        return
      }
      newName = normalized
    } catch (e) {
      ui.showToast('error', e instanceof Error ? e.message : String(e))
      return
    }
    const group = outputGroupOfRelPath(rootRelPath)
    const targetRelPath = group ? `outputs/${group}/${newName}` : `outputs/${newName}`
    if (targetRelPath !== rootRelPath) {
      const r = await call('editor.moveEntry', {
        workspaceId: props.workspaceId,
        sourceRelPath: rootRelPath,
        targetRelPath,
        scope: 'project',
      })
      if (!r.ok) {
        ui.showToast('error', `重命名失败：${r.message}`)
        return
      }
      previewStore.relocateProjectRoot(rootRelPath, targetRelPath, newName)
    }
    const saved = await saveUiProductCardMeta(props.workspaceId, targetRelPath, {
      title: input.name.trim(),
      coverTag: input.coverTag,
      uxName: input.uxName,
      pmName: input.pmName,
    })
    if (!saved.ok) {
      ui.showToast('error', `保存项目信息失败：${saved.message}`)
      return
    }
    productCardMeta.value = saved.card
    await reloadTree(true)
    if (detailMode.value === 'preview') await loadPreviewUrl(true)
    previewStore.reloadAllProductTabs()
    ui.showToast('success', targetRelPath !== rootRelPath ? '项目已更新' : '项目信息已保存')
    return
  }

  if (rootRelPath.startsWith('features/')) {
    const input = await ui.askPrompt({
      title: '重命名 PM 项目',
      message: `重命名 ${headerBrandTitle.value}。名称不能包含 / （如需改分组请在工作区列表操作）。`,
      placeholder: '例如：login-page',
      defaultValue: headerBrandTitle.value,
      confirmLabel: '重命名',
    })
    if (input === null) return
    let newSlug: string
    try {
      newSlug = normalizeFeatureSlug(input)
      if (newSlug.includes('/')) {
        ui.showToast('error', '重命名不支持包含 /')
        return
      }
    } catch (e) {
      ui.showToast('error', e instanceof Error ? e.message : String(e))
      return
    }
    if (newSlug === rootRelPath.split('/').filter(Boolean).at(-1)) return
    const r = await call('feature.rename', {
      workspaceId: props.workspaceId,
      relPath: rootRelPath,
      newSlug,
    })
    if (!r.ok) {
      ui.showToast('error', `重命名失败：${r.message}`)
      return
    }
    const group = featureGroupOfRelPath(rootRelPath)
    const targetRelPath = group ? `features/${group}/${newSlug}` : `features/${newSlug}`
    previewStore.relocateProjectRoot(rootRelPath, targetRelPath, newSlug)
    await reloadTree(true)
    if (detailMode.value === 'preview') await loadPreviewUrl(true)
    previewStore.reloadAllProductTabs()
    ui.showToast('success', '项目已重命名')
  }
}

function deleteHeaderFile(): void {
  if (!canDeleteHeader.value) return
  const rootRelPath = props.rootRelPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const dirtyHint = isDirty.value ? '\n当前未保存改动会一起丢弃。' : ''
  const isFeature = rootRelPath.startsWith('features/')
  ui.askConfirm({
    title: isFeature ? '删除 PM 项目' : '删除 UX 项目',
    message: `确定删除 ${headerBrandTitle.value}？这个操作会删除整个项目目录。${dirtyHint}`,
    confirmLabel: '删除',
    onConfirm: async () => {
      deleting.value = true
      const r = isFeature
        ? await call('feature.delete', { workspaceId: props.workspaceId, relPath: rootRelPath })
        : await call('editor.deleteEntry', {
            workspaceId: props.workspaceId,
            relPath: rootRelPath,
            scope: 'project',
          })
      deleting.value = false
      if (!r.ok) {
        ui.showToast('error', `删除失败：${r.message}`)
        return
      }
      previewStore.forceCloseTabsForRootRelPath(rootRelPath)
      ui.showToast('success', '项目已删除')
    },
  })
}

watch(selectedRelPath, (relPath, previous) => {
  cacheFile(previous)
  if (relPath && !openFilePaths.value.includes(relPath)) openFilePaths.value.push(relPath)
  expandSelectedAncestors(relPath)
  if (relPath) previewStore.setProductFilesActiveRelPath(props.tabId, relPath)
  if (detailMode.value === 'edit') void loadSelectedFile()
}, { flush: 'sync' })
watch(() => isDirty.value || Object.entries(fileDrafts.value).some(([path, draft]) => path !== selectedRelPath.value && draft.dirty), dirty => previewStore.setTabDirty(props.tabId, dirty), { immediate: true })
watch(
  () => [
    isSelectedMarkdown.value,
    textSession.value?.content,
    textSession.value?.relPath,
    markdownPreviewBaseUrl.value,
    themeStore.theme
  ],
  () => { void refreshMarkdownPreview() }
)
watch(() => props.rootRelPath, async () => {
  fileLoadSeq++
  resetLoadedContent()
  fileDrafts.value = {}
  openFilePaths.value = []
  workbenchTabOrder.value = []
  expandedDirs.value = new Set()
  appliedDefaultExpandRoot.value = null
  gitChangeMarks.value = new Map()
  selectedRelPath.value = props.activeRelPath ?? props.primaryRelPath ?? null
  detailMode.value = selectedRelPath.value ? 'edit' : 'preview'
  resetLoadedContent()
  await loadFeatureResources()
  await loadSourceProject()
  await reloadTree(false)
  if (detailMode.value === 'preview') await loadPreviewUrl()
  else await loadSelectedFile()
})
watch(() => props.primaryRelPath, async (relPath) => {
  if (!relPath) {
    if (detailMode.value !== 'preview') await backToPreview()
    return
  }
  if (relPath === selectedRelPath.value && detailMode.value === 'edit') return
  if (props.activeRelPath && props.activeRelPath !== relPath && selectedRelPath.value === props.activeRelPath) {
    return
  }
  detailMode.value = 'edit'
  selectedRelPath.value = relPath
  await reloadTree(true)
  await loadSelectedFile()
})
watch(
  () => previewStore.productFilesReloadToken(props.workspaceId, props.rootRelPath),
  async () => {
    cacheFile(selectedRelPath.value)
    await reloadTree(true)
    if (detailMode.value === 'preview') await loadPreviewUrl(true)
    else await loadSelectedFile()
  }
)
watch(() => previewFile.value?.relPath ?? '', () => {
  if (detailMode.value === 'preview') void loadPreviewUrl()
})
watch(
  () => props.workspaceId,
  (workspaceId, _previous, onCleanup) => {
    if (!workspaceId) return
    void refreshGitChangeMarks(true)
    const unsubscribeFs = window.events.on(`fs.change:${workspaceId}`, () => {
      scheduleGitMarkRefresh()
    })
    const unsubscribeRemote = window.events.on(`git.remote-updated:${workspaceId}`, () => {
      void refreshGitChangeMarks(true)
    })
    onCleanup(() => {
      unsubscribeFs()
      unsubscribeRemote()
    })
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  disposed = true
  fileLoadSeq++
  previewLoadSeq++
  if (gitMarkRefreshTimer) {
    clearTimeout(gitMarkRefreshTimer)
    gitMarkRefreshTimer = null
  }
})

function toggleTreeOpen(): void {
  treeOpen.value = !treeOpen.value
}

const showWorkbenchTopbar = computed(() => {
  if (previewStore.activeTabId !== props.tabId || !previewStore.isPreviewActive) return false
  if (activeWebPage.value) return true
  if (detailMode.value === 'preview') return true
  if (selectedKind.value === 'empty' || selectedKind.value === 'sketch') return true
  return !!(selectedFile.value || selectedRelPath.value)
})

onMounted(async () => {
  if (selectedRelPath.value && !openFilePaths.value.includes(selectedRelPath.value)) openFilePaths.value.push(selectedRelPath.value)
  void browser.initialize()
  previewStore.setTabLoaded(props.tabId)
  void loadFeatureResources()
  void loadSourceProject()
  if (props.activeRelPath) {
    detailMode.value = 'edit'
    selectedRelPath.value = props.activeRelPath
  } else {
    detailMode.value = props.primaryRelPath ? 'edit' : 'preview'
  }
  await reloadTree(true)
  if (detailMode.value === 'preview') await loadPreviewUrl()
  else await loadSelectedFile()
})
</script>

<template>
  <section class="product-files">
    <div v-if="error" class="product-files__error">{{ error }}</div>

    <Teleport v-if="showWorkbenchTopbar" to="#product-workbench-topbar">
      <ProjectBrowserTabs v-model:order="workbenchTabOrder" :scope="browserScope" :files="fileTabs" :active-file="detailMode === 'edit' ? selectedRelPath : null" :close-file="closeFileTab" @select-file="activateFileTab" @select-overview="showProjectOverview" />
      <div v-if="activeWebPage" class="product-files__workbench-topbar flex items-center gap-3 px-3">
        <ProductFilesBrandMenu :title="headerBrandTitle" :rename-disabled="!canRenameHeader" :delete-disabled="!canDeleteHeader" @rename="renameHeaderFile" @delete="deleteHeaderFile" />
      </div>
      <div v-else-if="detailMode === 'preview'" class="product-files__preview-head product-files__workbench-topbar product-workbench-bar">
        <ProductFilesBrandMenu
          :title="headerBrandTitle"
          :rename-disabled="!canRenameHeader"
          :delete-disabled="!canDeleteHeader"
          @rename="renameHeaderFile"
          @delete="deleteHeaderFile"
        />
        <div class="product-files__editor-actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="h-7 gap-1.5 px-2 text-xxs"
            @click="openResourceDialog"
          >
            <PackageOpen :size="13" aria-hidden="true" />
            关联资源
            <span class="product-files__resource-count">{{ selectedExternalRefIds.length }}</span>
          </Button>
          <Button
            v-if="sourceProject.state === 'unlinked'"
            type="button"
            variant="ghost"
            size="sm"
            class="h-7 gap-1.5 px-2 text-xxs"
            :disabled="sourceLoading || sourceAssociating"
            @click="associateSourceProject"
          >
            <GitBranch :size="13" aria-hidden="true" />
            {{ sourceAssociating ? '关联中…' : '关联源码' }}
          </Button>
          <span v-else-if="sourceProject.state === 'missing'" class="product-files__source-missing">源码副本缺失</span>
          <template v-else>
            <span class="product-files__source-state">{{ sourceProjectLabel }}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-7 gap-1.5 px-2 text-xxs"
              :disabled="sourceLaunching"
              @click="toggleSourcePreview"
            >
              {{ sourceLaunching ? '启动中…' : sourceProject.launch.state === 'running' ? '停止预览' : '运行 Mock' }}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-7 gap-1.5 px-2 text-xxs"
              :disabled="!sourceProject.dirty || sourceCommitting"
              @click="commitSourceProject"
            >
              <GitBranch :size="13" aria-hidden="true" />
              {{ sourceCommitting ? '提交中…' : '提交源码' }}
            </Button>
          </template>
          <Button variant="outline" size="sm" @click="ui.openBranchHistory({ workspaceId: props.workspaceId, relPath: activeTargetFile?.relPath ?? props.rootRelPath, initialView: 'pushes' })">变更记录</Button>
          <FeatureGitSubmitButton
            :workspace-id="props.workspaceId"
            :rel-dir="props.rootRelPath"
            :prepare="saveIfDirty"
            @done="refreshGitChangeMarks"
          />
        </div>
      </div>

      <div
        v-else-if="selectedKind === 'text' && textSession && selectedFile && isSelectedMarkdown"
        class="product-files__md-header product-files__workbench-topbar"
      >
        <div class="product-files__md-title-block">
          <div class="product-files__md-title-row">
            <ProductFilesBrandMenu
              :title="headerBrandTitle"
              :rename-disabled="!canRenameHeader"
              :delete-disabled="!canDeleteHeader"
              @rename="renameHeaderFile"
              @delete="deleteHeaderFile"
            />
            <span class="product-files__md-pill">MARKDOWN</span>
                <span v-if="textDirty" class="product-files__dirty">未保存</span>
          </div>
        </div>
        <div class="product-files__editor-actions">
          <Button type="button" variant="outline" size="sm" class="text-xxs" :disabled="loadingContent" @click="reloadSelectedFile">重载</Button>
          <Button type="button" variant="outline" size="sm" class="text-xs" :disabled="!canSave" @click="saveCurrent">
            {{ saving ? '保存中…' : '保存' }}
          </Button>
          <FeatureGitSubmitButton
            :workspace-id="props.workspaceId"
            :rel-dir="props.rootRelPath"
            :prepare="saveIfDirty"
            @done="refreshGitChangeMarks"
          />
        </div>
      </div>

      <div
        v-else-if="selectedKind === 'text' && textSession && selectedFile && isSelectedHtml"
        class="product-files__editor-head product-files__workbench-topbar product-workbench-bar"
      >
        <ProductFilesBrandMenu
          :title="headerBrandTitle"
          :rename-disabled="!canRenameHeader"
          :delete-disabled="!canDeleteHeader"
          @rename="renameHeaderFile"
          @delete="deleteHeaderFile"
        />
        <div class="product-files__editor-actions">
          <span v-if="textDirty" class="product-files__dirty">未保存</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="product-workbench-action-btn text-xs"
            :disabled="!canSave"
            @click="saveCurrent"
          >
            {{ saving ? '保存中…' : '保存' }}
          </Button>
          <Button variant="outline" size="sm" @click="ui.openBranchHistory({ workspaceId: props.workspaceId, relPath: activeTargetFile?.relPath ?? props.rootRelPath, initialView: 'pushes' })">变更记录</Button>
          <FeatureGitSubmitButton
            :workspace-id="props.workspaceId"
            :rel-dir="props.rootRelPath"
            :prepare="saveIfDirty"
            @done="refreshGitChangeMarks"
          />
        </div>
      </div>

      <div
        v-else-if="selectedKind === 'text' && textSession && selectedFile"
        class="product-files__editor-head product-files__workbench-topbar"
      >
        <ProductFilesBrandMenu
          :title="headerBrandTitle"
          :rename-disabled="!canRenameHeader"
          :delete-disabled="!canDeleteHeader"
          @rename="renameHeaderFile"
          @delete="deleteHeaderFile"
        />
        <div class="product-files__editor-actions">
          <span v-if="textDirty" class="product-files__dirty">未保存</span>
          <Button type="button" variant="outline" size="sm" class="text-xxs" :disabled="loadingContent" @click="reloadSelectedFile">重载</Button>
          <Button type="button" variant="outline" size="sm" class="text-xs" :disabled="!canSave" @click="saveCurrent">
            {{ saving ? '保存中…' : '保存' }}
          </Button>
          <FeatureGitSubmitButton
            :workspace-id="props.workspaceId"
            :rel-dir="props.rootRelPath"
            :prepare="saveIfDirty"
            @done="refreshGitChangeMarks"
          />
        </div>
      </div>

      <div v-else-if="selectedKind === 'image' && selectedFile" class="product-files__image-head product-files__workbench-topbar">
        <ProductFilesBrandMenu
          :title="headerBrandTitle"
          :rename-disabled="!canRenameHeader"
          :delete-disabled="!canDeleteHeader"
          @rename="renameHeaderFile"
          @delete="deleteHeaderFile"
        />
        <div class="product-files__editor-actions">
          <Button type="button" variant="outline" size="sm" class="text-xxs" :disabled="loadingContent" @click="reloadSelectedFile">重载</Button>
          <FeatureGitSubmitButton
            :workspace-id="props.workspaceId"
            :rel-dir="props.rootRelPath"
            :prepare="saveIfDirty"
            @done="refreshGitChangeMarks"
          />
        </div>
      </div>

      <div v-else-if="selectedFile" class="product-files__editor-head product-files__workbench-topbar">
        <ProductFilesBrandMenu
          :title="headerBrandTitle"
          :rename-disabled="!canRenameHeader"
          :delete-disabled="!canDeleteHeader"
          @rename="renameHeaderFile"
          @delete="deleteHeaderFile"
        />
        <div class="product-files__editor-actions">
          <Button type="button" variant="outline" size="sm" class="text-xxs" :disabled="loadingContent" @click="reloadSelectedFile">重载</Button>
          <FeatureGitSubmitButton
            :workspace-id="props.workspaceId"
            :rel-dir="props.rootRelPath"
            :prepare="saveIfDirty"
            @done="refreshGitChangeMarks"
          />
        </div>
      </div>
    </Teleport>

    <div class="product-files__body">
      <aside v-show="treeOpen && !activeWebPage" class="product-files__list">
        <div class="product-files__tree-toolbar">
          <span class="product-files__tree-title">目录树</span>
          <div class="product-files__tree-actions">
            <div class="product-files__create-menu-wrap">
              <Button type="button" variant="outline" size="sm" class="h-6 px-2 text-xxs" :disabled="creating" @click="createMenuOpen = !createMenuOpen">
                {{ creating ? '新建中…' : '新建文件' }}
              </Button>
              <div v-if="createMenuOpen" class="product-files__create-menu">
                <button type="button" @click="createMenuOpen = false; createFileInTree()">新建文件</button>
                <button type="button" @click="createSketchInTree">新建草图</button>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" class="h-6 px-2 text-xxs" :disabled="uploading" @click="openUploadPicker">
              {{ uploading ? '上传中…' : '上传' }}
            </Button>
          </div>
          <input ref="fileInputRef" type="file" multiple class="hidden" @change="uploadFiles">
        </div>
        <div v-if="loadingTree" class="product-files__muted">扫描中…</div>
        <template v-else-if="fileTreeRows.length">
          <div
            v-for="row in fileTreeRows"
            :key="treeRowKey(row)"
            role="button"
            tabindex="0"
            class="product-files__item product-files__tree-row"
            :class="{
              'is-active': isTreeRowActive(row),
              'is-folder': row.node.kind === 'folder',
              'is-changed': !!treeRowChangeMark(row)
            }"
            :title="treeRowChangeTitle(row)"
            @click="selectTreeRow(row)"
            @contextmenu.prevent="confirmDeleteTreeRow(row)"
            @keydown.enter.prevent="selectTreeRow(row)"
            @keydown.space.prevent="selectTreeRow(row)"
            @keydown.delete.prevent="confirmDeleteTreeRow(row)"
            @keydown.backspace.prevent="confirmDeleteTreeRow(row)"
          >
            <span class="product-files__tree-guides" aria-hidden="true">
              <span
                v-for="level in row.depth"
                :key="level"
                class="product-files__tree-guide"
              />
            </span>
            <span class="product-files__twisty" aria-hidden="true">
              <ChevronDown v-if="treeRowDisclosure(row) === 'expanded'" :size="11" :stroke-width="2.2" />
              <ChevronRight v-else-if="treeRowDisclosure(row) === 'collapsed'" :size="11" :stroke-width="2.2" />
            </span>
            <span class="product-files__icon" aria-hidden="true">
              <BookOpen
                v-if="row.node.kind === 'folder' && isDocFolderName(row.node.name)"
                :size="13"
                :stroke-width="2"
              />
              <FolderOpen
                v-else-if="row.node.kind === 'folder' && isFolderExpanded(row.node)"
                :size="13"
                :stroke-width="2"
              />
              <Folder
                v-else-if="row.node.kind === 'folder'"
                :size="13"
                :stroke-width="2"
              />
              <template v-else>{{ treeRowIcon(row) }}</template>
            </span>
            <span class="product-files__item-main">
              <span class="product-files__item-name">{{ treeRowName(row) }}</span>
              <span
                v-if="treeRowChangeMark(row)"
                class="product-files__change"
                :class="`is-${treeRowChangeMark(row)}`"
              >{{ treeRowChangeLabel(row) }}</span>
            </span>
            <button
              type="button"
              class="product-files__tree-delete"
              :disabled="deleting"
              title="删除"
              @click.stop="confirmDeleteTreeRow(row)"
            >删除</button>
          </div>
        </template>
        <div v-else class="product-files__muted">目录为空</div>
      </aside>

      <main class="product-files__detail">
        <template v-if="activeWebPage">
          <ProjectBrowserPane :scope="browserScope" :page-id="activeWebPage.id" :visible="previewStore.activeTabId === props.tabId" @design-created="onDesignCreated" />
        </template>
        <template v-else>
        <div
          v-if="!isSelectedMarkdown && !(isSelectedHtml && htmlWorkbenchTabMeta) && !(detailMode === 'preview' && previewUrl)"
          class="flex shrink-0 items-center border-b border-border px-2 py-1"
        >
          <ProductFilesTreeToggle :open="treeOpen" @toggle="toggleTreeOpen" />
        </div>
        <template v-if="detailMode === 'preview'">
          <div class="product-files__preview-wrap">
            <div v-if="loadingPreview" class="product-files__center">加载预览中…</div>
            <HtmlPreviewSurface
              v-else-if="previewUrl"
              :tab-id="props.tabId"
              :workspace-id="props.workspaceId"
              :rel-path="previewFile?.relPath ?? previewDisplayPath"
              :editable-root-path="props.rootRelPath"
              :url="previewUrl"
              show-tree-toggle
              show-reload
              :tree-open="treeOpen"
              :reloading="previewBarReloading"
              :reload-disabled="previewBarReloadDisabled"
              @toggle-tree="toggleTreeOpen"
              @reload="reloadSelectedFile"
            />
            <div v-else class="product-files__center">当前目录没有可预览的 HTML 文件。</div>
          </div>
        </template>
        <div v-else-if="loadingContent" class="product-files__center">加载中…</div>
        <div v-else-if="selectedKind === 'empty'" class="product-files__center">选择一个文件查看</div>
        <template v-else-if="selectedKind === 'sketch' && selectedFile">
          <SketchEditor
            v-model="sketchItems"
            :file-name="productFileDisplayName(selectedFile, files)"
            :dirty="sketchDirty"
            :saving="saving"
            @save="saveCurrent"
          />
        </template>
        <template v-else-if="selectedKind === 'text' && textSession && selectedFile && isSelectedMarkdown">
          <section class="product-files__md-pane">
            <div class="product-files__md-toolbar">
              <ProductFilesTreeToggle :open="treeOpen" @toggle="toggleTreeOpen" />
              <span class="product-files__md-toolbar-label">查看模式</span>
              <div class="product-files__md-seg">
                <button
                  type="button"
                  class="product-files__md-seg-btn"
                  :class="{ 'is-active': markdownMode === 'preview' }"
                  @click="markdownMode = 'preview'"
                >预览</button>
                <button
                  type="button"
                  class="product-files__md-seg-btn"
                  :class="{ 'is-active': markdownMode === 'edit' }"
                  @click="markdownMode = 'edit'"
                >编辑</button>
              </div>
              <span class="product-files__md-toolbar-label">快捷插入</span>
              <div class="product-files__md-seg">
                <button type="button" class="product-files__md-tool-btn" @click="insertMarkdownShortcut('emphasis')">强调</button>
                <button type="button" class="product-files__md-tool-btn" @click="insertMarkdownShortcut('heading')">标题</button>
                <button type="button" class="product-files__md-tool-btn" @click="insertMarkdownShortcut('quote')">引用</button>
                <button type="button" class="product-files__md-tool-btn" @click="insertMarkdownShortcut('table')">表格</button>
                <button type="button" class="product-files__md-tool-btn" @click="insertMarkdownShortcut('chart')">图表</button>
              </div>
            </div>
            <div class="product-files__md-body">
              <div v-if="markdownMode === 'edit'" class="product-files__md-editor">
                <CodeMirrorSurface
                  ref="markdownSurfaceRef"
                  :model-value="textSession.content"
                  :language="productFileLanguageExtension(textSession.relPath)"
                  text-variant="markdown"
                  :handle-image-files="handleMarkdownImageFiles"
                  :on-save="saveCurrent"
                  @update:model-value="updateTextContent"
                />
              </div>
              <div v-else class="product-files__md-preview">
                <div v-if="renderingMarkdownPreview" class="product-files__md-rendering">渲染中…</div>
                <iframe
                  class="product-files__md-preview-frame"
                  sandbox="allow-same-origin"
                  :srcdoc="markdownPreviewSrcdoc"
                  title="Markdown 预览"
                />
              </div>
            </div>
          </section>
        </template>
        <template v-else-if="selectedKind === 'text' && textSession && selectedFile && isSelectedHtml">
          <section class="product-files__html-pane">
            <PreviewSizeBar
              v-if="htmlWorkbenchTabMeta"
              :tab-id="props.tabId"
              :element-selecting="htmlElementSelecting"
              :element-editing="htmlElementEditing"
              :remarks-visible="htmlRemarksVisible"
              :show-preview-controls="htmlMode === 'preview'"
              show-tree-toggle
              show-reload
              show-html-view-mode
              :html-mode="htmlMode"
              :tree-open="treeOpen"
              :reloading="previewBarReloading"
              :reload-disabled="previewBarReloadDisabled"
              :preview-rel-path="textSession.relPath"
              @pick-element="onHtmlPickElement"
              @toggle-element-edit="onHtmlToggleElementEdit"
              @toggle-remarks="onHtmlToggleRemarks"
              @toggle-tree="toggleTreeOpen"
              @update:html-mode="setHtmlMode"
              @reload="reloadSelectedFile"
            />
            <div class="product-files__html-body">
              <div v-show="htmlMode === 'preview'" class="product-files__preview-wrap">
                <div v-if="loadingPreview" class="product-files__center">加载预览中…</div>
                <HtmlPreviewSurface
                  v-else-if="previewUrl"
                  ref="htmlPreviewRef"
                  suppress-size-bar
                  :tab-id="props.tabId"
                  :workspace-id="props.workspaceId"
                  :rel-path="textSession.relPath"
                  :editable-root-path="props.rootRelPath"
                  :url="previewUrl"
                  show-tree-toggle
                  :tree-open="treeOpen"
                  @toggle-tree="toggleTreeOpen"
                  @element-selecting-change="htmlElementSelecting = $event"
                  @element-editing-change="htmlElementEditing = $event"
                  @remarks-visible-change="htmlRemarksVisible = $event"
                />
                <div v-else class="product-files__center">预览加载失败，可切换到源码模式检查。</div>
              </div>
              <div v-show="htmlMode === 'source'" class="product-files__editor">
                <CodeMirrorSurface
                  :model-value="textSession.content"
                  :language="productFileLanguageExtension(textSession.relPath)"
                  :on-save="saveCurrent"
                  @update:model-value="updateTextContent"
                />
              </div>
            </div>
          </section>
        </template>
        <template v-else-if="selectedKind === 'text' && textSession && selectedFile">
          <div class="product-files__editor">
            <CodeMirrorSurface
              :model-value="textSession.content"
              :language="productFileLanguageExtension(textSession.relPath)"
              :on-save="saveCurrent"
              @update:model-value="updateTextContent"
            />
          </div>
        </template>
        <template v-else-if="selectedKind === 'image' && selectedFile">
          <div class="product-files__image-wrap">
            <img :src="imageUrl" :alt="selectedFile.name" class="product-files__image">
          </div>
        </template>
        <template v-else-if="selectedFile">
          <div class="product-files__unsupported">
            <div class="product-files__center">
              <div class="text-xs text-muted-foreground">这个文件类型暂不支持内嵌查看。</div>
            </div>
          </div>
        </template>
        </template>
      </main>
    </div>

    <FeatureResourceDialog
      v-model:open="resourceDialogOpen"
      :resources="externalRefs.pool"
      :selected-ids="selectedExternalRefIds"
      :busy="resourceSaving"
      title="调整项目资源"
      description="调整当前项目可使用的知识库和 UX 资产，不影响其他项目。"
      @save="saveFeatureResources"
    />
  </section>
</template>

<style scoped>
.product-files {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-bg-base);
}
.product-files__project-bar {
  display: flex;
  min-height: 38px;
  flex: 0 0 38px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg-panel);
  padding: 0 10px 0 12px;
}
.product-files__project-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  color: var(--color-text-primary);
  font-size: 12px;
}
.product-files__project-heading strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 650;
}
.product-files__project-label {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 600;
}
.product-files__project-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; }
.product-files__resource-count { display: inline-flex; min-width: 17px; height: 17px; align-items: center; justify-content: center; border-radius: 999px; background: var(--color-accent-light); color: var(--color-accent); font-size: 9px; font-weight: 700; }
.product-files__error {
  flex-shrink: 0;
  border-bottom: 1px solid rgba(220,38,38,0.18);
  background: #fff1f2;
  padding: 7px 12px;
  font-size: 12px;
  color: #be123c;
}
.product-files__body {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
}
.product-files__list {
  flex: 0 0 240px;
  width: 240px;
  min-width: 0;
  overflow: auto;
  border-right: 1px solid var(--color-border-subtle);
  background: var(--color-bg-panel);
  padding: 6px;
}
.product-files__tree-toolbar {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: -6px -6px 4px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg-panel);
  padding: 6px;
}
.product-files__tree-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 650;
  color: var(--color-text-muted, #64748b);
}
.product-files__tree-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}
.product-files__create-menu-wrap {
  position: relative;
}
.product-files__create-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  width: 112px;
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  border-radius: 7px;
  background: var(--color-bg-panel);
  box-shadow: 0 10px 30px rgba(15,23,42,0.12);
  padding: 4px;
}
.product-files__create-menu button {
  display: block;
  width: 100%;
  border-radius: 5px;
  padding: 6px 8px;
  text-align: left;
  font-size: 11px;
  color: var(--color-text-secondary, #334155);
}
.product-files__create-menu button:hover {
  background: var(--color-bg-subtle);
}
.product-files__item {
  display: flex;
  width: 100%;
  height: 26px;
  align-items: center;
  gap: 3px;
  border-radius: 5px;
  padding: 0 4px;
  text-align: left;
  color: var(--color-text-secondary, #334155);
  cursor: pointer;
  user-select: none;
}
.product-files__item:hover {
  background: var(--color-bg-subtle);
}
.product-files__item.is-active {
  background: var(--color-accent-light);
  color: var(--color-accent-pressed);
}
.product-files__item.is-folder {
  font-weight: 600;
}
.product-files__tree-guides {
  display: flex;
  height: 100%;
  flex-shrink: 0;
}
.product-files__tree-guide {
  position: relative;
  width: 12px;
  height: 100%;
  flex-shrink: 0;
  border-left: 1px solid color-mix(in srgb, var(--color-border-subtle) 78%, transparent);
}
.product-files__tree-guide:last-child::after {
  position: absolute;
  top: 50%;
  left: 0;
  width: 7px;
  border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 78%, transparent);
  content: '';
}
.product-files__twisty {
  display: inline-flex;
  width: 12px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted, #64748b);
}
.product-files__icon {
  display: inline-flex;
  width: 16px;
  height: 20px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted, #64748b);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}
.product-files__item.is-active .product-files__icon,
.product-files__item.is-folder .product-files__icon {
  color: currentColor;
}
.product-files__item-main {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  gap: 6px;
}
.product-files__item-name {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
}
.product-files__item.is-folder .product-files__item-name,
.product-files__item.is-active .product-files__item-name {
  font-weight: 650;
}
.product-files__change {
  flex-shrink: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}
.product-files__change.is-added {
  color: #16a34a;
}
.product-files__change.is-modified {
  color: #d97706;
}
.product-files__tree-delete {
  display: none;
  flex-shrink: 0;
  margin-left: 4px;
  border: 0;
  background: transparent;
  padding: 0 2px;
  color: var(--color-text-muted, #64748b);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}
.product-files__item:hover .product-files__tree-delete,
.product-files__item:focus-within .product-files__tree-delete {
  display: inline-flex;
}
.product-files__tree-delete:hover,
.product-files__tree-delete:focus-visible {
  color: var(--color-destructive, #dc2626);
}
.product-files__muted,
.product-files__center {
  color: var(--color-text-muted, #64748b);
  font-size: 12px;
}
.product-files__muted {
  padding: 10px;
}
.product-files__detail {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
  background: var(--color-bg-panel);
}
.product-files__workbench-topbar {
  width: 100%;
  box-sizing: border-box;
}
.product-files__center {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.product-files__editor-head,
.product-files__image-head,
.product-files__preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.product-files__editor-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
}
.product-files__editor-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 650;
  color: var(--color-text-primary, #0f172a);
}
.product-files__editor-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--color-text-muted, #64748b);
}
.product-files__dirty {
  flex-shrink: 0;
  border-radius: 999px;
  background: #fef3c7;
  padding: 2px 8px;
  font-size: 10px;
  color: #b45309;
}
.product-files__md-pane {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  background: var(--color-bg-panel);
}
.product-files__md-header {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg-panel);
  padding: 14px 18px 10px;
}
.product-files__md-title-block {
  min-width: 0;
  flex: 1 1 auto;
}
.product-files__md-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.product-files__md-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary, #0f172a);
}
.product-files__md-pill {
  flex-shrink: 0;
  border-radius: 999px;
  background: #eef2f7;
  padding: 2px 10px;
  font-size: 10px;
  line-height: 16px;
  color: #64748b;
}
.product-files__md-toolbar {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--color-border-subtle);
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg-panel);
  padding: 14px 18px;
}
.product-files__md-toolbar-label {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--color-text-muted, #64748b);
}
.product-files__md-seg {
  display: flex;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: var(--color-bg-panel);
}
.product-files__md-seg-btn,
.product-files__md-tool-btn {
  height: 28px;
  flex-shrink: 0;
  border-left: 1px solid #e2e8f0;
  padding: 0 12px;
  font-size: 12px;
  line-height: 1;
  color: #64748b;
  transition: background-color 0.12s, color 0.12s;
}
.product-files__md-seg-btn:first-child,
.product-files__md-tool-btn:first-child {
  border-left: 0;
}
.product-files__md-seg-btn.is-active {
  background: #0f172a;
  color: #fff;
}
.product-files__md-seg-btn:not(.is-active):hover,
.product-files__md-tool-btn:hover {
  background: var(--color-bg-subtle);
  color: #0f172a;
}
.product-files__md-body {
  flex: 1 1 auto;
  min-height: 0;
}
.product-files__md-editor,
.product-files__md-preview,
.product-files__md-preview-frame {
  height: 100%;
  min-height: 0;
}
.product-files__md-preview {
  position: relative;
  overflow: hidden;
  background: var(--color-bg-base);
}
.product-files__md-preview-frame {
  display: block;
  width: 100%;
  border: 0;
  background: var(--color-bg-panel);
}
.product-files__md-rendering {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
  border-radius: 999px;
  background: rgba(255,255,255,0.92);
  box-shadow: 0 8px 24px rgba(15,23,42,0.08);
  padding: 4px 10px;
  font-size: 11px;
  color: #64748b;
}
.product-files__editor {
  flex: 1 1 auto;
  min-height: 0;
}
.product-files__html-pane {
  display: flex;
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}
.product-files__html-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
}
.product-files__html-body .product-files__preview-wrap,
.product-files__html-body .product-files__editor {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
}
.product-files__preview-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background: var(--color-bg-base);
}
.product-files__image-wrap {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background:
    linear-gradient(45deg, var(--color-bg-subtle) 25%, transparent 25%),
    linear-gradient(-45deg, var(--color-bg-subtle) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--color-bg-subtle) 75%),
    linear-gradient(-45deg, transparent 75%, var(--color-bg-subtle) 75%);
  background-color: var(--color-bg-panel);
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  background-size: 20px 20px;
  padding: 24px;
}
.product-files__image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-panel);
  object-fit: contain;
}
.product-files__unsupported {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
}
.product-files__unsupported .product-files__center {
  flex: 1 1 auto;
  height: auto;
}
</style>
