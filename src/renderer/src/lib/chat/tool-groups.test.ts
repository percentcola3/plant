import { describe, expect, it } from 'vitest'
import {
  groupToolCalls,
  isRetrievalEntry,
  summarizeGroup,
  getToolFamily,
  type ToolCallPair
} from './tool-groups'

function pair(name: string, status: ToolCallPair['status'] = 'done', id?: string): ToolCallPair {
  return { toolUseId: id ?? `${name}-${Math.random()}`, name, input: {}, status }
}

describe('tool-groups', () => {
  describe('getToolFamily', () => {
    it('maps editing tools', () => {
      expect(getToolFamily('Write')).toBe('editing')
      expect(getToolFamily('Edit')).toBe('editing')
      expect(getToolFamily('MultiEdit')).toBe('editing')
    })
    it('maps reading/searching/bash/web', () => {
      expect(getToolFamily('Read')).toBe('reading')
      expect(getToolFamily('Glob')).toBe('searching')
      expect(getToolFamily('Grep')).toBe('searching')
      expect(getToolFamily('Bash')).toBe('bash')
      expect(getToolFamily('WebFetch')).toBe('web')
    })
    it('returns name as family for unmapped tools', () => {
      expect(getToolFamily('TodoWrite')).toBe('TodoWrite')
      expect(getToolFamily('CustomTool')).toBe('CustomTool')
    })
  })

  describe('groupToolCalls', () => {
    it('returns empty for no pairs', () => {
      expect(groupToolCalls([])).toEqual([])
    })

    it('keeps single tool as single entry', () => {
      const pairs = [pair('Bash')]
      const out = groupToolCalls(pairs)
      expect(out).toHaveLength(1)
      expect(out[0].kind).toBe('single')
    })

    it('groups consecutive same-family tools', () => {
      const pairs = [
        pair('Edit', 'done', 'e1'),
        pair('Edit', 'done', 'e2'),
        pair('Write', 'pending', 'w1')
      ]
      const out = groupToolCalls(pairs)
      expect(out).toHaveLength(1)
      expect(out[0].kind).toBe('group')
      if (out[0].kind === 'group') {
        expect(out[0].family).toBe('editing')
        expect(out[0].pairs).toHaveLength(3)
      }
    })

    it('does not group non-consecutive same-family tools', () => {
      // Edit, Bash, Edit —— 第一个 Edit 和第三个 Edit 不相邻，不合并
      const pairs = [
        pair('Edit', 'done', 'e1'),
        pair('Bash', 'done', 'b1'),
        pair('Edit', 'done', 'e2')
      ]
      const out = groupToolCalls(pairs)
      expect(out).toHaveLength(3)
      expect(out.every(e => e.kind === 'single')).toBe(true)
    })

    it('groups multiple families in sequence', () => {
      const pairs = [
        pair('Edit', 'done', 'e1'),
        pair('Edit', 'done', 'e2'),
        pair('Read', 'done', 'r1'),
        pair('Read', 'done', 'r2'),
        pair('Bash', 'pending', 'b1')
      ]
      const out = groupToolCalls(pairs)
      expect(out).toHaveLength(3)
      expect(out[0].kind).toBe('group')      // editing ×2
      expect(out[1].kind).toBe('group')      // reading ×2
      expect(out[2].kind).toBe('single')     // bash ×1
    })
  })

  describe('summarizeGroup', () => {
    it('all done', () => {
      const s = summarizeGroup('editing', [pair('Edit', 'done'), pair('Edit', 'done')])
      expect(s.label).toBe('编辑 ×2')
      expect(s.status).toBe('done')
      expect(s.statusLabel).toBe('已编辑')
    })

    it('has pending', () => {
      const s = summarizeGroup('editing', [pair('Edit', 'done'), pair('Edit', 'pending')])
      expect(s.status).toBe('pending')
      expect(s.statusLabel).toBe('进行中 (1/2)')
    })

    it('all error', () => {
      const s = summarizeGroup('editing', [pair('Edit', 'error'), pair('Edit', 'error')])
      expect(s.status).toBe('error')
      expect(s.statusLabel).toBe('失败')
    })

    it('partial error (no pending)', () => {
      const s = summarizeGroup('editing', [pair('Edit', 'done'), pair('Edit', 'error')])
      expect(s.status).toBe('error')
      expect(s.statusLabel).toBe('部分失败 (1/2)')
    })
  })
})


describe('retrieval timeline entries', () => {
  it('groups aliases together but does not mix plain grep into retrieval', () => {
    const entries = groupToolCalls([
      pair('Grep'), pair('zg_search'), pair('mcp__zvec-grep__zvec_grep_search', 'pending'), pair('Read')
    ])
    expect(entries).toHaveLength(3)
    expect(entries.map(isRetrievalEntry)).toEqual([false, true, false])
    const entry = entries[1]
    if (entry.kind !== 'group') throw new Error('Expected retrieval group')
    expect(summarizeGroup(entry.family, entry.pairs)).toMatchObject({ label: 'zvec-grep 检索 ×2', status: 'pending' })
  })

  it('retains failed standalone retrieval and never invents it for ordinary tools', () => {
    expect(groupToolCalls([pair('zg_search', 'error')]).filter(isRetrievalEntry)).toHaveLength(1)
    expect(groupToolCalls([pair('Read'), pair('Grep')]).filter(isRetrievalEntry)).toEqual([])
  })
})
