<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SketchArrow, SketchItem, SketchPoint, SketchRect, SketchStroke, SketchText } from '@/lib/preview/sketch-model'
import { Button } from '@/components/ui/button'

// 文本工具暂下线（输入/选中/缩放体验问题较多），后续重做时再恢复。
// 已有的 text 对象仍能被读取和渲染，保留旧草稿不丢。
type Tool = 'pen' | 'rect' | 'arrow' | 'eraser'

const props = withDefaults(defineProps<{
  modelValue: SketchItem[]
  fileName: string
  dirty?: boolean
  saving?: boolean
  showBack?: boolean
}>(), {
  dirty: false,
  saving: false,
  showBack: false
})

const emit = defineEmits<{
  'update:modelValue': [value: SketchItem[]]
  back: []
  save: []
  clear: []
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const activeTool = ref<Tool>('pen')
const strokeColor = ref('#ffffff')
const strokeSize = ref(3)
const draftItem = ref<SketchItem | null>(null)
const zoom = ref(1)
const pan = ref<SketchPoint>({ x: 0, y: 0 })
let resizeObserver: ResizeObserver | null = null
let drawingPointerId: number | null = null
const activePointers = new Map<number, SketchPoint>()
let pinchStart: { distance: number; scale: number; center: SketchPoint; pan: SketchPoint } | null = null

const toolOptions: Array<{ value: Tool; label: string; title: string }> = [
  { value: 'pen', label: '画笔', title: '自由画笔' },
  { value: 'rect', label: '方框', title: '拖拽画方框' },
  { value: 'arrow', label: '→', title: '箭头' },
  { value: 'eraser', label: '擦除', title: '擦除对象' }
]

const itemCountLabel = computed(() => `${props.modelValue.length} 个对象`)
const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`)

function screenPoint(event: PointerEvent): SketchPoint {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  }
}

function screenToWorld(point: SketchPoint, scale = zoom.value, offset = pan.value): SketchPoint {
  return {
    x: (point.x - offset.x) / scale,
    y: (point.y - offset.y) / scale
  }
}

function canvasPoint(event: PointerEvent): SketchPoint {
  return screenToWorld(screenPoint(event))
}

function updateItems(items: SketchItem[]): void {
  emit('update:modelValue', items)
  void nextTick(draw)
}

function clampZoom(value: number): number {
  return Math.min(3, Math.max(0.25, value))
}

function twoPointerSnapshot(): { a: SketchPoint; b: SketchPoint; center: SketchPoint; distance: number } | null {
  const points = [...activePointers.values()]
  if (points.length < 2) return null
  const [a, b] = points
  return {
    a,
    b,
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    distance: distance(a, b)
  }
}

function beginPinch(): void {
  const snapshot = twoPointerSnapshot()
  if (!snapshot) return
  draftItem.value = null
  drawingPointerId = null
  pinchStart = {
    distance: Math.max(1, snapshot.distance),
    scale: zoom.value,
    center: snapshot.center,
    pan: { ...pan.value }
  }
}

function updatePinch(): void {
  const snapshot = twoPointerSnapshot()
  if (!snapshot || !pinchStart) return
  const nextZoom = clampZoom(pinchStart.scale * (snapshot.distance / pinchStart.distance))
  const anchor = screenToWorld(pinchStart.center, pinchStart.scale, pinchStart.pan)
  pan.value = {
    x: snapshot.center.x - anchor.x * nextZoom,
    y: snapshot.center.y - anchor.y * nextZoom
  }
  zoom.value = nextZoom
  draw()
}

function setZoomAround(screen: SketchPoint, nextScale: number): void {
  const nextZoom = clampZoom(nextScale)
  const anchor = screenToWorld(screen)
  pan.value = {
    x: screen.x - anchor.x * nextZoom,
    y: screen.y - anchor.y * nextZoom
  }
  zoom.value = nextZoom
  draw()
}

function onCanvasWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  setZoomAround(
    { x: event.clientX - rect.left, y: event.clientY - rect.top },
    zoom.value * Math.exp(-event.deltaY / 260)
  )
}

function resetView(): void {
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
  draw()
}

function onPointerDown(event: PointerEvent): void {
  const canvas = canvasRef.value
  if (!canvas) return
  activePointers.set(event.pointerId, screenPoint(event))
  canvas.setPointerCapture(event.pointerId)
  if (activePointers.size >= 2) {
    beginPinch()
    return
  }
  const point = canvasPoint(event)
  if (activeTool.value === 'eraser') {
    eraseAt(point)
    return
  }

  drawingPointerId = event.pointerId
  if (activeTool.value === 'pen') {
    draftItem.value = {
      kind: 'pen',
      points: [point],
      color: strokeColor.value,
      size: strokeSize.value
    }
  } else if (activeTool.value === 'rect') {
    draftItem.value = {
      kind: 'rect',
      x: point.x,
      y: point.y,
      w: 0,
      h: 0,
      color: strokeColor.value,
      size: strokeSize.value
    }
  } else {
    draftItem.value = {
      kind: 'arrow',
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y,
      color: strokeColor.value,
      size: strokeSize.value
    }
  }
  draw()
}

function onPointerMove(event: PointerEvent): void {
  if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, screenPoint(event))
  if (pinchStart && activePointers.size >= 2) {
    updatePinch()
    return
  }
  if (drawingPointerId !== event.pointerId || !draftItem.value) return
  const point = canvasPoint(event)
  const current = draftItem.value
  if (current.kind === 'pen') {
    current.points = [...current.points, point]
  } else if (current.kind === 'rect') {
    current.w = point.x - current.x
    current.h = point.y - current.y
  } else if (current.kind === 'arrow') {
    current.x2 = point.x
    current.y2 = point.y
  }
  draw()
}

function onPointerUp(event: PointerEvent): void {
  const canvas = canvasRef.value
  if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  activePointers.delete(event.pointerId)
  if (pinchStart) {
    if (activePointers.size < 2) pinchStart = null
    return
  }
  if (drawingPointerId !== event.pointerId || !draftItem.value) return
  const item = draftItem.value
  draftItem.value = null
  drawingPointerId = null
  if (!isMeaningfulItem(item)) {
    draw()
    return
  }
  updateItems([...props.modelValue, item])
}

function onPointerCancel(event: PointerEvent): void {
  const canvas = canvasRef.value
  if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  activePointers.delete(event.pointerId)
  if (pinchStart && activePointers.size < 2) pinchStart = null
  if (drawingPointerId !== event.pointerId) return
  draftItem.value = null
  drawingPointerId = null
  draw()
}

function eraseAt(point: SketchPoint): void {
  for (let i = props.modelValue.length - 1; i >= 0; i--) {
    if (!hitTest(props.modelValue[i], point)) continue
    updateItems(props.modelValue.filter((_, idx) => idx !== i))
    return
  }
}

function undo(): void {
  updateItems(props.modelValue.slice(0, -1))
}

function clear(): void {
  updateItems([])
  emit('clear')
}

function save(): void {
  emit('save')
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const width = Math.max(1, Math.floor(rect.width * dpr))
  const height = Math.max(1, Math.floor(rect.height * dpr))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, rect.width, rect.height)
  drawGrid(ctx, rect.width, rect.height)
  ctx.save()
  ctx.translate(pan.value.x, pan.value.y)
  ctx.scale(zoom.value, zoom.value)
  for (const item of props.modelValue) drawItem(ctx, item)
  if (draftItem.value) drawItem(ctx, draftItem.value)
  ctx.restore()
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save()
  ctx.fillStyle = '#181818'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(255,255,255,0.28)'
  const step = 24
  for (let x = 16; x < width; x += step) {
    for (let y = 16; y < height; y += step) {
      ctx.fillRect(x, y, 1.4, 1.4)
    }
  }
  ctx.restore()
}

function drawItem(ctx: CanvasRenderingContext2D, item: SketchItem): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = item.color
  ctx.fillStyle = item.color
  ctx.lineWidth = item.kind === 'text' ? 1 : item.size
  if (item.kind === 'pen') drawPen(ctx, item)
  else if (item.kind === 'rect') drawRect(ctx, item)
  else if (item.kind === 'arrow') drawArrow(ctx, item)
  else drawText(ctx, item)
  ctx.restore()
}

function drawPen(ctx: CanvasRenderingContext2D, item: SketchStroke): void {
  if (item.points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(item.points[0].x, item.points[0].y)
  for (const point of item.points.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.stroke()
}

function drawRect(ctx: CanvasRenderingContext2D, item: SketchRect): void {
  ctx.strokeRect(item.x, item.y, item.w, item.h)
}

function drawArrow(ctx: CanvasRenderingContext2D, item: SketchArrow): void {
  ctx.beginPath()
  ctx.moveTo(item.x1, item.y1)
  ctx.lineTo(item.x2, item.y2)
  ctx.stroke()
  const angle = Math.atan2(item.y2 - item.y1, item.x2 - item.x1)
  const head = Math.max(12, item.size * 5)
  ctx.beginPath()
  ctx.moveTo(item.x2, item.y2)
  ctx.lineTo(item.x2 - Math.cos(angle - Math.PI / 6) * head, item.y2 - Math.sin(angle - Math.PI / 6) * head)
  ctx.moveTo(item.x2, item.y2)
  ctx.lineTo(item.x2 - Math.cos(angle + Math.PI / 6) * head, item.y2 - Math.sin(angle + Math.PI / 6) * head)
  ctx.stroke()
}

function drawText(ctx: CanvasRenderingContext2D, item: SketchText): void {
  ctx.font = `${item.size}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(item.text, item.x, item.y)
}

