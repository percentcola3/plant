import type { DocTreeNode } from '@shared/types'
import { isSketchJsonFileName } from './sketch-model'

export type ProductFileCategory = '页面' | '草图' | '资源' | '其他'

export type ProductFileItem = {
  name: string
  relPath: string
  size: number
  modifiedAt: string
  category: ProductFileCategory
  editable: boolean
}

export type ProductFileTreeNode =
  | {
    kind: 'folder'
    name: string
    relPath: string
    children: ProductFileTreeNode[]
  }
  | {
    kind: 'file'
    name: string
    relPath: string
    file: ProductFileItem
  }

const TEXT_EDITABLE_RE = /\.(html?|css|js|mjs|cjs|ts|tsx|json|md|mdx|markdown|txt)$/i
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i
const SKETCH_DRAFT_RE = /^草稿([1-9]\d*)\.sketch\.json$/i
const PRODUCT_ASSET_UPLOAD_FILE_NAME_RE = /^[A-Za-z0-9._-]+$/

export function isEditableProductFile(relPath: string): boolean {
  return isSketchJsonFileName(relPath) || TEXT_EDITABLE_RE.test(relPath)
}

export function isProductImageFile(relPath: string): boolean {
  return IMAGE_RE.test(relPath) && !isSketchJsonFileName(relPath)
}

export function productFileIcon(fileName: string): string {
  const name = fileName.toLowerCase()
  if (isSketchJsonFileName(name)) return '~'
  if (/\.html?$/.test(name)) return '<>'
  if (/\.(md|mdx|markdown)$/.test(name)) return '#'
  if (/\.(css|scss|sass|less)$/.test(name)) return '*'
  if (/\.(ts|tsx)$/.test(name)) return 'TS'
  if (/\.(js|mjs|cjs|jsx)$/.test(name)) return 'JS'
  if (/\.(json|ya?ml|toml|ini|env)$/.test(name) || /(^|\.)config\./.test(name)) return '{}'
  if (/\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/.test(name)) return '▧'
  if (/\.(woff2?|ttf|otf|eot)$/.test(name)) return 'Aa'
  if (/\.(zip|tar|gz|rar|7z)$/.test(name)) return '▣'
  if (/\.(mp3|wav|ogg|m4a)$/.test(name)) return '♪'
  if (/\.(mp4|webm|mov)$/.test(name)) return '▶'
  return '·'
}

export function productAssetUploadDir(productRelPath: string): string {
  return `${productRelPath.replace(/\/+$/, '')}/assets`
}

export function productAssetUploadFileNameError(fileName: string): string | null {
  if (PRODUCT_ASSET_UPLOAD_FILE_NAME_RE.test(fileName)) return null
  return `文件名只能包含英文字母、数字、点、下划线或中划线：${fileName}`
}

export function productFileDisplayName(
  file: Pick<ProductFileItem, 'name' | 'relPath'>,
  files?: Pick<ProductFileItem, 'name' | 'relPath'>[]
): string {
  if (!isSketchJsonFileName(file.relPath)) return file.name
  const draftNumbers = files ? sketchDraftNumberMap(files) : null
  const draftNumber = draftNumbers?.get(file.relPath) ?? explicitSketchDraftNumber(file)
  if (draftNumber) return `草稿${draftNumber}`
  return file.name.replace(/\.sketch\.json$/i, '')
}

export function nextSketchFileRelPath(productRelPath: string, files: Pick<ProductFileItem, 'relPath' | 'name'>[]): string {
  const root = productRelPath.replace(/\/+$/, '')
  const productFiles = files.filter((file) => file.relPath.startsWith(`${root}/`))
  const used = new Set(sketchDraftNumberMap(productFiles).values())
  let next = 1
  while (used.has(next)) next += 1
  return `${root}/草稿${next}.sketch.json`
}

export type ProductFileChangeKind = 'added' | 'modified'

export function isDocFolderName(name: string): boolean {
  return /^doc$/i.test(name.trim())
}

export function defaultExpandedProductFolderPaths(
  productRelPath: string,
  files: Pick<ProductFileItem, 'relPath'>[]
): string[] {
  const dirs = new Set<string>()
  for (const file of files) {
    for (const dir of productFileAncestorDirs(productRelPath, file.relPath)) {
      const name = dir.split('/').filter(Boolean).at(-1) ?? ''
      if (isDocFolderName(name)) dirs.add(dir)
    }
  }
  return [...dirs]
}

export function productTreeChangeMarks(
  productRelPath: string,
  details: Array<{ path: string; kind: string }>
): Map<string, ProductFileChangeKind> {
  const root = productRelPath.replace(/\\/g, '/').replace(/\/+$/, '').normalize('NFC')
  const prefix = `${root}/`
  const marks = new Map<string, ProductFileChangeKind>()
  for (const detail of details) {
    if (detail.kind === 'deleted') continue
    const path = detail.path
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/^"(.*)"$/, '$1')
      .normalize('NFC')
    if (path !== root && !path.startsWith(prefix)) continue
    const kind: ProductFileChangeKind = detail.kind === 'added' || detail.kind === 'untracked'
      ? 'added'
      : 'modified'
    const existing = marks.get(path)
    if (existing === 'modified') continue
    marks.set(path, kind)
    marks.set(path.normalize('NFC'), kind)
  }
  return marks
}

