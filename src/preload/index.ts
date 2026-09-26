import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_PREFIXES, IPC_CHANNELS } from '@shared/ipc-contract'

// 请求/响应式 IPC（renderer → main → 返回值）
const api = Object.fromEntries(
  IPC_CHANNELS.map((channel) => [channel, (input: unknown) => ipcRenderer.invoke(channel, input)])
) as Record<string, (input: unknown) => Promise<unknown>>

// 事件订阅式（main → renderer 推送）。channel 名经白名单前缀校验，
// renderer 不能监听任意 ipcRenderer 事件。
const events = {
  on(channel: string, listener: (...args: unknown[]) => void): () => void {
    const allowed = EVENT_PREFIXES.some((prefix) => channel.startsWith(prefix))
    if (!allowed) {
      console.warn(`[events] subscription to non-whitelisted channel rejected: ${channel}`)
      return () => {}
    }
    const wrapped = (_e: IpcRendererEvent, ...args: unknown[]) => listener(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

if (!process.contextIsolated) {
  // contextIsolation: true 是必须的；这里走到说明配置错了
  throw new Error('preload requires contextIsolation enabled')
}

try {
  contextBridge.exposeInMainWorld('api', api)
  contextBridge.exposeInMainWorld('events', events)
} catch (err) {
  console.error('preload: contextBridge.exposeInMainWorld failed', err)
}

export type Api = typeof api
export type Events = typeof events
