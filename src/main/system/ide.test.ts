import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const clipboardWriteTextMock = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  clipboard: { writeText: clipboardWriteTextMock }
}))

const spawnMock = vi.hoisted(() => vi.fn())
const execSyncMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  execSync: execSyncMock
}))

import { openProjectTool } from './ide'

beforeEach(() => {
  clipboardWriteTextMock.mockReset()
  spawnMock.mockReset()
  execSyncMock.mockReset()
})

describe('openProjectTool', () => {
  it('does not try to open a project with Codex App and returns setup guidance', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'codex-project-tool-'))

    const result = await openProjectTool('codex', projectPath)

    expect(clipboardWriteTextMock).toHaveBeenCalledWith(projectPath)
    expect(spawnMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      kind: 'codex',
      copiedPath: true
    })
    expect(result.message).toContain('Codex App')
    expect(result.message).toContain(projectPath)
  })

  it('relativePath 打开的是子目录（codex 复制子目录绝对路径）', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'subdir-project-tool-'))
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(projectPath, 'features', 'pix'), { recursive: true })

    const result = await openProjectTool('codex', projectPath, 'features/pix')

    expect(result.copiedPath).toBe(true)
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(join(projectPath, 'features', 'pix'))
  })

  it('relativePath 越界 → 抛 PATH_OUTSIDE_PROJECT', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'escape-project-tool-'))
    await expect(openProjectTool('codex', projectPath, '../evil')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_PROJECT'
    })
    expect(clipboardWriteTextMock).not.toHaveBeenCalled()
  })
})
