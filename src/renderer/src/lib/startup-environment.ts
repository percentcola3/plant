import type { IpcContract } from '@shared/ipc-contract'

type EnvironmentCheckResult = IpcContract['setup.checkEnv']['output']

export type StartupEnvironmentNotice = {
  title: string
  severity: 'blocking' | 'recommendation'
  items: string[]
  primaryActionKind?: 'settings'
  primaryActionLabel?: string
}

// 启动 splash 期间只关心两件事：
// 1. bundled git 是否就绪（极端情况：DMG 损坏）
// 2. git user.email 是否配（HTTPS clone 凭证匹配 / commit author 都要它）
// claude / cursor / vscode 改成 lazy + 后台检测，不在这里 block。
export function buildStartupEnvironmentNotice(
  result: EnvironmentCheckResult
): StartupEnvironmentNotice | null {
  const items: string[] = []
  let severity: StartupEnvironmentNotice['severity'] = 'recommendation'

  if (!result.gitBinaryReady) {
    items.push('App 内置 Git 组件不可用。请尝试重装 Plant；或先在系统装一份 git 兜底，重启 App 即可。')
    severity = 'blocking'
  }
  if (!result.gitUser.configured) {
    items.push('未配置用户身份邮箱。请先配置企业邮箱，后续权限管理、操作追踪和 HTTPS Git 认证都会使用它。')
    if (severity !== 'blocking') severity = 'blocking'
  }

  if (items.length === 0) return null

  const canConfigureIdentity = result.gitBinaryReady
  const primaryActionKind: StartupEnvironmentNotice['primaryActionKind'] =
    !result.gitUser.configured && canConfigureIdentity ? 'settings' : undefined
  const primaryActionLabel = primaryActionKind === 'settings' ? '去配置身份' : undefined

  return {
    title: severity === 'blocking' ? '环境未就绪' : '环境提示',
    severity,
    items,
    primaryActionKind,
    primaryActionLabel
  }
}
