// 为 AI 面板对话（claude --print）生成 zg 检索 MCP 配置。
//
// 形态：claude 的 --mcp-config JSON 文件，内含一个 stdio MCP server：
//   zg server --stdio（Electron-as-Node 运行）
// 该 stdio 代理会自动启动/复用 zg 共享 daemon（仅回环地址），客户端断开后
// daemon 保持常驻，后续 turn 毫秒级复用。claude 在对话中可调用
// mcp__zvec-grep__zvec_grep_search，通过 root 参数检索任意绝对路径——
// 包括项目根与知识库资源池（userData/external-pool/<id>）。
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { join } from 'node:path'
import { isZgAvailable, resolveZgScript } from './zg-runtime'

export const ZG_MCP_SEARCH_TOOL = 'mcp__zvec-grep__zvec_grep_search'

export function buildZgMcpConfig(zgScript: string, execPath: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        'zvec-grep': {
          command: execPath,
          args: [zgScript, 'server', '--stdio'],
          env: {
            ELECTRON_RUN_AS_NODE: '1'
          }
        }
      }
    },
    null,
    2
  )
}

function zgMcpConfigPath(): string {
  return join(app.getPath('userData'), 'zg-mcp.json')
}

// 同步探测配置文件是否已生成（TUI spawn 等同步链路用；文件由启动时的
// ensureZgMcpConfig 预生成，正常路径下总是存在）。
export function existingZgMcpConfigPath(): string | null {
  try {
    return existsSync(zgMcpConfigPath()) ? zgMcpConfigPath() : null
  } catch {
    return null
  }
}

// 幂等写入 MCP 配置，返回文件路径；zg 不可用时返回 null。
// 内容与上次一致则跳过写盘（避免每 turn 无谓 IO）。
export async function ensureZgMcpConfig(): Promise<string | null> {
  if (!isZgAvailable()) return null
  const script = resolveZgScript()
  if (!script) return null
  const content = buildZgMcpConfig(script, process.execPath)
  const path = zgMcpConfigPath()
  try {
    const current = await fs.readFile(path, 'utf-8')
    if (current === content) return path
  } catch {
    // 首次写入
  }
  await fs.writeFile(path, content, 'utf-8')
  return path
}
