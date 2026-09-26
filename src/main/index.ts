// 全局错误捕获：whenReady 内的 await 抛 Promise 拒绝时，Electron 默认会以 code 0 静默退出，
// 看不到根因。挂这两个 handler 让原因始终被打到 stderr。
function isConsoleEpipe(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const pipeError = error as NodeJS.ErrnoException
  if (pipeError.code !== 'EPIPE') return false
  const stack = pipeError.stack ?? ''
  return stack.includes('electron-log')
    || stack.includes('node:internal/console')
    || stack.includes('console.')
}

process.on('uncaughtException', (error) => {
  // EPIPE：stdout 管道断了（启动 App 的终端后来被关）。写日志本身会再触发
  // EPIPE，形成 8/10 那种几百条的日志风暴。直接吞掉；可能相关的 spawn EBADF
  // 由 spawn 自检记录证据，并在 spawn-turn 尝试恢复。
  if (isConsoleEpipe(error)) {
    recordSpawnRelatedEpipe()
    return
  }
  diagnostics.error('app.uncaught_exception', error)
})
process.on('unhandledRejection', (reason) => {
  if (isConsoleEpipe(reason)) {
    recordSpawnRelatedEpipe()
    return
  }
  diagnostics.error('app.unhandled_rejection', reason)
})

import { app, BrowserWindow, shell } from 'electron'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerAllIpcHandlers } from './ipc'
import { isBundled, resolveGitBinary, resolveGitEnv } from './git/binary'
import { killAllTtys } from './pty/manager'
import { cleanupClaudeResources } from './ipc/handlers/claude'
import { projectWatcher } from './projects/watcher'
import { askpassServer, ensureAskpassHelper, ensureCachedAskpassHelper } from './http/askpass-server'
import { previewServer } from './http/preview-server'
import { captureServer } from './raw/server'
import { ensureExtensionInstalled } from './raw/extension-installer'
import { hydrateProcessPathSync, hydrateProcessPathFromShell } from './system/shell-path'
import { ensureSpawnHealth, recordSpawnRelatedEpipe } from './system/spawn-health'
import { startAutoRefresh, stopAutoRefresh } from './external-pool/service'
import { startBackgroundFetch, stopBackgroundFetch } from './git/background-fetch'
import { flushBeforeQuit, unbindAll as unbindAllAutoSave } from './saga/auto-save'
import {
  AI_TASK_NOTCH_WINDOW_KIND,
  applyAiTaskNotchBounds,
  applyAiTaskNotchPosition,
  clampNotchBoundsToScreen,
  isAiTaskNotchWindow,
  readNotchPosition,
  writeNotchPosition
} from './ai-tasks/notch-window'
import {
  attachWindowChromeStateEvents,
  sendWindowChromeState,
  setMainWindowRef,
} from './window-chrome-state'
import { sweepStaleAiTasks } from './ai-tasks/sweep'
import { diagnostics, initializeDiagnostics } from './diagnostics/runtime'
import { settingsStore } from './settings/store'
import { ensureZgMcpConfig } from './zg/zg-mcp'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
let mainWindow: BrowserWindow | null = null
let aiTaskNotchWindow: BrowserWindow | null = null

// 让 dev 模式下 app.getPath('userData') 也指向 WorkSpace 而非 Electron 默认目录
// （否则 dev 用一份 projects.json，打包用另一份）
app.setName('WorkSpace')

// GUI 启动 Electron 时 PATH 默认只有 /usr/bin:/bin:/...，不含用户装的 node / brew / nvm
// 等目录。在创建任何子进程之前先把常见目录注入 process.env.PATH，避免 spawn claude /
// pty 里 `env node` 直接 ENOENT。完整 shell PATH 走 whenReady 内异步覆盖。
hydrateProcessPathSync()

// spawn 健康自检：启动早期记录 fd 基线并执行最小子进程探测；失败时尝试修复
// 标准 fd，并把探测矩阵写入诊断日志，供远端稳定复现场景定位。
void ensureSpawnHealth({ appVersion: app.getVersion(), isPackaged: app.isPackaged })

