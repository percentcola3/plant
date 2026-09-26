import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const zgQueryMock = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ui-client-deepseek-tools-userdata', getAppPath: () => '/tmp/ui-client-deepseek-tools-app' }
}))
vi.mock('../zg/zg-search', () => ({
  zgQuery: zgQueryMock
}))

import { createHarnessToolbox } from './tools'
import type { HarnessContext } from './context'

let root = ''
let external = ''
let pool = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ui-client-deepseek-tools-'))
  external = await mkdtemp(join(tmpdir(), 'ui-client-deepseek-external-'))
  pool = await mkdtemp(join(tmpdir(), 'ui-client-deepseek-pool-'))
  await mkdir(join(root, 'editable', 'nested'), { recursive: true })
  await mkdir(join(root, '.external'), { recursive: true })
  await writeFile(join(root, 'top.ts'), 'export const top = true\n')
  await writeFile(join(root, 'editable', 'nested', 'child.ts'), 'export const child = true\n')
  await writeFile(join(external, 'reference.md'), '# Reference\n')
  await writeFile(join(pool, 'package.json'), '{"name":"pos"}\n')
  await symlink(pool, join(root, '.external', 'POS前端'))
  zgQueryMock.mockReset()
})

afterEach(async () => {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(external, { recursive: true, force: true }),
    rm(pool, { recursive: true, force: true })
  ])
})

function toolbox(readRoots = [root, join(root, '.external'), pool, external]) {
  const context: HarnessContext = {
    systemPrompt: '',
    readRoots,
    writeRoots: [join(root, 'editable')],
    skills: new Map()
  }
  return createHarnessToolbox({ projectPath: root, workDir: root, context })
}

describe('DeepSeek Harness file tools', () => {
  it('allows reads in the provided context and writes only in editable roots', async () => {
    const tools = toolbox()

    await expect(tools.execute('Read', { file_path: external + '/reference.md' }))
      .resolves.toMatchObject({ isError: false, content: expect.stringContaining('# Reference') })
    await expect(tools.execute('Write', { file_path: 'editable/new.ts', content: 'export {}\n' }))
      .resolves.toMatchObject({ isError: false })
    await expect(tools.execute('Write', { file_path: 'README.md', content: 'blocked' }))
      .resolves.toMatchObject({ isError: true, content: expect.stringContaining('允许的写入范围') })
  })

  it('rejects traversal and symlinks that escape an editable root', async () => {
    const tools = toolbox()
    await symlink(external, join(root, 'editable', 'outside-link'))

    await expect(tools.execute('Write', { file_path: '../outside.txt', content: 'blocked' }))
      .resolves.toMatchObject({ isError: true })
    await expect(tools.execute('Write', { file_path: 'editable/outside-link/escaped.txt', content: 'blocked' }))
      .resolves.toMatchObject({ isError: true })
  })

  it('matches both root files and nested files with ** patterns', async () => {
    const result = await toolbox().execute('Glob', { pattern: '**/*.ts' })

    expect(result).toMatchObject({ isError: false })
    expect(result.content).toContain('top.ts')
    expect(result.content).toContain('editable/nested/child.ts')
  })

  it('follows .external knowledge mounts for Glob and Read', async () => {
    const tools = toolbox()
    const glob = await tools.execute('Glob', { pattern: '**/package.json', path: '.external' })
    expect(glob).toMatchObject({ isError: false })
    expect(glob.content).toContain('POS前端/package.json')

    await expect(tools.execute('Read', { file_path: '.external/POS前端/package.json' }))
      .resolves.toMatchObject({ isError: false, content: expect.stringContaining('"pos"') })
  })

  it('zg_search queries the mounted knowledge root via zg', async () => {
    zgQueryMock.mockResolvedValue([
      { relPath: 'package.json', lineStart: 1, lineEnd: 1, matchedBy: 'fts+vector', lines: ['{"name":"pos"}'] }
    ])
    const result = await toolbox().execute('zg_search', { query: '打包配置', root: '.external/POS前端' })
    expect(result).toMatchObject({ isError: false })
    expect(result.content).toContain('matchedBy=fts+vector')
    expect(result.content).toContain('package.json')
    expect(zgQueryMock).toHaveBeenCalledWith(join(root, '.external', 'POS前端'), '打包配置', { limit: 12 })
  })

  it('zg_search on .external fans out to indexed alias mounts', async () => {
    await mkdir(join(pool, '.zvec-grep'), { recursive: true })
    zgQueryMock.mockResolvedValue([
      { relPath: 'package.json', lineStart: 1, lineEnd: 1, matchedBy: 'fts', lines: ['{"name":"pos"}'] }
    ])
    const result = await toolbox().execute('zg_search', { query: '打包配置' })
    expect(result).toMatchObject({ isError: false })
    expect(result.content).toContain('POS前端/package.json')
    expect(zgQueryMock).toHaveBeenCalledWith(join(root, '.external', 'POS前端'), '打包配置', { limit: 12 })
  })

  it('exposes and executes the Claude-compatible zg MCP tool name', async () => {
    zgQueryMock.mockResolvedValue([
      { relPath: 'package.json', lineStart: 1, lineEnd: 1, matchedBy: 'fts+vector', lines: ['{"name":"pos"}'] }
    ])
    const tools = toolbox()
    expect(tools.definitions.map((item) => item.function.name)).toContain('mcp__zvec-grep__zvec_grep_search')
    expect(tools.definitions.find((item) => item.function.name === 'mcp__zvec-grep__zvec_grep_search')?.function.description)
      .toContain('calling this tool is optional')
    expect(tools.definitions.find((item) => item.function.name === 'mcp__zvec-grep__zvec_grep_search')?.function.description)
      .toContain('Hits are routes, not facts')
    expect(tools.definitions.find((item) => item.function.name === 'mcp__zvec-grep__zvec_grep_search')?.function.description)
      .toContain('@POS前端')

    const result = await tools.execute('mcp__zvec-grep__zvec_grep_search', {
      queries: ['打包配置'],
      root: '.external/POS前端'
    })
    expect(result).toMatchObject({ isError: false })
    expect(result.content).toContain('matchedBy=fts+vector')
    expect(zgQueryMock).toHaveBeenCalledWith(join(root, '.external', 'POS前端'), '打包配置', { limit: 12 })
  })
})
