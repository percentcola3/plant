import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listSkills,
  setSkillDisabled,
  createSkill,
  deleteSkill,
  ensureBuiltinSkills,
  installSkillTemplates,
  listSkillTemplates,
  parseFrontmatter
} from './service'

let workspace: string
let templates: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'skills-svc-ws-'))
  templates = await mkdtemp(join(tmpdir(), 'skills-svc-tpl-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
  await rm(templates, { recursive: true, force: true })
})

function ls() {
  return listSkills(workspace, templates)
}

async function writeSkill(root: string, name: string, content: string): Promise<void> {
  await fs.mkdir(join(root, name), { recursive: true })
  await fs.writeFile(join(root, name, 'SKILL.md'), content, 'utf-8')
}

describe('ensureBuiltinSkills', () => {
  const names = ['ux-design', 'prd-tech-review', 'knowledge-search']

  it('首次打开技能页时补齐三个可编辑的内置 Skill', async () => {
    for (const name of names) {
      await writeSkill(templates, name, `---\nname: ${name}\ndescription: builtin\n---\n`)
    }

    await ensureBuiltinSkills(workspace, templates)

    for (const name of names) {
      expect(await fs.readFile(join(workspace, '.claude/skills', name, 'SKILL.md'), 'utf-8'))
        .toContain(`name: ${name}`)
      expect(await fs.readFile(join(workspace, '.agents/skills', name, 'SKILL.md'), 'utf-8'))
        .toContain(`name: ${name}`)
    }
  })

  it('不会覆盖用户已经编辑或禁用的内置 Skill', async () => {
    await writeSkill(templates, 'ux-design', 'template')
    await writeSkill(join(workspace, '.claude/skills'), 'ux-design', 'user edited')
    await writeSkill(join(workspace, '.claude/skills/.disabled'), 'knowledge-search', 'disabled')

    await ensureBuiltinSkills(workspace, templates)

    expect(await fs.readFile(join(workspace, '.claude/skills/ux-design/SKILL.md'), 'utf-8'))
      .toBe('user edited')
    expect(await fs.stat(join(workspace, '.claude/skills/knowledge-search')).catch(() => null))
      .toBeNull()
  })

  it('upgrades an unhashed old knowledge-search template that still says MCP is unnecessary', async () => {
    await writeSkill(
      templates,
      'knowledge-search',
      '---\nname: knowledge-search\ndescription: 用 zvec-grep 定位\n---\n先 zg 再 Read\n'
    )
    await writeSkill(
      join(workspace, '.claude/skills'),
      'knowledge-search',
      '---\nname: knowledge-search\ndescription: 查知识库；无需 RAG、向量库或专用 MCP。\n---\n旧流程\n'
    )

    await ensureBuiltinSkills(workspace, templates)

    const updated = await fs.readFile(join(workspace, '.claude/skills/knowledge-search/SKILL.md'), 'utf-8')
    expect(updated).toContain('先 zg 再 Read')
    expect(updated).not.toContain('无需 RAG、向量库或专用 MCP')
  })
})

