import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, readlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureFeatureAiLinks } from './ai-links'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ai-links-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function seedRoot(): Promise<void> {
  await fs.mkdir(join(root, '.claude/skills/foo'), { recursive: true })
  await fs.writeFile(join(root, '.claude/skills/foo/SKILL.md'), '# foo')
  await fs.mkdir(join(root, '.agents/skills/bar'), { recursive: true })
  await fs.writeFile(join(root, '.agents/skills/bar/SKILL.md'), '# bar')
  await fs.mkdir(join(root, '.cursor/rules'), { recursive: true })
  await fs.writeFile(join(root, '.cursor/rules/project.mdc'), '# cursor rules')
  await fs.mkdir(join(root, '.external/ui'), { recursive: true })
  await fs.writeFile(join(root, '.external/ui/README.md'), '# ui assets')
  await fs.writeFile(join(root, 'CLAUDE.md'), '# claude rules')
  await fs.writeFile(join(root, 'AGENTS.md'), '# agents rules')
}

describe('ensureFeatureAiLinks', () => {
  it('为 features/<slug>/ 创建 AI 配置和 .external 相对符号链接指回根目录', async () => {
    await seedRoot()
    await fs.mkdir(join(root, 'features/login'), { recursive: true })

    const r = await ensureFeatureAiLinks(root, 'features/login')

    expect(r.results['.claude']).toBe('linked')
    expect(r.results['.agents']).toBe('linked')
    expect(r.results['.cursor/rules']).toBe('linked')
    expect(r.results['.external']).toBe('linked')
    expect(r.results['CLAUDE.md']).toBe('linked')
    expect(r.results['AGENTS.md']).toBe('linked')

    expect(await readlink(join(root, 'features/login/.claude'))).toBe('../../.claude')
    expect(await readlink(join(root, 'features/login/.cursor/rules'))).toBe('../../../.cursor/rules')
    expect(await readlink(join(root, 'features/login/.external'))).toBe('../../.external')
    expect(await readlink(join(root, 'features/login/CLAUDE.md'))).toBe('../../CLAUDE.md')

    // 跟着链接可读到根目录内容
    const txt = await fs.readFile(join(root, 'features/login/.claude/skills/foo/SKILL.md'), 'utf-8')
    expect(txt).toBe('# foo')
    const assetTxt = await fs.readFile(join(root, 'features/login/.external/ui/README.md'), 'utf-8')
    expect(assetTxt).toBe('# ui assets')
    const cursorRule = await fs.readFile(join(root, 'features/login/.cursor/rules/project.mdc'), 'utf-8')
    expect(cursorRule).toBe('# cursor rules')
  })

  it('支持 group 嵌套 features/<group>/<slug>/', async () => {
    await seedRoot()
    await fs.mkdir(join(root, 'features/auth/signin'), { recursive: true })

    await ensureFeatureAiLinks(root, 'features/auth/signin')

    expect(await readlink(join(root, 'features/auth/signin/.claude'))).toBe('../../../.claude')
    expect(await readlink(join(root, 'features/auth/signin/.cursor/rules'))).toBe('../../../../.cursor/rules')
    expect(await readlink(join(root, 'features/auth/signin/.external'))).toBe('../../../.external')
    expect(await readlink(join(root, 'features/auth/signin/AGENTS.md'))).toBe('../../../AGENTS.md')
  })

  it('idempotent：再调一次保持原状', async () => {
    await seedRoot()
    await fs.mkdir(join(root, 'features/login'), { recursive: true })

    await ensureFeatureAiLinks(root, 'features/login')
    const r2 = await ensureFeatureAiLinks(root, 'features/login')

    expect(r2.results['.claude']).toBe('already-linked')
    expect(r2.results['.cursor/rules']).toBe('already-linked')
    expect(r2.results['.external']).toBe('already-linked')
    expect(r2.results['CLAUDE.md']).toBe('already-linked')
  })

  it('缺 .claude/.agents/.external 报 source-missing；AGENTS.md 缺失则回退到 system.md', async () => {
    // 根目录只放 CLAUDE.md，缺 .claude / .agents / .external / AGENTS.md
    await fs.writeFile(join(root, 'CLAUDE.md'), '# x')
    await fs.mkdir(join(root, 'features/x'), { recursive: true })

    const r = await ensureFeatureAiLinks(root, 'features/x')

    // ensureFeatureAiLinks 先建根 system.md，故 CLAUDE.md→根CLAUDE.md、AGENTS.md→根system.md
    expect(r.results['CLAUDE.md']).toBe('linked')
    expect(await readlink(join(root, 'features/x/CLAUDE.md'))).toBe('../../CLAUDE.md')
    expect(r.results['AGENTS.md']).toBe('linked')
    expect(await readlink(join(root, 'features/x/AGENTS.md'))).toBe('../../system.md')

    expect(r.results['.claude']).toBe('source-missing')
    expect(r.results['.agents']).toBe('source-missing')
    expect(r.results['.cursor/rules']).toBe('source-missing')
    expect(r.results['.external']).toBe('source-missing')

    // 源不存在的位置不应该有空 link
    await expect(fs.lstat(join(root, 'features/x/.claude'))).rejects.toThrow()
  })

  it('遇到真实文件 / 目录不覆盖，返回 skipped-real', async () => {
    await seedRoot()
    await fs.mkdir(join(root, 'features/old/.claude/skills/legacy'), { recursive: true })
    await fs.writeFile(join(root, 'features/old/.claude/skills/legacy/SKILL.md'), '# legacy copy')
    await fs.writeFile(join(root, 'features/old/CLAUDE.md'), '# legacy rules')

    const r = await ensureFeatureAiLinks(root, 'features/old')

    expect(r.results['.claude']).toBe('skipped-real')
    expect(r.results['CLAUDE.md']).toBe('skipped-real')
    // legacy 实文件还在
    await expect(fs.readFile(join(root, 'features/old/CLAUDE.md'), 'utf-8')).resolves.toBe('# legacy rules')
    // 没存在的依然 link 上
    expect(r.results['.agents']).toBe('linked')
    expect(r.results['.cursor/rules']).toBe('linked')
    expect(r.results['.external']).toBe('linked')
    expect(r.results['AGENTS.md']).toBe('linked')
  })

  it('坏 target 的旧 symlink 被替换为正确 target', async () => {
    await seedRoot()
    await fs.mkdir(join(root, 'features/login'), { recursive: true })
    // 模拟一个旧 link 指向错的位置
    await fs.symlink('../wrong/.claude', join(root, 'features/login/.claude'))

    const r = await ensureFeatureAiLinks(root, 'features/login')

    expect(r.results['.claude']).toBe('linked')
    expect(await readlink(join(root, 'features/login/.claude'))).toBe('../../.claude')
  })
})
