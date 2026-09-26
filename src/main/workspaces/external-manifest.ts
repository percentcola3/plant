import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type {
  ExternalDependencyManifest,
  ExternalDependencyManifestRef,
  ExternalRef,
  ExternalRefBinding,
  ExternalRefCategory,
  ExternalRefCheckout
} from '@shared/types'
import { normalizeExternalVisibleDirs } from '@shared/external-ref-controls'
import { externalManifestPath } from './paths'
import { ALIAS_PATTERN } from '../external-pool/store'

const EMPTY: ExternalDependencyManifest = { schemaVersion: 1, refs: [] }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseCategory(value: unknown): ExternalRefCategory | null {
  return value === 'knowledge' || value === 'uikit' ? value : null
}

function parseCheckout(value: unknown): ExternalRefCheckout | undefined {
  if (!isPlainObject(value)) return undefined
  const type = value.type
  const checkoutValue = value.value
  if (type !== 'branch' && type !== 'tag' && type !== 'commit') return undefined
  if (typeof checkoutValue !== 'string' || !checkoutValue.trim()) return undefined
  return { type, value: checkoutValue.trim() }
}

function parseVisibleDirs(value: unknown, category: ExternalRefCategory): string[] | undefined {
  if (category !== 'knowledge' || !Array.isArray(value)) return undefined
  try {
    const visibleDirs = normalizeExternalVisibleDirs(
      value.filter((item): item is string => typeof item === 'string')
    )
    return visibleDirs.length > 0 ? visibleDirs : undefined
  } catch {
    return undefined
  }
}

function parseRef(value: unknown): ExternalDependencyManifestRef | null {
  if (!isPlainObject(value)) return null
  if (value.kind !== 'git') return null
  const alias = typeof value.alias === 'string' ? value.alias.trim() : ''
  const url = typeof value.url === 'string' ? value.url.trim() : ''
  const category = parseCategory(value.category)
  if (!ALIAS_PATTERN.test(alias) || !category || !url) return null
  return {
    alias,
    category,
    kind: 'git',
    url,
    checkout: parseCheckout(value.checkout),
    visibleDirs: parseVisibleDirs(value.visibleDirs, category),
    readonly: typeof value.readonly === 'boolean' ? value.readonly : true
  }
}

export async function readExternalManifest(workspacePath: string): Promise<ExternalDependencyManifest> {
  try {
    const text = await fs.readFile(externalManifestPath(workspacePath), 'utf-8')
    const parsed = JSON.parse(text) as unknown
    if (!isPlainObject(parsed) || !Array.isArray(parsed.refs)) return { ...EMPTY }
    return {
      schemaVersion: 1,
      refs: parsed.refs.map(parseRef).filter((ref): ref is ExternalDependencyManifestRef => ref !== null)
    }
  } catch {
    return { ...EMPTY }
  }
}

export async function writeExternalManifest(
  workspacePath: string,
  manifest: ExternalDependencyManifest
): Promise<void> {
  const path = externalManifestPath(workspacePath)
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, `${JSON.stringify({ ...manifest, schemaVersion: 1 }, null, 2)}\n`, 'utf-8')
}

export async function upsertExternalManifestRef(
  workspacePath: string,
  ref: ExternalDependencyManifestRef
): Promise<void> {
  const manifest = await readExternalManifest(workspacePath)
  const nextRefs = manifest.refs.filter((item) => item.alias !== ref.alias)
  nextRefs.push(ref)
  await writeExternalManifest(workspacePath, { schemaVersion: 1, refs: nextRefs })
}

export async function removeExternalManifestRef(workspacePath: string, alias: string): Promise<void> {
  const manifest = await readExternalManifest(workspacePath)
  const nextRefs = manifest.refs.filter((item) => item.alias !== alias)
  if (nextRefs.length === manifest.refs.length) return
  await writeExternalManifest(workspacePath, { schemaVersion: 1, refs: nextRefs })
}

export function externalRefToManifestRef(
  ref: ExternalRef,
  binding?: ExternalRefBinding
): ExternalDependencyManifestRef | null {
  if (ref.kind !== 'git') return null
  const visibleDirs = ref.category === 'knowledge'
    ? normalizeExternalVisibleDirs(binding?.visibleDirs)
    : []
  return {
    alias: ref.alias,
    category: ref.category,
    kind: 'git',
    url: ref.source,
    checkout: ref.checkout,
    ...(visibleDirs.length > 0 ? { visibleDirs } : {}),
    readonly: true
  }
}
