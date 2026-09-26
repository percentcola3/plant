import { BrowserWindow } from 'electron'
import { registerIpcHandler } from '../registry'
import { UIClientError } from '../errors'
import { createTty, killTty, resizeTty, writeTty, wrapClaudeArgs } from '../../pty/manager'
import { WorkspacesStore } from '../../workspaces/store'
import { readActiveWorkArea } from '../../workspaces/work-area'
import { resolveClaudeLaunchContext } from '../../claude-headless/launch-context'
import { getClaudeCapabilitiesSync } from '../../claude-headless/capability-probe'
import { existingZgMcpConfigPath } from '../../zg/zg-mcp'

const store = new WorkspacesStore()

export function registerTerminalHandlers(): void {
  registerIpcHandler('terminal.create', async (input) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) {
      throw new UIClientError('NO_WINDOW', '没有可用的窗口承接 PTY 输出')
    }
    // 默认 cwd 优先级：input.cwd > activeWorkArea > 激活项目根。
    // TUI 与 UI/headless 共用同一套 cwd-lock 语义。
    let cwd = input.cwd
    let defaultArgs: string[] | undefined
    if (!cwd) {
      const activeId = await store.activeId()
      if (activeId) {
        const p = await store.findById(activeId)
        if (p) {
          const launch = resolveClaudeLaunchContext(p.path, await readActiveWorkArea(p.path))
          cwd = launch.workDir
          const caps = getClaudeCapabilitiesSync()
          if (caps.addDir && launch.addDirs.length > 0) {
            // dcc 时自动加 '--' 透传给底层 claude
            defaultArgs = wrapClaudeArgs(['--add-dir', ...launch.addDirs])
          }
          // TUI 模式同样挂 zg 检索 MCP（等价 `zg install --target claude` 的效果，
          // 但只作用于 App 拉起的会话，不碰用户全局 ~/.claude.json）
          const mcpConfig = existingZgMcpConfigPath()
          if (mcpConfig && caps.mcpConfig) {
            const mcpArgs = ['--mcp-config', mcpConfig]
            defaultArgs = defaultArgs
              ? [...defaultArgs, ...mcpArgs]
              : wrapClaudeArgs(mcpArgs)
          }
        }
      }
    }
    const ttyId = createTty({
      shell: input.shell,
      args: input.args,
      defaultArgs,
      cwd,
      cols: input.cols,
      rows: input.rows,
      ownerWindowId: win.id
    })
    return { ttyId }
  })

  registerIpcHandler('terminal.write', async ({ ttyId, data }) => {
    writeTty(ttyId, data)
  })

  registerIpcHandler('terminal.resize', async ({ ttyId, cols, rows }) => {
    resizeTty(ttyId, cols, rows)
  })

  registerIpcHandler('terminal.kill', async ({ ttyId }) => {
    killTty(ttyId)
  })
}
