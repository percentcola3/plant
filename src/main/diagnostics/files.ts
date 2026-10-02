import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import JSZip from 'jszip'
import { sanitizeAttributes, sanitizeCorrelationId } from './redact'

export const DAY_MS = 24 * 60 * 60 * 1_000
export const DEFAULT_MAX_AGE_MS = 14 * DAY_MS
export const DEFAULT_MAX_BYTES = 100 * 1024 * 1024

type DiagnosticFile = {
  path: string
  name: string
  size: number
  mtimeMs: number
}

export type DiagnosticsInfo = {
  directory: string
  fileCount: number
  totalBytes: number
  oldestAt?: string
  newestAt?: string
}

export type CleanupOptions = {
  now?: number
  maxAgeMs?: number
  maxBytes?: number
}

export type DiagnosticBundleMetadata = {
  appVersion: string
  electronVersion: string
  nodeVersion: string
  chromeVersion?: string
}

async function listLogFiles(directory: string): Promise<DiagnosticFile[]> {
  await fs.mkdir(directory, { recursive: true })
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
    .map(async (entry) => {
      const path = join(directory, entry.name)
      const stat = await fs.stat(path)
      return { path, name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs }
    }))
  return files.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))
}

export async function cleanupDiagnosticFiles(
  directory: string,
  options: CleanupOptions = {}
): Promise<void> {
  const now = options.now ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const retained: DiagnosticFile[] = []

  for (const file of await listLogFiles(directory)) {
    if (file.mtimeMs < now - maxAgeMs) {
      await fs.rm(file.path, { force: true })
    } else {
      retained.push(file)
    }
  }

  let totalBytes = retained.reduce((sum, file) => sum + file.size, 0)
  for (const file of retained) {
    if (totalBytes <= maxBytes) break
    await fs.rm(file.path, { force: true })
    totalBytes -= file.size
  }
}

export async function getDiagnosticsInfo(directory: string): Promise<DiagnosticsInfo> {
  const files = await listLogFiles(directory)
  return {
    directory,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    ...(files[0] ? { oldestAt: new Date(files[0].mtimeMs).toISOString() } : {}),
    ...(files.at(-1) ? { newestAt: new Date(files.at(-1)!.mtimeMs).toISOString() } : {})
  }
}

export async function clearDiagnosticFiles(directory: string): Promise<void> {
  for (const file of await listLogFiles(directory)) {
    await fs.rm(file.path, { force: true })
  }
}

export async function exportDiagnosticBundle(input: {
  logsDirectory: string
  outputPath: string
  metadata: DiagnosticBundleMetadata
  sessionTarget?: string
}): Promise<string> {
  const zip = new JSZip()
  for (const file of await listLogFiles(input.logsDirectory)) {
    zip.file(`logs/${basename(file.path)}`, await fs.readFile(file.path))
  }
  zip.file('metadata.json', JSON.stringify(sanitizeAttributes(input.metadata), null, 2))
  zip.file('README.txt', [
    'Plant 本地诊断包',
    '日志不包含用户提示词、AI 回复正文或项目文件内容。',
    input.sessionTarget ? `目标会话：${sanitizeCorrelationId(input.sessionTarget)}` : '目标会话：未指定',
    '研发可按 turnId 或 sessionId 串联一次 AI 请求。'
  ].join('\n'))

  await fs.mkdir(dirname(input.outputPath), { recursive: true })
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fs.writeFile(input.outputPath, buffer)
  return input.outputPath
}
