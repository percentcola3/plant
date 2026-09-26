import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureSystemDoc } from './system-doc'

describe('ensureSystemDoc（根：建 system.md + 给已有文件注入 @引用，不建符号链接）', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'system-doc-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  const read = (rel: string) => fs.readFile(join(dir, rel), 'utf-8')
  const exists = (rel: string) => fs.stat(join(dir, rel)).then(() => true).catch(() => false)
  const isSymlink = (rel: string) => lstatSync(join(dir, rel), { throwIfNoEntry: false })?.isSymbolicLink() ?? false

  it('空项目 → 只建 system.md（模板），不创建 CLAUDE.md/AGENTS.md', async () => {
    const r = await ensureSystemDoc(dir)
    expect(r.systemDoc).toBe('created')
    expect(await read('system.md')).toContain('项目 AI 约束')
    expect(await exists('CLAUDE.md')).toBe(false)
    expect(await exists('AGENTS.md')).toBe(false)
    expect(r.injected['CLAUDE.md']).toBe('absent')
    expect(r.injected['AGENTS.md']).toBe('absent')
  })

  it('已有真实 CLAUDE.md → 末尾注入 @system.md 受管块，原内容保留', async () => {
    await fs.writeFile(join(dir, 'CLAUDE.md'), '# 我的开发指南\nyarn dev\n', 'utf-8')
    const r = await ensureSystemDoc(dir)
    expect(r.injected['CLAUDE.md']).toBe('injected')
    const txt = await read('CLAUDE.md')
    expect(txt).toContain('# 我的开发指南')   // 原内容零改动
    expect(txt).toContain('yarn dev')
    expect(txt).toContain('<!-- BEGIN ui-client:system-link (app-managed) -->')
    expect(txt).toContain('@system.md')
    // 仍是真实文件，不是符号链接
    expect(isSymlink('CLAUDE.md')).toBe(false)
    // @引用在末尾、原内容之前
    expect(txt.indexOf('yarn dev')).toBeLessThan(txt.indexOf('@system.md'))
  })

  it('幂等：二次注入不重复 @引用', async () => {
    await fs.writeFile(join(dir, 'AGENTS.md'), '# 头\n', 'utf-8')
    await ensureSystemDoc(dir)
    const first = await read('AGENTS.md')
    const r2 = await ensureSystemDoc(dir)
    expect(r2.injected['AGENTS.md']).toBe('already')
    expect(await read('AGENTS.md')).toBe(first)
    expect(first.match(/@system\.md/g)?.length).toBe(1)
  })

  it('CLAUDE.md 整份是旧 App 受管块（无用户内容）→ 删除，回归默认', async () => {
    const legacy = [
      '<!-- UI-CLIENT:WORKSPACE-RULES:START -->',
      '旧的 workspace 规则',
      '<!-- UI-CLIENT:WORKSPACE-RULES:END -->',
      '',
      '<!-- BEGIN ui-client:ui-asset-rules (app-managed) -->',
      '旧的 UI 资产规则',
      '<!-- END ui-client:ui-asset-rules -->',
      ''
    ].join('\n')
    await fs.writeFile(join(dir, 'CLAUDE.md'), legacy, 'utf-8')
    const r = await ensureSystemDoc(dir)
    expect(r.injected['CLAUDE.md']).toBe('removed-legacy')
    expect(await exists('CLAUDE.md')).toBe(false)
  })

  it('用户内容 + 旧 App 块混合 → 剥掉旧块、保留用户内容、注入 @system.md', async () => {
    const mixed = [
      '# 我的真实开发指南',
      'yarn dev',
      '',
      '<!-- BEGIN ui-client:ui-asset-rules (app-managed) -->',
      '旧的 UI 资产规则（该被剥掉）',
      '<!-- END ui-client:ui-asset-rules -->',
      ''
    ].join('\n')
    await fs.writeFile(join(dir, 'CLAUDE.md'), mixed, 'utf-8')
    await ensureSystemDoc(dir)
    const txt = await read('CLAUDE.md')
    expect(txt).toContain('# 我的真实开发指南')
    expect(txt).toContain('yarn dev')
    expect(txt).not.toContain('旧的 UI 资产规则')   // 旧块被剥掉
    expect(txt).toContain('@system.md')
  })

  it('根 CLAUDE.md/AGENTS.md 是旧版符号链接 → 删除（默认根不留）', async () => {
    await fs.writeFile(join(dir, 'system.md'), '# sys\n', 'utf-8')
    await fs.symlink('system.md', join(dir, 'CLAUDE.md'))
    await fs.symlink('system.md', join(dir, 'AGENTS.md'))
    const r = await ensureSystemDoc(dir)
    expect(r.injected['CLAUDE.md']).toBe('removed-link')
    expect(r.injected['AGENTS.md']).toBe('removed-link')
    expect(await exists('CLAUDE.md')).toBe(false)
    expect(await exists('AGENTS.md')).toBe(false)
  })

  it('system.md 被历史遗留 App 块污染 → 剥掉，保留用户真内容', async () => {
    const polluted = [
      '# 我的项目指南',
      '纯静态资产仓库。',
      '',
      '<!-- BEGIN ui-client:ui-asset-rules (app-managed) -->',
      '旧的资产规则（迁移残留）',
      '<!-- END ui-client:ui-asset-rules -->',
      ''
    ].join('\n')
    await fs.writeFile(join(dir, 'system.md'), polluted, 'utf-8')
    const r = await ensureSystemDoc(dir)
    expect(r.systemDoc).toBe('cleaned')
    const sys = await read('system.md')
    expect(sys).toContain('# 我的项目指南')
    expect(sys).toContain('纯静态资产仓库。')
    expect(sys).not.toContain('旧的资产规则')
  })

  it('system.md 整份是历史遗留 App 块 → 重置为模板', async () => {
    await fs.writeFile(join(dir, 'system.md'), '<!-- BEGIN ui-client:ui-asset-rules (app-managed) -->\nx\n<!-- END ui-client:ui-asset-rules -->\n', 'utf-8')
    const r = await ensureSystemDoc(dir)
    expect(r.systemDoc).toBe('cleaned')
    expect(await read('system.md')).toContain('项目 AI 约束')
  })

  it('已有 system.md → 不覆盖', async () => {
    await fs.writeFile(join(dir, 'system.md'), '# 用户自己的 system\n', 'utf-8')
    const r = await ensureSystemDoc(dir)
    expect(r.systemDoc).toBe('exists')
    expect(await read('system.md')).toBe('# 用户自己的 system\n')
  })
})
