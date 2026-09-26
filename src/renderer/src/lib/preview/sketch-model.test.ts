import { describe, expect, it } from 'vitest'
import {
  buildSketchDocument,
  computeSketchBounds,
  isSketchJsonFileName,
  parseSketchDocument
} from './sketch-model'

describe('sketch model', () => {
  it('parses only supported sketch items from json', () => {
    const items = parseSketchDocument(JSON.stringify({
      version: 1,
      items: [
        { kind: 'pen', points: [{ x: 10, y: 12 }, { x: 20, y: 22 }], color: '#fff', size: 2 },
        { kind: 'rect', x: 30, y: 40, w: 120, h: 80, color: '#f97316', size: 3 },
        { kind: 'arrow', x1: 5, y1: 6, x2: 80, y2: 90, color: '#111827', size: 2 },
        { kind: 'text', x: 60, y: 70, text: '登录', color: '#0f172a', size: 20 },
        { kind: 'ellipse', cx: 1, cy: 2 }
      ]
    }))

    expect(items).toEqual([
      { kind: 'pen', points: [{ x: 10, y: 12 }, { x: 20, y: 22 }], color: '#fff', size: 2 },
      { kind: 'rect', x: 30, y: 40, w: 120, h: 80, color: '#f97316', size: 3 },
      { kind: 'arrow', x1: 5, y1: 6, x2: 80, y2: 90, color: '#111827', size: 2 },
      { kind: 'text', x: 60, y: 70, text: '登录', color: '#0f172a', size: 20 }
    ])
  })

  it('builds a compact ai-readable sketch document', () => {
    const doc = buildSketchDocument([
      { kind: 'rect', x: 30, y: 40, w: 120, h: 80, color: '#fff', size: 2 }
    ])

    expect(doc).toEqual({
      version: 1,
      items: [
        { kind: 'rect', x: 30, y: 40, w: 120, h: 80, color: '#fff', size: 2 }
      ]
    })
  })

  it('computes bounds across freehand and shapes', () => {
    expect(computeSketchBounds([
      { kind: 'pen', points: [{ x: 10, y: 12 }, { x: 20, y: 22 }], color: '#fff', size: 4 },
      { kind: 'rect', x: 30, y: 40, w: 120, h: 80, color: '#fff', size: 2 }
    ])).toEqual({
      minX: 8,
      minY: 10,
      maxX: 151,
      maxY: 121
    })
  })

  it('recognizes sketch json filenames', () => {
    expect(isSketchJsonFileName('ui/demo/sketch-2026-06-18T07-10-17.sketch.json')).toBe(true)
    expect(isSketchJsonFileName('ui/demo/data.json')).toBe(false)
  })
})
