import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('macOS Dock icon', () => {
  const mainSource = readFileSync(resolve(__dirname, 'index.ts'), 'utf8')
  const builderConfig = readFileSync(resolve(__dirname, '../../electron-builder.yml'), 'utf8')

  it('restores the WorkSpace icon after showing the Dock in development and packaged builds', () => {
    expect(mainSource).toContain("? join(process.resourcesPath, 'icon.png')")
    expect(mainSource).toContain(": join(app.getAppPath(), 'build', 'icon.png')")
    expect(mainSource).toContain('.then(() => dock.setIcon(dockIconPath))')
    expect(mainSource).toContain('showMacDockIcon()')
  })

  it('packages explicit bundle and runtime Dock icons', () => {
    expect(builderConfig).toContain('icon: build/icon.icns')
    expect(builderConfig).toContain('- from: build/icon.png')
    expect(builderConfig).toContain('to: icon.png')
  })
})
