import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const editorSource = readFileSync(new URL('./WorkspaceEditorPane.vue', import.meta.url), 'utf-8')
const sidebarSource = readFileSync(new URL('./SkillFolderSidebar.vue', import.meta.url), 'utf-8')
const codeMirrorSource = readFileSync(new URL('./CodeMirrorSurface.vue', import.meta.url), 'utf-8')
const mainWindowSource = readFileSync(new URL('../../views/MainWindow.vue', import.meta.url), 'utf-8')

describe('Skill folder editor', () => {
  it('shows the full Skill folder beside SKILL.md and opens auxiliary text files', () => {
    expect(editorSource).toContain('<SkillFolderSidebar')
    expect(editorSource).toContain('claude|agents')
    expect(editorSource).toContain('editor.openText(relPath)')
    expect(sidebarSource).toContain("call('workspace.listFiles'")
  })

  it('supports adding files and subdirectories inside a Skill folder', () => {
    expect(sidebarSource).toContain("call('editor.writeTextFile'")
    expect(sidebarSource).toContain("call('editor.createEntry'")
    expect(sidebarSource).toContain('Skill 文件夹内的有效相对路径')
  })

  it('renders as a full tab with a dark editor and dark Markdown preview', () => {
    expect(editorSource).toContain('class="workspace-editor"')
    expect(editorSource).toContain("theme: 'dark'")
    expect(editorSource).toContain('theme="dark"')
    expect(editorSource).not.toContain('rounded-[20px]')
    expect(mainWindowSource).not.toContain('bg-background px-4 pb-4 pt-3')
    expect(codeMirrorSource).toContain("backgroundColor: dark ? '#121212'")
    expect(codeMirrorSource).toContain('syntaxHighlighting(darkHighlightStyle)')
  })
})