export function remainingProductFiles(files: ProductFileItem[], removedRelPath: string): ProductFileItem[] {
  const removed = removedRelPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const prefix = `${removed}/`
  return files.filter((file) => file.relPath !== removed && !file.relPath.startsWith(prefix))
}

export function productFileAncestorDirs(productRelPath: string, relPath: string): string[] {
  const root = productRelPath.replace(/\/+$/, '')
  const prefix = `${root}/`
  if (!relPath.startsWith(prefix)) return []
  const segments = relPath.slice(prefix.length).split('/').filter(Boolean)
  if (segments.length <= 1) return []

  const dirs: string[] = []
  let current = root
  for (const segment of segments.slice(0, -1)) {
    current = `${current}/${segment}`
    dirs.push(current)
  }
  return dirs
}

export function buildProductFileTree(files: ProductFileItem[], productRelPath: string): ProductFileTreeNode[] {
  const root = productRelPath.replace(/\/+$/, '')
  const prefix = `${root}/`
  const roots: ProductFileTreeNode[] = []
  const folders = new Map<string, Extract<ProductFileTreeNode, { kind: 'folder' }>>()

  for (const file of files) {
    const relativePath = file.relPath.startsWith(prefix) ? file.relPath.slice(prefix.length) : file.relPath
    const segments = relativePath.split('/').filter(Boolean)
    if (segments.length === 0) continue

    let currentPath = file.relPath.startsWith(prefix) ? root : ''
    let siblings = roots
    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      let folder = folders.get(currentPath)
      if (!folder) {
        folder = {
          kind: 'folder',
          name: segment,
          relPath: currentPath,
          children: []
        }
        folders.set(currentPath, folder)
        siblings.push(folder)
      }
      siblings = folder.children
    }
    siblings.push({
      kind: 'file',
      name: file.name,
      relPath: file.relPath,
      file
    })
  }

  return sortProductFileTree(roots)
}

function explicitSketchDraftNumber(file: Pick<ProductFileItem, 'name'>): number | null {
  const match = file.name.match(SKETCH_DRAFT_RE)
  if (!match) return null
  return Number(match[1])
}

function sketchDraftNumberMap(files: Pick<ProductFileItem, 'name' | 'relPath'>[]): Map<string, number> {
  const sketchFiles = files.filter((file) => isSketchJsonFileName(file.relPath))
  const used = new Set<number>()
  const mapped = new Map<string, number>()

  for (const file of sketchFiles) {
    const draftNumber = explicitSketchDraftNumber(file)
    if (!draftNumber || used.has(draftNumber)) continue
    used.add(draftNumber)
    mapped.set(file.relPath, draftNumber)
  }

  let next = 1
  for (const file of sketchFiles) {
    if (mapped.has(file.relPath)) continue
    while (used.has(next)) next += 1
    used.add(next)
    mapped.set(file.relPath, next)
  }

  return mapped
}

function sortProductFileTree(nodes: ProductFileTreeNode[]): ProductFileTreeNode[] {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  for (const node of nodes) {
    if (node.kind === 'folder') sortProductFileTree(node.children)
  }
  return nodes
}

export function selectProductFileAfterDelete(files: ProductFileItem[], deletedRelPath: string): string | null {
  const removed = deletedRelPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const prefix = `${removed}/`
  const currentIndex = files.findIndex((file) => file.relPath === removed || file.relPath.startsWith(prefix))
  const remaining = remainingProductFiles(files, deletedRelPath)
  if (remaining.length === 0) return null
  if (currentIndex === -1) return remaining[0].relPath
  return remaining[Math.min(currentIndex, remaining.length - 1)].relPath
}

export function flattenProductFiles(nodes: DocTreeNode[]): ProductFileItem[] {
  const items: ProductFileItem[] = []
  collectFiles(nodes, items)
  return items.sort((a, b) => {
    const categoryDiff = categoryRank(a.category) - categoryRank(b.category)
    if (categoryDiff !== 0) return categoryDiff
    return a.relPath.localeCompare(b.relPath)
  })
}

export function productFileCategory(relPath: string): ProductFileCategory {
  if (isSketchJsonFileName(relPath)) return '草图'
  if (/\.(html?|md|mdx|markdown)$/i.test(relPath)) return '页面'
  if (isProductImageFile(relPath) || /\/assets\//.test(relPath)) return '资源'
  return '其他'
}

function collectFiles(nodes: DocTreeNode[], sink: ProductFileItem[]): void {
  for (const node of nodes) {
    if (node.kind === 'folder') {
      collectFiles(node.children, sink)
      continue
    }
    sink.push({
      name: node.name,
      relPath: node.relPath,
      size: node.size,
      modifiedAt: node.modifiedAt,
      category: productFileCategory(node.relPath),
      editable: isEditableProductFile(node.relPath)
    })
  }
}

function categoryRank(category: ProductFileCategory): number {
  if (category === '页面') return 0
  if (category === '草图') return 1
  if (category === '资源') return 2
  return 3
}
