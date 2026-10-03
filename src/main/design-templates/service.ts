import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { DESIGN_TEMPLATES, type DesignTemplate, type DesignTemplateId, type DesignTemplateFileContent } from '@shared/design-templates'
import type { ExternalRef } from '@shared/types'
import { externalPoolStore } from '../external-pool/store'
import { UIClientError } from '../ipc/errors'
import { scheduleResourceIndexBuild } from '../resource-index/service'

const installations = new Map<DesignTemplateId, Promise<ExternalRef>>()
let seeding: Promise<void> | null = null

// Populate the resource pool once. A user who removes an asset should not get it
// re-added on the next refresh or application launch.
export async function ensureBuiltinDesignAssets(): Promise<void> {
  if (seeding) return seeding
  seeding = (async () => {
    if (await externalPoolStore.hasSeededBuiltinTemplates()) return
    // Store writes share one JSON file; keep the two installations sequential.
    for (const template of DESIGN_TEMPLATES) await installDesignTemplate(template.id)
    await externalPoolStore.markBuiltinTemplatesSeeded()
  })()
  try { await seeding }
  finally { seeding = null }
}

function templateFor(id: unknown): DesignTemplate {
  const template = DESIGN_TEMPLATES.find(item => item.id === id)
  if (!template) throw new UIClientError('VALIDATION', '未知的内置设计模板')
  return template
}

export function designTemplateRootCandidates(
  here = dirname(fileURLToPath(import.meta.url)),
  cwd = process.cwd(),
  resourcesPath = process.resourcesPath,
): string[] {
  const candidates = [
    join(cwd, 'resources', 'design-templates'),
    join(here, '..', '..', '..', 'resources', 'design-templates'),
    join(here, '..', '..', 'resources', 'design-templates'),
  ]
  if (resourcesPath) candidates.unshift(join(resourcesPath, 'design-templates'))
  return candidates
}

async function templateSource(template: DesignTemplate): Promise<string> {
  for (const root of designTemplateRootCandidates()) {
    const source = join(root, template.id)
    if ((await fs.stat(join(source, 'AI_USAGE.md')).catch(() => null))?.isFile()) return source
  }
  throw new UIClientError('NOT_FOUND', `未找到 ${template.name} 内置模板，请检查应用资源是否完整`)
}

export async function readDesignTemplate(id: unknown): Promise<DesignTemplateFileContent[]> {
  const template = templateFor(id)
  const source = await templateSource(template)
  return Promise.all(template.files.map(async file => ({
    ...file, content: await fs.readFile(join(source, file.path), 'utf8'),
  })))
}

export async function installDesignTemplate(id: unknown): Promise<ExternalRef> {
  const template = templateFor(id)
  const pending = installations.get(template.id)
  if (pending) return pending
  const task = install(template)
  installations.set(template.id, task)
  try { return await task }
  finally { installations.delete(template.id) }
}

async function install(template: DesignTemplate): Promise<ExternalRef> {
  const refs = await externalPoolStore.list()
  const existing = refs.find(ref => ref.builtinTemplateId === template.id)
  // Install into userData: mounted resources and indexes must survive application upgrades.
  const root = join(app.getPath('userData'), 'design-templates')
  const destination = existing?.poolPath ?? join(root, template.id)
  let restored = false
  if (!(await fs.stat(destination).catch(() => null))?.isDirectory()) {
    const source = await templateSource(template)
    await fs.mkdir(root, { recursive: true })
    const staging = await fs.mkdtemp(join(root, `.${template.id}-`))
    try {
      await fs.cp(source, staging, { recursive: true })
      await fs.rename(staging, destination)
      restored = true
    } finally {
      await fs.rm(staging, { recursive: true, force: true })
    }
  }
  if (existing) {
    // Add new example files to copies created by older builds, preserving edits.
    if (!restored) {
      const source = await templateSource(template)
      for (const file of [...template.files, { path: 'assets/README.md' }]) {
        const target = join(destination, file.path)
        if (await fs.stat(target).catch(() => null)) continue
        await fs.mkdir(dirname(target), { recursive: true })
        await fs.cp(join(source, file.path), target, { force: false, errorOnExist: true })
        restored = true
      }
    }
    if (restored) scheduleResourceIndexBuild(existing, 'first-import')
    return existing
  }
  const base = `${template.id}-design`
  let alias = base
  let suffix = 2
  while (refs.some(ref => ref.alias === alias)) alias = `${base}-${suffix++}`
  const ref: ExternalRef = {
    id: randomUUID(), alias, kind: 'local', category: 'uikit',
    source: destination, poolPath: destination, instructionFile: 'AI_USAGE.md',
    builtinTemplateId: template.id, addedAt: new Date().toISOString(),
  }
  await externalPoolStore.add(ref)
  scheduleResourceIndexBuild(ref, 'first-import')
  return ref
}

export async function copyDesignTemplate(id: unknown, parentPath: string): Promise<{ path: string }> {
  const template = templateFor(id)
  if (typeof parentPath !== 'string' || !isAbsolute(parentPath)) {
    throw new UIClientError('VALIDATION', '请选择本地目标目录')
  }
  if (!(await fs.stat(parentPath).catch(() => null))?.isDirectory()) {
    throw new UIClientError('NOT_DIR', '目标目录不存在')
  }
  const source = await templateSource(template)
  const destination = join(parentPath, `${template.id}-design-template`)
  try { await fs.mkdir(destination) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new UIClientError('TARGET_EXISTS', '该目录已存在同名模板，请选择其他目录，以免覆盖你的修改')
    }
    throw error
  }
  try {
    for (const entry of await fs.readdir(source)) {
      await fs.cp(join(source, entry), join(destination, entry), { recursive: true, force: false, errorOnExist: true })
    }
  }
  catch (error) {
    await fs.rm(destination, { recursive: true, force: true })
    throw error
  }
  return { path: destination }
}
