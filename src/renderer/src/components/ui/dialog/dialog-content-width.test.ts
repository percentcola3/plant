import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./DialogContent.vue', import.meta.url), 'utf-8')

describe('DialogContent width', () => {
  it('keeps horizontal viewport gutters so focused inputs are not clipped', () => {
    expect(source).toContain('w-[calc(100vw-2rem)]')
    expect(source).not.toContain('grid w-full max-w-lg')
  })
})
