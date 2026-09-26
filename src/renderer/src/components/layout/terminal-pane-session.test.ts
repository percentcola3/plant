import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const currentDir = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(currentDir, 'TerminalPane.vue'), 'utf8')
const conversationSource = readFileSync(join(currentDir, '../chat/ConversationView.vue'), 'utf8')
const composerSource = readFileSync(join(currentDir, '../chat/ChatComposer.vue'), 'utf8')
const claudeHandlerSource = readFileSync(join(currentDir, '../../../../main/ipc/handlers/claude.ts'), 'utf8')

describe('TerminalPane session startup', () => {
  // F3: 默认走 ensure 模式（claude.sessionId），切走再切回看到原对话；
  //     仅用户主动点"新会话"按钮（newUiSession）才强制 session.new。
  it('uses claude.sessionId (ensure) as default and reserves session.new for forceNew', () => {
    expect(source).toContain("'claude.sessionId'")
    expect(source).toContain("forceNew")
    // initUiMode 内部条件分支：forceNew → session.new；其它情况 → sessionId
    expect(source).toContain("options.forceNew ? 'claude.session.new' : 'claude.sessionId'")
    // newUiSession 必须显式传 forceNew: true（用户主动点"新会话"按钮）
    expect(source).toContain('forceNew: true')
  })

  // A1 修复后：startUiSession 必须把 watch.start 返回的历史事件灌回 store
  it('replays historical events from watch.start into the store', () => {
    expect(source).toContain('conversationStore.replay(effectiveSessionId, replayEvents')
    expect(source).toContain('historical: true')
  })

  it('restores the running turn when reconnecting to an active background task', () => {
    expect(claudeHandlerSource).toContain('turnActive: getAgentDriver().hasActiveTurn(effectiveSessionId)')
    expect(source).toContain('watchResult.data.turnActive')
    expect(source).toContain('conversationStore.restoreRunningTurn(effectiveSessionId)')
  })

  it('watches and subscribes to the exact session returned by the main process', () => {
    expect(source).toContain("call('claude.watch.start', {")
    expect(source).toContain('sessionId,')
    expect(source).toContain('const effectiveSessionId = watchResult.data.sessionId')
    expect(source).toContain('subscribeUiEvents(effectiveSessionId)')
    expect(source).toContain('currentSubscribedSessionId !== effectiveSessionId')
  })

  // F2: 模式切换不应该 abort UI in-flight turn / 不 unsubscribe UI 事件
  it('mode switch (UI->TUI) keeps UI subscription and in-flight turn alive', () => {
    // switchMode 不再调 abortUiTurn / unsubscribeUiEvents（除非真的退出项目）
    const switchModeBlock = extractFunction(source, 'async function switchMode')
    expect(switchModeBlock).not.toContain('abortUiTurn()')
    expect(switchModeBlock).not.toContain('unsubscribeUiEvents()')
  })

  it('mode switch (TUI->UI) verifies the persisted scope before exposing the conversation', () => {
    const switchModeBlock = extractFunction(source, 'async function switchMode')
    expect(switchModeBlock).toContain("status.value = 'spawning'")
    expect(switchModeBlock).toContain('await queuedInitUiMode(undefined, undefined, {')
    expect(switchModeBlock).toContain('expectedContextKey: currentSessionTargetKey()')
  })

  it('reuses the active subscribed session for consecutive user turns', () => {
    const prepareBlock = extractFunction(source, 'async function prepareSubmitSession')
    const initBlock = extractFunction(source, 'async function initUiMode')
    expect(prepareBlock).toContain('await queuedInitUiMode(req.targetDocument, req.targetWorkspace, {')
    expect(prepareBlock).toContain('expectedContextKey: currentSessionTargetKey()')
    expect(prepareBlock).not.toContain('forceNew: true')
    expect(prepareBlock).not.toContain("'claude.session.new'")
    expect(initBlock).toContain("options.forceNew ? 'claude.session.new' : 'claude.sessionId'")
    expect(initBlock).toContain('oldSessionId === ensuredSessionId')
    expect(initBlock).toContain('currentSubscribedSessionId === ensuredSessionId')
    expect(initBlock).toContain('isCurrentUiSessionTarget(targetDocument, targetWorkspace)')
    expect(initBlock).toContain('return ensuredSessionId')
    expect(source).toContain('@prepare-submit-session="prepareSubmitSession"')
  })

  it('rebinds the watcher without aborting when the active project changes', () => {
    const projectWatchStart = source.indexOf('() => project.value?.id')
    const projectWatchEnd = source.indexOf('// 当前会话目标变化时')
    const projectWatchBlock = source.slice(projectWatchStart, projectWatchEnd)

    expect(projectWatchBlock).toContain('await stopUiWatch(')
    expect(projectWatchBlock).toContain('previousWatchId')
    expect(projectWatchBlock).toContain('unsubscribeUiEvents()')
    // stop + init 作为同一队列操作，避免提交穿过项目切换窗口。
    expect(projectWatchBlock).toContain('await enqueueUiSessionOperation(async () => {')
    expect(projectWatchBlock).toContain('await initUiMode(undefined, undefined, {')
    expect(projectWatchBlock).toContain('expectedContextKey: currentSessionTargetKey()')
    expect(projectWatchBlock).not.toContain("call('claude.abort'")
  })

  it('switches project sessions without aborting or clearing the previous conversation', () => {
    const switchBlock = extractFunction(source, 'function switchUiSession')
    expect(switchBlock).toContain('stopUiWatch')
    expect(switchBlock).toContain('previousSessionId')
    expect(switchBlock).toContain('previousWatchId')
    expect(switchBlock).toContain('enqueueUiSessionOperation')
    expect(switchBlock).toContain('unsubscribeUiEvents()')
    expect(switchBlock).not.toContain("call('claude.abort'")
    expect(switchBlock).not.toContain('conversationStore.clearSession')
  })

  it('stops the previous project watcher by its captured session id', () => {
    const stopBlock = extractFunction(source, 'async function stopUiWatch')
    expect(stopBlock).toContain('sessionId = conversationStore.activeSessionId')
    expect(stopBlock).toContain('sessionId,')
  })

  it('keys AI sessions and composer drafts by the active project workbench', () => {
    const targetKeyBlock = extractFunction(source, 'function currentSessionTargetKey')
    expect(targetKeyBlock).toContain('activeAiProjectKey.value')
    expect(targetKeyBlock).toContain('project.value?.path')
    expect(source).toContain(':draft-key="activeAiProjectKey"')
    expect(conversationSource).toContain(':draft-key="draftKey"')
    expect(composerSource).toContain("defineProps<{ draftKey: string }>()")
    expect(composerSource).toContain('loadChatDraft')
    expect(composerSource).toContain('saveChatDraft')
    expect(composerSource).toContain('let currentDraftKey = props.draftKey')
    expect(composerSource).toContain('saveChatDraft(currentDraftKey')
    expect(composerSource).toContain("flush: 'sync'")
    expect(source).toContain(':key="activeAiProjectKey"')
    expect(source).toContain('visibleAiProject.value?.key')
    expect(source).toContain('activeAiProjectKey.value')

    const workspaceTargetBlock = extractFunction(source, 'function currentConversationTargetWorkspace')
    expect(workspaceTargetBlock.indexOf('currentClaudeWorkArea()'))
      .toBeLessThan(workspaceTargetBlock.indexOf('resolvedTerminalContext.value.targetDocument'))
  })

  it('shows the active project name in the AI panel header', () => {
    expect(source).toContain('const visibleAiProject = computed')
    expect(source).toContain('visiblePreviewTab.value?.project ?? null')
    expect(source).toContain('const projectNameLabel = computed')
    expect(source).toContain("visibleAiProject.value?.name ?? project.value?.name ?? '未打开项目'")
    expect(source).toContain('class="project-context-label"')
    expect(source).toContain('{{ projectNameLabel }}')
  })

  it('uses the active preview file as the default AI target document', () => {
    const targetDocumentBlock = extractFunction(source, 'function currentTargetDocument')
    expect(targetDocumentBlock.indexOf('currentPreviewTargetDocument()'))
      .toBeLessThan(targetDocumentBlock.indexOf('editorStore.session'))
    expect(targetDocumentBlock).toContain('if (!editorStore.isOpen) return undefined')
    expect(source).toContain('function currentPreviewTargetDocument')
    expect(source).toContain('tab.filesMeta?.activeRelPath')
    expect(source).toContain('function targetDocumentKindFromRelPath')
  })

  it('does not keep a hidden internal project session active on the root project home', () => {
    expect(source).toContain('const visiblePreviewTab = computed')
    expect(source).toContain('!previewStore.isPreviewActive || tab?.workspaceId !== project.value?.id')
    expect(source).toContain('const tab = visiblePreviewTab.value')
  })
})

function extractFunction(text: string, signature: string): string {
  const start = text.indexOf(signature)
  if (start === -1) return ''
  // 简易抓取：从 signature 起到下一个顶层 function/const 声明（基于缩进）。
  // 对当前文件够用——switchMode 后面紧跟 const uiSessionInitialized。
  const tail = text.slice(start)
  const match = /\n(async function |function |const \w+ = ref|onMounted|watch\()/m.exec(tail.slice(20))
  return match ? tail.slice(0, 20 + match.index) : tail
}