describe('listSkills', () => {
  it('解析 frontmatter 的 name + description（含 > 折叠）', async () => {
    await writeSkill(join(workspace, '.claude/skills'), 'brainstorming', `---
name: brainstorming
description: >-
  任何创造性工作前必须先调用，把模糊想法磨成可落地的设计。
  触发词：脑暴、需求澄清。
---

# 正文`)
    await writeSkill(templates, 'brainstorming', '同上')

    const skills = await ls()

    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('brainstorming')
    expect(skills[0].title).toBe('brainstorming')
    expect(skills[0].description).toContain('任何创造性工作前必须先调用')
    expect(skills[0].description).toContain('触发词：脑暴、需求澄清')
    expect(skills[0].skillDirRelPath).toBe('.claude/skills/brainstorming')
    expect(skills[0].skillRelPath).toBe('.claude/skills/brainstorming/SKILL.md')
  })

  it('解析快捷调用配置和默认提示词', async () => {
    await writeSkill(join(workspace, '.claude/skills'), 'knowledge-qa', `---
name: knowledge-qa
description: 检索知识库
quickInvocation: true
defaultPrompt: "检索问答"
---
`)

    const skills = await ls()

    expect(skills[0].quickInvocation).toBe(true)
    expect(skills[0].defaultPrompt).toBe('检索问答')
  })

  it('hasUserEdits：内容与模板一致 = false，否则 true', async () => {
    const original = `---\nname: x\ndescription: y\n---\n\nbody`
    await writeSkill(join(workspace, '.claude/skills'), 'x', original)
    await writeSkill(templates, 'x', original)

    let skills = await ls()
    expect(skills[0].hasUserEdits).toBe(false)

    await fs.writeFile(join(workspace, '.claude/skills/x/SKILL.md'), `${original}\n\nuser appended`, 'utf-8')
    skills = await ls()
    expect(skills[0].hasUserEdits).toBe(true)
  })

  it('hasUserEdits 按整个 Skill 文件夹比较，而不是只看 SKILL.md', async () => {
    const entry = '---\nname: folder-skill\n---\n'
    await writeSkill(join(workspace, '.claude/skills'), 'folder-skill', entry)
    await writeSkill(templates, 'folder-skill', entry)
    await fs.mkdir(join(workspace, '.claude/skills/folder-skill/scripts'), { recursive: true })
    await fs.mkdir(join(templates, 'folder-skill/scripts'), { recursive: true })
    await fs.writeFile(join(workspace, '.claude/skills/folder-skill/scripts/check.py'), 'print("ok")')
    await fs.writeFile(join(templates, 'folder-skill/scripts/check.py'), 'print("ok")')

    let skills = await ls()
    expect(skills[0].hasUserEdits).toBe(false)

    await fs.writeFile(join(workspace, '.claude/skills/folder-skill/scripts/check.py'), 'print("changed")')
    skills = await ls()
    expect(skills[0].hasUserEdits).toBe(true)
  })

  it('templates 里没对应模板时 hasUserEdits = false（无法对比）', async () => {
    await writeSkill(join(workspace, '.claude/skills'), 'orphan', '---\nname: orphan\n---\n')
    // templates 里没有 orphan
    const skills = await ls()
    expect(skills[0].hasUserEdits).toBe(false)
  })

  it('.claude 和 .agents 目录共享同一份 SKILL.md，按目录名去重', async () => {
    const body = '---\nname: dup\n---\n'
    await writeSkill(join(workspace, '.claude/skills'), 'dup', body)
    await writeSkill(join(workspace, '.agents/skills'), 'dup', body)
    await writeSkill(templates, 'dup', body)

    const skills = await ls()
    expect(skills).toHaveLength(1)
    expect(skills[0].skillRelPath).toBe('.claude/skills/dup/SKILL.md')
  })

  it('只在 .agents 里存在的 skill 也会列出', async () => {
    const body = '---\nname: codex-only\ndescription: just codex\n---\n'
    await writeSkill(join(workspace, '.agents/skills'), 'codex-only', body)
    await writeSkill(templates, 'codex-only', body)

    const skills = await ls()
    expect(skills).toHaveLength(1)
    expect(skills[0].skillRelPath).toBe('.agents/skills/codex-only/SKILL.md')
  })

  it('没有 SKILL.md 的目录被忽略', async () => {
    await fs.mkdir(join(workspace, '.claude/skills/empty-dir'), { recursive: true })
    const skills = await ls()
    expect(skills).toHaveLength(0)
  })

  it('frontmatter 缺失或解析失败时返回 null 字段，但仍列出该 skill', async () => {
    await writeSkill(join(workspace, '.claude/skills'), 'no-fm', 'plain body without frontmatter')
    const skills = await ls()
    expect(skills).toHaveLength(1)
    expect(skills[0].title).toBeNull()
    expect(skills[0].description).toBeNull()
  })

  it('按 name 升序排列', async () => {
    await writeSkill(join(workspace, '.claude/skills'), 'zebra', '---\nname: zebra\n---\n')
    await writeSkill(join(workspace, '.claude/skills'), 'alpha', '---\nname: alpha\n---\n')
    await writeSkill(join(workspace, '.claude/skills'), 'mango', '---\nname: mango\n---\n')

    const skills = await ls()
    expect(skills.map((s) => s.name)).toEqual(['alpha', 'mango', 'zebra'])
  })

  it('source: 模板里有 → app；模板里没有 → project（不再扫全局 ~/.claude/skills）', async () => {
    await writeSkill(join(workspace, '.claude/skills'), 'app-skill', '---\nname: app-skill\n---\n')
    await writeSkill(templates, 'app-skill', '---\nname: app-skill\n---\n')
    await writeSkill(join(workspace, '.claude/skills'), 'project-skill', '---\nname: project-skill\n---\n')

    const skills = await ls()
    const bySource = Object.fromEntries(skills.map((s) => [s.name, s.source]))
    expect(bySource).toEqual({
      'app-skill': 'app',
      'project-skill': 'project'
    })
  })

  it('disabled 字段：移到 .disabled/ 目录后 disabled=true，路径反映新位置', async () => {
    await writeSkill(join(workspace, '.claude/skills/.disabled'), 'sleeping', '---\nname: sleeping\n---\n')
    const skills = await ls()
    expect(skills).toHaveLength(1)
    expect(skills[0].disabled).toBe(true)
    expect(skills[0].skillRelPath).toBe('.claude/skills/.disabled/sleeping/SKILL.md')
  })

  it('同名同时存在 enabled + disabled 时，优先取 enabled', async () => {
    await writeSkill(join(workspace, '.claude/skills'), 'foo', '---\nname: foo\nstate: live\n---\n')
    await writeSkill(join(workspace, '.claude/skills/.disabled'), 'foo', '---\nname: foo\nstate: dead\n---\n')

    const skills = await ls()
    expect(skills).toHaveLength(1)
    expect(skills[0].disabled).toBe(false)
    expect(skills[0].skillRelPath).toBe('.claude/skills/foo/SKILL.md')
  })
})

