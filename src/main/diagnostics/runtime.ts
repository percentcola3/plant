import log from 'electron-log/main'
import { join } from 'node:path'
import { logsDir } from '../projects/paths'
import {
  cleanupDiagnosticFiles,
  clearDiagnosticFiles,
  exportDiagnosticBundle,
  type DiagnosticBundleMetadata
} from './files'
import { createDiagnosticsService, type DiagnosticEntry } from './service'

let configured = false
let fileLifecycle: Promise<void> = Promise.resolve()

function configureSink(): void {
  if (configured) return
  configured = true
  log.transports.file.resolvePathFn = () => join(logsDir(), 'main.log')
  log.transports.file.format = '{text}'
  log.transports.file.level = 'info'
  log.transports.file.maxSize = 10 * 1024 * 1024
  log.transports.file.sync = true
  log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : false
}

function writeEntry(entry: DiagnosticEntry): void {
  configureSink()
  const line = JSON.stringify(entry)
  if (entry.level === 'error') log.error(line)
  else if (entry.level === 'warn') log.warn(line)
  else log.info(line)
}

export const diagnostics = createDiagnosticsService({ write: writeEntry })

export async function initializeDiagnostics(): Promise<void> {
  configureSink()
  await cleanupRuntimeDiagnosticFiles().catch((error) => {
    diagnostics.error('diagnostics.cleanup.failed', error)
  })
  diagnostics.info('app.diagnostics.started')
}

export async function clearRuntimeDiagnosticFiles(): Promise<void> {
  return withFileLifecycle(async () => {
    configureSink()
    log.transports.file.getFile().clear()
    await clearDiagnosticFiles(logsDir())
  })
}

export async function cleanupRuntimeDiagnosticFiles(): Promise<void> {
  return withFileLifecycle(() => cleanupDiagnosticFiles(logsDir()))
}

export async function exportRuntimeDiagnosticBundle(input: {
  outputPath: string
  metadata: DiagnosticBundleMetadata
  sessionTarget?: string
}): Promise<string> {
  return withFileLifecycle(async () => {
    configureSink()
    await cleanupDiagnosticFiles(logsDir())
    return exportDiagnosticBundle({
      logsDirectory: logsDir(),
      ...input
    })
  })
}

function withFileLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const result = fileLifecycle.then(operation, operation)
  fileLifecycle = result.then(() => undefined, () => undefined)
  return result
}
