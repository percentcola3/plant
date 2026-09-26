import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const tabBarSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/layout/TopBar.vue'),
  'utf-8'
)
const sizeBarSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/preview/PreviewSizeBar.vue'),
  'utf-8'
)
const panelSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/preview/PreviewPanel.vue'),
  'utf-8'
)
const productFilesSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/preview/ProductFilesTabPane.vue'),
  'utf-8'
)
const htmlPreviewSurfacePath = join(
  process.cwd(),
  'src/renderer/src/components/preview/HtmlPreviewSurface.vue'
)
const indexCssSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/styles/index.css'),
  'utf-8'
)
const htmlPreviewSurfaceSource = existsSync(htmlPreviewSurfacePath)
  ? readFileSync(htmlPreviewSurfacePath, 'utf-8')
  : ''

describe('preview toolbar inspector actions', () => {
  it('removes guide and Claude insertion actions from the top toolbar', () => {
    expect(tabBarSource).not.toContain('调整诉求')
    expect(tabBarSource).not.toContain('沉淀到 AI')
    expect(tabBarSource).not.toContain('拾取元素')
    expect(tabBarSource).not.toContain('新手引导')
    expect(tabBarSource).not.toContain('插入到 Claude Code')
    expect(tabBarSource).not.toContain('inspectorRequest')
    expect(tabBarSource).not.toContain("emit('update:inspectorRequest'")
    expect(tabBarSource).not.toContain('InspectorAction')
    expect(tabBarSource).not.toContain('inspectorAction')
    expect(tabBarSource).not.toContain("emit('inspectorAction'")
    expect(tabBarSource).not.toContain("emit('inspectorAction', 'pick')")
    expect(tabBarSource).not.toContain("emit('inspectorAction', 'insert-distill')")
  })

  it('separates persistent element references from persistent element tuning', () => {
    expect(sizeBarSource).toContain('PreviewInspectorTools')
    expect(sizeBarSource).toContain('elementSelecting')
    expect(sizeBarSource).toContain('elementEditing')
    expect(sizeBarSource).toContain("emit('pick-element')")
    expect(sizeBarSource).toContain("emit('toggle-element-edit')")
    expect(htmlPreviewSurfaceSource).toContain('__uikit_pick_once__')
    expect(htmlPreviewSurfaceSource).toContain('__uikit_element_edit_mode__')
    expect(htmlPreviewSurfaceSource).toContain('@pick-element="toggleElementSelecting"')
    expect(htmlPreviewSurfaceSource).toContain('@toggle-element-edit="toggleElementEditing"')
    expect(htmlPreviewSurfaceSource).toContain('<ElementTuningPanel')
  })

  it('keeps home as the fixed title-bar tab', () => {
    const homeButtonIndex = tabBarSource.indexOf('class="app-tabbar__home"')

    expect(homeButtonIndex).toBeGreaterThanOrEqual(0)
    expect(tabBarSource).toContain('aria-label="Home"')
  })

  it('labels the remarks toggle as a show/hide remarks action', () => {
    expect(sizeBarSource).toContain('PreviewInspectorTools')
    expect(sizeBarSource).toContain("emit('toggle-remarks')")
    expect(sizeBarSource).not.toContain('>📝 备注</Button>')
    expect(sizeBarSource).not.toContain('>📝 {{ props.remarksVisible ?')
  })

  it('resends remark visibility after iframe reloads', () => {
    const onLoadStart = htmlPreviewSurfaceSource.indexOf('function onLoad')
    const onLoadEnd = htmlPreviewSurfaceSource.indexOf('function onError')
    const onLoadBlock = htmlPreviewSurfaceSource.slice(onLoadStart, onLoadEnd)

    expect(onLoadStart).toBeGreaterThanOrEqual(0)
    expect(onLoadBlock).toContain('postRemarksVisible()')
  })

  it('restores persistent element selection after an iframe reload', () => {
    const onLoadStart = htmlPreviewSurfaceSource.indexOf('function onLoad')
    const onLoadEnd = htmlPreviewSurfaceSource.indexOf('function onError')
    const onLoadBlock = htmlPreviewSurfaceSource.slice(onLoadStart, onLoadEnd)

    expect(onLoadBlock).toContain('if (elementSelecting.value) postPickOnce()')
  })

  it('keeps element selection enabled after inserting a picked chip', () => {
    const insertChipStart = htmlPreviewSurfaceSource.indexOf("if (data.type === '__uikit_insert_chip__')")
    const requestSyncStart = htmlPreviewSurfaceSource.indexOf("if (data.type === '__uikit_request_sync__'")
    const insertChipBlock = htmlPreviewSurfaceSource.slice(insertChipStart, requestSyncStart)

    expect(insertChipStart).toBeGreaterThanOrEqual(0)
    expect(insertChipBlock).toContain('__uikit_host_insert_chip__')
    expect(insertChipBlock).not.toContain('elementSelecting.value = false')
    expect(insertChipBlock).not.toContain("emit('element-selecting-change', false)")
  })

  it('moves sketch creation out of the title toolbar', () => {
    expect(tabBarSource).not.toContain('新建草图')
    expect(tabBarSource).not.toContain('createSketchFromToolbar')
    expect(productFilesSource).toContain('新建草图')
  })

  it('does not bridge preview requests into Claude Code', () => {
    expect(htmlPreviewSurfaceSource).toContain('activeInspectorRequest')
    expect(htmlPreviewSurfaceSource).toContain('__uikit_request_set__')
    expect(htmlPreviewSurfaceSource).toContain('__uikit_request_sync__')
    expect(htmlPreviewSurfaceSource).not.toContain('__uikit_toolbar_action__')
    expect(htmlPreviewSurfaceSource).not.toContain('__uikit_insert_prompt__')
    expect(htmlPreviewSurfaceSource).not.toContain('__uikit_visual_choice__')
    expect(htmlPreviewSurfaceSource).not.toContain('handleInsertPrompt')
    expect(htmlPreviewSurfaceSource).not.toContain('runInspectorAction')
    expect(htmlPreviewSurfaceSource).not.toContain('useTerminalStore')
    expect(htmlPreviewSurfaceSource).toContain("mode: 'ui'")
  })

  it('uses a theme-aware dotted viewport background outside fixed preview frames', () => {
    expect(htmlPreviewSurfaceSource).toContain('preview-viewport-stars p-3 pt-8')
    expect(htmlPreviewSurfaceSource).toContain('relative m-auto shrink-0')
    expect(htmlPreviewSurfaceSource).not.toContain('preview-viewport-stars justify-center items-start')
    expect(htmlPreviewSurfaceSource).not.toContain("isResponsive ? 'bg-background' : 'preview-viewport-stars")
    expect(indexCssSource).toContain('.preview-viewport-stars')
    expect(indexCssSource).toContain('background-color: var(--color-bg-canvas)')
    expect(indexCssSource).toContain('html.light .preview-viewport-stars')
    expect(indexCssSource).toContain('background-size: 40px 40px')
    expect(indexCssSource).toContain('radial-gradient')
  })
})

