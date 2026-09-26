import { shell } from 'electron'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { registerIpcHandler } from '../registry'
import { ensureExtensionInstalled, extensionDestDir } from '../../raw/extension-installer'

// 暴露 "剪页插件配置引导" 入口：信息查询 + 在 Finder 打开 + 唤起 Chrome 的扩展页。
// 真正的剪页内容捕获走的是 main/raw/server.ts 的 capture HTTP server（127.0.0.1:9527-9531），
// 不走 IPC，所以这里看不到。保存成功后 main → renderer 推 raw.captured 事件弹 toast。

export function registerRawHandlers(): void {
  registerIpcHandler('raw.extensionInfo', async () => {
    // 每次查询都重新 ensure 一次：用户卸载/换版本后能自动恢复
    const r = await ensureExtensionInstalled()
    return {
      destDir: r.destDir,
      version: r.version,
      installed: r.installed,
      error: r.error
    }
  })

  registerIpcHandler('raw.revealExtensionDir', async () => {
    // showItemInFolder 需要选中一个真实文件；选 manifest.json
    shell.showItemInFolder(join(extensionDestDir(), 'manifest.json'))
  })

  registerIpcHandler('raw.openChromeExtensions', async () => {
    // mac 上 shell.openExternal('chrome://...') 走 LaunchServices，没有 App 注册 chrome:// 协议会报
    // 'No application in the Launch Services database matches'。改成显式启动 Chrome 处理这个 URL。
    const url = 'chrome://extensions/'
    try {
      if (process.platform === 'darwin') {
        await new Promise<void>((resolve, reject) => {
          const child = spawn('open', ['-a', 'Google Chrome', url], { stdio: 'ignore', detached: true })
          child.on('error', reject)
          child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`open exited ${code}`)))
        })
        return
      }
      if (process.platform === 'win32') {
        await new Promise<void>((resolve, reject) => {
          const child = spawn('cmd', ['/c', 'start', '', 'chrome', url], { stdio: 'ignore', detached: true })
          child.on('error', reject)
          child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`start exited ${code}`)))
        })
        return
      }
      // linux: 尝试 google-chrome / chromium
      const candidates = ['google-chrome', 'chromium', 'chromium-browser']
      let lastErr: Error | null = null
      for (const cmd of candidates) {
        try {
          await new Promise<void>((resolve, reject) => {
            const child = spawn(cmd, [url], { stdio: 'ignore', detached: true })
            child.on('error', reject)
            child.on('spawn', () => resolve())
          })
          return
        } catch (e) {
          lastErr = e as Error
        }
      }
      if (lastErr) throw lastErr
    } catch (e) {
      // 全 fallback：让系统选择默认浏览器
      void shell.openExternal(url).catch(() => undefined)
      console.warn('[raw] openChromeExtensions fell back to openExternal:', (e as Error).message)
    }
  })
}
