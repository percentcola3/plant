import type { Workspace, WorkspaceScanResult } from '@shared/types'

export const FIXED_UX_SPACE_SLUG = 'ux-shared'

/** outputs/ 工作台模型：不再向用户暴露 space 切换与管理。 */
export function isOutputsFirstUxProject(
  workspace: Pick<Workspace, 'kind' | 'name'> | null | undefined,
  _scan?: WorkspaceScanResult | null
): boolean {
  return workspace?.kind === 'ux'
}

/** UX Git 项目统一激活共享的 space/ux-shared。 */
export function fixedUxSpaceSlug(
  workspace: Pick<Workspace, 'kind' | 'name'> | null | undefined,
  _scan?: WorkspaceScanResult | null
): string | null {
  return isOutputsFirstUxProject(workspace) ? FIXED_UX_SPACE_SLUG : null
}
