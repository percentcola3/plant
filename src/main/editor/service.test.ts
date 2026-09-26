import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  copyEditorEntry,
  createEditorEntry,
  createEditorEntryWithSkillMirror,
  deleteEditorEntry,
  deleteEditorFile,
  editorEntryExists,
  moveEditorEntry,
  pairedSkillRelPath,
  readEditorFile,
  saveEditorAsset,
  saveProjectBinaryFile,
  writeEditorFile,
  writeEditorFileWithSkillMirror
} from './service'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ui-client-editor-'))
  await fs.mkdir(join(dir, 'docs/spec'), { recursive: true })
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('editor service', () => {
  it('reads a text file inside the docs root', async () => {
    await fs.writeFile(join(dir, 'docs/spec/plan.md'), '# Plan\n', 'utf-8')

    const result = await readEditorFile(dir, 'docs', 'docs/spec/plan.md')

    expect(result.content).toBe('# Plan\n')
    expect(result.relPath).toBe('docs/spec/plan.md')
    expect(result.mtime).toMatch(/T/)
  })

  it('reads a css file from the project scope', async () => {
    await fs.mkdir(join(dir, 'styles/saas'), { recursive: true })
    await fs.writeFile(join(dir, 'styles/saas/theme-light.css'), ':root { --brand: #f60; }\n', 'utf-8')

    const result = await readEditorFile(dir, dir, 'styles/saas/theme-light.css')

    expect(result.content).toContain('--brand')
  })

  it('rejects reading a file outside the docs root', async () => {
    await fs.writeFile(join(dir, 'README.md'), 'nope', 'utf-8')

    await expect(readEditorFile(dir, 'docs', 'README.md')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_SCOPE'
    })
  })

  it('checks whether an editor entry exists without treating a missing file as an error', async () => {
    await fs.writeFile(join(dir, 'docs/spec/plan.md'), '# Plan\n', 'utf-8')

    await expect(editorEntryExists(dir, 'docs', 'docs/spec/plan.md')).resolves.toBe(true)
    await expect(editorEntryExists(dir, 'docs', 'docs/spec/missing.md')).resolves.toBe(false)
  })

  it('rejects existence checks outside the allowed root', async () => {
    await fs.writeFile(join(dir, 'README.md'), 'nope', 'utf-8')

    await expect(editorEntryExists(dir, 'docs', 'README.md')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_SCOPE'
    })
  })

  it('writes a text file when mtime matches', async () => {
    const abs = join(dir, 'docs/spec/plan.md')
    await fs.writeFile(abs, 'v1', 'utf-8')
    const before = await readEditorFile(dir, 'docs', 'docs/spec/plan.md')

    const result = await writeEditorFile(dir, 'docs', 'docs/spec/plan.md', 'v2', before.mtime)

    expect(result.mtime).not.toBe(before.mtime)
    expect(await fs.readFile(abs, 'utf-8')).toBe('v2')
  })

  it('maps project-level Skill paths between Claude Code and Codex', () => {
    expect(pairedSkillRelPath('.claude/skills/ux-design/SKILL.md'))
      .toBe('.agents/skills/ux-design/SKILL.md')
    expect(pairedSkillRelPath('.agents/skills/.disabled/ux-design/scripts/check.ts'))
      .toBe('.claude/skills/.disabled/ux-design/scripts/check.ts')
    expect(pairedSkillRelPath('features/order/SKILL.md')).toBeNull()
  })

  it('writes every Skill file to both tool directories', async () => {
    const relPath = '.claude/skills/ux-design/references/components.md'

    await writeEditorFileWithSkillMirror(dir, dir, relPath, '# Components\n')

    await expect(fs.readFile(join(dir, relPath), 'utf-8')).resolves.toBe('# Components\n')
    await expect(fs.readFile(
      join(dir, '.agents/skills/ux-design/references/components.md'),
      'utf-8'
    )).resolves.toBe('# Components\n')
  })

  it('rejects writing when the file was changed after opening', async () => {
    const abs = join(dir, 'docs/spec/plan.md')
    await fs.writeFile(abs, 'v1', 'utf-8')
    const before = await readEditorFile(dir, 'docs', 'docs/spec/plan.md')
    await fs.writeFile(abs, 'v1 external', 'utf-8')

    await expect(
      writeEditorFile(dir, 'docs', 'docs/spec/plan.md', 'v2', before.mtime)
    ).rejects.toMatchObject({ code: 'MTIME_CONFLICT' })
  })

  it('stores pasted image under docs/.assets and returns a relative markdown path', async () => {
    const result = await saveEditorAsset(dir, 'docs', {
      contextRelPath: 'docs/spec/plan.md',
      mimeType: 'image/png',
      dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X3KcAAAAASUVORK5CYII=',
      originalName: 'shot.png'
    })

    expect(result.assetRelPath).toMatch(/^docs\/\.assets\/.+\.png$/)
    expect(result.markdownPath).toMatch(/^\.\.\/\.assets\/.+\.png$/)
    await expect(fs.stat(join(dir, result.assetRelPath))).resolves.toBeTruthy()
  })

  it('stores uploaded product assets under the requested product assets directory', async () => {
    const result = await saveProjectBinaryFile(dir, dir, {
      targetRelDir: 'ui/order/assets',
      mimeType: 'image/png',
      dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X3KcAAAAASUVORK5CYII=',
      originalName: '../hero card.png'
    })

    expect(result.relPath).toMatch(/^ui\/order\/assets\/hero-card\.png$/)
    await expect(fs.stat(join(dir, result.relPath))).resolves.toBeTruthy()
  })

  it('deduplicates uploaded product asset names', async () => {
    await fs.mkdir(join(dir, 'ui/order/assets'), { recursive: true })
    await fs.writeFile(join(dir, 'ui/order/assets/hero.png'), 'old', 'utf-8')

    const result = await saveProjectBinaryFile(dir, dir, {
      targetRelDir: 'ui/order/assets',
      mimeType: 'image/png',
      dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X3KcAAAAASUVORK5CYII=',
      originalName: 'hero.png'
    })

    expect(result.relPath).toMatch(/^ui\/order\/assets\/hero-[a-f0-9]{4}\.png$/)
    await expect(fs.stat(join(dir, result.relPath))).resolves.toBeTruthy()
  })

  it('deletes a text file inside the allowed root', async () => {
    const abs = join(dir, 'docs/spec/remove.md')
    await fs.writeFile(abs, 'remove me', 'utf-8')

    await deleteEditorFile(dir, 'docs', 'docs/spec/remove.md')

    await expect(fs.stat(abs)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects deleting a file outside the allowed root', async () => {
    await fs.writeFile(join(dir, 'README.md'), 'nope', 'utf-8')

    await expect(deleteEditorFile(dir, 'docs', 'README.md')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_SCOPE'
    })
  })

  it('copies a UI product directory inside the project scope', async () => {
    await fs.mkdir(join(dir, 'ui/login'), { recursive: true })
    await fs.writeFile(join(dir, 'ui/login/index.html'), '<h1>Login</h1>', 'utf-8')
    await fs.writeFile(join(dir, 'ui/login/style.css'), 'body{}', 'utf-8')

    const result = await copyEditorEntry(
      dir,
      dir,
      'ui/login',
      'ui/login-copy'
    )

    expect(result.relPath).toBe('ui/login-copy')
    await expect(
      fs.readFile(join(dir, 'ui/login-copy/index.html'), 'utf-8')
    ).resolves.toBe('<h1>Login</h1>')
  })

  it('deletes a UI product directory inside the project scope', async () => {
    const abs = join(dir, 'ui/login')
    await fs.mkdir(abs, { recursive: true })
    await fs.writeFile(join(abs, 'index.html'), '<h1>Login</h1>', 'utf-8')

    await deleteEditorEntry(dir, dir, 'ui/login')

    await expect(fs.stat(abs)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects copying an entry outside the allowed root', async () => {
    await fs.mkdir(join(dir, 'ui/login'), { recursive: true })

    await expect(
      copyEditorEntry(dir, 'docs', 'ui/login', 'docs/login-copy')
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_SCOPE' })
  })

  it('moves (renames) a UI product within the same layer', async () => {
    await fs.mkdir(join(dir, 'ui/login'), { recursive: true })
    await fs.writeFile(join(dir, 'ui/login/index.html'), '<h1>Login</h1>', 'utf-8')

    const result = await moveEditorEntry(dir, dir, 'ui/login', 'ui/signin')

    expect(result.relPath).toBe('ui/signin')
    await expect(fs.readFile(join(dir, 'ui/signin/index.html'), 'utf-8')).resolves.toBe('<h1>Login</h1>')
    // 源目录已删
    await expect(fs.stat(join(dir, 'ui/login'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('moves a UI product into a group (nested target)', async () => {
    await fs.mkdir(join(dir, 'ui/login'), { recursive: true })
    await fs.writeFile(join(dir, 'ui/login/index.html'), '<h1>Login</h1>', 'utf-8')

    await moveEditorEntry(dir, dir, 'ui/login', 'ui/订单组/login')

    await expect(fs.readFile(join(dir, 'ui/订单组/login/index.html'), 'utf-8')).resolves.toBe('<h1>Login</h1>')
    await expect(fs.stat(join(dir, 'ui/login'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('moves a product without meta.json without error (non-product dir)', async () => {
    await fs.mkdir(join(dir, 'ui/login'), { recursive: true })
    await fs.writeFile(join(dir, 'ui/login/notes.md'), 'hi', 'utf-8')

    await expect(moveEditorEntry(dir, dir, 'ui/login', 'ui/notes')).resolves.toBeTruthy()
    await expect(fs.readFile(join(dir, 'ui/notes/notes.md'), 'utf-8')).resolves.toBe('hi')
  })

  it('rejects moving onto an existing target', async () => {
    await fs.mkdir(join(dir, 'ui/login'), { recursive: true })
    await fs.mkdir(join(dir, 'ui/exists'), { recursive: true })

    await expect(moveEditorEntry(dir, dir, 'ui/login', 'ui/exists')).rejects.toMatchObject({ code: 'FILE_EXISTS' })
    // 源未被删（copy 阶段就失败）
    await expect(fs.stat(join(dir, 'ui/login'))).resolves.toBeTruthy()
  })

  it('rejects moving a directory into itself', async () => {
    await fs.mkdir(join(dir, 'ui/login/sub'), { recursive: true })

    await expect(
      moveEditorEntry(dir, dir, 'ui/login', 'ui/login/sub/inner')
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('creates an empty directory entry', async () => {
    const result = await createEditorEntry(dir, dir, 'ui/新分组')

    expect(result.relPath).toBe('ui/新分组')
    await expect(fs.stat(join(dir, 'ui/新分组'))).resolves.toBeTruthy()
  })

  it('creates Skill subdirectories for both tools', async () => {
    await createEditorEntryWithSkillMirror(dir, dir, '.claude/skills/ux-design/scripts')

    await expect(fs.stat(join(dir, '.claude/skills/ux-design/scripts'))).resolves.toBeTruthy()
    await expect(fs.stat(join(dir, '.agents/skills/ux-design/scripts'))).resolves.toBeTruthy()
  })

  it('rejects creating an entry that already exists', async () => {
    await fs.mkdir(join(dir, 'ui/exists'), { recursive: true })

    await expect(createEditorEntry(dir, dir, 'ui/exists')).rejects.toMatchObject({ code: 'FILE_EXISTS' })
  })

  it('rejects creating an entry outside the allowed root', async () => {
    await expect(createEditorEntry(dir, 'docs', 'ui/escape')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_SCOPE' })
  })
})
