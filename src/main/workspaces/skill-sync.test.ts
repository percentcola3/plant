// G0 智能 skill 同步契约测试：覆盖三类情形
//   1. 文件不存在 → 写
//   2. 用户没改过（文件 hash 等于上次记录的源 hash）→ 用新模板覆盖
//   3. 用户改过 → 保留不动
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncSkillSubtree } from './skill-sync'

let workspacePath: string
let templateDir: string
let targetDir: string

beforeEach(() => {
  workspacePath = mkdtempSync(join(tmpdir(), 'skill-sync-'))
  templateDir = mkdtempSync(join(tmpdir(), 'skill-template-'))
  targetDir = join(workspacePath, '.claude', 'skills', 'sample-skill')
})

afterEach(() => {
  rmSync(workspacePath, { recursive: true, force: true })
  rmSync(templateDir, { recursive: true, force: true })
})

function writeTemplate(rel: string, content: string): void {
  const full = join(templateDir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content, 'utf-8')
}

describe('syncSkillSubtree', () => {
  it('writes new files on first sync and records their hash', () => {
    writeTemplate('SKILL.md', 'v1 content')
    writeTemplate('templates/foo.md', 'foo')
    return syncSkillSubtree(workspacePath, templateDir, targetDir).then((result) => {
      expect(result.written).toBe(2)
      expect(result.preservedUserEdits).toEqual([])
      expect(readFileSync(join(targetDir, 'SKILL.md'), 'utf-8')).toBe('v1 content')
      expect(existsSync(join(workspacePath, '.ui-client', 'skill-managed-hashes.json'))).toBe(true)
    })
  })

  it('updates files when source changes and user has not modified', async () => {
    writeTemplate('SKILL.md', 'v1')
    await syncSkillSubtree(workspacePath, templateDir, targetDir)
    // 第二次 sync：模板更新到 v2
    writeTemplate('SKILL.md', 'v2 with new rules')
    const result = await syncSkillSubtree(workspacePath, templateDir, targetDir)
    expect(result.written).toBe(1)
    expect(result.preservedUserEdits).toEqual([])
    expect(readFileSync(join(targetDir, 'SKILL.md'), 'utf-8')).toBe('v2 with new rules')
  })

  it('preserves user-modified files and skips overwrite', async () => {
    writeTemplate('SKILL.md', 'v1')
    await syncSkillSubtree(workspacePath, templateDir, targetDir)
    // 用户改了本地副本
    writeFileSync(join(targetDir, 'SKILL.md'), 'user customized version', 'utf-8')
    // 模板也改了
    writeTemplate('SKILL.md', 'v2')
    const result = await syncSkillSubtree(workspacePath, templateDir, targetDir)
    expect(result.written).toBe(0)
    expect(result.preservedUserEdits.some((p) => p.endsWith('SKILL.md'))).toBe(true)
    // 用户改动保留
    expect(readFileSync(join(targetDir, 'SKILL.md'), 'utf-8')).toBe('user customized version')
  })

  it('no-op when source matches existing target byte-for-byte', async () => {
    writeTemplate('SKILL.md', 'v1')
    await syncSkillSubtree(workspacePath, templateDir, targetDir)
    const result = await syncSkillSubtree(workspacePath, templateDir, targetDir)
    expect(result.written).toBe(0)
    expect(result.preservedUserEdits).toEqual([])
  })

  it('walks nested subdirectories', async () => {
    writeTemplate('SKILL.md', 'root')
    writeTemplate('templates/foo.md', 'a')
    writeTemplate('templates/sub/bar.md', 'b')
    const result = await syncSkillSubtree(workspacePath, templateDir, targetDir)
    expect(result.written).toBe(3)
    expect(existsSync(join(targetDir, 'templates', 'sub', 'bar.md'))).toBe(true)
  })

  it('handles fresh template files added between syncs', async () => {
    writeTemplate('SKILL.md', 'v1')
    await syncSkillSubtree(workspacePath, templateDir, targetDir)
    // 模板新增一个文件
    writeTemplate('templates/new.md', 'fresh')
    const result = await syncSkillSubtree(workspacePath, templateDir, targetDir)
    expect(result.written).toBe(1)
    expect(readFileSync(join(targetDir, 'templates', 'new.md'), 'utf-8')).toBe('fresh')
  })

  it('overwrites hash-less copies that still carry the old builtin MCP-unnecessary marker', async () => {
    writeTemplate('SKILL.md', '先调用 mcp__zvec-grep__zvec_grep_search 定位候选文件')
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(
      join(targetDir, 'SKILL.md'),
      '---\nname: knowledge-search\ndescription: 查知识库；无需 RAG、向量库或专用 MCP。\n---\n',
      'utf-8'
    )
    const result = await syncSkillSubtree(workspacePath, templateDir, targetDir)
    expect(result.written).toBe(1)
    expect(result.preservedUserEdits).toEqual([])
    expect(readFileSync(join(targetDir, 'SKILL.md'), 'utf-8')).toContain('mcp__zvec-grep__zvec_grep_search')
  })
})
