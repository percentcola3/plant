import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 复用 git identity 的 sanitize；测试里直接放透传即可
vi.mock('../git/identity', () => ({
  sanitizeBranchSegment: vi.fn((raw: string) =>
    raw.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  )
}))

import {
  createFeature,
  deleteFeature,
  moveFeature,
  renameFeature,
  sanitizeFeatureSlug
} from './lifecycle'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'features-lifecycle-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function exists(rel: string): Promise<boolean> {
  return fs.stat(join(dir, rel)).then(() => true).catch(() => false)
}

describe('createFeature', () => {
  it('scaffolds doc/prd.md + index.html under features/<slug>/', async () => {
    const r = await createFeature({ workspacePath: dir, slug: 'login' })
    expect(r.featureRelPath).toBe('features/login')
    expect(r.prdRelPath).toBe('features/login/doc/prd.md')
    expect(r.indexHtmlRelPath).toBe('features/login/index.html')
    await expect(exists('features/login/doc/prd.md')).resolves.toBe(true)
    await expect(exists('features/login/index.html')).resolves.toBe(true)
  })

  it('index.html 初始化为空白页（无可见文案），保留 REGION 注释供 AI 生成接管', async () => {
    await createFeature({ workspacePath: dir, slug: 'blank' })
    const html = await fs.readFile(join(dir, 'features/blank/index.html'), 'utf-8')
    expect(html).toContain('<!-- REGION: content -->')
    // 不再把 slug/提示文案写进页面
    expect(html).not.toContain('blank')
    expect(html).not.toContain('page-empty')
    expect(html).not.toContain('<h1')
    expect(html).not.toContain('<style')
  })

  it('places feature under group when specified', async () => {
    const r = await createFeature({ workspacePath: dir, slug: 'login', group: 'auth' })
    expect(r.featureRelPath).toBe('features/auth/login')
    await expect(exists('features/auth/login/doc/prd.md')).resolves.toBe(true)
  })

  it('rejects existing slug', async () => {
    await createFeature({ workspacePath: dir, slug: 'login' })
    await expect(createFeature({ workspacePath: dir, slug: 'login' })).rejects.toMatchObject({
      code: 'EXISTS'
    })
  })

  it('respects withPrd / withIndexHtml=false', async () => {
    const r = await createFeature({
      workspacePath: dir,
      slug: 'bare',
      withPrd: false,
      withIndexHtml: false
    })
    expect(r.prdRelPath).toBeNull()
    expect(r.indexHtmlRelPath).toBeNull()
    await expect(exists('features/bare/doc/prd.md')).resolves.toBe(false)
    await expect(exists('features/bare')).resolves.toBe(true)
  })
})

describe('renameFeature', () => {
  it('moves to new slug, preserves group', async () => {
    await createFeature({ workspacePath: dir, slug: 'login', group: 'auth' })
    const r = await renameFeature({
      workspacePath: dir,
      relPath: 'features/auth/login',
      newSlug: 'signin'
    })
    expect(r.relPath).toBe('features/auth/signin')
    await expect(exists('features/auth/signin/doc/prd.md')).resolves.toBe(true)
    await expect(exists('features/auth/login')).resolves.toBe(false)
  })

  it('throws when target exists', async () => {
    await createFeature({ workspacePath: dir, slug: 'a' })
    await createFeature({ workspacePath: dir, slug: 'b' })
    await expect(
      renameFeature({ workspacePath: dir, relPath: 'features/a', newSlug: 'b' })
    ).rejects.toMatchObject({ code: 'EXISTS' })
  })
})

describe('moveFeature', () => {
  it('moves between groups + cleans empty source group', async () => {
    await createFeature({ workspacePath: dir, slug: 'login', group: 'auth' })
    const r = await moveFeature({
      workspacePath: dir,
      relPath: 'features/auth/login',
      toGroup: 'identity'
    })
    expect(r.relPath).toBe('features/identity/login')
    await expect(exists('features/identity/login')).resolves.toBe(true)
    await expect(exists('features/auth')).resolves.toBe(false)
  })

  it('moves to root when toGroup=null', async () => {
    await createFeature({ workspacePath: dir, slug: 'login', group: 'auth' })
    const r = await moveFeature({
      workspacePath: dir,
      relPath: 'features/auth/login',
      toGroup: null
    })
    expect(r.relPath).toBe('features/login')
    await expect(exists('features/auth')).resolves.toBe(false)
  })
})

describe('deleteFeature', () => {
  it('removes feature + empty group cleanup', async () => {
    await createFeature({ workspacePath: dir, slug: 'login', group: 'auth' })
    await deleteFeature({ workspacePath: dir, relPath: 'features/auth/login' })
    await expect(exists('features/auth')).resolves.toBe(false)
  })

  it('keeps non-empty group', async () => {
    await createFeature({ workspacePath: dir, slug: 'login', group: 'auth' })
    await createFeature({ workspacePath: dir, slug: 'signup', group: 'auth' })
    await deleteFeature({ workspacePath: dir, relPath: 'features/auth/login' })
    await expect(exists('features/auth/signup')).resolves.toBe(true)
  })
})

describe('sanitizeFeatureSlug', () => {
  it('rejects empty', () => {
    expect(() => sanitizeFeatureSlug('   ')).toThrow()
  })

  it('rejects > 80 chars', () => {
    expect(() => sanitizeFeatureSlug('a'.repeat(81))).toThrow()
  })
})
