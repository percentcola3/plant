import { afterAll, describe, it, expect } from 'vitest'
import {
  projectHashFor,
  sessionJsonlPath,
  ensureSessionId,
  createSessionId,
  ensureDocumentSessionId,
  createDocumentSessionId,
  ensureWorkspaceSessionId,
  createWorkspaceSessionId,
  clearProjectSessionHistory,
  branchScopedDocumentKey,
  branchScopedWorkspaceKey
} from '../../src/main/claude-headless/session-id'
import { dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const originalHome = process.env.HOME
const testHome = mkdtempSync(join(tmpdir(), 'ui-client-session-home-'))
process.env.HOME = testHome

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  rmSync(testHome, { recursive: true, force: true })
})

describe('session-id', () => {
  it('projectHashFor: Claude 2.1.x 会替换全部非 ASCII 字母数字字符', () => {
    expect(projectHashFor('/Users/didi/Code/ui-client')).toBe('-Users-didi-Code-ui-client')
    expect(projectHashFor('/tmp/test')).toBe('-tmp-test')
    expect(projectHashFor('/')).toBe('-')
    expect(projectHashFor('/Users/didi/Documents/WorkSpace/.mywork/features/无名'))
      .toBe('-Users-didi-Documents-WorkSpace--mywork-features---')
  })

  it('sessionJsonlPath: 拼接正确', () => {
    const result = sessionJsonlPath('/Users/didi/Code/ui-client', 'abc-123')
    expect(result).toBe(join(homedir(), '.claude', 'projects', '-Users-didi-Code-ui-client', 'abc-123.jsonl'))
  })

  it('createSessionId: 创建新 id 并覆盖项目持久化会话', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'ui-client-session-'))
    const first = ensureSessionId(projectPath)
    const second = createSessionId(projectPath)

    expect(second).not.toBe(first)
    expect(ensureSessionId(projectPath)).toBe(second)
  })

  it('document session: 同一项目下每个文档有独立持久化 session-id', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'ui-client-session-'))
    const a1 = ensureDocumentSessionId(projectPath, '测试pred.md')
    const a2 = ensureDocumentSessionId(projectPath, '测试pred.md')
    const b1 = ensureDocumentSessionId(projectPath, 'docs/prd/pix.md')

    expect(a2).toBe(a1)
    expect(b1).not.toBe(a1)
    expect(ensureSessionId(projectPath)).not.toBe(a1)
  })

  it('createDocumentSessionId: 只覆盖指定文档的 session-id', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'ui-client-session-'))
    const oldA = ensureDocumentSessionId(projectPath, 'a.md')
    const oldB = ensureDocumentSessionId(projectPath, 'b.md')
    const nextA = createDocumentSessionId(projectPath, 'a.md')

    expect(nextA).not.toBe(oldA)
    expect(ensureDocumentSessionId(projectPath, 'a.md')).toBe(nextA)
    expect(ensureDocumentSessionId(projectPath, 'b.md')).toBe(oldB)
  })

  it('workspace session: PM 首页工作区使用独立持久化 session-id', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'ui-client-session-'))
    const projectSid = ensureSessionId(projectPath)
    const docSid = ensureDocumentSessionId(projectPath, 'a.md')
    const workspaceSid = ensureWorkspaceSessionId(projectPath)

    expect(ensureWorkspaceSessionId(projectPath)).toBe(workspaceSid)
    expect(workspaceSid).not.toBe(projectSid)
    expect(workspaceSid).not.toBe(docSid)
  })

  it('workspace session: scoped workspace targets do not share history', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'ui-client-session-'))
    const homeSid = ensureWorkspaceSessionId(projectPath)
    const reqSid = ensureWorkspaceSessionId(projectPath, 'requirement:5ccaa019-dinin')
    const productSid = ensureWorkspaceSessionId(projectPath, 'ui-product:ui/点餐')

    expect(ensureWorkspaceSessionId(projectPath, 'requirement:5ccaa019-dinin')).toBe(reqSid)
    expect(reqSid).not.toBe(homeSid)
    expect(productSid).not.toBe(homeSid)
    expect(productSid).not.toBe(reqSid)
  })

  it('workspace session: 同一项目不同分支不共享 scoped 会话', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'ui-client-session-'))
    const mainSid = ensureWorkspaceSessionId(projectPath, branchScopedWorkspaceKey('main', 'ui-product:outputs/home'))
    const reqSid = ensureWorkspaceSessionId(projectPath, branchScopedWorkspaceKey('req/demo', 'ui-product:outputs/home'))

    expect(ensureWorkspaceSessionId(projectPath, branchScopedWorkspaceKey('main', 'ui-product:outputs/home'))).toBe(mainSid)
    expect(reqSid).not.toBe(mainSid)
  })

  it('document session: 同一项目不同分支不共享文档会话', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'ui-client-session-'))
    const mainSid = ensureDocumentSessionId(projectPath, branchScopedDocumentKey('main', 'docs/prd.md'))
    const reqSid = ensureDocumentSessionId(projectPath, branchScopedDocumentKey('req/demo', 'docs/prd.md'))

    expect(ensureDocumentSessionId(projectPath, branchScopedDocumentKey('main', 'docs/prd.md'))).toBe(mainSid)
    expect(reqSid).not.toBe(mainSid)
  })

  it('createWorkspaceSessionId: 只覆盖首页工作区 session-id', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'ui-client-session-'))
    const oldWorkspace = ensureWorkspaceSessionId(projectPath)
    const projectSid = ensureSessionId(projectPath)
    const nextWorkspace = createWorkspaceSessionId(projectPath)

    expect(nextWorkspace).not.toBe(oldWorkspace)
    expect(ensureWorkspaceSessionId(projectPath)).toBe(nextWorkspace)
    expect(ensureSessionId(projectPath)).toBe(projectSid)
  })

  it('clearProjectSessionHistory: 删除 App 记录的 session-id 与对应 Claude JSONL', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'ui-client-session-'))
    const projectSid = ensureSessionId(projectPath)
    const workspaceSid = ensureWorkspaceSessionId(projectPath)
    const docSid = ensureDocumentSessionId(projectPath, 'docs/prd.md')
    const scopedSid = ensureWorkspaceSessionId(projectPath, 'requirement:demo')
    const externalSid = 'external-session-kept'

    for (const sid of [projectSid, workspaceSid, docSid, scopedSid, externalSid]) {
      const jsonl = sessionJsonlPath(projectPath, sid)
      mkdirSync(dirname(jsonl), { recursive: true })
      writeFileSync(jsonl, '{}\n', 'utf-8')
    }

    clearProjectSessionHistory(projectPath)

    expect(existsSync(join(projectPath, '.workspace', 'session-id'))).toBe(false)
    expect(existsSync(join(projectPath, '.workspace', 'home-session-id'))).toBe(false)
    expect(existsSync(join(projectPath, '.workspace', 'document-sessions'))).toBe(false)
    expect(existsSync(join(projectPath, '.workspace', 'workspace-sessions'))).toBe(false)
    for (const sid of [projectSid, workspaceSid, docSid, scopedSid]) {
      expect(existsSync(sessionJsonlPath(projectPath, sid))).toBe(false)
    }
    expect(existsSync(sessionJsonlPath(projectPath, externalSid))).toBe(true)
  })

  it('创建 session-id 时写入 gitignore，避免会话状态进入业务变更', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'ui-client-session-'))

    ensureDocumentSessionId(projectPath, 'docs/prd.md')

    const gitignore = readFileSync(join(projectPath, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('.ui-client/')
    expect(gitignore).toContain('.external/')
    expect(gitignore).toContain('.workspace/project-context.json')
    expect(gitignore).toContain('.workspace/session-id')
    expect(gitignore).toContain('.workspace/home-session-id')
    expect(gitignore).toContain('.workspace/document-sessions/')
    expect(gitignore).toContain('.workspace/workspace-sessions/')
    expect(gitignore).toContain('.claude/skills/')
    expect(gitignore).toContain('.claude/settings.local.json')
    expect(gitignore).toContain('.agents/skills/')
    expect(gitignore).toContain('.cursor/rules/ui-client-ui-assets.mdc')
  })
})