describe('project workbench navigation', () => {
  it('shows home and project tabs in the window top bar', () => {
    const mainNavStart = tabBarSource.indexOf('class="app-tabbar__nav"')
    const mainNavEnd = tabBarSource.indexOf('</nav>', mainNavStart)
    const mainNav = tabBarSource.slice(mainNavStart, mainNavEnd)

    expect(mainNavStart).toBeGreaterThanOrEqual(0)
    expect(mainNav).toContain('app-tabbar__home')
    expect(mainNav).toContain('app-tabbar__tabs')
    expect(mainNav).not.toContain('data-resource-tabs')
    expect(tabBarSource).not.toContain('class="flex h-9 items-end border-b border-border/60 bg-muted/30 px-1 pt-1"')
    expect(tabBarSource).toContain('previewProjectTabs')
    expect(tabBarSource).toContain('activeProjectKey')
    expect(tabBarSource).toContain('previewStore.activateProject(projectKey)')
    expect(tabBarSource).toContain('closeProjectTab(project.key)')
    expect(tabBarSource).not.toContain('preview.activeProjectTabs')
    expect(tabBarSource).toContain('{{ project.name }}')
    expect(tabBarSource).toContain('<OpenProjectDialog')
    expect(tabBarSource).toContain('previewStore.hideCanvas()')
    expect(tabBarSource).not.toContain('workspaceName(projectId)')
    expect(tabBarSource).not.toContain('preview.openProjectIds')
  })

  it('uses compact project-tab styling', () => {
    expect(tabBarSource).toContain('.topbar-project-tab {')
    expect(tabBarSource).toContain('height: 30px;')
    expect(tabBarSource).toContain('.topbar-project-tab.is-active')
    expect(tabBarSource).not.toContain('rounded-t-md border border-b-0')
    expect(tabBarSource).not.toContain("? 'bg-accent/15 text-primary font-medium'")
  })

  it('removes manual project opening and resource-level actions', () => {
    expect(tabBarSource).not.toContain('class="topbar-add-tab"')
    expect(tabBarSource).not.toContain('title="打开项目"')
    expect(tabBarSource).not.toContain('preview.clearAll()')
    expect(tabBarSource).not.toContain('新建草图')
    expect(tabBarSource).not.toContain('↗ 打开')
    expect(tabBarSource).not.toContain('<button\n      ref="plusBtnRef"')
    expect(tabBarSource).not.toContain('<button\n      v-if="previewStore.tabs.length > 0"')
  })

  it('keeps external tool opening in the global workbench actions', () => {
    expect(tabBarSource).toContain('<OpenWithMenu')
    expect(tabBarSource).toContain(':workspace-id="active.id"')
    expect(productFilesSource).not.toContain("import OpenWithMenu from '@/components/layout/OpenWithMenu.vue'")
  })

  it('does not expose resource-level navigation', () => {
    expect(tabBarSource).not.toContain('openPreviewMenuSelection')
    expect(tabBarSource).not.toContain("value: 'preview'")
    expect(tabBarSource).not.toContain("value: 'files'")
    expect(tabBarSource).not.toContain("value: 'components'")
    expect(tabBarSource).not.toContain("value: 'images'")
    expect(tabBarSource).not.toContain('openCurrentProductPreview')
    expect(tabBarSource).not.toContain('文件目录')
    expect(tabBarSource).not.toContain('可用组件')
    expect(tabBarSource).not.toContain('可用图片')
    expect(tabBarSource).not.toContain('暂无文件目录')
    expect(tabBarSource).not.toContain('productItems.length === 0')
    expect(tabBarSource).not.toContain('新 Markdown 文件名')
    expect(tabBarSource).not.toContain('Markdown 文档')
    expect(tabBarSource).not.toContain('createMd')
  })

  it('removes component and image resource tabs from project navigation', () => {
    expect(tabBarSource).not.toContain('openProjectImages')
    expect(tabBarSource).not.toContain('openProjectComponents')
    expect(tabBarSource).not.toContain('activePreviewWorkspaceId')
  })

  it('uses the app theme background in the files panel instead of hardcoded white or cold gray surfaces', () => {
    expect(productFilesSource).toContain('background: var(--color-bg-base);')
    expect(productFilesSource).toContain('background: var(--color-bg-panel);')
    expect(productFilesSource).toContain('background: var(--color-bg-subtle);')
    expect(productFilesSource).not.toContain('background: #f8fafc;')
    expect(productFilesSource).not.toContain('background: #fff;')
    expect(productFilesSource).not.toContain('background: #f1f5f9;')
  })

  it('uses a tree toggle on the responsive preview bar and keeps HTML preview inside the file detail pane', () => {
    expect(productFilesSource).toContain('Teleport')
    expect(productFilesSource).toContain('to="#product-workbench-topbar"')
    expect(productFilesSource).toContain('product-files__workbench-topbar')
    expect(productFilesSource).not.toContain('product-files__tree-toggle-row')
    expect(sizeBarSource).toContain('ProductFilesTreeToggle')
    expect(sizeBarSource).toContain('ProductFilesReloadButton')
    expect(sizeBarSource).toContain("emit('reload')")
    expect(sizeBarSource).toContain('HtmlViewModeToggle')
    expect(sizeBarSource).toMatch(/ProductFilesReloadButton[\s\S]*HtmlViewModeToggle/)
    expect(sizeBarSource).toMatch(/PreviewInspectorTools[\s\S]*previewRelPath/)
    expect(sizeBarSource).toContain('showHtmlViewMode')
    expect(sizeBarSource).toContain("emit('update:htmlMode'")
    expect(sizeBarSource).not.toContain('hideZoom')
    expect(sizeBarSource).not.toContain('v-if="!hideZoom"')
    expect(sizeBarSource).not.toContain('>缩放</span>')
    expect(productFilesSource).not.toContain('ProductPreviewZoomControl')
    expect(sizeBarSource).toContain('PreviewCanvasSizeToggle')
    expect(sizeBarSource).toContain('WORKBENCH_CANVAS_PRESETS')
    expect(sizeBarSource).toContain('applyCanvasPreset')
    expect(sizeBarSource).not.toContain('分辨率')
    expect(sizeBarSource).not.toContain('<Select')
    expect(sizeBarSource).toContain('PreviewInspectorTools')
    expect(sizeBarSource).toContain("@toggle=\"emit('toggle-tree')\"")
    expect(productFilesSource).not.toContain('product-files__tree-rail')
    expect(sizeBarSource).toContain('showPreviewControls')
    expect(productFilesSource).toContain('product-workbench-bar')
    expect(productFilesSource).toContain('product-workbench-action-btn')
    expect(productFilesSource).toContain('suppress-size-bar')
    expect(productFilesSource).toContain(':show-preview-controls="htmlMode === \'preview\'"')
    expect(productFilesSource).toContain('v-show="htmlMode === \'source\'"')
    expect(productFilesSource).not.toContain('v-if="htmlMode === \'source\'"')
    expect(productFilesSource).toContain('show-html-view-mode')
    expect(productFilesSource).toContain('<HtmlPreviewSurface')
  })

  it('uses the shared HTML preview surface in both file-detail preview entries', () => {
    expect(panelSource).toContain('<HtmlPreviewSurface')
    expect(panelSource).not.toContain('<PreviewTabBar')
    expect(productFilesSource.match(/<HtmlPreviewSurface/g)).toHaveLength(2)
    expect(productFilesSource).not.toContain('class="product-files__preview-frame"')
    expect(htmlPreviewSurfaceSource).toContain("e.source !== iframeEl.value?.contentWindow")
  })

  it('renders a dense single-line file tree with guides and no file counts or duplicate paths', () => {
    expect(productFilesSource).toContain('product-files__tree-guides')
    expect(productFilesSource).toContain('product-files__tree-guide')
    expect(productFilesSource).toContain('height: 26px;')
    expect(productFilesSource).not.toContain('folderFileCount')
    expect(productFilesSource).not.toContain('treeRowMeta')
    expect(productFilesSource).not.toContain('product-files__item-path')
    expect(productFilesSource).toContain('BookOpen')
    expect(productFilesSource).toContain('isDocFolderName(row.node.name)')
    expect(productFilesSource).toContain('ensureDefaultExpandedFolders')
    expect(productFilesSource).toContain("call('git.snapshot'")
    expect(productFilesSource).toContain('`fs.change:${workspaceId}`')
    expect(productFilesSource).toContain('`git.remote-updated:${workspaceId}`')
    expect(productFilesSource).not.toContain("call('git.status'")
    expect(productFilesSource).toContain('confirmDeleteTreeRow')
    expect(productFilesSource).toContain('product-files__tree-delete')
    expect(productFilesSource).toContain("call('editor.deleteEntry'")
  })

  it('restores the last opened file and submits only the current feature directory', () => {
    expect(productFilesSource).toContain('activeRelPath?: string')
    expect(productFilesSource).toContain('props.activeRelPath ?? props.primaryRelPath')
    expect(productFilesSource).toContain('<FeatureGitSubmitButton')
    expect(productFilesSource).toContain(':rel-dir="props.rootRelPath"')
    expect(productFilesSource).toContain(':prepare="saveIfDirty"')
    expect(productFilesSource).toContain('@done="refreshGitChangeMarks"')
    expect(panelSource).toContain(':active-rel-path="tab.filesMeta.activeRelPath"')
  })
})
