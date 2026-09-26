import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./Input.vue', import.meta.url), 'utf-8')

describe('Input focus treatment', () => {
  it('uses a 1px focus border instead of the thick shadcn ring', () => {
    expect(source).toContain('focus-visible:border-ring')
    expect(source).toContain('focus-visible:ring-0')
    expect(source).toContain('focus-visible:ring-offset-0')
    expect(source).not.toContain('focus-visible:ring-2')
    expect(source).not.toContain('focus-visible:ring-offset-2')
  })
})
