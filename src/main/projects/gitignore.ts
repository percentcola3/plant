// 幂等地把一行加入 .gitignore：文件不存在则创建；存在但不含该行则追加；含则 no-op。
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export async function ensureGitignoreEntry(projectPath: string, entry: string): Promise<void> {
  const path = join(projectPath, '.gitignore')
  let current = ''
  try {
    current = await fs.readFile(path, 'utf-8')
  } catch {
    current = ''
  }
  const lines = current ? current.replace(/\s+$/, '').split('\n') : []
  if (lines.includes(entry)) return
  lines.push(entry)
  await fs.writeFile(path, lines.filter(Boolean).join('\n') + '\n', 'utf-8')
}
