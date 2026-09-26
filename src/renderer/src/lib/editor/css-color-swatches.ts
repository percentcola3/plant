import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view'
import { RangeSetBuilder, type Extension } from '@codemirror/state'

// 编辑器只是展示色块辅助识别色值，浏览器认为有效的色值都直接交给 DOM 验证。
// 命名颜色子集足够覆盖设计稿里手写时常见的 transparent/white/black 等。
const NAMED_COLORS = new Set([
  'transparent', 'currentcolor', 'aliceblue', 'antiquewhite', 'aqua', 'aquamarine',
  'azure', 'beige', 'bisque', 'black', 'blanchedalmond', 'blue', 'blueviolet',
  'brown', 'burlywood', 'cadetblue', 'chartreuse', 'chocolate', 'coral',
  'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgrey', 'darkgreen', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon',
  'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise',
  'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue',
  'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro', 'ghostwhite',
  'gold', 'goldenrod', 'gray', 'grey', 'green', 'greenyellow', 'honeydew',
  'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush',
  'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgrey', 'lightgreen', 'lightpink',
  'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey',
  'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen', 'magenta',
  'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple',
  'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise',
  'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose', 'moccasin',
  'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange', 'orangered',
  'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple',
  'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon',
  'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver', 'skyblue',
  'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen', 'steelblue',
  'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat', 'white',
  'whitesmoke', 'yellow', 'yellowgreen'
])

// 各种色值字面量：hex / rgb(a) / hsl(a) / oklch / oklab / lab / lch / color() / hwb / var(--x)
// 命名色用 (?<![\w-]) / (?![\w-]) 严格边界，避免把 `--grey-1`、`light-blue` 这种自定义 token 命中。
const COLOR_RE = new RegExp(
  [
    '(?<![\\w-])#[0-9a-fA-F]{3,8}\\b',
    '(?<![\\w-])(?:rgba?|hsla?|oklch|oklab|lab|lch|color|hwb)\\([^()]*(?:\\([^()]*\\)[^()]*)*\\)',
    '(?<![\\w-])var\\(--[\\w-]+(?:\\s*,[^()]*(?:\\([^()]*\\)[^()]*)*)?\\)',
    '(?<![\\w-])(?:' + Array.from(NAMED_COLORS).join('|') + ')(?![\\w-])'
  ].join('|'),
  'gi'
)

// 校验值是否能被浏览器识别为颜色——把候选值扔到隐藏元素的 backgroundColor 里看是否生效。
const probeEl = typeof document !== 'undefined' ? document.createElement('span') : null

function isRenderableColor(value: string): boolean {
  if (!probeEl) return false
  probeEl.style.background = ''
  probeEl.style.background = value
  return probeEl.style.background !== ''
}

function buildVarMap(doc: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /(--[\w-]+)\s*:\s*([^;}]+?)(?=\s*[;}])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(doc)) !== null) {
    map.set(m[1], m[2].trim())
  }
  return map
}

function resolveVarChain(raw: string, map: Map<string, string>, depth = 0): string | null {
  if (depth > 5) return null
  const trimmed = raw.trim()
  const varMatch = /^var\(\s*(--[\w-]+)(?:\s*,\s*([^]*))?\)$/.exec(trimmed)
  if (!varMatch) return trimmed
  const defined = map.get(varMatch[1])
  if (defined) return resolveVarChain(defined, map, depth + 1)
  if (varMatch[2] !== undefined) return resolveVarChain(varMatch[2], map, depth + 1)
  return null
}

function resolveColor(raw: string, varMap: Map<string, string>): string | null {
  const lower = raw.toLowerCase()
  if (lower.startsWith('var(')) {
    const resolved = resolveVarChain(raw, varMap)
    if (!resolved) return null
    if (resolved === raw) return null
    return isRenderableColor(resolved) ? resolved : null
  }
  return isRenderableColor(raw) ? raw : null
}

class ColorSwatchWidget extends WidgetType {
  constructor(private readonly color: string) {
    super()
  }

  eq(other: ColorSwatchWidget): boolean {
    return other.color === this.color
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-color-swatch'
    el.style.backgroundColor = this.color
    el.title = this.color
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const fullDoc = view.state.doc.toString()
  const varMap = buildVarMap(fullDoc)

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    COLOR_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = COLOR_RE.exec(text)) !== null) {
      const raw = m[0]
      const resolved = resolveColor(raw, varMap)
      if (!resolved) continue
      const pos = from + m.index + raw.length
      builder.add(
        pos,
        pos,
        Decoration.widget({
          widget: new ColorSwatchWidget(resolved),
          side: 1
        })
      )
    }
  }
  return builder.finish()
}

export function cssColorSwatches(): Extension {
  return [
    EditorView.baseTheme({
      '.cm-color-swatch': {
        display: 'inline-block',
        width: '0.85rem',
        height: '0.85rem',
        marginLeft: '0.4rem',
        marginRight: '0.1rem',
        borderRadius: '4px',
        border: '1px solid rgba(15, 23, 42, 0.18)',
        verticalAlign: '-2px',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.7) inset',
        backgroundImage:
          'linear-gradient(45deg, rgba(15,23,42,0.06) 25%, transparent 25%, transparent 75%, rgba(15,23,42,0.06) 75%),' +
          'linear-gradient(45deg, rgba(15,23,42,0.06) 25%, transparent 25%, transparent 75%, rgba(15,23,42,0.06) 75%)',
        backgroundSize: '6px 6px',
        backgroundPosition: '0 0, 3px 3px'
      }
    }),
    ViewPlugin.fromClass(class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view)
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view)
        }
      }
    }, {
      decorations: (value) => value.decorations
    })
  ]
}
