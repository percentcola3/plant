export type SketchPoint = {
  x: number
  y: number
}

export type SketchStroke = {
  kind: 'pen'
  points: SketchPoint[]
  color: string
  size: number
}

export type SketchRect = {
  kind: 'rect'
  x: number
  y: number
  w: number
  h: number
  color: string
  size: number
}

export type SketchArrow = {
  kind: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  size: number
}

export type SketchText = {
  kind: 'text'
  x: number
  y: number
  text: string
  color: string
  size: number
}

export type SketchItem = SketchStroke | SketchRect | SketchArrow | SketchText

export type SketchDocument = {
  version: 1
  items: SketchItem[]
}

const DEFAULT_COLOR = '#ffffff'
const DEFAULT_STROKE_SIZE = 2
const DEFAULT_TEXT_SIZE = 20
const MAX_ABS_COORDINATE = 100_000
const MAX_SIZE = 4_096

export function isSketchJsonFileName(name: string): boolean {
  return /\.sketch\.json$/i.test(name)
}

export function buildSketchDocument(items: SketchItem[]): SketchDocument {
  return { version: 1, items }
}

export function parseSketchDocument(text: string | null): SketchItem[] {
  if (!text) return []
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed) || !Array.isArray(parsed.items)) return []
    return parsed.items.flatMap((item) => {
      const normalized = normalizeSketchItem(item)
      return normalized ? [normalized] : []
    })
  } catch {
    return []
  }
}

export function computeSketchBounds(items: SketchItem[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  const includePoint = (x: number, y: number, padding: number): void => {
    minX = Math.min(minX, x - padding)
    minY = Math.min(minY, y - padding)
    maxX = Math.max(maxX, x + padding)
    maxY = Math.max(maxY, y + padding)
  }

  for (const item of items) {
    if (item.kind === 'pen') {
      const padding = Math.max(1, clampSketchSize(item.size) / 2)
      for (const point of item.points) includePoint(point.x, point.y, padding)
      continue
    }
    if (item.kind === 'rect') {
      const padding = Math.max(1, clampSketchSize(item.size) / 2)
      const left = Math.min(item.x, item.x + item.w)
      const top = Math.min(item.y, item.y + item.h)
      const right = Math.max(item.x, item.x + item.w)
      const bottom = Math.max(item.y, item.y + item.h)
      includePoint(left, top, padding)
      includePoint(right, bottom, padding)
      continue
    }
    if (item.kind === 'arrow') {
      const padding = Math.max(1, clampSketchSize(item.size) / 2) + 16
      includePoint(item.x1, item.y1, padding)
      includePoint(item.x2, item.y2, padding)
      continue
    }
    const fontSize = Math.max(12, clampSketchSize(item.size))
    const textWidth = Math.max(fontSize, item.text.length * fontSize * 0.62)
    includePoint(item.x, item.y - fontSize, 4)
    includePoint(item.x + textWidth, item.y + fontSize * 0.2, 4)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, maxX: 320, maxY: 200 }
  }
  return { minX, minY, maxX, maxY }
}

export function clampSketchNumber(value: unknown): number {
  const numeric = readNumber(value)
  if (numeric === null) return 0
  return Math.max(-MAX_ABS_COORDINATE, Math.min(MAX_ABS_COORDINATE, numeric))
}

export function clampSketchSize(value: unknown): number {
  const numeric = readNumber(value)
  if (numeric === null) return 1
  return Math.max(1, Math.min(MAX_SIZE, numeric))
}

function normalizeSketchItem(value: unknown): SketchItem | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'pen') return normalizePen(value)
  if (value.kind === 'rect') return normalizeRect(value)
  if (value.kind === 'arrow') return normalizeArrow(value)
  if (value.kind === 'text') return normalizeText(value)
  return null
}

function normalizePen(value: Record<string, unknown>): SketchStroke | null {
  if (!Array.isArray(value.points)) return null
  const points = value.points.flatMap((point) => {
    const normalized = normalizePoint(point)
    return normalized ? [normalized] : []
  })
  if (points.length === 0) return null
  return {
    kind: 'pen',
    points,
    color: normalizeColor(value.color),
    size: normalizeShapeSize(value.size)
  }
}

function normalizeRect(value: Record<string, unknown>): SketchRect | null {
  const x = normalizeCoordinate(value.x)
  const y = normalizeCoordinate(value.y)
  const w = normalizeCoordinate(value.w)
  const h = normalizeCoordinate(value.h)
  if (x === null || y === null || w === null || h === null) return null
  return {
    kind: 'rect',
    x,
    y,
    w,
    h,
    color: normalizeColor(value.color),
    size: normalizeShapeSize(value.size)
  }
}

function normalizeArrow(value: Record<string, unknown>): SketchArrow | null {
  const x1 = normalizeCoordinate(value.x1)
  const y1 = normalizeCoordinate(value.y1)
  const x2 = normalizeCoordinate(value.x2)
  const y2 = normalizeCoordinate(value.y2)
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null
  return {
    kind: 'arrow',
    x1,
    y1,
    x2,
    y2,
    color: normalizeColor(value.color),
    size: normalizeShapeSize(value.size)
  }
}

function normalizeText(value: Record<string, unknown>): SketchText | null {
  const x = normalizeCoordinate(value.x)
  const y = normalizeCoordinate(value.y)
  if (x === null || y === null) return null
  return {
    kind: 'text',
    x,
    y,
    text: typeof value.text === 'string' ? value.text : '',
    color: normalizeColor(value.color),
    size: readNumber(value.size) === null ? DEFAULT_TEXT_SIZE : clampSketchSize(value.size)
  }
}

function normalizePoint(value: unknown): SketchPoint | null {
  if (!isRecord(value)) return null
  const x = normalizeCoordinate(value.x)
  const y = normalizeCoordinate(value.y)
  if (x === null || y === null) return null
  return { x, y }
}

function normalizeCoordinate(value: unknown): number | null {
  const numeric = readNumber(value)
  return numeric === null ? null : clampSketchNumber(numeric)
}

function normalizeShapeSize(value: unknown): number {
  return readNumber(value) === null ? DEFAULT_STROKE_SIZE : clampSketchSize(value)
}

function normalizeColor(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : DEFAULT_COLOR
}

function readNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