describe('setSkillDisabled', () => {
  it('禁用：把 .claude/skills/<name> 和 .agents/skills/<name> 一起移到 .disabled/', async () => {
    await writeSkill(join(workspace, '.claude/skills'), 'x', '---\nname: x\n---\n')
    await writeSkill(join(workspace, '.agents/skills'), 'x', '---\nname: x\n---\n')

    await setSkillDisabled(workspace, 'x', true)

    expect(await fs.stat(join(workspace, '.claude/skills/x')).catch(() => null)).toBeNull()
    expect(await fs.stat(join(workspace, '.agents/skills/x')).catch(() => null)).toBeNull()
    expect(await fs.stat(join(workspace, '.claude/skills/.disabled/x'))).toBeDefined()
    expect(await fs.stat(join(workspace, '.agents/skills/.disabled/x'))).toBeDefined()
  })

  it('启用：把 .disabled/<name> 在两侧都移回原位', async () => {
    await writeSkill(join(workspace, '.claude/skills/.disabled'), 'y', '---\nname: y\n---\n')
    await writeSkill(join(workspace, '.agents/skills/.disabled'), 'y', '---\nname: y\n---\n')

    await setSkillDisabled(workspace, 'y', false)

    expect(await fs.stat(join(workspace, '.claude/skills/y'))).toBeDefined()
    expect(await fs.stat(join(workspace, '.agents/skills/y'))).toBeDefined()
  })

  it('一侧不存在另一侧存在时不报错，已存在的那一侧被处理', async () => {
    await writeSkill(join(workspace, '.claude/skills'), 'lonely', '---\nname: lonely\n---\n')
    await setSkillDisabled(workspace, 'lonely', true)
    expect(await fs.stat(join(workspace, '.claude/skills/.disabled/lonely'))).toBeDefined()
  })

  it('两侧都不存在时抛错', async () => {
    await expect(setSkillDisabled(workspace, 'ghost', true)).rejects.toThrow(/不存在/)
  })

  it('非法 skill 名（含斜杠或点开头）抛错', async () => {
    await expect(setSkillDisabled(workspace, 'a/b', true)).rejects.toThrow(/非法/)
    await expect(setSkillDisabled(workspace, '.disabled', true)).rejects.toThrow(/非法/)
  })
})

