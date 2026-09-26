import { app, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandler } from '../ipc/registry'
import { logsDir } from '../projects/paths'
import {
  getDiagnosticsInfo
} from './files'
import {
  cleanupRuntimeDiagnosticFiles,
  clearRuntimeDiagnosticFiles,
  diagnostics,
  exportRuntimeDiagnosticBundle
} from './runtime'
import { sanitizeCorrelationId } from './redact'

export function registerDiagnosticsHandlers(): void {
  registerIpcHandler('diagnostics.info', async () => {
    await cleanupRuntimeDiagnosticFiles()
    return getDiagnosticsInfo(logsDir())
  })

  registerIpcHandler('diagnostics.reveal', async () => {
    await cleanupRuntimeDiagnosticFiles()
    const error = await shell.openPath(logsDir())
    if (error) throw new Error(error)
    diagnostics.info('diagnostics.directory.revealed')
  })

  registerIpcHandler('diagnostics.export', async ({ sessionId }) => {
    const sessionTarget = sessionId ? sanitizeCorrelationId(sessionId) : undefined
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outputPath = join(app.getPath('downloads'), `WorkSpace-diagnostics-${stamp}.zip`)
    await exportRuntimeDiagnosticBundle({
      outputPath,
      metadata: {
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron ?? '',
        nodeVersion: process.versions.node,
        chromeVersion: process.versions.chrome
      },
      sessionTarget
    })
    shell.showItemInFolder(outputPath)
    diagnostics.info('diagnostics.bundle.exported', { sessionTarget: sessionTarget ?? '' })
    return { path: outputPath }
  })

  registerIpcHandler('diagnostics.clear', async () => {
    await clearRuntimeDiagnosticFiles()
    return getDiagnosticsInfo(logsDir())
  })

  registerIpcHandler('diagnostics.reportRendererError', async ({ kind, name, message, stack }) => {
    const error = new Error(message)
    error.name = name || 'RendererError'
    if (stack) error.stack = stack
    diagnostics.error('renderer.unhandled', error, { eventType: kind })
  })
}
