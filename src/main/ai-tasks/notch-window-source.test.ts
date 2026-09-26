import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/ai-tasks/notch-window.ts'), 'utf-8')
const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf-8')
const contractSource = readFileSync(join(process.cwd(), 'src/shared/ipc-contract.ts'), 'utf-8')

describe('ai task notch window compact size', () => {
  it('keeps only mini and panel states with room for the outside badge', () => {
    expect(source).toContain("export type NotchWindowState = 'mini' | 'panel'")
    expect(source).toContain('mini: { width: 44, height: 44 }')
    expect(source).not.toContain('pill:')
    expect(indexSource).toContain('width: 44')
    expect(indexSource).toContain('height: 44')
    expect(indexSource).toContain("applyAiTaskNotchBounds(win, 'mini')")
    expect(contractSource).toContain("input: { state: 'mini' | 'panel' }")
  })
})
