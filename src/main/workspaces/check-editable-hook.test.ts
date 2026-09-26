// 直接 spawn check-editable.cjs 测它的拒绝/放行行为。
// hook 是 .cjs（CommonJS）脚本，独立运行；这里走 node 子进程 + stdin JSON 模拟 claude 的调用。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncManagedHooks } from './managed-hooks'

let workspacePath: string

beforeEach(async () => {
  workspacePath = mkdtempSync(join(tmpdir(), 'check-editable-hook-'))
  await syncManagedHooks(workspacePath)
})

afterEach(() => {
  rmSync(workspacePath, { recursive: true, force: true })
})

function writeContext(editableRoots: string[]): void {
  const contextDir = join(workspacePath, '.workspace')
  mkdirSync(contextDir, { recursive: true })
  writeFileSync(join(contextDir, 'project-context.json'), JSON.stringify({ editableRoots }), 'utf-8')
}

function runHook(payload: object): { code: number; stderr: string } {
  const scriptPath = join(workspacePath, '.ui-client', 'hooks', 'check-editable.cjs')
  const r = spawnSync('node', [scriptPath], {
    input: JSON.stringify(payload),
    cwd: workspacePath,
    encoding: 'utf-8'
  })
  return { code: r.status ?? -1, stderr: r.stderr ?? '' }
}

describe('check-editable.cjs hook', () => {
  it('allows non-write tools (Read, Bash, ...)', () => {
    writeContext(['docs/'])
    const r = runHook({ tool_name: 'Read', tool_input: { file_path: 'src/foo.ts' } })
    expect(r.code).toBe(0)
  })

  it('allows write inside editableRoots', () => {
    writeContext(['docs/', 'ui/'])
    const r = runHook({ tool_name: 'Write', tool_input: { file_path: 'docs/spec.md' } })
    expect(r.code).toBe(0)
  })

  it('warns without blocking writes outside editableRoots', () => {
    writeContext(['docs/'])
    const r = runHook({ tool_name: 'Edit', tool_input: { file_path: 'src/main.ts' } })
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('docs')
    expect(r.stderr).toContain('src/main.ts')
  })

  it('warns without blocking paths escaping the project root', () => {
    writeContext(['docs/'])
    const r = runHook({ tool_name: 'Write', tool_input: { file_path: '../outside.txt' } })
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('项目外')
  })

  it('passes through when no project-context.json exists', () => {
    const r = runHook({ tool_name: 'Write', tool_input: { file_path: 'whatever.txt' } })
    expect(r.code).toBe(0)
  })

  it('passes through when editableRoots is empty', () => {
    writeContext([])
    const r = runHook({ tool_name: 'Write', tool_input: { file_path: 'whatever.txt' } })
    expect(r.code).toBe(0)
  })

  it('handles MultiEdit and NotebookEdit (notebook_path)', () => {
    writeContext(['notebooks/'])
    const allow = runHook({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'notebooks/a.ipynb' } })
    expect(allow.code).toBe(0)
    const block = runHook({ tool_name: 'MultiEdit', tool_input: { file_path: 'src/x.ts' } })
    expect(block.code).toBe(0)
    expect(block.stderr).toContain('src/x.ts')
  })
})
