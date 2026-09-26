import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ProjectCardMoreMenu.vue', import.meta.url), 'utf-8')

describe('ProjectCardMoreMenu', () => {
  it('collects card actions into an icon-triggered dropdown menu', () => {
    expect(source).toContain('aria-label="更多操作"')
    expect(source).toContain('project-card-more-menu__trigger')
    expect(source).toContain('.product-card:hover .project-card-more-menu__trigger')
    expect(source).toContain('.group\\/card:hover .project-card-more-menu__trigger')
    expect(source).toContain('重命名</DropdownMenuItem>')
    expect(source).toContain('移动</DropdownMenuItem>')
    expect(source).toContain('复制</DropdownMenuItem>')
    expect(source).toContain('删除')
    expect(source).toContain("emit('rename')")
    expect(source).toContain("emit('delete')")
    expect(source).not.toContain('复制到')
    expect(source).not.toContain("emit('edit')")
    expect(source).not.toContain("emit('copyToSpace')")
    expect(source).not.toContain("emit('teamSpace')")
  })
})
