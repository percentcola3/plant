let transition: Promise<void> = Promise.resolve()

// 根 Git workspace、内部项目监听范围和删除必须按主进程收到的顺序执行。
export function enqueueWorkspaceScopeTransition(operation: () => Promise<void>): Promise<void> {
  const result = transition.then(operation, operation)
  transition = result.catch(() => undefined)
  return result
}
