import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS, type IpcChannel, type IpcContract, type IpcResult } from '@shared/ipc-contract'
import { serializeError } from './errors'
import { diagnostics } from '../diagnostics/runtime'

type Handler<K extends IpcChannel> = (
  input: IpcContract[K]['input'], event: IpcMainInvokeEvent
) => Promise<IpcContract[K]['output']> | IpcContract[K]['output']

// 已注册的 channel；启动末尾会校验它与 IPC_CHANNELS 一一对应。
const registered = new Set<IpcChannel>()

export function registerIpcHandler<K extends IpcChannel>(
  channel: K,
  handler: Handler<K>
): void {
  if (registered.has(channel)) {
    throw new Error(`IPC channel "${channel}" registered twice`)
  }
  registered.add(channel)

  ipcMain.handle(channel, async (_event, input: IpcContract[K]['input']) => {
    try {
      const data = await handler(input, _event)
      return { ok: true, data } as IpcResult<IpcContract[K]['output']>
    } catch (err) {
      const e = serializeError(err)
      console.error(`[ipc] ${channel} failed:`, e)
      diagnostics.error('ipc.handler.failed', err, { name: channel, code: e.code })
      return { ok: false, ...e } as IpcResult<IpcContract[K]['output']>
    }
  })
}

// 启动末尾调用，确认所有 IPC_CHANNELS 都被注册了；否则 preload bridge 会暴露空 channel。
export function assertAllChannelsRegistered(): void {
  const missing = IPC_CHANNELS.filter((c) => !registered.has(c))
  if (missing.length > 0) {
    throw new Error(`IPC channels declared but not registered: ${missing.join(', ')}`)
  }
}
