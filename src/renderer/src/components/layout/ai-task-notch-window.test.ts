import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/layout/AiTaskNotchWindow.vue'),
  'utf-8'
)
const laneSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/layout/AiTaskLanePanel.vue'),
  'utf-8'
)

function extractCssBlock(selector: string): string {
  const start = source.indexOf(`${selector} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('\n}', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('AiTaskNotchWindow', () => {
  it('uses the project theme icon without the old robot or white focus rim', () => {
    const miniBlock = extractCssBlock('.notch-mini')

    expect(source).toContain('Sparkles')
    expect(source).not.toContain('<Bot')
    expect(miniBlock).toContain('background: var(--color-accent);')
    expect(miniBlock).toContain('color: var(--color-bg-base);')
    expect(miniBlock).toContain('outline: none;')
    expect(miniBlock).not.toContain('background: #0a0a0a;')
  })

  it('inherits expanded panel colors from the app theme', () => {
    const rootBlock = extractCssBlock('.notch-root')
    const panelBlock = extractCssBlock('.notch-panel')
    const titleBlock = extractCssBlock('.notch-panel-title')

    expect(rootBlock).toContain('color: var(--color-text-primary);')
    expect(panelBlock).toContain('border: 1px solid var(--color-border);')
    expect(panelBlock).toContain('background: color-mix(in srgb, var(--color-bg-panel) 96%, transparent);')
    expect(panelBlock).toContain('var(--color-text-primary) 16%')
    expect(titleBlock).toContain('color: var(--color-text-primary);')
    expect(source).not.toContain('background: rgba(5, 5, 5, 0.96);')
    expect(source).not.toContain('color: #f7fff4;')
  })

  it('uses pointer drag for the mini icon and expanded header', () => {
    expect(source).toContain('@mousedown="onMiniMouseDown"')
    expect(source).toContain('@mousedown="onPanelHeadMouseDown"')
    expect(source).toContain('function onMiniMouseDown')
    expect(source).toContain('function onPanelHeadMouseDown')
    expect(source).not.toContain('onPillMouseDown')
  })

  it('opens all tasks from a mini double click and minimizes from the expanded header', () => {
    const panelHeadBlock = extractCssBlock('.notch-panel-head')

    expect(source).toContain('function expandAllTasks()')
    expect(source).toContain('@dblclick.stop="expandAllTasks"')
    expect(source).toContain('@keydown.enter.prevent="expandAllTasks"')
    expect(source).toContain('@keydown.space.prevent="expandAllTasks"')
    expect(source).toContain('function onPanelHeadMouseDown')
    expect(source).toContain('@mousedown="onPanelHeadMouseDown"')
    expect(source).toContain('@dblclick="minimize"')
    expect(panelHeadBlock).toContain('-webkit-app-region: no-drag;')
    expect(panelHeadBlock).not.toContain('-webkit-app-region: drag;')
  })

  it('shows a pulsing running-task count in mini mode with reduced-motion support', () => {
    const miniBlock = extractCssBlock('.notch-mini')
    const countBlock = extractCssBlock('.notch-mini-count')

    expect(source).toContain('v-if="activeCount > 0"')
    expect(source).toContain('class="notch-mini-count"')
    expect(source).toContain("activeCount > 9 ? '9+' : activeCount")
    expect(miniBlock).toContain('margin-top: 4px;')
    expect(countBlock).toContain('top: -4px;')
    expect(countBlock).toContain('right: -4px;')
    expect(countBlock).toContain('animation: notch-mini-count-pulse')
    expect(source).toContain('@keyframes notch-mini-count-pulse')
    expect(source).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('uses only mini and panel states without a collapsed pill', () => {
    expect(source).toContain("type NotchState = 'mini' | 'panel'")
    expect(source).toContain("const state = ref<NotchState>('mini')")
    expect(source).not.toContain("state === 'pill'")
    expect(source).not.toContain('notch-pill')
    expect(source).not.toContain('ChevronDown')
    expect(source).not.toContain('收起为折叠药丸')
  })

  it('renders internal-project attribution with an explicit root-project fallback', () => {
    expect(source).toContain('aiTaskProjectAttribution')
    expect(source).toContain('projectAttributionText(task)')
    expect(source).not.toContain('function workspaceText')
    expect(laneSource).toContain('aiTaskProjectAttribution')
    expect(laneSource).toContain('projectAttributionText(task)')
    expect(laneSource).not.toContain('function workspaceLabel')
  })

  it('measures expanded content and requests a bounded BrowserWindow height', () => {
    expect(source).toContain('const panelHeadEl = ref<HTMLElement | null>(null)')
    expect(source).toContain('const panelBodyEl = ref<HTMLElement | null>(null)')
    expect(source).toContain('function syncPanelHeight()')
    expect(source).toContain("call('aiTask.notch.setPanelHeight', { height })")
    expect(source).toContain('body.scrollHeight')
    expect(source).toContain('new ResizeObserver(syncPanelHeight)')
    expect(source).toContain('ref="panelHeadEl"')
    expect(source).toContain('ref="panelBodyEl"')
  })

  it('reserves only a compact shadow gutter below the expanded panel', () => {
    const panelBlock = extractCssBlock('.notch-panel')
    expect(source).toContain("'notch-root--panel': state === 'panel'")
    expect(source).toContain('.notch-root--panel {')
    expect(source).toContain('padding-bottom: 12px;')
    expect(panelBlock).toContain('max-height: calc(100vh - 12px);')
    expect(panelBlock).toContain('box-shadow: 0 8px 18px color-mix(in srgb, var(--color-text-primary) 16%, transparent);')
    expect(panelBlock).not.toContain('0 26px 60px')
  })
})
