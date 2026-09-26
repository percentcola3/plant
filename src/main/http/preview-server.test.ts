import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Workspace } from '@shared/types'

const electronPaths = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => electronPaths.userData }
}))

import { previewServer } from './preview-server'
import { WorkspacesStore, _testOnlyResetSharedCache } from '../workspaces/store'
import { workspacesJsonPath } from '../workspaces/paths'

let workspacePath: string
let workspaceId: string

function workspace(input: Partial<Workspace> = {}): Workspace {
  return {
    id: workspaceId,
    kind: 'ux',
    name: 'uikit',
    path: workspacePath,
    defaultBranch: 'main',
    addedAt: '2026-06-11T00:00:00.000Z',
    lastActiveAt: '2026-06-11T00:00:00.000Z',
    ...input
  }
}

async function touch(relPath: string, content = '<section></section>'): Promise<void> {
  const abs = join(workspacePath, relPath)
  await fs.mkdir(join(abs, '..'), { recursive: true })
  await fs.writeFile(abs, content, 'utf-8')
}

beforeEach(async () => {
  electronPaths.userData = await mkdtemp(join(tmpdir(), 'preview-server-userdata-'))
  _testOnlyResetSharedCache()
  await fs.rm(workspacesJsonPath(), { force: true })
  workspacePath = await mkdtemp(join(tmpdir(), 'preview-server-uikit-'))
  workspaceId = `ux-${Math.random().toString(36).slice(2, 10)}`
})

afterEach(async () => {
  await previewServer.stop()
  _testOnlyResetSharedCache()
  await fs.rm(electronPaths.userData, { recursive: true, force: true }).catch(() => undefined)
  await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined)
})

describe('previewServer components preview', () => {
  it('groups component previews by every first-level components directory', async () => {
    await new WorkspacesStore().add(workspace())
    await touch('components/common/button/index.html')
    await touch('components/common-c/upload/index.html')
    await touch('components/business/card/demo.html')

    const { baseUrl } = await previewServer.start()
    const res = await fetch(`${baseUrl}/preview/components/${workspaceId}`)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('共 3 个组件')
    expect(html).toContain('common-c')
    expect(html).toContain('components/common-c/upload/index.html')
  })

  it('renders component groups as collapsible directories with counts', async () => {
    await new WorkspacesStore().add(workspace())
    await touch('components/common/button/index.html')
    await touch('components/common-c/upload/index.html')

    const { baseUrl } = await previewServer.start()
    const res = await fetch(`${baseUrl}/preview/components/${workspaceId}`)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('class="group collapsed"')
    expect(html).toContain('class="group-toggle"')
    expect(html).toContain('data-category="common-c"')
    expect(html).toContain('COMMON-C')
    expect(html).toContain('group-count">1</span>')
    expect(html).toContain('function toggleGroup')
  })

  it('renders an edit action for opening the selected component in the app preview', async () => {
    await new WorkspacesStore().add(workspace())
    await touch('components/common/button/index.html')

    const { baseUrl } = await previewServer.start()
    const res = await fetch(`${baseUrl}/preview/components/${workspaceId}`)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('id="editComponentBtn"')
    expect(html).toContain('编辑组件')
    expect(html).toContain('function openCurrentComponentEditor')
    expect(html).toContain('__uikit_open_component_editor__')
    expect(html).toContain('components/common/button/index.html')
  })

  it('renders inline edit and delete actions for component rows', async () => {
    await new WorkspacesStore().add(workspace())
    await touch('components/common/button/index.html')

    const { baseUrl } = await previewServer.start()
    const res = await fetch(`${baseUrl}/preview/components/${workspaceId}`)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('data-item-action="edit"')
    expect(html).toContain('data-item-action="delete"')
    expect(html).toContain('function deleteCurrentComponent')
    expect(html).toContain('__uikit_delete_component__')
  })

  it('uses app-level component controls without a duplicate iframe refresh', async () => {
    await new WorkspacesStore().add(workspace())
    await touch('components/common/button/index.html')

    const { baseUrl } = await previewServer.start()
    const res = await fetch(`${baseUrl}/preview/components/${workspaceId}`)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).not.toContain('onclick="location.reload()"')
    expect(html).not.toContain('id="toggleAll"')
    expect(html).toContain('__uikit_toggle_components_overview__')
    expect(html).toContain('--component-bg: #fffdf3')
    expect(html).toContain('background: var(--component-bg)')
  })
})

describe('previewServer icons preview', () => {
  it('renders asset directories as collapsible icon groups with counts', async () => {
    await new WorkspacesStore().add(workspace())
    await touch('assets/icons/source/add.svg', '<svg />')
    await touch('assets/icons/custom/Search.svg', '<svg />')

    const { baseUrl } = await previewServer.start()
    const res = await fetch(`${baseUrl}/preview/icons/${workspaceId}`)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('2 个图标 · 来自 assets/ 下的 2 个目录')
    expect(html).toContain('class="icon-section collapsed"')
    expect(html).toContain('class="section-toggle"')
    expect(html).toContain('data-category="icons/custom"')
    expect(html).toContain('ICONS/CUSTOM')
    expect(html).toContain('section-count">1</span>')
    expect(html).toContain('function toggleIconGroup')
    expect(html).not.toContain('onclick="location.reload()"')
    expect(html).toContain('--icon-bg: #fffdf3')
    expect(html).toContain('header { padding: 8px 24px 14px;')
    expect(html).toContain('background: var(--icon-bg)')
    expect(html).toContain('border: 1px solid var(--icon-border)')
  })
})

describe('previewServer project file preview', () => {
  it('injects the inspector into editable product html', async () => {
    await new WorkspacesStore().add(workspace({ kind: 'project' }))
    await touch('outputs/payment/index.html', '<!doctype html><html><body><button>Pay</button></body></html>')

    const { baseUrl } = await previewServer.start()
    const res = await fetch(`${baseUrl}/p/${workspaceId}/outputs/payment/index.html`)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('<button>Pay</button>')
    expect(html).toContain('window.__UIKIT_INSPECTOR=')
    expect(html).toContain('/static/inspector.js')
  })
})
