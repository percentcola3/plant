// renderer 侧统一调用入口。所有 IPC 都走这里，永远拿到 IpcResult。
//
// 用法：
//   const r = await call('app.ping', { msg: 'hi' })
//   if (r.ok) console.log(r.data.pong)
//   else      toast(r.message)

import type { IpcChannel, IpcContract, IpcResult } from '@shared/ipc-contract'

type Awaitable<T> = T | Promise<T>

export function call<K extends IpcChannel>(
  channel: K,
  input: IpcContract[K]['input']
): Promise<IpcResult<IpcContract[K]['output']>> {
  if (!window.api) {
    return Promise.resolve({
      ok: false,
      code: 'PRELOAD_MISSING',
      message: 'window.api 未注入：preload 未加载或 contextBridge 失败'
    })
  }
  const fn = window.api[channel]
  if (typeof fn !== 'function') {
    return Promise.resolve({
      ok: false,
      code: 'BRIDGE_MISSING',
      message: `IPC channel "${channel}" 未在 preload 暴露`
    })
  }
  return fn(input as unknown).catch((err: unknown) => ({
    ok: false as const,
    code: 'INVOKE_THREW',
    message: err instanceof Error ? err.message : String(err)
  })) as Awaitable<IpcResult<IpcContract[K]['output']>> as Promise<
    IpcResult<IpcContract[K]['output']>
  >
}
