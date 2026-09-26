import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { UIClientError } from '../ipc/errors'
import { sanitizeBranchSegment } from '../git/identity'
import { seedProductAgentFiles } from './seed-agent-files'

const OUTPUTS_DIR = 'outputs'

function sanitizeProductSlug(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new UIClientError('VALIDATION', '项目名称不能为空')
  const cleaned = sanitizeBranchSegment(trimmed)
  if (!cleaned) throw new UIClientError('VALIDATION', `项目名称无效：${input}`)
  if (cleaned.length > 80) throw new UIClientError('VALIDATION', '项目名称过长（>80 字符）')
  return cleaned
}

async function pathExists(absPath: string): Promise<boolean> {
  return fs.stat(absPath).then(() => true).catch(() => false)
}

async function fileExists(absPath: string): Promise<boolean> {
  return fs.stat(absPath).then((s) => s.isFile()).catch(() => false)
}

async function assertDirectory(absPath: string, label: string): Promise<void> {
  const stat = await fs.stat(absPath).catch(() => null)
  if (!stat) throw new UIClientError('NOT_FOUND', `${label}不存在：${absPath}`)
  if (!stat.isDirectory()) throw new UIClientError('VALIDATION', `${label}必须是目录：${absPath}`)
}

function shouldCopyImportedEntry(sourceRoot: string, sourcePath: string): boolean {
  if (sourcePath === sourceRoot) return true
  const name = basename(sourcePath)
  return name !== '.git' && name !== 'node_modules' && name !== '.DS_Store'
}

async function countFiles(absPath: string): Promise<number> {
  const stat = await fs.stat(absPath).catch(() => null)
  if (!stat) return 0
  if (stat.isFile()) return 1
  if (!stat.isDirectory()) return 0
  const entries = await fs.readdir(absPath)
  let count = 0
  for (const entry of entries) count += await countFiles(join(absPath, entry))
  return count
}

export type ImportUiProductInput = {
  workspacePath: string
  sourcePath: string
  name?: string
}

export type ImportUiProductResult = {
  productRelPath: string
  htmlRelPath: string
  fileCount: number
}

export async function importUiProduct(input: ImportUiProductInput): Promise<ImportUiProductResult> {
  const sourceAbs = resolve(input.sourcePath)
  await assertDirectory(sourceAbs, '导入目录')
  if (!(await fileExists(join(sourceAbs, 'index.html')))) {
    throw new UIClientError('VALIDATION', '导入 UX 项目目录必须包含根 index.html')
  }

  const productName = sanitizeProductSlug(input.name ?? basename(sourceAbs))
  const productRelPath = `${OUTPUTS_DIR}/${productName}`
  const productAbs = join(input.workspacePath, productRelPath)
  if (await pathExists(productAbs)) {
    throw new UIClientError('EXISTS', `UX 项目已存在：${productRelPath}`)
  }

  await fs.mkdir(dirname(productAbs), { recursive: true })
  await fs.cp(sourceAbs, productAbs, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (sourcePath) => shouldCopyImportedEntry(sourceAbs, sourcePath)
  })
  await seedProductAgentFiles(input.workspacePath, productRelPath).catch(() => undefined)

  return {
    productRelPath,
    htmlRelPath: `${productRelPath}/index.html`,
    fileCount: await countFiles(productAbs)
  }
}
