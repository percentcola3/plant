import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyOutputEdit } from './applyEdit'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ui-client-preview-edit-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('applyOutputEdit', () => {
  it('allows editing project UI product html', async () => {
    const relPath = 'ui/login/index.html'
    const abs = join(dir, relPath)
    await fs.mkdir(join(abs, '..'), { recursive: true })
    await fs.writeFile(abs, '<main><button>OK</button></main>', 'utf-8')

    await applyOutputEdit({
      projectPath: dir,
      relPath,
      selector: 'html > body > main > button',
      kind: 'style:color',
      value: 'red'
    })

    await expect(fs.readFile(abs, 'utf-8')).resolves.toContain('style="color: red"')
  })

  it('allows editing feature root product html', async () => {
    const relPath = 'features/pix/index.html'
    const abs = join(dir, relPath)
    await fs.mkdir(join(abs, '..'), { recursive: true })
    await fs.writeFile(abs, '<main><button>OK</button></main>', 'utf-8')

    await applyOutputEdit({
      projectPath: dir,
      relPath,
      selector: 'html > body > main > button',
      kind: 'style:background-color',
      value: '#22c55e'
    })

    await expect(fs.readFile(abs, 'utf-8')).resolves.toContain('style="background-color: #22c55e"')
  })

  it('allows editing element text content', async () => {
    const relPath = 'features/pix/index.html'
    const abs = join(dir, relPath)
    await fs.mkdir(join(abs, '..'), { recursive: true })
    await fs.writeFile(abs, '<main><p>Old copy</p></main>', 'utf-8')

    await applyOutputEdit({
      projectPath: dir,
      relPath,
      selector: 'html > body > main > p',
      kind: 'text:content',
      value: 'New copy'
    })

    await expect(fs.readFile(abs, 'utf-8')).resolves.toContain('<p>New copy</p>')
  })
})
