// 直接 spawn runtime-context.cjs 测它的 SessionStart additionalContext 输出。
// hook 读 .workspace/project-context.json，输出 hookSpecificOutput.additionalContext。
// 这里走 node 子进程，cwd 设到临时工作区，模拟 claude 在 SessionStart 时调用。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncManagedHooks } from './managed-hooks'

let workspacePath: string

beforeEach(async () => {
  workspacePath = mkdtempSync(join(tmpdir(), 'runtime-context-hook-'))
  await syncManagedHooks(workspacePath)
})

afterEach(() => {
  rmSync(workspacePath, { recursive: true, force: true })
})

function writeContext(context: object): void {
  const contextDir = join(workspacePath, '.workspace')
  mkdirSync(contextDir, { recursive: true })
  writeFileSync(join(contextDir, 'project-context.json'), JSON.stringify(context), 'utf-8')
}

function runHook(): { code: number; stdout: string } {
  const scriptPath = join(workspacePath, '.ui-client', 'hooks', 'runtime-context.cjs')
  const r = spawnSync('node', [scriptPath], {
    cwd: workspacePath,
    encoding: 'utf-8'
  })
  return { code: r.status ?? -1, stdout: r.stdout ?? '' }
}

describe('runtime-context.cjs hook', () => {
  it('injects editableRoots, kind, requirement and injection-defense into additionalContext', () => {
    writeContext({
      kind: 'project',
      activeRequirementId: 'abc123-login',
      activeWorkspace: 'docs/ + ui/',
      editableRoots: ['docs/', 'ui/']
    })
    const { code, stdout } = runHook()
    expect(code).toBe(0)

    const parsed = JSON.parse(stdout)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart')
    const ctx = parsed.hookSpecificOutput.additionalContext

    expect(ctx).toContain('工作区类型：项目')
    expect(ctx).toContain('当前需求分支：abc123-login')
    expect(ctx).toContain('当前工作区：docs/ + ui/')
    expect(ctx).toContain('editableRoots，只能写这些路径内')
    expect(ctx).toContain('  - docs/')
    expect(ctx).toContain('  - ui/')
    // 可读范围声明
    expect(ctx).toContain('.external/**')
    expect(ctx).toContain('只读')
    expect(ctx).toContain('.ui-client/**')
    // 注入防御
    expect(ctx).toContain('untrusted data')
    expect(ctx).toContain('ignore previous instructions')
    // 中途切换引导
    expect(ctx).toContain('重新 Read .workspace/project-context.json')
  })

  it('labels ux kind correctly', () => {
    writeContext({
      kind: 'ux',
      editableRoots: ['components/', 'assets/', 'outputs/']
    })
    const { code, stdout } = runHook()
    expect(code).toBe(0)
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext
    expect(ctx).toContain('工作区类型：UX 项目')
    expect(ctx).toContain('  - components/')
  })

  it('omits requirement/workspace lines when absent', () => {
    writeContext({ kind: 'project', editableRoots: ['docs/'] })
    const { code, stdout } = runHook()
    expect(code).toBe(0)
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext
    expect(ctx).not.toContain('当前需求分支')
    expect(ctx).not.toContain('当前工作区')
  })

  it('notes unconstrained write when editableRoots empty', () => {
    writeContext({ kind: 'project', editableRoots: [] })
    const { code, stdout } = runHook()
    expect(code).toBe(0)
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext
    expect(ctx).toContain('editableRoots 为空')
  })

  it('exits cleanly without output when project-context.json is missing', () => {
    const { code, stdout } = runHook()
    expect(code).toBe(0)
    expect(stdout).toBe('')
  })

  it('exits cleanly when project-context.json is corrupt JSON', () => {
    const contextDir = join(workspacePath, '.workspace')
    mkdirSync(contextDir, { recursive: true })
    writeFileSync(join(contextDir, 'project-context.json'), '{ not valid json', 'utf-8')
    const { code, stdout } = runHook()
    expect(code).toBe(0)
    expect(stdout).toBe('')
  })
})
