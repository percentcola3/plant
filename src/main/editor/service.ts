import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { UIClientError } from '../ipc/errors'

function resolveAllowedRoot(projectPath: string, rootRelOrAbs: string): string {
  return isAbsolute(rootRelOrAbs) ? resolve(rootRelOrAbs) : resolve(join(projectPath, rootRelOrAbs))
}

function assertInside(root: string, target: string, code: string): void {
  if (target !== root && !target.startsWith(root + '/')) {
    throw new UIClientError(code, `路径不在允许范围内：${target} 不在 ${root}/ 下`)
  }
}

function resolveEditablePath(projectPath: string, rootRelOrAbs: string, relPath: string, code: string): string {
  const docsRoot = resolveAllowedRoot(projectPath, rootRelOrAbs)
  const target = isAbsolute(relPath) ? resolve(relPath) : resolve(join(projectPath, relPath))
  assertInside(docsRoot, target, code)
  return target
}

function safeAssetExt(mimeType: string, originalName?: string): string {
  const ext = extname(originalName ?? '').toLowerCase()
  if (ext) return ext
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg'
  }
  return map[mimeType] ?? '.bin'
}

function safeUploadFileName(mimeType: string, originalName?: string): string {
  const ext = safeAssetExt(mimeType, originalName)
  const rawStem = basename(originalName ?? 'asset', extname(originalName ?? ''))
  const stem = rawStem
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'asset'
  return `${stem}${ext}`
}

async function uniqueTargetFile(targetDirAbs: string, fileName: string): Promise<string> {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  let candidate = join(targetDirAbs, fileName)
  try {
    await fs.stat(candidate)
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return candidate
    throw e
  }

  for (;;) {
    candidate = join(targetDirAbs, `${stem}-${randomBytes(2).toString('hex')}${ext}`)
    try {
      await fs.stat(candidate)
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return candidate
      throw e
    }
  }
}

function timestampSlug(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('')
}

function revisionToken(content: string, size: number, isoMtime: string): string {
  const digest = createHash('sha1').update(content).digest('hex').slice(0, 12)
  return `${isoMtime}|${size}|${digest}`
}

async function readFileState(absPath: string): Promise<{ content: string; mtime: string }> {
  let stat
  try {
    stat = await fs.stat(absPath)
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new UIClientError('FILE_NOT_FOUND', `文件不存在：${absPath}`)
    }
    throw e
  }
  const content = await fs.readFile(absPath, 'utf-8')
  return {
    content,
    mtime: revisionToken(content, stat.size, stat.mtime.toISOString())
  }
}

export async function readEditorFile(
  projectPath: string,
  rootRelOrAbs: string,
  relPath: string
): Promise<{ relPath: string; content: string; mtime: string }> {
  const absPath = resolveEditablePath(projectPath, rootRelOrAbs, relPath, 'PATH_OUTSIDE_SCOPE')
  const { content, mtime } = await readFileState(absPath)
  return { relPath, content, mtime }
}

export async function editorEntryExists(
  projectPath: string,
  rootRelOrAbs: string,
  relPath: string
): Promise<boolean> {
  const absPath = resolveEditablePath(projectPath, rootRelOrAbs, relPath, 'PATH_OUTSIDE_SCOPE')
  try {
    await fs.stat(absPath)
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return false
    throw e
  }
}

// 用 lstat（不跟随符号链接）区分：缺失 / 符号链接（带 target）/ 真实文件 / 目录。
// 面板靠它如实显示 CLAUDE.md/AGENTS.md 是「已关联 system.md」还是「项目自有」。
export async function editorEntryKind(
  projectPath: string,
  rootRelOrAbs: string,
  relPath: string
): Promise<{ kind: 'missing' | 'symlink' | 'file' | 'dir'; target?: string }> {
  const absPath = resolveEditablePath(projectPath, rootRelOrAbs, relPath, 'PATH_OUTSIDE_SCOPE')
  try {
    const st = await fs.lstat(absPath)
    if (st.isSymbolicLink()) return { kind: 'symlink', target: await fs.readlink(absPath) }
    if (st.isDirectory()) return { kind: 'dir' }
    return { kind: 'file' }
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return { kind: 'missing' }
    throw e
  }
}

