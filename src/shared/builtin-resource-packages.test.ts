import { describe, expect, it } from 'vitest'
import { BUILTIN_RESOURCE_PACKAGES } from './builtin-resource-packages'

describe('builtin resource packages', () => {
  it('ships no builtin repositories by default', () => {
    expect(BUILTIN_RESOURCE_PACKAGES).toEqual([])
  })
})
