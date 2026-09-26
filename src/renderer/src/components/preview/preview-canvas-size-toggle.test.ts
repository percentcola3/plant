import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..', '..', '..')

describe('PreviewCanvasSizeToggle', () => {
  const toggleSource = readFileSync(resolve(root, 'src/components/preview/PreviewCanvasSizeToggle.vue'), 'utf8')
  const moreSource = readFileSync(resolve(root, 'src/components/preview/PreviewCanvasSizeMoreMenu.vue'), 'utf8')

  it('renders desktop and phone quick actions with lucide icons', () => {
    expect(toggleSource).toContain('Monitor')
    expect(toggleSource).toContain('Smartphone')
    expect(toggleSource).toContain('1440×900')
    expect(toggleSource).toContain('750×1624')
    expect(toggleSource).toContain('PreviewCanvasSizeMoreMenu')
    expect(toggleSource).toContain("emit('select', presetForKind('desktop'))")
    expect(toggleSource).toContain("emit('select', presetForKind('phone'))")
  })

  it('keeps legacy presets and custom resolution inputs in the more menu', () => {
    expect(moreSource).toContain('DEVICE_PRESETS')
    expect(moreSource).toContain('WORKBENCH_CUSTOM_DEVICE_PRESET')
    expect(moreSource).toContain('自定义')
    expect(moreSource).toContain('onWidthChange')
    expect(moreSource).toContain('toggleRotate')
    expect(moreSource).toContain('响应式')
  })
})