function showMacDockIcon(): void {
  const dock = app.dock
  if (process.platform !== 'darwin' || !dock) return

  const dockIconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'icon.png')

  void dock.show()
    .then(() => dock.setIcon(dockIconPath))
    .catch((error) => console.warn('[main] dock.show/setIcon failed:', error))
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win.maximize()
    win.show()
    sendWindowChromeState(win)
  })
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
      setMainWindowRef(null)
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(win)
  attachWindowChromeStateEvents(win)

  mainWindow = win
  setMainWindowRef(win)
  return win
}

// 屏幕顶部灵动岛：常驻透明窗口，mini 图标和展开面板均可直接交互。
function createAiTaskNotchWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 44,
    height: 44,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    // 允许窗口尺寸/位置超出物理屏幕范围，避免 macOS 把窗口挤到菜单栏下方
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    title: 'WorkSpace AI Tasks',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 'screen-saver' 是 Electron 支持的最高层级，在 macOS 上对应
  // NSScreenSaverWindowLevel，高于菜单栏 (NSMainMenuWindowLevel)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.on('ready-to-show', () => {
    applyAiTaskNotchBounds(win, 'mini')
    // 若有持久化的用户拖动位置，用它覆盖默认居中
    void readNotchPosition().then((pos) => {
      if (pos && !win.isDestroyed()) applyAiTaskNotchPosition(win, pos)
      if (!win.isDestroyed() && settingsStore.getCached()?.aiTaskNotchEnabled !== false) win.showInactive()
    })
  })
  // 用户拖动窗口后落位就把位置写盘（debounce 由 native 事件天然稀疏，无需手动）。
  // 顺便把窗口 clamp 回屏幕内，防止用户误拖到屏幕外找不回来。
  win.on('moved', () => {
    if (win.isDestroyed()) return
    const b = win.getBounds()
    const clamped = clampNotchBoundsToScreen(b)
    if (clamped.x !== b.x || clamped.y !== b.y) {
      win.setBounds({ ...b, x: clamped.x, y: clamped.y })
    }
    void writeNotchPosition({ x: clamped.x, y: clamped.y })
  })
  win.on('closed', () => {
    if (aiTaskNotchWindow === win) aiTaskNotchWindow = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRenderer(win, AI_TASK_NOTCH_WINDOW_KIND)
  aiTaskNotchWindow = win
  return win
}

function loadRenderer(win: BrowserWindow, windowKind?: string): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (windowKind) url.searchParams.set('window', windowKind)
    win.loadURL(url.toString())
    return
  }

  win.loadFile(join(__dirname, '../renderer/index.html'), windowKind
    ? { search: `window=${windowKind}` }
    : undefined)
}

