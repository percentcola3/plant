import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExternalRefHint } from './compose-prompt'
import { loadResourceInstructions } from './resource-instructions'

const dirs: string[] = []

async function projectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'resource-instructions-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('loadResourceInstructions', () => {
  it('读取最新 AI_USAGE.md 并保留项目级说明', async () => {
    const root = await projectDir()
    await fs.mkdir(join(root, '.external', 'guide'), { recursive: true })
    await fs.writeFile(join(root, '.external', 'guide', 'AI_USAGE.md'), '优先使用 tokens。')
    const refs: ExternalRefHint[] = [{
      alias: 'guide',
      path: '.external/guide',
      instructionPath: '.external/guide/AI_USAGE.md',
      usageNote: '只使用亮色主题。',
      kind: 'local',
      category: 'uikit'
    }]

    expect(loadResourceInstructions(root, refs)[0]).toEqual(expect.objectContaining({
      instructions: '优先使用 tokens。',
      usageNote: '只使用亮色主题。'
    }))
  })

  it('单文件最多 12 KB，所有资源说明合计最多 32 KB', async () => {
    const root = await projectDir()
    const refs: ExternalRefHint[] = []
    for (let index = 0; index < 4; index += 1) {
      const alias = `guide-${index}`
      await fs.mkdir(join(root, '.external', alias), { recursive: true })
      await fs.writeFile(join(root, '.external', alias, 'AI_USAGE.md'), String(index).repeat(20 * 1024))
      refs.push({
        alias,
        path: `.external/${alias}`,
        instructionPath: `.external/${alias}/AI_USAGE.md`,
        kind: 'local',
        category: 'knowledge'
      })
    }

    const loaded = loadResourceInstructions(root, refs)
    expect(Buffer.byteLength(loaded[0].instructions ?? '')).toBeLessThanOrEqual(12 * 1024)
    expect(loaded.reduce((total, ref) => total + Buffer.byteLength(ref.instructions ?? ''), 0))
      .toBeLessThanOrEqual(32 * 1024)
    expect(loaded.some((ref) => ref.instructionsTruncated)).toBe(true)
  })

  it('忽略越界路径和缺失文件', async () => {
    const root = await projectDir()
    const refs: ExternalRefHint[] = [{
      alias: 'bad', path: '.external/bad', instructionPath: '../secret', kind: 'local', category: 'knowledge'
    }]
    expect(loadResourceInstructions(root, refs)).toEqual(refs)
  })

  it('项目级说明也计入 32 KB 总限额', async () => {
    const root = await projectDir()
    const refs: ExternalRefHint[] = Array.from({ length: 3 }, (_, index) => ({
      alias: `note-${index}`,
      path: `.external/note-${index}`,
      kind: 'local',
      category: 'knowledge',
      usageNote: String(index).repeat(16 * 1024)
    }))
    const loaded = loadResourceInstructions(root, refs)
    const bytes = loaded.reduce((total, ref) =>
      total + Buffer.byteLength(ref.instructions ?? '') + Buffer.byteLength(ref.usageNote ?? ''), 0)
    expect(bytes).toBeLessThanOrEqual(32 * 1024)
    expect(loaded.some((ref) => ref.instructionsTruncated)).toBe(true)
  })
})
