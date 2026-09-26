import { describe, expect, it } from 'vitest'
import { BUILTIN_RESOURCE_PACKAGES } from './builtin-resource-packages'

describe('builtin resource packages', () => {
  it('only declares metadata and keeps builtin repositories opt-in', () => {
    expect(BUILTIN_RESOURCE_PACKAGES).toEqual([
      expect.objectContaining({
        alias: 'POS前端',
        category: 'knowledge',
        url: 'git@git.example.internal:example-team/soda-saas-b-pos.git'
      }),
      expect.objectContaining({
        alias: '管理端前端',
        category: 'knowledge',
        url: 'git@git.example.internal:example-team/soda-saas-b-manager.git'
      }),
      expect.objectContaining({
        alias: 'SaaSUI',
        category: 'uikit',
        url: 'https://git.example.internal/example-team/saas-desgin-ai.git'
      })
    ])
  })
})
