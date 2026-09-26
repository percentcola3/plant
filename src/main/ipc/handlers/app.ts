import { app } from 'electron'
import { registerIpcHandler } from '../registry'
import { UIClientError } from '../errors'

export function registerAppHandlers(): void {
  registerIpcHandler('app.ping', async ({ msg }) => {
    if (typeof msg !== 'string') {
      throw new UIClientError('VALIDATION', 'msg must be a string')
    }
    return { pong: msg, receivedAt: Date.now() }
  })

  registerIpcHandler('app.version', async () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown'
  }))
}
