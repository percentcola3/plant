import { describe, expect, it } from 'vitest'
import { findOutOfScopeArtifacts } from './scope-warning'

describe('findOutOfScopeArtifacts', () => {
  it('returns changed artifacts outside editable roots', () => {
    expect(findOutOfScopeArtifacts(
      ['features/payments/index.html', 'features/refund/index.html', 'README.md'],
      ['features/payments/']
    )).toEqual(['features/refund/index.html', 'README.md'])
  })

  it('does not warn when there are no editable roots', () => {
    expect(findOutOfScopeArtifacts(['README.md'], [])).toEqual([])
  })
})