describe('createSkill', () => {
  it('在 .claude/skills 和 .agents/skills 两侧都生成最小骨架 SKILL.md', async () => {
    await createSkill(workspace, 'my-skill', '一句话描述')

    const claude = await fs.readFile(join(workspace, '.claude/skills/my-skill/SKILL.md'), 'utf-8')
    const agents = await fs.readFile(join(workspace, '.agents/skills/my-skill/SKILL.md'), 'utf-8')

    expect(claude).toBe(agents)
    expect(claude).toContain('name: my-skill')
    expect(claude).toContain('description: 一句话描述')
    expect(claude).toContain('# my-skill')
    expect(claude).toContain('TODO')
  })

  it('可生成快捷调用配置并要求默认提示词', async () => {
    await createSkill(workspace, 'knowledge-qa', '知识库问答', {
      quickInvocation: true,
      defaultPrompt: '检索问答'
    })

    const content = await fs.readFile(
      join(workspace, '.claude/skills/knowledge-qa/SKILL.md'),
      'utf-8'
    )
    const frontmatter = parseFrontmatter(content)
    expect(frontmatter.quickInvocation).toBe('true')
    expect(frontmatter.defaultPrompt).toBe('检索问答')

    await expect(createSkill(workspace, 'invalid-quick', undefined, {
      quickInvocation: true
    })).rejects.toThrow(/默认提示词/)
  })

  it('description 不传时填占位说明', async () => {
    await createSkill(workspace, 'xy')
    const claude = await fs.readFile(join(workspace, '.claude/skills/xy/SKILL.md'), 'utf-8')
    expect(claude).toMatch(/description: TODO/)
  })

  it('名字非法时抛错（大写 / 含点 / 含斜杠 / 太短 / 保留字）', async () => {
    await expect(createSkill(workspace, 'My-Skill')).rejects.toThrow()
    await expect(createSkill(workspace, 'a.b')).rejects.toThrow()
    await expect(createSkill(workspace, 'a/b')).rejects.toThrow()
    await expect(createSkill(workspace, 'a')).rejects.toThrow()
    await expect(createSkill(workspace, '_shared')).rejects.toThrow()
    await expect(createSkill(workspace, 'README')).rejects.toThrow()
  })

  it('已存在时抛错（两侧任一存在即拒）', async () => {
    await createSkill(workspace, 'dup', 'd')
    await expect(createSkill(workspace, 'dup')).rejects.toThrow(/已存在/)
  })
})

describe('deleteSkill', () => {
  it('硬删两份目录 + .disabled 副本', async () => {
    await createSkill(workspace, 'gone')
    await fs.mkdir(join(workspace, '.claude/skills/.disabled/gone'), { recursive: true })
    await fs.writeFile(join(workspace, '.claude/skills/.disabled/gone/SKILL.md'), 'old')

    await deleteSkill(workspace, 'gone')

    expect(await fs.stat(join(workspace, '.claude/skills/gone')).catch(() => null)).toBeNull()
    expect(await fs.stat(join(workspace, '.agents/skills/gone')).catch(() => null)).toBeNull()
    expect(await fs.stat(join(workspace, '.claude/skills/.disabled/gone')).catch(() => null)).toBeNull()
  })

  it('不存在的 skill 删除是幂等的', async () => {
    await expect(deleteSkill(workspace, 'never-existed')).resolves.toBeUndefined()
  })

  it('删除时清掉 skill-managed-hashes.json 里的对应前缀', async () => {
    await fs.mkdir(join(workspace, '.ui-client'), { recursive: true })
    await fs.writeFile(
      join(workspace, '.ui-client/skill-managed-hashes.json'),
      JSON.stringify({
        '.claude/skills/foo/SKILL.md': 'aaaa',
        '.agents/skills/foo/SKILL.md': 'aaaa',
        '.claude/skills/bar/SKILL.md': 'bbbb'
      })
    )
    await fs.mkdir(join(workspace, '.claude/skills/foo'), { recursive: true })
    await fs.writeFile(join(workspace, '.claude/skills/foo/SKILL.md'), 'x')

    await deleteSkill(workspace, 'foo')

    const map = JSON.parse(await fs.readFile(join(workspace, '.ui-client/skill-managed-hashes.json'), 'utf-8'))
    expect(map['.claude/skills/foo/SKILL.md']).toBeUndefined()
    expect(map['.agents/skills/foo/SKILL.md']).toBeUndefined()
    expect(map['.claude/skills/bar/SKILL.md']).toBe('bbbb')
  })

  it('保留名字（_shared / README）不能删', async () => {
    await expect(deleteSkill(workspace, '_shared')).rejects.toThrow()
    await expect(deleteSkill(workspace, 'README')).rejects.toThrow()
  })
})

