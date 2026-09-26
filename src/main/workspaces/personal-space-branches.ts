import { gitFor } from '../git/client'

// personal-space 模型在 git 层的视图：列举 space/* 分支（本地 + origin 追踪 ref）。
// .ui-client/personal-space.json 是本地私有 meta（gitignored），同事在远端创建的
// space/* 分支只能通过 origin/space/* refs 发现，因此 list 必须以 git 分支为权威，
// meta 仅用于补齐 createdAt / fromBranch 等本地侧记录过的元信息。

export const SPACE_BRANCH_PREFIX = 'space/'

export async function listSpaceBranchSlugs(workspacePath: string): Promise<string[]> {
  const sg = gitFor(workspacePath)
  const slugs = new Set<string>()
  try {
    const local = await sg.branchLocal()
    for (const b of local.all) {
      if (b.startsWith(SPACE_BRANCH_PREFIX)) slugs.add(b.slice(SPACE_BRANCH_PREFIX.length))
    }
  } catch { /* 非 git 仓库等异常 → 视为无本地分支 */ }
  try {
    const raw = await sg.raw([
      'for-each-ref',
      `refs/remotes/origin/${SPACE_BRANCH_PREFIX}*`,
      '--format=%(refname:short)'
    ])
    for (const line of raw.split('\n')) {
      const m = line.trim().match(/^origin\/space\/(.+)$/)
      if (m) slugs.add(m[1])
    }
  } catch { /* 没有远端或网络不通也无所谓，本地侧仍可展示 */ }
  return Array.from(slugs).sort()
}

// origin 上是否存在指定 space 分支。switch 时本地无 tracking 但远端有就 checkout -b 建一条。
export async function hasRemoteSpaceBranch(workspacePath: string, branch: string): Promise<boolean> {
  const sg = gitFor(workspacePath)
  return sg.raw(['show-ref', '--verify', `refs/remotes/origin/${branch}`])
    .then(() => true)
    .catch(() => false)
}
