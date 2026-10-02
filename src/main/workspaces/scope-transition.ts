let transition: Promise<void> = Promise.resolve()

// 根 Git workspace、内部项目监听范围和删除必须按主进程收到的顺序执行。
export function enqueueWorkspaceScopeTransition<T>(operation: () => Promise<T>): Promise<T> {
  const result = transition.then(operation, operation)
  transition = result.then(() => undefined, () => undefined)
  return result
}
