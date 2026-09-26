import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { injectInspectorIntoHtml } from './inspector-assets'

const previewServerSource = readFileSync(join(process.cwd(), 'src/main/http/preview-server.ts'), 'utf-8')
const systemHandlerSource = readFileSync(join(process.cwd(), 'src/main/ipc/handlers/system.ts'), 'utf-8')
const ipcContractSource = readFileSync(join(process.cwd(), 'src/shared/ipc-contract.ts'), 'utf-8')

describe('injectInspectorIntoHtml', () => {
  it('injects inspector context before closing body', () => {
    const html = '<html><body><main>demo</main></body></html>'

    const result = injectInspectorIntoHtml(html, 'p1', 'outputs/demo/index.html', 'token-123')

    expect(result).toContain('window.__UIKIT_INSPECTOR=')
    expect(result).toContain('"projectId":"p1"')
    expect(result).toContain('<script src="/static/inspector.js" defer></script>')
    expect(result.indexOf('/static/inspector.js')).toBeLessThan(result.indexOf('</body>'))
  })

  it('appends inspector block when body is missing', () => {
    const html = '<div>demo only</div>'

    const result = injectInspectorIntoHtml(html, 'p1', 'outputs/demo/index.html', 'token-123')

    expect(result.startsWith(html)).toBe(true)
    expect(result).toContain('/static/inspector.js')
  })

  it('injects the inspector only into editable preview html', () => {
    expect(previewServerSource).toContain('const isEditablePreviewHtml')
    expect(previewServerSource).toContain('isOutputHtml')
    expect(previewServerSource).toContain('isProjectUiHtml')
    expect(previewServerSource).toContain('isFeatureHtml')
  })

  it('does not expose an inspector guide route or IPC endpoint', () => {
    expect(previewServerSource).not.toContain('inspector-guide')
    expect(systemHandlerSource).not.toContain('preview.inspectorGuideUrl')
    expect(ipcContractSource).not.toContain('preview.inspectorGuideUrl')
  })
})
