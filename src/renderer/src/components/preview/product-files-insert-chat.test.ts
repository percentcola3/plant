import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const productFilesSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/preview/ProductFilesTabPane.vue'),
  'utf-8'
)
const sketchEditorSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/preview/SketchEditor.vue'),
  'utf-8'
)
const composerSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/chat/ChatComposer.vue'),
  'utf-8'
)
const chipInputSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/chat/ChipInput.vue'),
  'utf-8'
)

describe('product files insert to chat', () => {
  it('dispatches selected files into the chat composer as file references', () => {
    expect(productFilesSource).toContain('插入到对话')
    expect(productFilesSource).toContain('__uikit_insert_file_ref__')
    expect(productFilesSource).toContain('insertFileToChat(row.node.file)')
    expect(productFilesSource).not.toContain('class="product-files__header"')
    expect(composerSource).toContain('__uikit_insert_file_ref__')
    expect(composerSource).toContain('insertFileRefFromProductFiles')
    expect(chipInputSource).toContain('insertFileRef')
  })

  it('keeps file operations with the file area and supports creating files in the tree', () => {
    expect(productFilesSource).toContain('新建文件')
    expect(productFilesSource).toContain('createFileInTree')
    expect(productFilesSource).toContain('product-files__tree-actions')
    expect(productFilesSource).toContain('editor.writeTextFile')
  })

  it('opens the directory tree by default without a return-to-preview action', () => {
    expect(productFilesSource).toContain("const detailMode = ref<'preview' | 'edit'>('preview')")
    expect(productFilesSource).toContain("detailMode === 'preview'")
    expect(productFilesSource).toContain("preview.fileUrl")
    expect(productFilesSource).toContain('function backToPreview')
    expect(productFilesSource).toContain('const treeOpen = ref(true)')
    expect(productFilesSource).toContain(':tree-open="treeOpen" @toggle-tree="toggleTreeOpen"')
    expect(productFilesSource).not.toContain('@click="backToPreview"')
    expect(productFilesSource).not.toContain('show-back')
  })

  it('exposes basic sketch shapes and canvas pinch zoom controls', () => {
    expect(sketchEditorSource).toContain("value: 'rect'")
    expect(sketchEditorSource).toContain("label: '方框'")
    // 文本工具暂下线（见 commit fix(sketch): 暂下线草稿「文本」工具）
    expect(sketchEditorSource).not.toContain("value: 'text'")
    expect(sketchEditorSource).not.toContain("label: '文本'")
    expect(sketchEditorSource).toContain("value: 'pen'")
    expect(sketchEditorSource).toContain("value: 'eraser'")
    expect(sketchEditorSource).toContain('showBack')
    expect(sketchEditorSource).toContain('function onCanvasWheel')
    expect(sketchEditorSource).toContain('function setZoomAround')
    expect(sketchEditorSource).toContain('pinchStart')
  })
})
