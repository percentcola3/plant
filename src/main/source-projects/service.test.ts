import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runtimeRoot = vi.hoisted(() => ({ path: '' }))
const gitState = vi.hoisted(() => ({ dirty: false, commits: [] as string[] }))

vi.mock('electron', () => ({ app: { getPath: () => runtimeRoot.path } }))

vi.mock('../git/client', () => ({
  gitFor: vi.fn((cwd: string) => ({
    raw: vi.fn(async (args: string[]) => {
      if (args.join(' ') === 'rev-parse --is-inside-work-tree') return 'true\n'
      if (args.join(' ') === 'remote get-url origin') return 'git@example.com:team/demo.git\n'
      return ''
    }),
    status: vi.fn(async () => ({ current: 'master', isClean: () => !gitState.dirty })),
    clone: vi.fn(async (source: string, target: string) => {
      await fs.cp(source, target, { recursive: true })
    }),
    add: vi.fn(async () => undefined),
    commit: vi.fn(async (message: string) => { gitState.commits.push(message); gitState.dirty = false })
  }))
}))

import { associateSourceProject, commitSourceProject, getSourceProject } from './service'

let root = ''
let workspace = ''
let source = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'source-project-'))
  runtimeRoot.path = join(root, 'app-data')
  workspace = join(root, 'workspace')
  source = join(root, 'manager')
  await fs.mkdir(join(workspace, 'features', 'order'), { recursive: true })
  await fs.mkdir(source, { recursive: true })
  await fs.writeFile(join(source, 'ui-client.runtime.json'), JSON.stringify({
    schemaVersion: 1,
    name: 'Manager',
    node: '16.15.1',
    packageManager: 'yarn@1.22.22',
    install: ['yarn', 'ideps'],
    start: ['yarn', 'dev'],
    readyUrl: 'http://127.0.0.1:8001',
    mockOutputDir: '.ui-client-runtime/mocks'
  }))
  gitState.dirty = false
  gitState.commits = []
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('source project service', () => {
  it('keeps a project directory normal while associating one private source copy', async () => {
    const associated = await associateSourceProject(workspace, 'features/order', source)

    expect(associated.state).toBe('ready')
    expect(associated.binding?.runtime).toMatchObject({
      name: 'Manager',
      start: ['yarn', 'dev'],
      mockOutputDir: '.ui-client-runtime/mocks'
    })
    await expect(fs.stat(join(workspace, 'features', 'order', '.source-project.json'))).resolves.toBeDefined()
    expect((await getSourceProject(workspace, 'features/order')).state).toBe('ready')
  })

  it('commits only the private source copy', async () => {
    await associateSourceProject(workspace, 'features/order', source)
    gitState.dirty = true

    const result = await commitSourceProject(workspace, 'features/order', 'feat: adjust order view')

    expect(result.dirty).toBe(false)
    expect(gitState.commits).toEqual(['feat: adjust order view'])
  })
})
