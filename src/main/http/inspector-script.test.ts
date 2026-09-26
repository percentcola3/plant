import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const inspectorSource = readFileSync(join(process.cwd(), 'resources/inspector/inspector.js'), 'utf-8')

describe('inspector browser script', () => {
  it('supports host-driven persistent element edit mode and synced chip removal', () => {
    expect(inspectorSource).toContain('__uikit_pick_once__')
    expect(inspectorSource).toContain('__uikit_pick_cancel__')
    expect(inspectorSource).toContain('__uikit_picker_state__')
    expect(inspectorSource).toContain('__uikit_element_edit_mode__')
    expect(inspectorSource).toContain('setElementEditMode')
    expect(inspectorSource).toContain('__uikit_remove_pick__')
    expect(inspectorSource).toContain('removePickByPath')
    expect(inspectorSource).toContain('__uikit_sync_pick_paths__')
    expect(inspectorSource).toContain('syncPicksFromHostPaths')
    expect(inspectorSource).toContain('if (opt.insertChip) insertPickToChat(existing)')
  })

  it('keeps host-driven element picking active in UI mode', () => {
    const pickStart = inspectorSource.indexOf('function startPickOnce()')
    const hoverStart = inspectorSource.indexOf('function clearHover()')
    const pickBody = inspectorSource.slice(pickStart, hoverStart)
    const clickStart = inspectorSource.indexOf("document.addEventListener('click', (e) => {")
    const editStart = inspectorSource.indexOf('function activateElementForEdit(el)')
    const clickBody = inspectorSource.slice(clickStart, editStart)

    expect(pickBody).toContain("setPickerActive(true, hostMode !== 'ui')")
    expect(clickBody).toContain("insertChip: pickerOnce || hostMode === 'ui'")
    expect(clickBody).toContain('if (pickerOnce) setPickerActive(false, false)')
  })

  it('removes guide and Claude insertion actions from the floating panel', () => {
    expect(inspectorSource).not.toContain('__uikit_toolbar_action__')
    expect(inspectorSource).not.toContain('__uikit_insert_prompt__')
    expect(inspectorSource).not.toContain('__uikit_insert_prompt_result__')
    expect(inspectorSource).not.toContain('__uikit_visual_choice__')
    expect(inspectorSource).toContain('__uikit_request_set__')
    expect(inspectorSource).toContain('__uikit_request_sync__')
    expect(inspectorSource).toContain('setRequestText')
    expect(inspectorSource).toContain('syncRequestToHost')
    expect(inspectorSource).not.toContain("action === 'open-guide'")
    expect(inspectorSource).not.toContain("action === 'insert-prompt'")
    expect(inspectorSource).not.toContain("action === 'insert-distill'")
    expect(inspectorSource).not.toContain('data-action="open-guide"')
    expect(inspectorSource).not.toContain('data-action="insert-prompt"')
    expect(inspectorSource).not.toContain('data-action="insert-distill"')
    expect(inspectorSource).not.toContain('新手引导')
    expect(inspectorSource).not.toContain('插入到 Claude Code')
  })

  it('hides the floating launcher in UI mode', () => {
    expect(inspectorSource).toContain('mode-ui #__uikit_fab__')
    expect(inspectorSource).toContain("setHostMode(d.mode)")
  })

  it('renders selected aliases as non-editable removable blocks', () => {
    expect(inspectorSource).toContain('class="aliasref" contenteditable="false"')
    expect(inspectorSource).toContain('data-alias-remove')
  })

  it('removes deprecated actions from the floating panel', () => {
    expect(inspectorSource).not.toContain('data-action="toggle-pick"')
    expect(inspectorSource).not.toContain('data-action="clear"')
    expect(inspectorSource).not.toContain('data-action="reset"')
    expect(inspectorSource).not.toContain('data-action="copy-prompt"')
  })

  it('keeps chat insert and delete in the element adjustment panel', () => {
    const toolbarStart = inspectorSource.indexOf('function createToolbar(pick)')
    const toolbarEnd = inspectorSource.indexOf('function updateToolbarPos(pick)')
    const toolbarBody = inspectorSource.slice(toolbarStart, toolbarEnd)

    expect(toolbarBody).not.toContain('data-tb-action="delete"')
    expect(inspectorSource).toContain('data-pop-action="insert-chat"')
    expect(inspectorSource).toContain('data-pop-action="delete"')
    expect(inspectorSource).toContain('insertPickToChat')
  })

  it('keeps committed chat references when element tuning closes', () => {
    const editModeStart = inspectorSource.indexOf('function setElementEditMode(enabled)')
    const editModeEnd = inspectorSource.indexOf('function startPickOnce()')
    const editModeBody = inspectorSource.slice(editModeStart, editModeEnd)
    const clickStart = inspectorSource.indexOf("document.addEventListener('click', (e) => {")
    const choiceStart = inspectorSource.indexOf('// ───── 图文设计')
    const clickBody = inspectorSource.slice(clickStart, choiceStart)

    expect(editModeBody).toContain('clearTransientEditPicks()')
    expect(editModeBody).not.toContain('clearPicks()')
    expect(inspectorSource).toContain('function activateElementForEdit(el)')
    expect(clickBody).toContain('activateElementForEdit(e.target)')
    expect(inspectorSource).toContain('showToolbar: false')
  })

  it('bridges tuning selection and style changes to the fixed host panel', () => {
    expect(inspectorSource).toContain('__uikit_element_edit_selection__')
    expect(inspectorSource).toContain('__uikit_element_edit_apply__')
    expect(inspectorSource).toContain('__uikit_element_edit_action__')
    expect(inspectorSource).toContain('function postElementEditSelection(pick)')
    expect(inspectorSource).toContain('function writeStyleEdit(pick, property, value)')
    expect(inspectorSource).toContain('function writeTextEdit(pick, value)')
    expect(inspectorSource).toContain("pick.edits['text:content']")
    expect(inspectorSource).toContain("scheduleWrite(pick.path, 'text:content', value)")
    expect(inspectorSource).toContain('mode-ui #__uikit_style_popover__')
  })

  it('exposes expanded style properties for host-side element tuning', () => {
    expect(inspectorSource).toContain("'font-size'")
    expect(inspectorSource).toContain("'text-align'")
    expect(inspectorSource).toContain("'display'")
    expect(inspectorSource).toContain("'flex-direction'")
    expect(inspectorSource).toContain("'justify-content'")
    expect(inspectorSource).toContain("'align-items'")
    expect(inspectorSource).toContain("'flex-grow'")
    expect(inspectorSource).toContain("'flex-basis'")
    expect(inspectorSource).toContain("'margin'")
    expect(inspectorSource).toContain("'padding'")
  })

  it('keeps the draggable adjustment panel only for the standalone legacy host', () => {
    expect(inspectorSource).toContain('data-pop-drag-handle')
    expect(inspectorSource).toContain('startPopoverDrag')
    expect(inspectorSource).toContain("data-pop-action=\"remark\"")
    expect(inspectorSource).toContain('data-pop-actions')
    expect(inspectorSource.indexOf('data-pop-actions')).toBeLessThan(inspectorSource.indexOf('<div class="body"></div>'))
    expect(inspectorSource).not.toContain('<footer>\\n      <button class="btn btn-ghost" type="button" data-pop-action="remark">备注</button>')
    expect(inspectorSource).toContain('popoverMode')
    expect(inspectorSource).toContain('buildRemarkPanel')
  })

  it('stores element remarks as preview remark JSON', () => {
    expect(inspectorSource).toContain('/api/preview/remarks')
    expect(inspectorSource).toContain("setAttribute('data-role', 'remark')")
    expect(inspectorSource).toContain('scheduleRemarkSave')
    expect(inspectorSource).toContain('loadRemarks')
  })

  it('removes alias chips from the floating request when picks are removed', () => {
    expect(inspectorSource).toContain('removeAliasFromRequest')
    expect(inspectorSource).toContain('removeAliasesFromRequest')
  })

  it('uses the same complete brand outline without shadows for hover and selection', () => {
    const start = inspectorSource.indexOf('.__uikit_pick_hover__')
    const end = inspectorSource.indexOf('.__uikit_remark_overlay_svg__')
    const css = inspectorSource.slice(start, end)

    expect(css).toContain('.__uikit_pick_hover__,')
    expect(css).toContain('.__uikit_pick_selection__')
    expect(css).toContain('position: fixed')
    expect(css).toContain('border: 2px solid #f26b2f')
    expect(css).toContain('box-shadow: none')
    expect(css).toContain('transition: none')
    expect(css).not.toContain('transition: left')
    expect(css).not.toContain('rgba(37,99,235')
    expect(css).not.toContain('rgba(242,107,47,.14)')
    expect(css).not.toContain('#ff4d4f')
    expect(inspectorSource).toContain('function updateHoverOverlay()')
    expect(inspectorSource).toContain('function createSelectionOverlay(pick)')
    expect(inspectorSource).toContain('function updateSelectionOverlay(pick)')
    expect(inspectorSource).toContain('function destroySelectionOverlay(pick)')
  })

  it('supports dragging selected elements with CSS translate persistence', () => {
    expect(inspectorSource).toContain('function startElementDrag(e, pick)')
    expect(inspectorSource).toContain("pick.edits['style:translate']")
    expect(inspectorSource).toContain("scheduleWrite(s.pick.path, 'style:translate', value)")
    expect(inspectorSource).toContain('parseTranslatePx')
    expect(inspectorSource).toContain('suppressNextClickAfterDrag')
    expect(inspectorSource).toContain('updateSelectionOverlay(s.pick)')
  })

  it('does not generate adjustment prompts for Claude insertion', () => {
    expect(inspectorSource).not.toContain('function buildAdjustPrompt()')
    expect(inspectorSource).not.toContain('function insertPrompt()')
    expect(inspectorSource).not.toContain('粘贴给 Claude Code')
    expect(inspectorSource).not.toContain('请显式调用这些 skill')
  })

  it('removes distill prompt insertion with the Claude bridge', () => {
    expect(inspectorSource).not.toContain('data-action="insert-distill"')
    expect(inspectorSource).not.toContain('function insertDistillPrompt()')
    expect(inspectorSource).not.toContain('window.parent.postMessage({ type: \'__uikit_insert_prompt__\'')
  })
})
