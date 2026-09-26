import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { lstatSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpUserData = await mkdtemp(join(tmpdir(), 'workspace-templates-userdata-'))
vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData }
}))

import type { ExternalRef } from '@shared/types'
import { externalPoolStore, _testOnlyResetSharedCache as resetExternalPool } from '../external-pool/store'
import { indexFile } from '../external-pool/paths'
import { activeReqPath, refsPath } from './paths'
import { writeRefs } from './refs'
import { skillTemplateRootCandidates, syncWorkspaceTemplates } from './templates'
import { writeActiveWorkArea } from './work-area'
import { writeFeatureResourceSelection } from '../features/resources'

let dir: string

async function exists(path: string): Promise<boolean> {
  return fs.stat(path).then(() => true).catch(() => false)
}

function externalRef(input: Partial<ExternalRef> & Pick<ExternalRef, 'id' | 'alias' | 'category'>): ExternalRef {
  return {
    kind: 'local',
    source: `/tmp/${input.alias}`,
    poolPath: `/tmp/${input.alias}`,
    addedAt: '2026-06-10T00:00:00.000Z',
    ...input
  }
}

beforeEach(async () => {
  resetExternalPool()
  await fs.rm(indexFile(), { force: true })
  dir = await mkdtemp(join(tmpdir(), 'workspace-templates-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('syncWorkspaceTemplates', () => {
  it('打包态优先从 process.resourcesPath 查找 skill templates', () => {
    expect(skillTemplateRootCandidates(
      '/Applications/WorkSpace.app/Contents/Resources/app.asar/out/main/workspaces',
      '/tmp',
      '/Applications/WorkSpace.app/Contents/Resources'
    )[0]).toBe('/Applications/WorkSpace.app/Contents/Resources/skill-templates')
  })

  it('生成 Claude Code 可识别的 rules、skills 和结构化项目上下文', async () => {
    await fs.mkdir(join(dir, '.ui-client'), { recursive: true })
    await fs.writeFile(activeReqPath(dir), 'abc123-login\n')
    await externalPoolStore.add(externalRef({
      id: 'kb-1',
      alias: 'product-kb',
      category: 'knowledge',
      kind: 'git',
      source: 'https://example.com/kb.git',
      poolPath: '/pool/kb'
    }))
    await externalPoolStore.add(externalRef({
      id: 'ui-1',
      alias: 'saas-ui',
      category: 'uikit',
      kind: 'local',
      source: '/Users/me/uikit',
      poolPath: '/Users/me/uikit'
    }))
    await writeRefs(dir, [
      {
        alias: 'product-kb',
        externalRefId: 'kb-1',
        addedAt: '2026-06-10T01:00:00.000Z',
        visibleDirs: ['docs', 'research/payment']
      },
      { alias: 'saas-ui', externalRefId: 'ui-1', addedAt: '2026-06-10T01:01:00.000Z' }
    ])

    await syncWorkspaceTemplates(dir, 'project')

    // 新模型：sync 只建根 system.md（事实源）；默认不创建 CLAUDE.md/AGENTS.md；
    // Cursor 经 system.md 镜像出 .mdc。
    expect(await exists(join(dir, 'system.md'))).toBe(true)
    expect(await exists(join(dir, 'CLAUDE.md'))).toBe(false)
    expect(await exists(join(dir, 'AGENTS.md'))).toBe(false)
    expect(await exists(join(dir, '.cursor/rules/ui-client-ui-assets.mdc'))).toBe(true)

    const context = JSON.parse(await fs.readFile(join(dir, '.workspace/project-context.json'), 'utf-8')) as {
      kind: string
      activeRequirementId: string
      activeWorkspace: string
      kbRefs: Array<{
        alias: string
        path: string
        paths: string[]
        visibleDirs?: string[]
        readonly: boolean
      }>
      uiAssets: Array<{ alias: string; path: string; readonly: boolean }>
      editableRoots: string[]
    }

    expect(context.activeRequirementId).toBe('abc123-login')
    expect(context.kind).toBe('project')
    // PM 项目 2026-06-24 重构后：所有产物落在 features/<slug>/。
    // 老的 docs/ + ui/ 已废，editableRoots 默认仅 features/。
    expect(context.activeWorkspace).toBe('docs/ + ui/') // 默认文案沿用，活跃需求兜底
    expect(context.editableRoots).toEqual(['features/'])
    expect(context.editableRoots).not.toContain('.knowledge/')
    expect(context.kbRefs).toEqual([
      expect.objectContaining({
        alias: 'product-kb',
        path: '.external/product-kb',
        paths: ['.external/product-kb/docs', '.external/product-kb/research/payment'],
        visibleDirs: ['docs', 'research/payment'],
        readonly: true
      })
    ])
    // INDEX.md/files.jsonl 同步产物已移除（检索统一走 zg 混合索引）
    expect(context.kbRefs[0]).not.toHaveProperty('indexPath')
    expect(context.kbRefs[0]).not.toHaveProperty('indexCatalogPath')
    await expect(fs.readlink(join(dir, '.workspace/resource-indexes/product-kb/INDEX.md'))).rejects.toThrow()
    expect(context.uiAssets).toEqual([
      expect.objectContaining({ alias: 'saas-ui', path: '.external/saas-ui', readonly: true })
    ])

    // skill 模板已不再 auto-scaffold；用户从模板库 / 添加按钮主动装入。
    expect(await exists(join(dir, '.claude/skills/pm-prd/SKILL.md'))).toBe(false)
    expect(await exists(join(dir, '.claude/skills/pm-brainstorm/SKILL.md'))).toBe(false)
    expect(await exists(join(dir, '.claude/skills/_shared/component-spec.md'))).toBe(false)
    expect(await exists(join(dir, '.claude/skills/README.md'))).toBe(false)
    expect(await exists(refsPath(dir))).toBe(true)
  })

  it('当前工作区为 UI 产物时，仅把该产物目录作为可写范围', async () => {
    await fs.mkdir(join(dir, '.ui-client'), { recursive: true })
    await fs.writeFile(activeReqPath(dir), 'abc123-login\n')
    await writeActiveWorkArea(dir, {
      kind: 'ui-product',
      relPath: 'ui/点餐'
    })

    await syncWorkspaceTemplates(dir, 'project')

    const context = JSON.parse(await fs.readFile(join(dir, '.workspace/project-context.json'), 'utf-8')) as {
      activeWorkspace: string
      activeWorkArea: { kind: string; relPath: string } | null
      editableRoots: string[]
    }

    expect(context.activeWorkspace).toBe('ui/点餐')
    expect(context.activeWorkArea).toEqual({
      kind: 'ui-product',
      relPath: 'ui/点餐'
    })
    expect(context.editableRoots).toEqual(['ui/点餐/'])
  })

  it('PM 项目工作区为 feature 时锁可写到 features/<slug>/', async () => {
    await fs.mkdir(join(dir, '.ui-client'), { recursive: true })
    await writeActiveWorkArea(dir, { kind: 'feature', relPath: 'features/login-page' })

    await syncWorkspaceTemplates(dir, 'project')

    const context = JSON.parse(await fs.readFile(join(dir, '.workspace/project-context.json'), 'utf-8')) as {
      activeWorkspace: string
      activeWorkArea: { kind: string; relPath: string } | null
      editableRoots: string[]
    }
    expect(context.activeWorkArea).toEqual({ kind: 'feature', relPath: 'features/login-page' })
    expect(context.editableRoots).toEqual(['features/login-page/'])
    expect(context.activeWorkspace).toBe('features/login-page')
  })

  it('feature 只向 AI 上下文暴露当前项目关联的资源', async () => {
    await fs.mkdir(join(dir, 'features/login-page'), { recursive: true })
    await externalPoolStore.add(externalRef({ id: 'feature-kb-selected', alias: 'feature-product-kb', category: 'knowledge' }))
    await externalPoolStore.add(externalRef({ id: 'feature-ui-selected', alias: 'feature-design-assets', category: 'uikit' }))
    await externalPoolStore.add(externalRef({ id: 'feature-kb-hidden', alias: 'feature-internal-notes', category: 'knowledge' }))
    await writeRefs(dir, [
      { alias: 'feature-product-kb', externalRefId: 'feature-kb-selected', addedAt: '2026-06-10T01:00:00.000Z' },
      { alias: 'feature-design-assets', externalRefId: 'feature-ui-selected', addedAt: '2026-06-10T01:01:00.000Z' },
      { alias: 'feature-internal-notes', externalRefId: 'feature-kb-hidden', addedAt: '2026-06-10T01:02:00.000Z' }
    ])
    await writeFeatureResourceSelection(dir, 'features/login-page', ['feature-kb-selected', 'feature-ui-selected'])
    await writeActiveWorkArea(dir, { kind: 'feature', relPath: 'features/login-page' })

    await syncWorkspaceTemplates(dir, 'project')

    const context = JSON.parse(await fs.readFile(join(dir, '.workspace/project-context.json'), 'utf-8')) as {
      externalRefs: Array<{ alias: string }>
      kbRefs: Array<{ alias: string }>
      uiAssets: Array<{ alias: string }>
    }
    expect(context.externalRefs.map((ref) => ref.alias)).toEqual(['feature-product-kb', 'feature-design-assets'])
    expect(context.kbRefs.map((ref) => ref.alias)).toEqual(['feature-product-kb'])
    expect(context.uiAssets.map((ref) => ref.alias)).toEqual(['feature-design-assets'])
  })

  it('feature 未关联资源时继承工作区已挂载的知识库', async () => {
    await fs.mkdir(join(dir, 'features/pos-64'), { recursive: true })
    await externalPoolStore.add(externalRef({ id: 'pos-frontend', alias: 'POS前端', category: 'knowledge' }))
    await writeRefs(dir, [
      { alias: 'POS前端', externalRefId: 'pos-frontend', addedAt: '2026-09-08T09:04:01.848Z' }
    ])
    await writeFeatureResourceSelection(dir, 'features/pos-64', [])
    await writeActiveWorkArea(dir, { kind: 'feature', relPath: 'features/pos-64' })

    await syncWorkspaceTemplates(dir, 'project')

    const context = JSON.parse(await fs.readFile(join(dir, '.workspace/project-context.json'), 'utf-8')) as {
      kbRefs: Array<{ alias: string; path: string }>
      externalRefs: Array<{ alias: string }>
    }
    expect(context.kbRefs).toEqual([
      expect.objectContaining({ alias: 'POS前端', path: '.external/POS前端' })
    ])
    expect(context.externalRefs.map((ref) => ref.alias)).toEqual(['POS前端'])
  })

  it('PM 项目无 workArea 时 editableRoots 包含 features/', async () => {
    await syncWorkspaceTemplates(dir, 'project')
    const context = JSON.parse(await fs.readFile(join(dir, '.workspace/project-context.json'), 'utf-8')) as {
      editableRoots: string[]
    }
    expect(context.editableRoots).toContain('features/')
  })

  it('feature workArea 越界（非 features/ 前缀）兜底丢弃', async () => {
    await writeActiveWorkArea(dir, { kind: 'feature', relPath: 'ui/escape' })
    await syncWorkspaceTemplates(dir, 'project')
    const context = JSON.parse(await fs.readFile(join(dir, '.workspace/project-context.json'), 'utf-8')) as {
      activeWorkArea: { kind: string; relPath: string } | null
      editableRoots: string[]
    }
    expect(context.activeWorkArea).toBeNull()
    // 退回默认 editableRoots（含 features/）
    expect(context.editableRoots).toContain('features/')
  })

  it('工作区上下文变化时只更新 project-context（AGENTS/CLAUDE/cursor 受管块已废弃）', async () => {
    await fs.mkdir(join(dir, '.ui-client'), { recursive: true })
    await fs.writeFile(activeReqPath(dir), 'abc123-login\n')
    await syncWorkspaceTemplates(dir, 'project')

    await writeActiveWorkArea(dir, {
      kind: 'ui-product',
      relPath: 'ui/点餐'
    })
    await syncWorkspaceTemplates(dir, 'project')

    const context = JSON.parse(await fs.readFile(join(dir, '.workspace/project-context.json'), 'utf-8')) as {
      activeWorkspace: string
      editableRoots: string[]
    }
    expect(context.activeWorkspace).toBe('ui/点餐')
    expect(context.editableRoots).toEqual(['ui/点餐/'])

    // 新模型：默认不创建根 CLAUDE.md/AGENTS.md，只有 system.md
    expect(await exists(join(dir, 'AGENTS.md'))).toBe(false)
    expect(await exists(join(dir, 'CLAUDE.md'))).toBe(false)
    expect(await exists(join(dir, 'system.md'))).toBe(true)
    expect(await exists(join(dir, '.cursor/rules/ui-client-workspace.mdc'))).toBe(false)
  })

  it('已有真实 AGENTS.md / CLAUDE.md → 不丢弃、不替换，末尾注入 @system.md', async () => {
    await fs.writeFile(join(dir, 'AGENTS.md'), 'My own AGENTS rules\n', 'utf-8')
    await fs.writeFile(join(dir, 'CLAUDE.md'), 'My own CLAUDE rules\n', 'utf-8')
    // 用户自有的旧 cursor 规则文件不归 App 托管，保持不动
    await fs.mkdir(join(dir, '.cursor', 'rules'), { recursive: true })
    await fs.writeFile(join(dir, '.cursor/rules/ui-client-workspace.mdc'), 'My own cursor rules\n', 'utf-8')

    await syncWorkspaceTemplates(dir, 'project')

    // 仍是真实文件、原内容保留、末尾注入 @system.md（不变符号链接、不被迁移）
    expect(lstatSync(join(dir, 'AGENTS.md')).isSymbolicLink()).toBe(false)
    expect(lstatSync(join(dir, 'CLAUDE.md')).isSymbolicLink()).toBe(false)
    const agents = await fs.readFile(join(dir, 'AGENTS.md'), 'utf-8')
    const claude = await fs.readFile(join(dir, 'CLAUDE.md'), 'utf-8')
    expect(agents).toContain('My own AGENTS rules')
    expect(agents).toContain('@system.md')
    expect(claude).toContain('My own CLAUDE rules')
    expect(claude).toContain('@system.md')
    // 旧的 ui-client-workspace.mdc 不被 App 触碰
    expect(await fs.readFile(join(dir, '.cursor/rules/ui-client-workspace.mdc'), 'utf-8'))
      .toBe('My own cursor rules\n')
    // Cursor 适配：从 system.md 镜像出 App 自管的 .mdc
    const mirror = await fs.readFile(join(dir, '.cursor/rules/ui-client-ui-assets.mdc'), 'utf-8')
    expect(mirror).toContain('alwaysApply: true')
    expect(mirror).toContain('UI 资产库约定')
  })

  it('同步模板时补齐 App 管理文件的 gitignore', async () => {
    await fs.mkdir(join(dir, '.git'))
    await syncWorkspaceTemplates(dir, 'project')

    const gitignore = await fs.readFile(join(dir, '.gitignore'), 'utf-8')
    // cwd 锁定改造后 AGENTS.md / CLAUDE.md / .cursor/rules 归用户所有，不强制 gitignore
    expect(gitignore).not.toContain('AGENTS.md')
    expect(gitignore).not.toContain('CLAUDE.md')
    expect(gitignore).not.toContain('.cursor/rules/ui-client-workspace.mdc')
    expect(gitignore).toContain('.ui-client/')
    expect(gitignore).toContain('.external/')
    expect(gitignore).toContain('.workspace/project-context.json')
    expect(gitignore).toContain('.workspace/session-id')
    expect(gitignore).toContain('.workspace/home-session-id')
    expect(gitignore).toContain('.workspace/document-sessions/')
    expect(gitignore).toContain('.claude/skills/')
    expect(gitignore).toContain('.agents/skills/')
  })

  it('非 Git 项目同步模板时不创建 .gitignore', async () => {
    await syncWorkspaceTemplates(dir, 'project')
    expect(await exists(join(dir, '.gitignore'))).toBe(false)
  })

  it('syncWorkspaceTemplates 不再 auto-scaffold 任何 skill 模板（v1 用户主导）', async () => {
    await syncWorkspaceTemplates(dir, 'project')

    // .claude/skills 整个目录都不该被创建
    const claudeSkillsExists = await fs.stat(join(dir, '.claude/skills')).then(() => true).catch(() => false)
    expect(claudeSkillsExists).toBe(false)
    const agentsSkillsExists = await fs.stat(join(dir, '.agents/skills')).then(() => true).catch(() => false)
    expect(agentsSkillsExists).toBe(false)
  })

  it('syncWorkspaceTemplates 不写入 .claude/skills/README.md（README 由首次装入模板时兜底生成）', async () => {
    await syncWorkspaceTemplates(dir, 'project')
    expect(await exists(join(dir, '.claude/skills/README.md'))).toBe(false)

    await syncWorkspaceTemplates(dir, 'ux')
    expect(await exists(join(dir, '.claude/skills/README.md'))).toBe(false)
  })

  it('用户在 .claude/skills 下已有的内容不会被 syncWorkspaceTemplates 改动', async () => {
    await fs.mkdir(join(dir, '.claude/skills/my-custom'), { recursive: true })
    await fs.writeFile(join(dir, '.claude/skills/my-custom/SKILL.md'), 'user content', 'utf-8')

    await syncWorkspaceTemplates(dir, 'project')

    const content = await fs.readFile(join(dir, '.claude/skills/my-custom/SKILL.md'), 'utf-8')
    expect(content).toBe('user content')
  })

  it('UX 工作区默认允许修改设计资产和 outputs', async () => {
    await syncWorkspaceTemplates(dir, 'ux')

    const context = JSON.parse(await fs.readFile(join(dir, '.workspace/project-context.json'), 'utf-8')) as {
      activeWorkspace: string
      editableRoots: string[]
      kind: string
      uiAssets: Array<{ alias: string; path: string; paths: string[]; readonly: boolean }>
    }

    expect(context.activeWorkspace).toBe('components/ + design-systems/ + assets/ + outputs/')
    expect(context.editableRoots).toEqual(['components/', 'design-systems/', 'assets/', 'outputs/'])
    expect(context.kind).toBe('ux')
    expect(context.uiAssets).toEqual([
      expect.objectContaining({
        alias: 'workspace-components',
        path: 'components',
        paths: ['components'],
        readonly: false
      }),
      expect.objectContaining({
        alias: 'workspace-assets',
        path: 'assets',
        paths: ['assets'],
        readonly: false
      }),
      expect.objectContaining({
        alias: 'workspace-design-systems',
        path: 'design-systems',
        paths: ['design-systems'],
        readonly: false
      })
    ])
    // 新模型：UX 也建根 system.md；默认不创建 CLAUDE.md/AGENTS.md；Cursor 从 system.md 镜像
    expect(await exists(join(dir, 'system.md'))).toBe(true)
    expect(await exists(join(dir, 'AGENTS.md'))).toBe(false)
    expect(await exists(join(dir, 'CLAUDE.md'))).toBe(false)
    expect(await exists(join(dir, '.cursor/rules/ui-client-ui-assets.mdc'))).toBe(true)
  })

  it('UX 工作区当前产物只允许修改对应 outputs 目录', async () => {
    await fs.mkdir(join(dir, '.ui-client'), { recursive: true })
    await writeActiveWorkArea(dir, {
      kind: 'ui-product',
      relPath: 'outputs/login'
    })

    await syncWorkspaceTemplates(dir, 'ux')

    const context = JSON.parse(await fs.readFile(join(dir, '.workspace/project-context.json'), 'utf-8')) as {
      activeWorkspace: string
      activeWorkArea: { kind: string; relPath: string } | null
      editableRoots: string[]
    }

    expect(context.activeWorkspace).toBe('outputs/login')
    expect(context.activeWorkArea).toEqual({ kind: 'ui-product', relPath: 'outputs/login' })
    expect(context.editableRoots).toEqual(['outputs/login/'])
  })

  it('UX 工作区当前组件只允许修改对应 components 目录', async () => {
    await fs.mkdir(join(dir, '.ui-client'), { recursive: true })
    await writeActiveWorkArea(dir, {
      kind: 'ui-component',
      relPath: 'components/common/sp-alert'
    })

    await syncWorkspaceTemplates(dir, 'ux')

    const context = JSON.parse(await fs.readFile(join(dir, '.workspace/project-context.json'), 'utf-8')) as {
      activeWorkspace: string
      activeWorkArea: { kind: string; relPath: string } | null
      editableRoots: string[]
    }

    expect(context.activeWorkspace).toBe('components/common/sp-alert')
    expect(context.activeWorkArea).toEqual({ kind: 'ui-component', relPath: 'components/common/sp-alert' })
    expect(context.editableRoots).toEqual(['components/common/sp-alert/'])
  })

  it('用户 CLAUDE.md 混旧 App 受管块 → 剥旧块、留用户内容、注入 @system.md', async () => {
    const seeded = [
      '# CLAUDE.md',
      '',
      '<!-- UI-CLIENT:WORKSPACE-RULES:START -->',
      'legacy managed content',
      '<!-- UI-CLIENT:WORKSPACE-RULES:END -->',
      '',
      'Manual footer',
      ''
    ].join('\n')
    await fs.writeFile(join(dir, 'CLAUDE.md'), seeded)

    await syncWorkspaceTemplates(dir, 'ux')

    const claude = await fs.readFile(join(dir, 'CLAUDE.md'), 'utf-8')
    // 旧受管块被剥掉，用户真内容保留，末尾注入 @system.md；仍是真实文件
    expect(claude).not.toContain('legacy managed content')
    expect(claude).toContain('Manual footer')
    expect(claude).toContain('@system.md')
    expect(lstatSync(join(dir, 'CLAUDE.md')).isSymbolicLink()).toBe(false)
  })
})
