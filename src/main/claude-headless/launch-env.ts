// 构造 spawn claude 时的 PATH：把 node 二进制目录 + claude 二进制目录 +
// 用户工具链目录合并进去，解决 GUI 启动 PATH 不全导致 claude 子孙进程 ENOENT 的问题。
//
// 背景：打包后从 Dock/Finder 启动时 process.env.PATH 常缺失 ~/.npm-global、
// /opt/homebrew/bin 等。findClaudePath 的三级兜底能找到 claude 本身的绝对路径，
// 但 claude 起的子进程（MCP server via `#!/usr/bin/env node`、bash 脚本）仍可能
// 因 PATH 不全而 ENOENT。把 node 目录 + claude 目录 + 常见工具链目录塞进 PATH，
// 覆盖这类 shebang 解释器找不到的场景。
//
// 对标 open-design launch.ts:applyAgentLaunchEnv。
import { delimiter, dirname } from 'node:path'
import { homedir } from 'node:os'

const USER_TOOLCHAIN_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  `${homedir()}/.npm-global/bin`,
  `${homedir()}/.bun/bin`,
  `${homedir()}/.local/bin`
  // nvm/fnm/mise 的目录是动态的（按 node 版本切换），v1 先不扫。
  // findCommandSync 的 shell probe 已兜底找到 claude 本身。
].filter((d): d is string => Boolean(d))

export function buildSpawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  claudeBinPath: string
): NodeJS.ProcessEnv {
  // prepend：node 二进制目录（npm .cmd shim 调 node 需要）+ claude 所在目录
  const toPrepend = [
    dirname(process.execPath),
    dirname(claudeBinPath)
  ].filter((d): d is string => Boolean(d))

  if (toPrepend.length === 0 && USER_TOOLCHAIN_DIRS.length === 0) return { ...baseEnv }

  // 大小写不敏感查找 PATH key —— Windows 用 'Path' 不是 'PATH'。
  // 直接读 env.PATH 在 Windows 会 undefined，丢掉所有系统路径。
  const pathKey = Object.keys(baseEnv).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  const existing = typeof baseEnv[pathKey] === 'string'
    ? (baseEnv[pathKey] as string).split(delimiter).filter((e) => e.length > 0)
    : []

  // 去重合并：prepend 在前 → existing 居中 → userToolchain 垫后
  const normalize = (p: string): string => {
    const trimmed = p.replace(/[/\\]+$/, '')
    return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
  }
  const seen = new Set<string>()
  const merged: string[] = []
  for (const entry of [...toPrepend, ...existing, ...USER_TOOLCHAIN_DIRS]) {
    const n = normalize(entry)
    if (seen.has(n)) continue
    seen.add(n)
    merged.push(entry)
  }

  return { ...baseEnv, [pathKey]: merged.join(delimiter) }
}
