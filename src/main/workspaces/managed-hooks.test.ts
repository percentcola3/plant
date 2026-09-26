// managed-hooks 行为契约：幂等注入、不动用户自有 hooks、损坏 settings 走重写。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HOOK_INTERNALS, syncManagedHooks } from './managed-hooks'

let workspacePath: string

beforeEach(() => {
  workspacePath = mkdtempSync(join(tmpdir(), 'managed-hooks-'))
})

afterEach(() => {
  rmSync(workspacePath, { recursive: true, force: true })
})

function readSettings(): Record<string, unknown> {
  const path = join(workspacePath, '.claude', 'settings.local.json')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function ourCommand(): string {
  return HOOK_INTERNALS.HOOK_COMMAND
}

describe('syncManagedHooks', () => {
  it('writes hook script to .ui-client/hooks/check-editable.cjs', async () => {
    await syncManagedHooks(workspacePath)
    const scriptPath = join(workspacePath, HOOK_INTERNALS.HOOK_REL_PATH)
    expect(existsSync(scriptPath)).toBe(true)
    const body = readFileSync(scriptPath, 'utf-8')
    expect(body).toContain('PreToolUse hook')
    expect(body).toContain('editableRoots')
  })

  it('creates settings.local.json when missing, with our PreToolUse', async () => {
    await syncManagedHooks(workspacePath)
    const settings = readSettings() as { hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> } }
    expect(settings.hooks.PreToolUse).toHaveLength(1)
    expect(settings.hooks.PreToolUse[0].matcher).toBe(HOOK_INTERNALS.HOOK_MATCHER)
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe(ourCommand())
  })

  it('is idempotent: running twice keeps exactly one of our hooks', async () => {
    await syncManagedHooks(workspacePath)
    await syncManagedHooks(workspacePath)
    const settings = readSettings() as { hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> } }
    const ours = settings.hooks.PreToolUse.filter((g) =>
      g.hooks.some((h) => h.command === ourCommand())
    )
    expect(ours).toHaveLength(1)
  })

  it('preserves user-added hooks in PreToolUse and other hook arrays', async () => {
    mkdirSync(join(workspacePath, '.claude'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.claude', 'settings.local.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo before-bash' }] }
          ],
          PostToolUse: [
            { matcher: 'Write', hooks: [{ type: 'command', command: 'echo wrote' }] }
          ]
        },
        somethingElse: { keep: true }
      }, null, 2),
      'utf-8'
    )

    await syncManagedHooks(workspacePath)
    const settings = readSettings() as {
      hooks: {
        PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }>
        PostToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }>
      }
      somethingElse: { keep: boolean }
    }

    // 用户的 Bash hook 还在
    expect(settings.hooks.PreToolUse.some((g) => g.matcher === 'Bash')).toBe(true)
    // 我们的 hook 也注入了
    expect(settings.hooks.PreToolUse.some((g) =>
      g.hooks.some((h) => h.command === ourCommand())
    )).toBe(true)
    // PostToolUse 不动
    expect(settings.hooks.PostToolUse).toHaveLength(1)
    // 顶层无关字段不动
    expect(settings.somethingElse).toEqual({ keep: true })
  })

  it('replaces an old version of our hook (same script path, different surroundings)', async () => {
    mkdirSync(join(workspacePath, '.claude'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.claude', 'settings.local.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            // 旧版本 matcher 是 Write|Edit（少了 MultiEdit）
            { matcher: 'Write|Edit', hooks: [{ type: 'command', command: ourCommand() }] }
          ]
        }
      }, null, 2),
      'utf-8'
    )
    await syncManagedHooks(workspacePath)

    const settings = readSettings() as { hooks: { PreToolUse: Array<{ matcher: string }> } }
    const ours = settings.hooks.PreToolUse.filter((g) => g.matcher === HOOK_INTERNALS.HOOK_MATCHER)
    expect(ours).toHaveLength(1)
    // 旧 matcher 不应再存在
    expect(settings.hooks.PreToolUse.some((g) => g.matcher === 'Write|Edit')).toBe(false)
  })

  it('writes brainstorming-gate SessionStart hook script and registers it', async () => {
    await syncManagedHooks(workspacePath)
    const scriptPath = join(workspacePath, HOOK_INTERNALS.GATE_HOOK_REL_PATH)
    expect(existsSync(scriptPath)).toBe(true)
    const body = readFileSync(scriptPath, 'utf-8')
    // 脚本检查 pm-brainstorm / ui-brainstorm 安装状态
    expect(body).toContain('pm-brainstorm')
    expect(body).toContain('ui-brainstorm')
    expect(body).toContain('SessionStart')

    const settings = readSettings() as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> }
    }
    // 资产库化 + cwd 锁定改造后，SessionStart 只保留 brainstorming-gate；
    // 老的 runtime-context.cjs hook 已废弃（spec 2026-06-24-cwd-scoped-agent-design.md）。
    expect(settings.hooks.SessionStart).toHaveLength(1)
    const commands = settings.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command))
    expect(commands).toContain(HOOK_INTERNALS.GATE_HOOK_COMMAND)
  })

  it('SessionStart hook 注入也是幂等的，跑多次只剩一条', async () => {
    await syncManagedHooks(workspacePath)
    await syncManagedHooks(workspacePath)
    const settings = readSettings() as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> }
    }
    const gate = settings.hooks.SessionStart.filter((g) =>
      g.hooks.some((h) => h.command === HOOK_INTERNALS.GATE_HOOK_COMMAND)
    )
    expect(gate).toHaveLength(1)
  })

  it('幂等清理 settings.local.json 中旧 runtime-context.cjs SessionStart 注册', async () => {
    // 模拟升级前老 settings.local.json 已有的 runtime-context 注册
    mkdirSync(join(workspacePath, '.claude'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.claude', 'settings.local.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: `node ${HOOK_INTERNALS.LEGACY_RUNTIME_CTX_HOOK_REL_PATH}` }]
            }
          ]
        }
      }, null, 2) + '\n',
      'utf-8'
    )
    await syncManagedHooks(workspacePath)
    const settings = readSettings() as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> }
    }
    const commands = settings.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command))
    expect(commands.some((c) => c.includes(HOOK_INTERNALS.LEGACY_RUNTIME_CTX_HOOK_REL_PATH))).toBe(false)
    // gate 仍正常注入
    expect(commands).toContain(HOOK_INTERNALS.GATE_HOOK_COMMAND)
  })

  it('rebuilds settings on corrupted JSON instead of crashing', async () => {
    mkdirSync(join(workspacePath, '.claude'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.claude', 'settings.local.json'),
      '{ this is not valid JSON',
      'utf-8'
    )
    await syncManagedHooks(workspacePath)
    const settings = readSettings() as { hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> } }
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe(ourCommand())
  })
})
