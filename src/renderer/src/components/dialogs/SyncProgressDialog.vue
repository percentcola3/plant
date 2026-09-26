<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useWorkspacesStore } from '@/stores/workspaces'
import { call } from '@/lib/api'
import { buildGitRepairPrompt, titleForGitRepair } from '@/lib/git-ai-repair-prompt'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const ui = useUiStore()
const ws = useWorkspacesStore()

type Phase = 'check-clean' | 'commit' | 'fetch' | 'pull-rebase' | 'rebase-mainline' | 'push' | 'done'
type Step = { phase: Phase; ok: boolean; message?: string }
type Mode = 'remote' | 'mainline' | 'full'

const PHASES: { key: Phase; label: string }[] = [
  { key: 'check-clean', label: '检查未提交' },
  { key: 'commit', label: '保存当前进度' },
  { key: 'fetch', label: '拉取远端' },
  { key: 'pull-rebase', label: '合并同分支新提交' },
  { key: 'rebase-mainline', label: '合并公共空间最新' },
  { key: 'push', label: '推送' }
]

const steps = ref<Step[]>([])
const finished = ref(false)
const finalResult = ref<{ ok: true; pushed: boolean } | { ok: false; phase: string; code: string; message: string } | null>(null)
let unsub: (() => void) | null = null

const currentMode = computed<Mode>(() => ui.syncProgress?.mode ?? 'full')
const title = computed(() => {
  if (currentMode.value === 'remote') return '远程同步'
  if (currentMode.value === 'mainline') return '同步公共空间'
  return '同步'
})
const visiblePhases = computed(() => PHASES.filter((phase) => {
  if (currentMode.value === 'remote') return phase.key !== 'rebase-mainline'
  if (currentMode.value === 'mainline') return phase.key !== 'pull-rebase'
  return true
}))

const open = computed({
  get: () => !!ui.syncProgress,
  set: (v) => { if (!v) close() },
})

function statusOf(phase: Phase): 'pending' | 'ok' | 'fail' {
  const matching = steps.value.filter((s) => s.phase === phase)
  if (matching.length === 0) return 'pending'
  return matching[matching.length - 1].ok ? 'ok' : 'fail'
}

watch(
  () => ui.syncProgress,
  async (cur) => {
    if (cur) {
      steps.value = []
      finished.value = false
      finalResult.value = null
      unsub = window.events.on(`sync.progress:${cur.workspaceId}`, (payload: unknown) => {
        const e = payload as Step
        steps.value = [...steps.value, e]
      })
      const r = await call('sync.start', {
        workspaceId: cur.workspaceId,
        mode: cur.mode ?? 'full',
        uncommittedStrategy: 'commit',
        commitMessage: cur.commitMessage
      })
      finished.value = true
      finalResult.value = r.ok ? r.data : { ok: false, phase: '', code: r.code, message: r.message }
      if (finalResult.value && !finalResult.value.ok && finalResult.value.code === 'CONFLICT') {
        ui.openConflictResolve(cur.workspaceId, 'sync')
      } else if (finalResult.value && !finalResult.value.ok) {
        const workspace = ws.list.find((item) => item.id === cur.workspaceId)
        const repair = await call('saga.latestRepair', { workspaceId: cur.workspaceId })
        const richPrompt = repair.ok ? repair.data.prompt : null
        ui.openAiRepairPrompt({
          title: titleForGitRepair('sync'),
          message: '同步没有完成。可以把下面提示词交给 AI 面板，让它检查分支状态、远端状态和失败原因。',
          prompt: richPrompt ?? buildGitRepairPrompt({
            action: 'sync',
            workspaceName: workspace?.name,
            defaultBranch: workspace?.defaultBranch,
            phase: finalResult.value.phase,
            code: finalResult.value.code,
            message: finalResult.value.message
          })
        })
      }
      await ws.refresh()
    } else if (unsub) {
      unsub()
      unsub = null
    }
  }
)

onBeforeUnmount(() => {
  if (unsub) { unsub(); unsub = null }
})

function close(): void {
  if (!finished.value) return
  ui.closeSyncProgress()
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
      </DialogHeader>

      <ul class="space-y-2 text-sm">
        <li v-for="p in visiblePhases" :key="p.key" class="flex items-center gap-2">
          <span
            class="inline-block w-4 h-4 rounded-full text-center text-xxs leading-4"
            :class="statusOf(p.key) === 'ok'
              ? 'bg-green-500 text-white'
              : statusOf(p.key) === 'fail'
                ? 'bg-red-500 text-white'
                : 'bg-muted border border-border'"
          >{{ statusOf(p.key) === 'ok' ? '✓' : statusOf(p.key) === 'fail' ? '!' : '' }}</span>
          <span class="text-muted-foreground">{{ p.label }}</span>
        </li>
      </ul>

      <div v-if="finished && finalResult" class="text-sm">
        <div v-if="finalResult.ok" class="text-green-700">
          ✓ {{ title }}完成
          <span v-if="!finalResult.pushed" class="text-muted-foreground/70">（无远端，未推送）</span>
        </div>
        <div v-else class="p-3 rounded bg-destructive/10 text-destructive break-all">
          <p class="text-xs uppercase mb-1">{{ finalResult.phase || '失败' }} · {{ finalResult.code }}</p>
          <p class="text-xs">{{ finalResult.message }}</p>
          <p v-if="finalResult.code === 'CONFLICT'" class="text-xs mt-2">
            已自动打开冲突解决…
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button :disabled="!finished" @click="close">
          {{ finished ? '关闭' : '同步中…' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