function isMeaningfulItem(item: SketchItem): boolean {
  if (item.kind === 'pen') return item.points.length > 1 && pathLength(item.points) > 2
  if (item.kind === 'rect') return Math.abs(item.w) > 3 && Math.abs(item.h) > 3
  if (item.kind === 'arrow') return distance({ x: item.x1, y: item.y1 }, { x: item.x2, y: item.y2 }) > 5
  return item.text.trim().length > 0
}

function hitTest(item: SketchItem, point: SketchPoint): boolean {
  if (item.kind === 'pen') return item.points.some((p, idx) => idx > 0 && segmentDistance(item.points[idx - 1], p, point) <= Math.max(8, item.size + 4))
  if (item.kind === 'rect') {
    const left = Math.min(item.x, item.x + item.w)
    const right = Math.max(item.x, item.x + item.w)
    const top = Math.min(item.y, item.y + item.h)
    const bottom = Math.max(item.y, item.y + item.h)
    const nearEdge = point.x >= left - 8 && point.x <= right + 8 && point.y >= top - 8 && point.y <= bottom + 8
    const insideInset = point.x > left + 8 && point.x < right - 8 && point.y > top + 8 && point.y < bottom - 8
    return nearEdge && !insideInset
  }
  if (item.kind === 'arrow') {
    return segmentDistance({ x: item.x1, y: item.y1 }, { x: item.x2, y: item.y2 }, point) <= Math.max(8, item.size + 4)
  }
  const width = Math.max(item.size, item.text.length * item.size * 0.62)
  return point.x >= item.x - 4 && point.x <= item.x + width + 4 && point.y >= item.y - item.size - 4 && point.y <= item.y + 6
}