describe('listSkillTemplates', () => {
  it('返回模板目录里的全部条目并标 kind / alreadyInstalled', async () => {
    // 准备假的 templates 目录：一个 pm-* + 一个 ui-* + _shared
    await writeSkill(templates, 'pm-brainstorm', '---\nname: pm-brainstorm\ndescription: 头脑风暴\n---\n')
    await writeSkill(templates, 'ui-execute', '---\nname: ui-execute\ndescription: 执行\n---\n')
    await fs.mkdir(join(templates, '_shared'), { recursive: true })
    await fs.writeFile(join(templates, '_shared', 'note.md'), 'shared')

    // 工作区已经装了 pm-brainstorm
    await fs.mkdir(join(workspace, '.claude/skills/pm-brainstorm'), { recursive: true })

    const list = await listSkillTemplates(workspace, templates)
    const byName = Object.fromEntries(list.map((t) => [t.name, t]))

    expect(byName['pm-brainstorm'].kind).toBe('project')
    expect(byName['pm-brainstorm'].alreadyInstalled).toBe(true)
    expect(byName['pm-brainstorm'].description).toContain('头脑风暴')
    expect(byName['ui-execute'].kind).toBe('ux')
    expect(byName['ui-execute'].alreadyInstalled).toBe(false)
    expect(byName['_shared'].kind).toBe('shared')
  })
})

describe('installSkillTemplates', () => {
  beforeEach(async () => {
    // 准备一份真实模板
    await writeSkill(templates, 'pm-brainstorm', '---\nname: pm-brainstorm\n---\nbrainstorm body')
    await writeSkill(templates, 'pm-prd', '---\nname: pm-prd\n---\nprd body')
    await fs.mkdir(join(templates, '_shared'), { recursive: true })
    await fs.writeFile(join(templates, '_shared/readme-pm.md'), '# PM README')
    await fs.writeFile(join(templates, '_shared/readme-ui.md'), '# UI README')
  })

  it('写入两侧目录，返回 installed / skipped', async () => {
    const r = await installSkillTemplates(workspace, templates, 'project', ['pm-brainstorm', 'pm-prd'])
    expect(r.installed.sort()).toEqual(['pm-brainstorm', 'pm-prd'])
    expect(r.skipped).toEqual([])

    expect(await fs.readFile(join(workspace, '.claude/skills/pm-brainstorm/SKILL.md'), 'utf-8')).toContain('brainstorm body')
    expect(await fs.readFile(join(workspace, '.agents/skills/pm-prd/SKILL.md'), 'utf-8')).toContain('prd body')
  })

  it('已装的进 skipped 不动', async () => {
    await fs.mkdir(join(workspace, '.claude/skills/pm-brainstorm'), { recursive: true })
    await fs.writeFile(join(workspace, '.claude/skills/pm-brainstorm/SKILL.md'), 'user content')

    const r = await installSkillTemplates(workspace, templates, 'project', ['pm-brainstorm', 'pm-prd'])
    expect(r.skipped).toContain('pm-brainstorm')
    expect(r.installed).toEqual(['pm-prd'])
    expect(await fs.readFile(join(workspace, '.claude/skills/pm-brainstorm/SKILL.md'), 'utf-8')).toBe('user content')
  })

  it('首次装入时生成 README.md（PM 用 readme-pm，UX 用 readme-ui）', async () => {
    await installSkillTemplates(workspace, templates, 'project', ['pm-brainstorm'])
    expect(await fs.readFile(join(workspace, '.claude/skills/README.md'), 'utf-8')).toBe('# PM README')

    // UX 工作区里装会写 ui 版
    const wsUx = await mkdtemp(join(tmpdir(), 'skills-ux-ws-'))
    try {
      await writeSkill(templates, 'ui-execute', '---\nname: ui-execute\n---\nui body')
      await installSkillTemplates(wsUx, templates, 'ux', ['ui-execute'])
      expect(await fs.readFile(join(wsUx, '.claude/skills/README.md'), 'utf-8')).toBe('# UI README')
    } finally {
      await rm(wsUx, { recursive: true, force: true })
    }
  })

  it('已存在 README 不覆盖', async () => {
    await fs.mkdir(join(workspace, '.claude/skills'), { recursive: true })
    await fs.writeFile(join(workspace, '.claude/skills/README.md'), 'user edited readme')
    await installSkillTemplates(workspace, templates, 'project', ['pm-brainstorm'])
    expect(await fs.readFile(join(workspace, '.claude/skills/README.md'), 'utf-8')).toBe('user edited readme')
  })
})
