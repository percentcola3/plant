// 对话回合状态的小工具：计时器 + 状态词轮换 + 跳点
// 词轮换避免长时间静止感；纯函数 pickRotatingLabel / formatElapsed 便于单测。
import { ref, watch, onBeforeUnmount, type Ref } from 'vue'

export const ROTATING_LABELS = ['思考中', '处理中', '分析中', '工作中', '推理中', '推敲中'] as const

export function pickRotatingLabel(seconds: number): string {
  const idx = Math.floor(Math.max(0, seconds) / 3) % ROTATING_LABELS.length
  return ROTATING_LABELS[idx]
}

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return m === 0 ? `${r}s` : `${m}m ${r.toString().padStart(2, '0')}s`
}

export function useTurnTicker(isLoading: Ref<boolean>) {
  const elapsedSeconds = ref(0)
  const dots = ref('')
  const rotatingLabel = ref<string>(ROTATING_LABELS[0])

  let secTimer: ReturnType<typeof setInterval> | null = null
  let dotTimer: ReturnType<typeof setInterval> | null = null

  function clear(): void {
    if (secTimer) { clearInterval(secTimer); secTimer = null }
    if (dotTimer) { clearInterval(dotTimer); dotTimer = null }
  }

  function start(): void {
    clear()
    elapsedSeconds.value = 0
    dots.value = ''
    rotatingLabel.value = ROTATING_LABELS[0]
    const startMs = Date.now()
    secTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - startMs) / 1000)
      elapsedSeconds.value = sec
      rotatingLabel.value = pickRotatingLabel(sec)
    }, 1000)
    dotTimer = setInterval(() => {
      dots.value = dots.value.length >= 3 ? '' : dots.value + '.'
    }, 500)
  }

  watch(isLoading, (v) => { v ? start() : clear() }, { immediate: true })
  onBeforeUnmount(clear)

  return { elapsedSeconds, dots, rotatingLabel }
}