function pathLength(points: SketchPoint[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i])
  return total
}

function distance(a: SketchPoint, b: SketchPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function segmentDistance(a: SketchPoint, b: SketchPoint, p: SketchPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) return distance(a, p)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
  return distance({ x: a.x + dx * t, y: a.y + dy * t }, p)
}

onMounted(() => {
  if (canvasRef.value) {
    resizeObserver = new ResizeObserver(draw)
    resizeObserver.observe(canvasRef.value)
  }
  draw()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

watch(() => props.modelValue, () => { void nextTick(draw) }, { deep: true })
watch([strokeColor, strokeSize, activeTool], () => draw())
</script>

<template>
  <section class="sketch-editor">
    <div class="sketch-editor__toolbar">
      <Button v-if="showBack" type="button" variant="outline" size="sm" class="text-xxs" @click="emit('back')">返回预览</Button>
      <div class="sketch-editor__file">
        <div class="sketch-editor__name">{{ fileName }}</div>
        <div class="sketch-editor__meta">
          <span>{{ itemCountLabel }}</span>
          <span v-if="dirty" class="sketch-editor__dirty">未保存</span>
        </div>
      </div>

      <div class="sketch-editor__tools">
        <button
          v-for="tool in toolOptions"
          :key="tool.value"
          type="button"
          class="sketch-editor__tool"
          :class="{ 'is-active': activeTool === tool.value }"
          :title="tool.title"
          @click="activeTool = tool.value"
        >{{ tool.label }}</button>
      </div>

      <input v-model="strokeColor" class="sketch-editor__color" type="color" title="颜色">
      <input v-model.number="strokeSize" class="sketch-editor__range" type="range" min="1" max="12" step="1" title="线宽">
      <button type="button" class="sketch-editor__zoom" title="重置缩放" @click="resetView">{{ zoomLabel }}</button>

      <Button type="button" variant="outline" size="sm" class="text-xxs" :disabled="modelValue.length === 0" @click="undo">撤销</Button>
      <Button type="button" variant="outline" size="sm" class="text-xxs" :disabled="modelValue.length === 0" @click="clear">清空</Button>
      <Button type="button" size="sm" class="text-xxs" :disabled="saving || !dirty" @click="save">
        {{ saving ? '保存中…' : '保存' }}
      </Button>
    </div>

    <canvas
      ref="canvasRef"
      class="sketch-editor__canvas"
      @pointerdown.prevent="onPointerDown"
      @pointermove.prevent="onPointerMove"
      @pointerup.prevent="onPointerUp"
      @pointercancel.prevent="onPointerCancel"
      @wheel="onCanvasWheel"
    />
  </section>
</template>

<style scoped>
.sketch-editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: #181818;
}
.sketch-editor__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 7px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  background: #202020;
  color: #e5e7eb;
}
.sketch-editor__file {
  min-width: 150px;
  flex: 1 1 auto;
}
.sketch-editor__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}
.sketch-editor__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  font-size: 10px;
  color: #9ca3af;
}
.sketch-editor__dirty {
  color: #fbbf24;
}
.sketch-editor__tools {
  display: flex;
  gap: 4px;
}
.sketch-editor__tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  background: #262626;
  color: #d1d5db;
  font-size: 12px;
}
.sketch-editor__tool:hover {
  background: #303030;
}
.sketch-editor__tool.is-active {
  border-color: #d86a42;
  background: #d86a42;
  color: #fff;
}
.sketch-editor__color {
  width: 32px;
  height: 30px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  background: #262626;
}
.sketch-editor__range {
  width: 110px;
}
.sketch-editor__zoom {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 30px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  background: #262626;
  color: #d1d5db;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.sketch-editor__zoom:hover {
  background: #303030;
}
.sketch-editor__canvas {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: crosshair;
}
</style>
