export function normalizeGitRelPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^"(.*)"$/, '$1')
    .normalize('NFC')
}

export function stripRelDir(relDir: string): string {
  return normalizeGitRelPath(relDir).replace(/\/+$/, '')
}

export function isPathInsideRelDir(path: string, relDir: string): boolean {
  const filePath = normalizeGitRelPath(path)
  const dir = stripRelDir(relDir)
  return filePath === dir || filePath.startsWith(`${dir}/`)
}
