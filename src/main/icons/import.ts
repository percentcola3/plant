import { dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { ICON_EXTENSIONS, ICON_EXT_RE } from '../http/preview-server'
import { WorkspacesStore } from '../workspaces/store'
import { UIClientError } from '../ipc/errors'

const store = new WorkspacesStore()

export type ImportResult = {
  added: string[]
  skipped: Array<{ name: string; reason: 'exists' | 'unsupported' | 'read-failed' }>
}

// 弹系统文件选择器（可多选），把选中的图片复制到工作区 assets/icons/。
// 重名 → 在文件名后追加 -1 / -2 … 直到唯一。
// purpose → 写入 assets/icons/registry/icon-registry.json
export async function importIcons(
  workspaceId: string,
  prePicked?: string[],
  purpose?: string,
  letterName?: string
): Promise<ImportResult> {
  const ws = await store.findById(workspaceId)
  if (!ws) throw new UIClientError('NOT_FOUND', `工作区 ${workspaceId} 不存在`)

  const importName = normalizeLetterName(letterName)
  const semantic = purpose?.trim() ?? ''
  if (importName && !semantic) {
    throw new UIClientError('VALIDATION', '请填写图片语义')
  }

  let sources: string[] = prePicked ?? []
  if (sources.length === 0) {
    const r = await dialog.showOpenDialog({
      title: importName ? '选择图片文件' : '选择图标文件',
      buttonLabel: importName ? '上传' : '导入',
      properties: importName ? ['openFile'] : ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ICON_EXTENSIONS }]
    })
    if (r.canceled) return { added: [], skipped: [] }
    sources = r.filePaths
  }
  if (importName && sources.length > 1) {
    throw new UIClientError('VALIDATION', '指定图片名称时一次只能上传一张图片')
  }

  const iconsDir = join(ws.path, 'assets', 'icons')
  const targetDir = importName ? join(iconsDir, 'custom') : iconsDir
  await fs.mkdir(targetDir, { recursive: true })

  const added: string[] = []
  const registryAdds: RegistryAddition[] = []
  const skipped: ImportResult['skipped'] = []

  for (const src of sources) {
    const baseName = basename(src)
    if (!ICON_EXT_RE.test(baseName)) {
      skipped.push({ name: baseName, reason: 'unsupported' })
      continue
    }
    const ext = extname(baseName).toLowerCase()
    const targetName = importName ? `${importName}${ext}` : baseName
    const dest = importName ? join(targetDir, targetName) : await uniquePath(targetDir, targetName)
    if (importName && await pathExists(dest)) {
      skipped.push({ name: targetName, reason: 'exists' })
      continue
    }
    try {
      await fs.copyFile(src, dest)
      const fileName = basename(dest)
      added.push(fileName)
      registryAdds.push({
        fileName,
        label: fileName.slice(0, fileName.length - extname(fileName).length),
        relAssetPath: relative(join(ws.path, 'assets'), dest).replace(/\\/g, '/')
      })
    } catch {
      skipped.push({ name: baseName, reason: 'read-failed' })
    }
  }

  if (registryAdds.length > 0 && semantic) {
    await writeIconRegistry(iconsDir, registryAdds, semantic, !!importName)
  }

  return { added, skipped }
}

type RegistryAddition = {
  fileName: string
  label: string
  relAssetPath: string
}

function normalizeLetterName(name: string | undefined): string | null {
  if (name === undefined) return null
  const trimmed = name.trim()
  if (!/^[A-Za-z]+$/.test(trimmed)) {
    throw new UIClientError('VALIDATION', '图片名称只能使用英文字母')
  }
  return trimmed
}

async function writeIconRegistry(
  iconsDir: string,
  additions: RegistryAddition[],
  purpose: string,
  preferEntriesFormat: boolean
): Promise<void> {
  const registryDir = join(iconsDir, 'registry')
  await fs.mkdir(registryDir, { recursive: true })
  const registryPath = join(registryDir, 'icon-registry.json')
  const raw = await readRegistry(registryPath)

  if (preferEntriesFormat || hasEntries(raw)) {
    const next: Record<string, unknown> = isPlainObject(raw) ? { ...raw } : { version: 1 }
    const entries = Array.isArray(next.entries)
      ? [...(next.entries as Array<Record<string, unknown>>)]
      : []
    for (const addition of additions) {
      const entry = buildRegistryEntry(addition, purpose)
      const idx = entries.findIndex((item) => item.path === addition.relAssetPath)
      if (idx >= 0) entries[idx] = { ...entries[idx], ...entry }
      else entries.push(entry)
    }
    next.version = typeof next.version === 'number' ? next.version : 1
    next.entries = entries
    await fs.writeFile(registryPath, JSON.stringify(next, null, 2) + '\n', 'utf-8')
    return
  }

  const registry = isPlainObject(raw)
    ? raw as Record<string, { purpose: string; addedAt?: string }>
    : {}
  for (const addition of additions) {
    registry[addition.fileName] = { purpose, addedAt: new Date().toISOString() }
  }
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8')
}

async function readRegistry(path: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf-8')) as unknown
  } catch {
    return null
  }
}

function buildRegistryEntry(addition: RegistryAddition, purpose: string): Record<string, unknown> {
  const slug = addition.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return {
    id: `icon-${slug}`,
    type: 'icon',
    name: `${addition.label} ${purpose}`,
    aliases: uniqueNonEmpty([purpose, addition.label]),
    tags: ['uploaded'],
    path: addition.relAssetPath,
    category: 'uploaded',
    designName: purpose
  }
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function hasEntries(value: unknown): value is { entries: unknown[] } {
  return isPlainObject(value) && Array.isArray(value.entries)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function uniquePath(dir: string, fileName: string): Promise<string> {
  const ext = extname(fileName)
  const stem = fileName.slice(0, fileName.length - ext.length)
  let candidate = join(dir, fileName)
  let n = 1
  // 名字未占用直接用；占用则 stem-1.ext / stem-2.ext …
  while (await pathExists(candidate)) {
    candidate = join(dir, `${stem}-${n}${ext}`)
    n++
    if (n > 9999) throw new Error('too many name collisions')
  }
  return candidate
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