export async function writeEditorFile(
  projectPath: string,
  rootRelOrAbs: string,
  relPath: string,
  content: string,
  expectedMtime?: string
): Promise<{ relPath: string; mtime: string }> {
  const absPath = resolveEditablePath(projectPath, rootRelOrAbs, relPath, 'PATH_OUTSIDE_SCOPE')
  if (expectedMtime) {
    const { mtime: currentMtime } = await readFileState(absPath)
    if (currentMtime !== expectedMtime) {
      throw new UIClientError('MTIME_CONFLICT', `${basename(relPath)} 已被外部修改`)
    }
  }
  // 父目录不存在时自动创建（如 .ui-client/ 在 asset/knowledge 工作区初始没 scaffold）
  await fs.mkdir(dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
  return { relPath, mtime: (await readFileState(absPath)).mtime }
}

// App 同时维护 Claude Code 和 Codex 的项目级 Skill 目录。
// 编辑任意一侧的 Skill 文件时，返回另一侧的对应路径，普通项目文件不处理。
export function pairedSkillRelPath(relPath: string): string | null {
  const normalized = relPath.replace(/\\/g, '/')
  if (/^\.claude\/skills\/(?:\.disabled\/)?[^/]+(?:\/.*)?$/.test(normalized)) {
    return normalized.replace(/^\.claude\/skills\//, '.agents/skills/')
  }
  if (/^\.agents\/skills\/(?:\.disabled\/)?[^/]+(?:\/.*)?$/.test(normalized)) {
    return normalized.replace(/^\.agents\/skills\//, '.claude/skills/')
  }
  return null
}

export async function writeEditorFileWithSkillMirror(
  projectPath: string,
  rootRelOrAbs: string,
  relPath: string,
  content: string,
  expectedMtime?: string
): Promise<{ relPath: string; mtime: string }> {
  const result = await writeEditorFile(projectPath, rootRelOrAbs, relPath, content, expectedMtime)
  const pairedRelPath = pairedSkillRelPath(relPath)
  if (pairedRelPath) {
    await writeEditorFile(projectPath, rootRelOrAbs, pairedRelPath, content)
  }
  return result
}

export async function deleteEditorFile(
  projectPath: string,
  rootRelOrAbs: string,
  relPath: string
): Promise<void> {
  const absPath = resolveEditablePath(projectPath, rootRelOrAbs, relPath, 'PATH_OUTSIDE_SCOPE')
  let stat
  try {
    stat = await fs.stat(absPath)
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new UIClientError('FILE_NOT_FOUND', `文件不存在：${absPath}`)
    }
    throw e
  }
  if (!stat.isFile()) {
    throw new UIClientError('NOT_FILE', `只能删除文件：${relPath}`)
  }
  await fs.rm(absPath, { force: true })
}

export async function deleteEditorEntry(
  projectPath: string,
  rootRelOrAbs: string,
  relPath: string
): Promise<void> {
  const absPath = resolveEditablePath(projectPath, rootRelOrAbs, relPath, 'PATH_OUTSIDE_SCOPE')
  try {
    await fs.stat(absPath)
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new UIClientError('FILE_NOT_FOUND', `文件不存在：${absPath}`)
    }
    throw e
  }
  await fs.rm(absPath, { recursive: true, force: true })
}

export async function copyEditorEntry(
  projectPath: string,
  rootRelOrAbs: string,
  sourceRelPath: string,
  targetRelPath: string
): Promise<{ relPath: string }> {
  const sourceAbs = resolveEditablePath(projectPath, rootRelOrAbs, sourceRelPath, 'PATH_OUTSIDE_SCOPE')
  const targetAbs = resolveEditablePath(projectPath, rootRelOrAbs, targetRelPath, 'PATH_OUTSIDE_SCOPE')
  if (sourceAbs === targetAbs) {
    throw new UIClientError('VALIDATION', '源路径和目标路径不能相同')
  }
  if (targetAbs.startsWith(sourceAbs + '/')) {
    throw new UIClientError('VALIDATION', '不能复制到自身子目录')
  }
  try {
    await fs.stat(sourceAbs)
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new UIClientError('FILE_NOT_FOUND', `文件不存在：${sourceAbs}`)
    }
    throw e
  }
  try {
    await fs.stat(targetAbs)
    throw new UIClientError('FILE_EXISTS', `目标已存在：${targetRelPath}`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e
  }
  await fs.mkdir(dirname(targetAbs), { recursive: true })
  await fs.cp(sourceAbs, targetAbs, { recursive: true, errorOnExist: true, force: false })
  return { relPath: targetRelPath }
}

// 移动/重命名：复制到目标（同 copy 的路径安全校验），删源。
export async function moveEditorEntry(
  projectPath: string,
  rootRelOrAbs: string,
  sourceRelPath: string,
  targetRelPath: string
): Promise<{ relPath: string }> {
  const result = await copyEditorEntry(projectPath, rootRelOrAbs, sourceRelPath, targetRelPath)
  // 删源
  const sourceAbs = resolveEditablePath(projectPath, rootRelOrAbs, sourceRelPath, 'PATH_OUTSIDE_SCOPE')
  await fs.rm(sourceAbs, { recursive: true, force: true })
  return result
}


// 新建空目录（分组）。已存在则抛 FILE_EXISTS。recursive 建中间层。
export async function createEditorEntry(
  projectPath: string,
  rootRelOrAbs: string,
  targetRelPath: string
): Promise<{ relPath: string }> {
  const absPath = resolveEditablePath(projectPath, rootRelOrAbs, targetRelPath, 'PATH_OUTSIDE_SCOPE')
  try {
    await fs.stat(absPath)
    throw new UIClientError('FILE_EXISTS', `目标已存在：${targetRelPath}`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e
  }
  await fs.mkdir(absPath, { recursive: true })
  return { relPath: targetRelPath }
}

export async function createEditorEntryWithSkillMirror(
  projectPath: string,
  rootRelOrAbs: string,
  targetRelPath: string
): Promise<{ relPath: string }> {
  const result = await createEditorEntry(projectPath, rootRelOrAbs, targetRelPath)
  const pairedRelPath = pairedSkillRelPath(targetRelPath)
  if (pairedRelPath && !await editorEntryExists(projectPath, rootRelOrAbs, pairedRelPath)) {
    await createEditorEntry(projectPath, rootRelOrAbs, pairedRelPath)
  }
  return result
}

export async function saveProjectBinaryFile(
  projectPath: string,
  rootRelOrAbs: string,
  input: {
    targetRelDir: string
    mimeType: string
    dataBase64: string
    originalName?: string
  }
): Promise<{ relPath: string }> {
  if (!input.targetRelDir || input.targetRelDir.includes('..') || isAbsolute(input.targetRelDir)) {
    throw new UIClientError('VALIDATION', '目标目录不合法')
  }
  const root = resolveAllowedRoot(projectPath, rootRelOrAbs)
  const targetDirAbs = resolveEditablePath(projectPath, rootRelOrAbs, input.targetRelDir, 'PATH_OUTSIDE_SCOPE')
  const fileName = safeUploadFileName(input.mimeType, input.originalName)
  const targetAbs = await uniqueTargetFile(targetDirAbs, fileName)
  assertInside(root, targetAbs, 'PATH_OUTSIDE_SCOPE')

  await fs.mkdir(targetDirAbs, { recursive: true })
  await fs.writeFile(targetAbs, Buffer.from(input.dataBase64, 'base64'))

  return { relPath: relative(projectPath, targetAbs).replace(/\\/g, '/') }
}

export async function saveEditorAsset(
  projectPath: string,
  docsDirRel: string,
  input: {
    contextRelPath: string
    mimeType: string
    dataBase64: string
    originalName?: string
  }
): Promise<{ assetRelPath: string; markdownPath: string }> {
  const docsRoot = resolveAllowedRoot(projectPath, docsDirRel)
  const contextAbs = resolveEditablePath(projectPath, docsDirRel, input.contextRelPath, 'PATH_OUTSIDE_DOCS')
  const assetsAbs = join(docsRoot, '.assets')
  const assetExt = safeAssetExt(input.mimeType, input.originalName)
  const fileName = `${timestampSlug()}-${randomBytes(2).toString('hex')}${assetExt}`
  const assetAbs = join(assetsAbs, fileName)
  assertInside(docsRoot, assetAbs, 'PATH_OUTSIDE_DOCS')

  await fs.mkdir(assetsAbs, { recursive: true })
  await fs.writeFile(assetAbs, Buffer.from(input.dataBase64, 'base64'))

  const assetRelPath = relative(projectPath, assetAbs).replace(/\\/g, '/')
  const markdownPath = relative(dirname(contextAbs), assetAbs).replace(/\\/g, '/')
  return {
    assetRelPath,
    markdownPath: markdownPath.startsWith('.') ? markdownPath : `./${markdownPath}`
  }
}
