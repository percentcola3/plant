import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const fakeHome = vi.hoisted(() => ({ path: '' }))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => fakeHome.path }
})

import { buildHarnessContext } from './context'

let projectPath = ''

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'ui-client-deepseek-context-'))
  fakeHome.path = await mkdtemp(join(tmpdir(), 'ui-client-deepseek-home-'))
  await mkdir(join(projectPath, '.workspace'), { recursive: true })
  await mkdir(join(projectPath, '.agents', 'skills', 'project-skill'), { recursive: true })
  await mkdir(join(fakeHome.path, '.claude', 'skills', 'user-skill'), { recursive: true })
  await writeFile(join(projectPath, '.workspace', 'project-context.json'), JSON.stringify({
    editableRoots: ['features/']
  }))
  await writeFile(join(projectPath, 'AGENTS.md'), '只修改功能目录。')
  await writeFile(join(projectPath, '.agents', 'skills', 'project-skill', 'SKILL.md'), [
    '---',
    'name: project-skill',
    'description: 项目内技能',
    '---',
    'Use this skill.'
  ].join('\n'))
  await writeFile(join(fakeHome.path, '.claude', 'skills', 'user-skill', 'SKILL.md'), [
    '---',
    'name: user-skill',
    'description: 用户技能',
    '---',
    'Use this skill.'
  ].join('\n'))
})

afterEach(async () => {
  await Promise.all([
    rm(projectPath, { recursive: true, force: true }),
    rm(fakeHome.path, { recursive: true, force: true })
  ])
})

describe('DeepSeek Harness context', () => {
  it('injects project instructions and catalogs project/user skills while preserving file scopes', async () => {
    const context = await buildHarnessContext({
      projectPath,
      workDir: projectPath,
      addDirs: [join(projectPath, '.external')]
    })

    expect(context.writeRoots).toEqual([join(projectPath, 'features')])
    expect(context.readRoots).toEqual(expect.arrayContaining([
      projectPath,
      join(projectPath, '.external'),
      join(projectPath, '.agents', 'skills', 'project-skill'),
      join(fakeHome.path, '.claude', 'skills', 'user-skill')
    ]))
    expect([...context.skills.keys()]).toEqual(['project-skill', 'user-skill'])
    expect(context.systemPrompt).toContain('只修改功能目录。')
    expect(context.systemPrompt).toContain('project-skill: 项目内技能')
    expect(context.systemPrompt).toContain('user-skill: 用户技能')
    expect(context.systemPrompt).toContain('Writable roots (enforced by the harness):')
    expect(context.systemPrompt).toContain('mcp__zvec-grep__zvec_grep_search')
    expect(context.systemPrompt).toContain('Decide whether retrieval is needed')
    expect(context.systemPrompt).toContain('Only if that scope has no relevant information')
    expect(context.systemPrompt).not.toContain('Glob/Grep follow the same mounts')
  })

  it('expands .external directory mounts into readable pool roots', async () => {
    const pool = await mkdtemp(join(tmpdir(), 'ui-client-deepseek-pool-'))
    await mkdir(join(projectPath, '.external'), { recursive: true })
    await writeFile(join(pool, 'README.md'), 'pos')
    await symlink(pool, join(projectPath, '.external', 'POS前端'))

    const context = await buildHarnessContext({
      projectPath,
      workDir: projectPath,
      addDirs: [join(projectPath, '.external')]
    })

    expect(context.readRoots).toEqual(expect.arrayContaining([
      join(projectPath, '.external'),
      await realpath(pool)
    ]))
    await rm(pool, { recursive: true, force: true })
  })
})
