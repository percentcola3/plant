import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DAY_MS,
  cleanupDiagnosticFiles,
  clearDiagnosticFiles,
  exportDiagnosticBundle,
  getDiagnosticsInfo
} from './files'

describe('diagnostic files', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'workspace-diagnostics-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('deletes files older than the retention window', async () => {
    const oldPath = join(dir, 'old.log')
    const newPath = join(dir, 'new.log')
    const now = Date.UTC(2026, 6, 11)
    await fs.writeFile(oldPath, 'old')
    await fs.writeFile(newPath, 'new')
    await fs.utimes(oldPath, new Date(now - 15 * DAY_MS), new Date(now - 15 * DAY_MS))
    await fs.utimes(newPath, new Date(now - DAY_MS), new Date(now - DAY_MS))

    await cleanupDiagnosticFiles(dir, { now, maxAgeMs: 14 * DAY_MS, maxBytes: 1_000 })

    expect(await fs.readdir(dir)).toEqual(['new.log'])
  })

  it('deletes oldest files until total size is within the limit', async () => {
    const now = Date.UTC(2026, 6, 11)
    const oldest = join(dir, 'oldest.log')
    const newest = join(dir, 'newest.log')
    await fs.writeFile(oldest, 'a'.repeat(80))
    await fs.writeFile(newest, 'b'.repeat(80))
    await fs.utimes(oldest, new Date(now - 2_000), new Date(now - 2_000))
    await fs.utimes(newest, new Date(now - 1_000), new Date(now - 1_000))

    await cleanupDiagnosticFiles(dir, { now, maxAgeMs: 14 * DAY_MS, maxBytes: 100 })

    expect(await fs.readdir(dir)).toEqual(['newest.log'])
  })

  it('reports file count, size and time range', async () => {
    const first = join(dir, 'first.log')
    const second = join(dir, 'second.log')
    await fs.writeFile(first, '1234')
    await fs.writeFile(second, '567890')
    await fs.utimes(first, new Date(1_000), new Date(1_000))
    await fs.utimes(second, new Date(2_000), new Date(2_000))

    const info = await getDiagnosticsInfo(dir)

    expect(info).toEqual({
      directory: dir,
      fileCount: 2,
      totalBytes: 10,
      oldestAt: new Date(1_000).toISOString(),
      newestAt: new Date(2_000).toISOString()
    })
  })

  it('clears log files but preserves unrelated exports', async () => {
    await fs.writeFile(join(dir, 'main.log'), 'log')
    await fs.writeFile(join(dir, 'bundle.zip'), 'zip')

    await clearDiagnosticFiles(dir)

    expect(await fs.readdir(dir)).toEqual(['bundle.zip'])
  })

  it('exports logs and metadata without adding other local files', async () => {
    await fs.writeFile(join(dir, 'main.log'), '{"event":"safe"}\n')
    await fs.writeFile(join(dir, 'settings.json'), '{"token":"private"}')
    const outputPath = join(dir, 'diagnostics.zip')

    await exportDiagnosticBundle({
      logsDirectory: dir,
      outputPath,
      metadata: { appVersion: '0.2.2', electronVersion: '32.0.0', nodeVersion: '20.0.0' },
      sessionTarget: 'token=private /Users/alice/session'
    })

    const zip = await JSZip.loadAsync(await fs.readFile(outputPath))
    expect(Object.keys(zip.files).sort()).toEqual([
      'README.txt',
      'logs/',
      'logs/main.log',
      'metadata.json'
    ])
    const readme = await zip.file('README.txt')?.async('string')
    expect(readme).toContain('[REDACTED]')
    expect(readme).not.toMatch(/private|alice/)
    expect(await zip.file('metadata.json')?.async('string')).not.toContain('private')
  })
})
