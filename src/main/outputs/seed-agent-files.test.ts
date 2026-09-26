import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, readlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedProductAgentFiles } from './seed-agent-files'

let workspacePath: string

beforeEach(async () => {
  workspacePath = await mkdtemp(join(tmpdir(), 'seed-agent-files-'))
})

afterEach(async () => {
  await fs.rm(workspacePath, { recursive: true, force: true })
})

async function write(relPath: string, content: string): Promise<void> {
  const abs = join(workspacePath, relPath)
  await fs.mkdir(join(abs, '..'), { recursive: true })
  await fs.writeFile(abs, content, 'utf-8')
}

async function read(relPath: string): Promise<string> {
  return fs.readFile(join(workspacePath, relPath), 'utf-8')
}

describe('seedProductAgentFiles', () => {
  it('copies skills and root agent instruction files into the product directory', async () => {
    await write('.claude/skills/pm-prd/SKILL.md', 'claude skill')
    await write('.agents/skills/pm-prd/SKILL.md', 'agents skill')
    await write('AGENTS.md', 'agents rules')
    await write('CLAUDE.md', 'claude rules')
    await write('.cursor/rules/project.mdc', 'cursor rules')
    await write('.external/ui/README.md', 'ui assets')

    const result = await seedProductAgentFiles(workspacePath, 'features/payments')

    expect(result.sourcedFrom).toEqual([
      '.claude/skills',
      '.agents/skills',
      'AGENTS.md',
      'CLAUDE.md',
      '.cursor/rules'
    ])
    expect(result.copied).toBe(5)
    await expect(read('features/payments/.claude/skills/pm-prd/SKILL.md')).resolves.toBe('claude skill')
    await expect(read('features/payments/.agents/skills/pm-prd/SKILL.md')).resolves.toBe('agents skill')
    await expect(read('features/payments/AGENTS.md')).resolves.toBe('agents rules')
    await expect(read('features/payments/CLAUDE.md')).resolves.toBe('claude rules')
    await expect(read('features/payments/.cursor/rules/project.mdc')).resolves.toBe('cursor rules')
    expect(await readlink(join(workspacePath, 'features/payments/.external'))).toBe('../../.external')
    await expect(read('features/payments/.external/ui/README.md')).resolves.toBe('ui assets')
  })

  it('keeps existing agent links and does not copy through them', async () => {
    await write('.claude/skills/pm-prd/SKILL.md', 'claude skill')
    await write('.agents/skills/pm-prd/SKILL.md', 'agents skill')
    await write('AGENTS.md', 'agents rules')
    await write('CLAUDE.md', 'claude rules')
    await write('.cursor/rules/project.mdc', 'cursor rules')
    await fs.mkdir(join(workspacePath, 'features/payments/.cursor'), { recursive: true })
    await fs.mkdir(join(workspacePath, 'features/payments/.workspace'), { recursive: true })
    await fs.symlink('../../.claude', join(workspacePath, 'features/payments/.claude'))
    await fs.symlink('../../.agents', join(workspacePath, 'features/payments/.agents'))
    await fs.symlink('../../AGENTS.md', join(workspacePath, 'features/payments/AGENTS.md'))
    await fs.symlink('../../CLAUDE.md', join(workspacePath, 'features/payments/CLAUDE.md'))
    await fs.symlink('../../../.cursor/rules', join(workspacePath, 'features/payments/.cursor/rules'))

    const result = await seedProductAgentFiles(workspacePath, 'features/payments')

    expect(result.sourcedFrom).toEqual([])
    expect(await readlink(join(workspacePath, 'features/payments/.claude'))).toBe('../../.claude')
    expect(await readlink(join(workspacePath, 'features/payments/.cursor/rules'))).toBe('../../../.cursor/rules')
    await expect(read('AGENTS.md')).resolves.toBe('agents rules')
    await expect(read('CLAUDE.md')).resolves.toBe('claude rules')
  })
})
