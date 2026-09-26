import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SKILL_SETS } from '../workspaces/templates'

const root = join(process.cwd(), 'resources', 'skill-templates')

describe('builtin skill templates', () => {
  it('exposes the three local-first skills to the default project', () => {
    expect(SKILL_SETS.project).toEqual(expect.arrayContaining([
      'ux-design',
      'prd-tech-review',
      'knowledge-search'
    ]))
  })

  it.each([
    ['ux-design', '优先检索并复用项目绑定的 UX 资产'],
    ['prd-tech-review', '从研发视角评审 PRD'],
    ['knowledge-search', '用 zvec-grep 定位']
  ])('%s has a focused trigger description', (name, trigger) => {
    const source = readFileSync(join(root, name, 'SKILL.md'), 'utf-8')
    expect(source).toContain(`name: ${name}`)
    expect(source).toContain(trigger)
  })

  it('knowledge-search uses zvec-grep then Read, not the old no-MCP wording', () => {
    const source = readFileSync(join(root, 'knowledge-search', 'SKILL.md'), 'utf-8')
    expect(source).toContain('mcp__zvec-grep__zvec_grep_search')
    expect(source).toContain('把命中当作**候选路径**')
    expect(source).not.toContain('无需 RAG、向量库或专用 MCP')
  })
})
