import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const featuresSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/layout/FeaturesPage.vue'),
  'utf-8'
)
describe('project import actions', () => {
  it('adds a PM project import action backed by feature.import', () => {
    expect(featuresSource).toContain('async function importFeatureProject(): Promise<void>')
    expect(featuresSource).toContain("'system.selectDirectory'")
    expect(featuresSource).toContain("'feature.import'")
    expect(featuresSource).toContain('@click="importFeatureProject"')
    expect(featuresSource).toContain('导入项目')
  })

})
