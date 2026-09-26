<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import { call } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const ui = useUiStore()
const request = computed(() => ui.aiRepairPrompt)
const aborting = ref(false)

const open = computed({
  get: () => !!request.value,
  set: (v) => { if (!v) ui.closeAiRepairPrompt() },
})

async function copyPrompt(openTerminal: boolean): Promise<void> {
  const cur = request.value
  if (!cur) return
  const r = await call('system.copyToClipboard', { text: cur.prompt })
  if (!r.ok) {
    ui.showToast('error', `复制失败：${r.message}`, 4500)
    return
  }
  ui.showToast('success', '提示词已复制')
  if (openTerminal) {
    ui.openTerminalPanel()
    ui.closeGitOperationDialogs()
  }
}

// 放弃并清理：abort worktree 内 rebase + 移除临时 worktree（仅团队推送冲突场景）
async function abortAndClose(): Promise<void> {
  const cur = request.value
  if (!cur?.abort) return
  aborting.value = true
  try {
    const r = await call('team.abort', cur.abort)
    if (!r.ok) {
      ui.showToast('error', `清理失败：${r.message}`, 4500)
      return
    }
    ui.showToast('success', '已放弃并清理临时目录')
    ui.closeAiRepairPrompt()
  } finally {
    aborting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[640px]">
      <DialogHeader>
        <DialogTitle>{{ request?.title }}</DialogTitle>
        <DialogDescription class="leading-6">
          {{ request?.message }}
        </DialogDescription>
      </DialogHeader>
      <pre class="max-h-[280px] overflow-auto rounded border border-border/60 bg-muted p-3 text-xs leading-5 text-muted-foreground whitespace-pre-wrap">{{ request?.prompt }}</pre>
      <DialogFooter>
        <Button v-if="request?.abort" variant="outline" :disabled="aborting" @click="abortAndClose">
          {{ aborting ? '清理中…' : '放弃并清理' }}
        </Button>
        <Button variant="outline" @click="copyPrompt(false)">复制提示词</Button>
        <Button @click="copyPrompt(true)">复制并打开 AI 对话</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
