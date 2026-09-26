import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../shared/ipc-contract'

describe('diagnostics IPC', () => {
  it('declares every diagnostics channel in the preload allowlist', () => {
    expect(IPC_CHANNELS).toEqual(expect.arrayContaining([
      'diagnostics.info',
      'diagnostics.reveal',
      'diagnostics.export',
      'diagnostics.clear',
      'diagnostics.reportRendererError'
    ]))
  })

  it('registers local management and renderer error handlers', () => {
    const source = readFileSync(resolve(__dirname, 'handlers.ts'), 'utf8')
    const runtimeSource = readFileSync(resolve(__dirname, 'runtime.ts'), 'utf8')

    expect(source).toContain("registerIpcHandler('diagnostics.info'")
    expect(source).toContain("registerIpcHandler('diagnostics.reveal'")
    expect(source).toContain("registerIpcHandler('diagnostics.export'")
    expect(source).toContain("registerIpcHandler('diagnostics.clear'")
    expect(source).toContain("registerIpcHandler('diagnostics.reportRendererError'")
    expect(source).toContain('sanitizeCorrelationId(sessionId)')
    expect(source).toContain('exportRuntimeDiagnosticBundle({')
    expect(runtimeSource).toContain('log.transports.file.sync = true')
  })

  it('captures main, IPC and renderer stability failures', () => {
    const mainSource = readFileSync(resolve(__dirname, '../index.ts'), 'utf8')
    const registrySource = readFileSync(resolve(__dirname, '../ipc/registry.ts'), 'utf8')
    const rendererSource = readFileSync(resolve(__dirname, '../../renderer/src/main.ts'), 'utf8')

    expect(mainSource).toContain('initializeDiagnostics()')
    expect(mainSource).toContain("app.on('render-process-gone'")
    expect(mainSource).toContain("app.on('child-process-gone'")
    expect(registrySource).toContain("diagnostics.error('ipc.handler.failed'")
    expect(rendererSource).toContain("call('diagnostics.reportRendererError'")
    expect(rendererSource).toContain("window.addEventListener('unhandledrejection'")
  })
})