function focusMainWindow(): void {
  const existing = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getAllWindows().find((win) => !isAiTaskNotchWindow(win))
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    mainWindow = existing
    return
  }
  createMainWindow()
}

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) {
    // 显式打印原因；之前一行 app.quit() 让人误以为 electron-vite 自己出问题
    console.warn('[main] 另一个 WorkSpace 实例已在运行（持有 single instance lock）。本实例退出。')
    console.warn('[main] 如果上一次 dev session 没退干净，可以执行: pkill -9 -f "Electron \\."')
    app.quit()
    return
  }

  await initializeDiagnostics()
  // 后续 provider / CLI 决策包含同步热路径，注册 IPC 前先把本机设置载入缓存。
  await settingsStore.load()
  logGitResolution()

  // 预生成 zg 检索 MCP 配置（UI headless 与 TUI 面板的 claude 会话都挂载它；
  // 等价 `zg install --target claude`，但只作用于 App 拉起的会话，不碰用户全局配置）。
  void ensureZgMcpConfig().catch((e) => console.warn('[main] zg mcp config failed:', e))

  // 异步从 user shell（zsh/bash）拉完整 PATH 合并到 process.env.PATH，
  // 覆盖 nvm 这种动态目录。fire-and-forget，不阻塞 UI 启动；用户首次对话前
  // 通常已经完成（200-500ms）。完成前依靠 hydrateProcessPathSync 加的常见目录兜底。
  void hydrateProcessPathFromShell().catch((e) => console.warn('[main] hydrate shell PATH failed:', e))

  await askpassServer.start()
  await ensureAskpassHelper()
  await ensureCachedAskpassHelper()
  await previewServer.start()

  // 剪页插件 capture server（127.0.0.1:9527→9531）。绑不到端口不致命，
  // 用户下次可以在 Settings 手动重启 App；这里只 warn 不抛。
  const bound = await captureServer.start().catch((e) => {
    console.warn('[main] capture server failed to start:', e)
    return null
  })
  if (bound) console.log('[main] capture server bound at 127.0.0.1:' + bound.port)
  else console.warn('[main] capture server did not bind any port (9527-9531 all busy?)')

  // Chrome 插件资源拷贝到 ~/Documents/workspace-extension/，best-effort
  void ensureExtensionInstalled().catch((e) => console.warn('[main] ensureExtensionInstalled failed:', e))

  registerAllIpcHandlers()
  startAutoRefresh()
  startBackgroundFetch()
  // 把上次进程死掉时仍在 running / waiting 的 AI 任务标 aborted，避免灵动岛显示僵尸
  void sweepStaleAiTasks().then((r) => {
    if (r.swept > 0) console.log(`[main] swept ${r.swept} stale AI task(s) → aborted`)
  }).catch((e) => console.warn('[main] sweep stale AI tasks failed:', e))
  createMainWindow()
  createAiTaskNotchWindow()

  // macOS: 灵动岛窗口是 focusable:false + showInactive()，会让进程停留在 accessory
  // 激活态、Dock 不显示图标。这里显式 dock.show() 把进程拉回 regular 应用，确保
  // 启动后 Dock 出现图标。
  showMacDockIcon()

  app.on('activate', () => {
    // 点击 Dock 图标重新激活时同样要确保 Dock 图标可见（防御 accessory 退化的边界场景）。
    showMacDockIcon()
    focusMainWindow()
  })
})

app.on('render-process-gone', (_event, webContents, details) => {
  diagnostics.error('app.renderer.gone', new Error(`Renderer process ${details.reason}`), {
    processId: webContents.getOSProcessId(),
    reason: details.reason,
    exitCode: details.exitCode
  })
})

app.on('child-process-gone', (_event, details) => {
  diagnostics.error('app.child_process.gone', new Error(`Child process ${details.type} ${details.reason}`), {
    eventType: details.type,
    name: details.name ?? details.serviceName ?? details.type,
    reason: details.reason,
    exitCode: details.exitCode
  })
})

// 启动时打印当前 git 决议结果，方便验证"是否真的用了 bundled git"。
// 路径含 dugite/ 且版本不带 (Apple Git ...) 才算 bundled 生效。
function logGitResolution(): void {
  const path = resolveGitBinary()
  let version = 'NOT FOUND'
  if (path) {
    try {
      version = execFileSync(path, ['--version'], {
        env: { ...process.env, ...resolveGitEnv() },
        encoding: 'utf-8',
      }).trim()
    } catch (e) {
      version = `ERROR: ${(e as Error).message}`
    }
  }
  console.log('[git] path =', path, '| bundled =', isBundled(), '| version =', version)
}

app.on('second-instance', () => {
  focusMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitInProgress = false
app.on('before-quit', (event) => {
  if (quitInProgress) return
  event.preventDefault()
  quitInProgress = true
  void (async () => {
    // 灵动岛窗口是 screen-saver 级、setVisibleOnAllWorkspaces 且 focusable:false，
    // 正常销毁流程里它会最后才被清理，导致退出期间它继续浮在屏幕顶部（看起来像
    // 菜单栏"还在"）。先把它 destroy 掉，避免视觉残留。
    const notch = aiTaskNotchWindow
    if (notch && !notch.isDestroyed()) {
      try { notch.destroy() } catch { /* 忽略销毁失败 */ }
    }
    // 关闭时只 commit 落盘；push 留给下次启动的 saga resume。
    try { await flushBeforeQuit() } catch (e) { console.warn('[main] flushBeforeQuit failed:', e) }
    unbindAllAutoSave()
    killAllTtys()
    cleanupClaudeResources()
    await Promise.allSettled([projectWatcher.stopAll(), askpassServer.stop(), previewServer.stop(), captureServer.stop()])
    stopAutoRefresh()
    stopBackgroundFetch()
    app.quit()
  })()
})
