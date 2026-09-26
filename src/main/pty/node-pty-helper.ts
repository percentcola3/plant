import { chmodSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

function toUnpackedAsarPath(path: string): string {
  return path.replace(/app\.asar(?=\/|$)/, 'app.asar.unpacked')
}

export function nodePtySpawnHelperCandidates(
  nodePtyEntryPath = require.resolve('node-pty'),
  platform = process.platform,
  arch = process.arch
): string[] {
  const packageRoot = dirname(dirname(nodePtyEntryPath))
  const paths = [
    join(packageRoot, 'build', 'Release', 'spawn-helper'),
    join(packageRoot, 'prebuilds', `${platform}-${arch}`, 'spawn-helper')
  ]
  return paths.map(toUnpackedAsarPath)
}

export function ensureExecutableBit(filePath: string): boolean {
  if (!existsSync(filePath)) return false

  const stat = statSync(filePath)
  if ((stat.mode & 0o111) === 0o111) return false

  chmodSync(filePath, stat.mode | 0o111)
  return true
}

export function ensureNodePtySpawnHelpersExecutable(): void {
  if (process.platform === 'win32') return

  for (const helper of nodePtySpawnHelperCandidates()) {
    try {
      ensureExecutableBit(helper)
    } catch (error) {
      console.warn('[pty] failed to chmod node-pty spawn-helper:', helper, error)
    }
  }
}
