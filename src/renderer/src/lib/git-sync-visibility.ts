export type SyncVisibilityStatus = {
  isDirty: boolean
  hasRemote: boolean
  ahead: number
  behind: number
  mainlineBehind: number
}

export function shouldShowRemoteSyncButton(status: Pick<SyncVisibilityStatus, 'isDirty' | 'hasRemote' | 'ahead' | 'behind'> | null | undefined): boolean {
  if (!status) return false
  if (!status.hasRemote) return false
  return status.isDirty || status.ahead > 0 || status.behind > 0
}

export function shouldShowMainlineSyncButton(status: Pick<SyncVisibilityStatus, 'mainlineBehind'> | null | undefined): boolean {
  if (!status) return false
  return status.mainlineBehind > 0
}
