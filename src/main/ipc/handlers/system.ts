import { clipboard, dialog, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandler } from '../registry'
import { UIClientError } from '../errors'
import { openInBrowser, revealInFinder } from '../../system'
import { detectIde, openInIde, openProjectTool } from '../../system/ide'
import { checkSshKey, generateSshKey, rotateSshKey } from '../../system/ssh'
import { previewServer } from '../../http/preview-server'
import { importIcons } from '../../icons/import'
import { WorkspacesStore } from '../../workspaces/store'
import { checkClaude, checkCursor, checkEnvironment, checkVSCode } from '../../system/setup'
import { getWindowChromeState, resolveMainBrowserWindow } from '../../window-chrome-state'

const store = new WorkspacesStore()

async function resolveProjectPath(workspaceId: string): Promise<string> {
  const p = await store.findById(workspaceId)
  if (!p) throw new UIClientError('NOT_FOUND', `项目 ${workspaceId} 不存在`)
  return p.path
}

export function registerSystemHandlers(): void {
  registerIpcHandler('system.openInBrowser', async ({ workspaceId, relativePath }) => {
    const projectPath = await resolveProjectPath(workspaceId)
    // outputs 下的 HTML 走 preview-server，确保相对资源按项目路径加载。
    const isOutputHtml = /^outputs\//.test(relativePath) && /\.html?$/i.test(relativePath)
    if (isOutputHtml) {
      const baseUrl = previewServer.baseUrl()
      const encoded = relativePath.split('/').map((s) => encodeURIComponent(s)).join('/')
      await shell.openExternal(`${baseUrl}/p/${workspaceId}/${encoded}`)
      return
    }
    await openInBrowser(relativePath, projectPath)
  })

  registerIpcHandler('system.revealInFinder', async ({ workspaceId, relativePath }) => {
    const projectPath = await resolveProjectPath(workspaceId)
    const target = relativePath ? join(projectPath, relativePath) : projectPath
    revealInFinder(target)
  })

  registerIpcHandler('system.openExternal', async ({ url }) => {
    if (!/^https?:\/\//.test(url)) {
      throw new UIClientError('VALIDATION', '只允许 https / http URL')
    }
    await shell.openExternal(url)
  })

  registerIpcHandler('system.copyToClipboard', async ({ text }) => {
    clipboard.writeText(text)
  })

  registerIpcHandler('ssh.check', async () => checkSshKey())
  registerIpcHandler('ssh.generate', async ({ email }) => generateSshKey({ email }))
  registerIpcHandler('ssh.rotate', async ({ email, expectedFingerprint }) => rotateSshKey({ email, expectedFingerprint }))

  registerIpcHandler('system.openInIDE', async ({ workspaceId, relativePath }) => {
    const projectPath = await resolveProjectPath(workspaceId)
    const target = relativePath ? join(projectPath, relativePath) : projectPath
    return openInIde(target, projectPath)
  })

  // 控制 macOS 红绿灯按钮的可见性。沉浸式（preview）下 TopBar 收起时一并隐藏，
  // 鼠标移到顶部热区 TopBar 浮起时一并显示。Win/Linux 是 no-op。
  registerIpcHandler('system.setTrafficLightsVisible', async ({ visible }) => {
    if (process.platform !== 'darwin') return
    const win = resolveMainBrowserWindow()
    if (!win) return
    win.setWindowButtonVisibility(!!visible)
  })

  registerIpcHandler('system.getWindowChromeState', async () => {
    const win = resolveMainBrowserWindow()
    if (!win) {
      return {
        platform: process.platform,
        maximized: false,
        fullscreen: false,
        compactTrafficLightInset: false,
      }
    }
    return getWindowChromeState(win)
  })

  registerIpcHandler('system.openProjectTool', async ({ workspaceId, kind, relativePath }) => {
    const projectPath = await resolveProjectPath(workspaceId)
    if (kind === 'finder') {
      revealInFinder(relativePath ? join(projectPath, relativePath) : projectPath)
      return { kind }
    }
    return openProjectTool(kind, projectPath, relativePath)
  })

  registerIpcHandler('system.detectIde', async () => {
    const r = detectIde()
    return { kind: r.kind }
  })

  registerIpcHandler('system.selectDirectory', async ({ title, buttonLabel }) => {
    const r = await dialog.showOpenDialog({
      title: title || '选择目录',
      buttonLabel: buttonLabel || '选择',
      properties: ['openDirectory']
    })
    if (r.canceled) return null
    return { path: r.filePaths[0] }
  })

  function previewRootQuery(rootRel: string | undefined): string {
    return rootRel ? `?rootRel=${encodeURIComponent(rootRel)}` : ''
  }

  registerIpcHandler('preview.componentsUrl', async ({ workspaceId, rootRel }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return { url: `${previewServer.baseUrl()}/preview/components/${workspaceId}${previewRootQuery(rootRel)}` }
  })

  registerIpcHandler('preview.iconsUrl', async ({ workspaceId, rootRel }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return { url: `${previewServer.baseUrl()}/preview/icons/${workspaceId}${previewRootQuery(rootRel)}` }
  })

  registerIpcHandler('preview.docUrl', async ({ workspaceId, relPath }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    const path = relPath
      ? `/preview/md/${workspaceId}/${encodeURIComponent(relPath)}`
      : `/preview/md/${workspaceId}`
    return { url: `${previewServer.baseUrl()}${path}` }
  })

  registerIpcHandler('preview.fileUrl', async ({ workspaceId, relPath }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    const cleanRel = relPath.replace(/^\/+/, '').replace(/\\/g, '/')
    if (!cleanRel || cleanRel.split('/').includes('..')) {
      throw new UIClientError('PATH_OUTSIDE_SCOPE', `路径越界：${relPath}`)
    }
    const encoded = cleanRel.split('/').map((s) => encodeURIComponent(s)).join('/')
    return { url: `${previewServer.baseUrl()}/p/${encodeURIComponent(workspaceId)}/${encoded}` }
  })

  registerIpcHandler('icons.import', async ({ workspaceId, filePaths, purpose, name }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    return importIcons(workspaceId, filePaths, purpose, name)
  })

  // 启动环境检查（极简，不阻塞 splash）
  registerIpcHandler('setup.checkEnv', async () => checkEnvironment())

  // 按需检查可选依赖（claude-code / cursor / vscode）
  registerIpcHandler('setup.checkOptionalDep', async ({ name }) => {
    if (name === 'claude-code') return checkClaude()
    if (name === 'cursor') return checkCursor()
    if (name === 'vscode') return checkVSCode()
    throw new UIClientError('VALIDATION', `未知依赖：${name}`)
  })
}
