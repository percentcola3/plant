// 由 preload contextBridge 暴露的全局对象。
// 真正调用应走 @/lib/api 里的 call()，它有完整类型推导；这里只声明运行时存在性。

declare interface Window {
  readonly api: Record<string, (input: unknown) => Promise<unknown>>
  readonly events: {
    on(channel: string, listener: (...args: unknown[]) => void): () => void
  }
}
