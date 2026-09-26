<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PushHistoryPanel from './PushHistoryPanel.vue'
import type { GitCommitSummary } from '@shared/types'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import { useWorkspacesStore } from '@/stores/workspaces'
import {
  MAIN_BRANCH_ROLLBACK_CONFIRM_PHRASE,
  buildRollbackConfirmMessage,
  formatCommitAuthor,
  formatCommitTime,
  isDefaultBranch,
  isMainBranchRollbackConfirmed,
} from '@/lib/branch-history'
import { buildGitRepairPrompt, titleForGitRepair } from '@/lib/git-ai-repair-prompt'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type BranchHistoryContext = {
  workspaceId: string
  workspaceName?: string
  branch?: string
  defaultBranch?: string
}

const ui = useUiStore()
const ws = useWorkspacesStore()
const view = ref<'pushes' | 'commits'>('pushes')
const commits = ref<GitCommitSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const revertingSha = ref<string | null>(null)

const request = computed(() => ui.branchHistory)
const branchLabel = computed(() => request.value?.branch ?? '当前分支')

const open = computed({
  get: () => !!request.value,
  set: (v) => { if (!v) close() },
})

watch(request, (next) => {
  if (next) {
    view.value = next.initialView ?? 'pushes'
    if (view.value === 'commits') void loadHistory()
  }
  else {
    commits.value = []
    error.value = null
    revertingSha.value = null
  }
})

watch(view, next => { if (next === 'commits' && request.value) void loadHistory() })

async function loadHistory(): Promise<void> {
  const cur = request.value
  if (!cur) return
  loading.value = true
  error.value = null
  const r = await call('git.history', { workspaceId: cur.workspaceId, limit: 30 })
  loading.value = false
  if (!r.ok) {
    error.value = r.message
    return
  }
  commits.value = r.data
}

function close(): void {
  ui.closeBranchHistory()
}

async function requestRollback(commit: GitCommitSummary): Promise<void> {
  const cur = request.value
  if (!cur || revertingSha.value) return
  const branch = cur.branch ?? ''
  const defaultBranch = cur.defaultBranch ?? ''
  const message = buildRollbackConfirmMessage({
    branch,
    defaultBranch,
    targetShortSha: commit.shortSha,
  })
  if (isDefaultBranch(branch, defaultBranch)) {
    const input = await ui.askPrompt({
      title: '高风险：回滚公共空间',
      message,
      placeholder: MAIN_BRANCH_ROLLBACK_CONFIRM_PHRASE,
      confirmLabel: '确认回滚',
    })
    if (!input) return
    if (!isMainBranchRollbackConfirmed(input)) {
      ui.showToast('error', '确认短语不匹配，已取消回滚', 2600)
      return
    }
    await runRollback(commit)
    return
  }
  ui.askConfirm({
    title: '回滚历史版本',
    message,
    confirmLabel: '回滚',
    onConfirm: () => {
      void runRollback(commit)
    },
  })
}

async function runRollback(commit: GitCommitSummary): Promise<void> {
  const cur = request.value
  if (!cur || revertingSha.value) return
  revertingSha.value = commit.sha
  const r = await call('git.revertTo', { workspaceId: cur.workspaceId, targetSha: commit.sha })
  revertingSha.value = null
  if (!r.ok) {
    openRepairPrompt(cur, commit, { code: r.code, message: r.message })
    return
  }
  if (!r.data.ok) {
    if (r.data.code === 'UNCOMMITTED') {
      ui.showToast('error', r.data.message, 4200)
      return
    }
    openRepairPrompt(cur, commit, r.data)
    return
  }
  ui.showToast('success', r.data.revertedCount > 0 ? `已回滚 ${r.data.revertedCount} 个提交` : '已经是所选版本')
  await loadHistory()
  await ws.refreshScan(cur.workspaceId)
}

function openRepairPrompt(
  cur: BranchHistoryContext,
  commit: GitCommitSummary,
  failure: { phase?: string; code?: string; message: string },
): void {
  ui.closeBranchHistory()
  ui.openAiRepairPrompt({
    title: titleForGitRepair('rollback'),
    message: '回滚没有完成。可以把下面提示词交给 AI 面板，让它按当前工作区状态处理。',
    prompt: buildGitRepairPrompt({
      action: 'rollback',
      workspaceName: cur.workspaceName,
      branch: cur.branch,
      defaultBranch: cur.defaultBranch,
      targetSha: commit.shortSha,
      phase: failure.phase,
      code: failure.code,
      message: failure.message,
    }),
  })
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[78vh] flex-col sm:max-w-[760px] p-0 gap-0">
      <DialogHeader class="flex flex-row items-start justify-between gap-4 border-b border-dialog-border p-4 space-y-0">
        <div>
          <DialogTitle>历史版本 · {{ branchLabel }}</DialogTitle>
          <DialogDescription class="mt-1">查看推送说明与文档变更，或切换提交版本执行回滚。</DialogDescription>
        </div>
        <Button v-if="view === 'commits'" variant="outline" size="sm" :disabled="loading" @click="loadHistory">
          {{ loading ? '读取中…' : '刷新' }}
        </Button>
      </DialogHeader>
      <div class="flex gap-2 px-4 pt-3" role="group" aria-label="历史类型">
        <Button size="sm" :variant="view === 'pushes' ? 'default' : 'outline'" @click="view = 'pushes'">推送记录</Button>
        <Button size="sm" :variant="view === 'commits' ? 'default' : 'outline'" @click="view = 'commits'">提交版本</Button>
      </div>
      <div v-if="view === 'pushes' && request" class="min-h-0 overflow-y-auto p-4">
        <PushHistoryPanel :workspace-id="request.workspaceId" :rel-path="request.relPath" :branch="request.branch" />
      </div>


      <div v-if="view === 'commits'" class="flex-1 overflow-y-auto p-4">
        <div v-if="loading" class="rounded-md border border-popover-border bg-muted p-4 text-sm text-muted-foreground">
          读取历史版本中…
        </div>
        <div v-else-if="error" class="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {{ error }}
        </div>
        <div v-else-if="commits.length === 0" class="rounded-md border border-popover-border bg-muted p-4 text-sm text-muted-foreground">
          暂无提交历史。
        </div>
        <ul v-else class="space-y-2">
          <li
            v-for="(commit, index) in commits"
            :key="commit.sha"
            class="flex items-start gap-3 rounded-md border border-popover-border bg-background px-3 py-2"
          >
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <span class="truncate text-sm font-medium text-foreground">{{ commit.subject || '无提交说明' }}</span>
                <span class="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xxs text-muted-foreground">{{ commit.shortSha }}</span>
              </div>
              <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xxs text-muted-foreground">
                <span>{{ formatCommitTime(commit.authoredAt) }}</span>
                <span>{{ formatCommitAuthor(commit) }}</span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              class="h-7 shrink-0 px-2 text-xxs"
              :disabled="index === 0 || revertingSha !== null"
              :title="index === 0 ? '当前已经是最新版本' : '回滚到此版本'"
              @click="requestRollback(commit)"
            >
              {{ revertingSha === commit.sha ? '回滚中…' : index === 0 ? '当前版本' : '回滚到此版本' }}
            </Button>
          </li>
        </ul>
      </div>
    </DialogContent>
  </Dialog>
</template>
