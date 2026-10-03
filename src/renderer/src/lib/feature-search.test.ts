import { describe, expect, it } from 'vitest'
import type { FeatureCard } from '@shared/types'
import { featureMatchesSearch, fuzzyMatch } from './feature-search'

const sampleCard: FeatureCard = {
  name: '0725 【pdv】优惠券+返现支持堂食场景',
  relPath: 'features/POS/0725-pdv-coupon',
  group: 'POS',
  prdRelPath: 'features/POS/0725-pdv-coupon/prd.md',
  uiArtifacts: [{ name: '首页', htmlRelPath: 'features/POS/0725-pdv-coupon/ui/index.html', rootRelPath: 'features/POS/0725-pdv-coupon/ui' }],
  modifiedAt: null,
}

const displayDocPath = () => 'prd.md'
const resolveGroup = () => 'POS'

describe('fuzzyMatch', () => {
  it('matches substring queries', () => {
    expect(fuzzyMatch('优惠券支持堂食', '优惠券')).toBe(true)
  })

  it('matches out-of-order character sequences', () => {
    expect(fuzzyMatch('0725 【pdv】优惠券', 'pdv优')).toBe(true)
  })

  it('rejects unrelated queries', () => {
    expect(fuzzyMatch('0725 【pdv】优惠券', '外卖')).toBe(false)
  })
})

describe('featureMatchesSearch', () => {
  it('matches project name and group tokens', () => {
    expect(featureMatchesSearch(sampleCard, 'pdv 优惠券', displayDocPath, resolveGroup)).toBe(true)
    expect(featureMatchesSearch(sampleCard, 'POS pdv', displayDocPath, resolveGroup)).toBe(true)
  })

  it('returns all cards when query is empty', () => {
    expect(featureMatchesSearch(sampleCard, '   ', displayDocPath, resolveGroup)).toBe(true)
  })
})
