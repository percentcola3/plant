import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

const DOC_START = '<!-- WORKSPACE-COMPONENT-DOC:START'
const DOC_END = 'WORKSPACE-COMPONENT-DOC:END -->'

export type ComponentDocState = {
  content: string
  source: 'managed' | 'legacy' | 'none'
}

export async function readComponentDoc(projectPath: string, relPath: string): Promise<ComponentDocState> {
  const html = await readComponentHtml(projectPath, relPath)
  return extractComponentDoc(html)
}

export async function saveComponentDoc(
  projectPath: string,
  relPath: string,
  content: string
): Promise<ComponentDocState> {
  const html = await readComponentHtml(projectPath, relPath)
  const next = upsertComponentDoc(html, content)
  await fs.writeFile(resolve(join(projectPath, relPath)), next, 'utf-8')
  return { content: normalizeDocContent(content), source: 'managed' }
}

export function extractComponentDoc(html: string): ComponentDocState {
  const managed = html.match(/<!-- WORKSPACE-COMPONENT-DOC:START\s*\n?([\s\S]*?)\n?WORKSPACE-COMPONENT-DOC:END -->/)
  if (managed) {
    return { content: normalizeDocContent(managed[1] ?? ''), source: 'managed' }
  }

  const legacy = html.match(/^\s*<!--([\s\S]*?)-->/)
  if (legacy) {
    return { content: normalizeDocContent(legacy[1] ?? ''), source: 'legacy' }
  }

  return { content: '', source: 'none' }
}

export function upsertComponentDoc(html: string, content: string): string {
  const block = renderManagedBlock(content)
  if (/<!-- WORKSPACE-COMPONENT-DOC:START[\s\S]*?WORKSPACE-COMPONENT-DOC:END -->/.test(html)) {
    return html.replace(/<!-- WORKSPACE-COMPONENT-DOC:START[\s\S]*?WORKSPACE-COMPONENT-DOC:END -->/, block)
  }

  if (/^\s*<!--[\s\S]*?-->/.test(html)) {
    return html.replace(/^\s*<!--[\s\S]*?-->/, block)
  }

  return `${block}\n\n${html.replace(/^\s*/, '')}`
}

export function buildComponentMachineId(relPath: string, labels: string[] = []): string {
  const normalized = relPath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  const category = parts[1] ?? 'component'
  const name = parts[2] ?? parts[parts.length - 2] ?? 'item'
  const file = parts[parts.length - 1] ?? 'index.html'
  const base = `component:${slugify(category)}/${slugify(name)}:${slugify(file)}`
  const tail = labels.map(slugify).filter(Boolean).join('/')
  return tail ? `${base}#${tail}` : base
}

export function buildComponentReadableRef(relPath: string, labels: string[] = []): string {
  const tail = labels.filter(Boolean).join(' :: ')
  return tail ? `${relPath} :: ${tail}` : relPath
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

function renderManagedBlock(content: string): string {
  const normalized = normalizeDocContent(content)
  return `${DOC_START}\n${normalized}\n${DOC_END}`
}

function normalizeDocContent(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
}

async function readComponentHtml(projectPath: string, relPath: string): Promise<string> {
  const absProject = resolve(projectPath)
  const absTarget = resolve(join(projectPath, relPath))
  if (!absTarget.startsWith(absProject)) {
    throw new Error(`component path outside project: ${relPath}`)
  }
  return fs.readFile(absTarget, 'utf-8')
}
