import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const statusSource = readFileSync(new URL('./ResourceIndexStatus.vue', import.meta.url), 'utf-8')
const panelSource = readFileSync(new URL('./ProjectAiConfigPanel.vue', import.meta.url), 'utf-8')

describe('resource index manual build', () => {
  it('offers build and rebuild actions according to index state', () => {
    expect(statusSource).toContain("if (state.value === 'ready') return '重新构建'")
    expect(statusSource).toContain("return '构建索引'")
    expect(statusSource).toContain("emit('build')")
    // 检索统一走 zg 混合索引：INDEX.md 编辑入口已移除
    expect(statusSource).not.toContain("emit('edit')")
    expect(statusSource).not.toContain('编辑索引')
    expect(statusSource).toContain('zg检索 ${zgSearchPercent(status)}%')
    expect(statusSource).toContain('zgSearchPercent')
  })

  it('queues manual builds from both knowledge and UX resource cards', () => {
    expect(panelSource).toContain('async function buildExternalIndex(ref: ExternalRef)')
    expect(panelSource).toContain('searchTraceSummary')
    expect(panelSource).toContain('searchEngineLabel')
    expect(panelSource.match(/@build="[^"]*buildExternalIndex/g)).toHaveLength(2)
    expect(panelSource).not.toContain('openResourceIndex')
  })
})
