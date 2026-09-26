import { gitFor } from './client'
import { UIClientError } from '../ipc/errors'

export type GitUser = { name: string; email: string }

// 写全局 git 身份。任意一项为空字符串 → 跳过该项；两项都空 → 抛错。
// 不在仓库内也能跑（操作 --global），cwd 可省。
export async function setGlobalGitUser(input: { name?: string; email?: string }): Promise<void> {
  const name = (input.name ?? '').trim()
  const email = (input.email ?? '').trim()
  if (!name && !email) {
    throw new UIClientError('VALIDATION', '至少需要提供 name 或 email')
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new UIClientError('VALIDATION', `邮箱格式不合法：${email}`)
  }
  const sg = gitFor(process.cwd())
  if (name) await sg.raw(['config', '--global', 'user.name', name])
  if (email) await sg.raw(['config', '--global', 'user.email', email])
}

// 读取 git 用户身份。优先 cwd 局部 (`git config user.name` 在仓库内），
// 回落到全局 (`git config --global ...`)。任意一项缺省返回空字符串，由调用方决定
// 怎么提示——不抛错，因为新用户首次安装时局部 + 全局可能都没设。
export async function readLocalGitUser(cwd?: string): Promise<GitUser> {
  const sg = gitFor(cwd ?? process.cwd())
  const safe = async (key: string): Promise<string> => {
    try {
      // local（cwd 是 git 仓库时）→ global → 拿到一个就返回
      const local = (await sg.raw(['config', '--get', key])).trim()
      if (local) return local
    } catch { /* not in repo or not set */ }
    try {
      const global = (await sg.raw(['config', '--global', '--get', key])).trim()
      if (global) return global
    } catch { /* not set */ }
    return ''
  }
  const [name, email] = await Promise.all([safe('user.name'), safe('user.email')])
  return { name, email }
}

// 把任意字符串转成合法 git ref 片段。规则取自 git-check-ref-format：
// - 不允许空格、~ ^ : ? * [ \ 等
// - 不能以 - 开头、不能含 ..、不能以 . 结尾
// 失败时回落到 'work'。
export function sanitizeBranchSegment(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[\s~^:?*\[\\]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^[-./]+|[-./]+$/g, '')
  return cleaned || 'work'
}

// 校验完整分支名是否符合 git 规则。renderer 提交前先用，main 入口会再校验一次。
export function isValidBranchName(name: string): boolean {
  if (!name || name.length > 200) return false
  if (/[\s~^:?*\[\\]/.test(name)) return false
  if (name.includes('..')) return false
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false
  return true
}
