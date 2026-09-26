import { describe, expect, it } from 'vitest'
import {
  collectFileWrites,
  mergeFileWrites,
  suppressArtifactEcho,
  ARTIFACT_ECHO_WINDOW_SIZE
} from './artifact-echo-suppressor'
import type { AgentContentBlock } from './agent-events'

const HTML = '<!doctype html>\n<html>\n  <body>\n    <div>hello</div>\n  </body>\n</html>'

describe('artifact-echo-suppressor', () => {
  describe('collectFileWrites', () => {
    it('extracts content from Write tool_use', () => {
      const blocks: AgentContentBlock[] = [
        { type: 'tool_use', toolUseId: 't1', name: 'Write', input: { file_path: 'a.html', content: HTML } }
      ]
      const writes = collectFileWrites(blocks)
      expect(writes).toHaveLength(1)
      expect(writes[0].toolUseId).toBe('t1')
      expect(writes[0].content).toContain('<div>hello</div>')
    })

    it('extracts new_string from Edit tool_use', () => {
      const blocks: AgentContentBlock[] = [
        { type: 'tool_use', toolUseId: 't2', name: 'Edit', input: { file_path: 'a.ts', new_string: 'export const x = 1' } }
      ]
      expect(collectFileWrites(blocks)).toHaveLength(1)
    })

    it('ignores non-file-write tools (Bash, Read)', () => {
      const blocks: AgentContentBlock[] = [
        { type: 'tool_use', toolUseId: 't3', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', toolUseId: 't4', name: 'Read', input: { file_path: 'a.ts' } }
      ]
      expect(collectFileWrites(blocks)).toHaveLength(0)
    })

    it('ignores Write tool_use without content', () => {
      const blocks: AgentContentBlock[] = [
        { type: 'tool_use', toolUseId: 't5', name: 'Write', input: { file_path: 'a.ts' } }
      ]
      expect(collectFileWrites(blocks)).toHaveLength(0)
    })
  })

  describe('mergeFileWrites', () => {
    it('dedupes by toolUseId', () => {
      const recent = [{ toolUseId: 't1', content: 'a' }]
      const incoming = [{ toolUseId: 't1', content: 'a' }]
      expect(mergeFileWrites(recent, incoming)).toHaveLength(1)
    })

    it(`caps at window size ${ARTIFACT_ECHO_WINDOW_SIZE}`, () => {
      let recent: Array<{ toolUseId: string; content: string }> = []
      for (let i = 0; i < ARTIFACT_ECHO_WINDOW_SIZE + 3; i++) {
        recent = mergeFileWrites(recent, [{ toolUseId: `t${i}`, content: `c${i}` }])
      }
      expect(recent.length).toBe(ARTIFACT_ECHO_WINDOW_SIZE)
      // 最老的应被丢掉
      expect(recent.find((r) => r.toolUseId === 't0')).toBeUndefined()
    })
  })

  describe('suppressArtifactEcho', () => {
    it('strips text block that exactly matches a written file content', () => {
      // writes.content 与 text 规范化后一致（suppressArtifactEcho 内部幂等 normalize）
      const writes = [{ content: HTML }]
      const blocks: AgentContentBlock[] = [
        { type: 'text', text: HTML }
      ]
      const out = suppressArtifactEcho(blocks, writes)
      expect(out).toHaveLength(0)
    })

    it('strips text block that matches written content with different whitespace', () => {
      // 写入内容紧凑，echo 内容带缩进 —— 规范化后一致
      const writes = [{ content: '<div>hello</div>' }]
      const blocks: AgentContentBlock[] = [
        { type: 'text', text: '  <div>hello</div>  ' }
      ]
      expect(suppressArtifactEcho(blocks, writes)).toHaveLength(0)
    })

    it('strips text block that is a substring of written content (≥20 chars)', () => {
      const fullCode = 'function hello() {\n  return "world"\n}\n// end of file'
      const writes = [{ content: fullCode.split('\n').map((l) => l.trim()).filter(Boolean).join('\n') }]
      const blocks: AgentContentBlock[] = [
        { type: 'text', text: 'function hello() {\n  return "world"\n}' }
      ]
      const out = suppressArtifactEcho(blocks, writes)
      expect(out).toHaveLength(0)
    })

    it('keeps text block that is unrelated to written content', () => {
      const writes = [{ content: 'const x = 1' }]
      const blocks: AgentContentBlock[] = [
        { type: 'text', text: '我已经完成了文件创建，接下来我们来测试一下功能。' }
      ]
      expect(suppressArtifactEcho(blocks, writes)).toHaveLength(1)
    })

    it('keeps short text echoes (<20 chars) to avoid false positives', () => {
      const writes = [{ content: 'div { color: red; }' }]
      const blocks: AgentContentBlock[] = [
        { type: 'text', text: 'div { color: red; }' }  // 19 chars，刚好 < 20
      ]
      // 精确匹配仍应抑制（w === normalized）
      const out = suppressArtifactEcho(blocks, writes)
      expect(out).toHaveLength(0)
    })

    it('keeps non-text blocks untouched', () => {
      const writes = [{ content: 'something' }]
      const blocks: AgentContentBlock[] = [
        { type: 'tool_use', toolUseId: 't1', name: 'Bash', input: {} },
        { type: 'tool_result', toolUseId: 't1', content: 'done', isError: false }
      ]
      expect(suppressArtifactEcho(blocks, writes)).toEqual(blocks)
    })

    it('returns blocks unchanged when no writes recorded', () => {
      const blocks: AgentContentBlock[] = [{ type: 'text', text: 'hello' }]
      expect(suppressArtifactEcho(blocks, [])).toEqual(blocks)
    })

    it('normalizes whitespace before comparing', () => {
      // 写入内容带多余空白，echo 内容紧凑 —— 规范化后应视为相同
      const writeContent = '  <div>\n\n    hello\n\n  </div>  '
      const writes = [{ content: writeContent }]
      const blocks: AgentContentBlock[] = [
        { type: 'text', text: '<div>\nhello\n</div>' }
      ]
      const out = suppressArtifactEcho(blocks, writes)
      // 规范化后 writeContent = "<div>\nhello\n</div>"，text 规范化后相同 → 抑制
      expect(out).toHaveLength(0)
    })
  })
})
