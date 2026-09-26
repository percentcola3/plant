<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { call } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const ui = useUiStore()

type ConflictChunk = {
  startLine: number
  separatorLine: number
  endLine: number
  ours: string
  theirs: string
}

type ConflictFile = {
  relPath: string
  binary: boolean
  chunks: ConflictChunk[]
  resolved?: boolean
}

const inProgress = ref<'rebase' | 'merge' | 'none'>('none')
const files = ref<ConflictFile[]>([])
const loading = ref(false)
const acting = ref(false)
const error = ref<string | null>(null)

const allResolved = computed(() => files.value.length > 0 && files.value.every((f) => f.resolved))

const open = computed({
  get: () => !!ui.conflictResolve,
  set: (v) => { if (!v) close() },
})

async function refresh(): Promise<void> {
  if (!ui.conflictResolve) return
  loading.value = true
  error.value = null
  const r = await call('conflict.list', { workspaceId: ui.conflictResolve.workspaceId })
  loading.value = false
  if (!r.ok) {
    error.value = r.message
    return
  }
  inProgress.value = r.data.inProgress
  files.value = r.data.files.map((f) => ({ ...f, resolved: false }))
}

watch(
  () => ui.conflictResolve,
  (cur) => {
    if (cur) {
      void refresh()
    } else {
      files.value = []
      inProgress.value = 'none'
    }
  },
)

async function pickSide(file: ConflictFile, side: 'ours' | 'theirs'): Promise<void> {
  if (!ui.conflictResolve) return
  acting.value = true
  const r = await call('conflict.pickSide', {
    workspaceId: ui.conflictResolve.workspaceId,
    relPath: file.relPath,
    side,
  })
  acting.value = false
  if (r.ok) {
    file.resolved = true
  } else {
    ui.showToast('error', `${file.relPath}: ${r.message}`)
  }
}

// AI 解决改为异步后台任务：点击后立即关闭对话框释放用户，完成时由事件回调处理。
// 组件始终挂载（MainWindow 无条件渲染），故一次性订阅 conflict.aiResolve.done:<id>
// 即使对话框已关也能收到。
//
// 分层兜底：先 spawn 自动解决；处理不了（失败/部分失败/异常）再升级到 AI 对话面板，
// 让用户能看到 AI 的输出、取舍，claude 异常也直接暴露在面板里。
let unsubAiDone: (() => void) | null = null
let pendingConflictFiles: string[] = []     // 启动时快照，供失败 fallback 构建提示词

type AiResolveResult = {
  ok: boolean
  outcomes?: Array<{ relPath: string; applied: boolean }>
  continued?: boolean
  error?: string
}

function onAiResolveDone(payload: unknown): void {
  const result = payload as AiResolveResult
  const outcomes = result.ok ? (result.outcomes ?? []) : []
  const appliedSet = new Set(outcomes.filter((o) => o.applied).map((o) => o.relPath))
  const unresolved = pendingConflictFiles.filter((rp) => !appliedSet.has(rp))
  const applied = appliedSet.size
  const total = pendingConflictFiles.length

  // 全部解决且已自动 continue → 完美收尾
  if (result.ok && result.continued && unresolved.length === 0) {
    ui.showToast('success', `AI 已解决 ${applied}/${total} 个冲突并完成合并`)
    return
  }
  // 全解决了但没自动 continue（罕见）→ 提示手动继续，不必开面板
  if (result.ok && unresolved.length === 0) {
    ui.showToast('info', 'AI 已解决全部冲突，请打开冲突面板点「继续」完成合并', 5000)
    return
  }
  // 处理不了 → 升级到 AI 对话面板：用户可见 AI 输出 + 取舍 + 异常
  handoffToAiPanel(unresolved.length > 0 ? unresolved : pendingConflictFiles, result)
}

// 把没处理完的冲突交给可见的 AI 对话面板（复用 AiRepairPromptDialog）。
function handoffToAiPanel(relPaths: string[], result: AiResolveResult): void {
  const reason = result.ok
    ? `自动解决了 ${result.outcomes?.filter((o) => o.applied).length ?? 0}/${pendingConflictFiles.length} 个，剩余需手动`
    : `自动解决失败：${result.error ?? '未知'}`
  const prompt = [
    '当前仓库处于 rebase / merge 冲突中，自动解决没能处理以下文件：',
    relPaths.map((r) => `- ${r}`).join('\n'),
    '',
    '请帮我：',
    '1. 逐个查看上述冲突文件（含 <<<<<<< ======= >>>>>>> 标记），结合上下文给出合理合并版本并写入；',
    '2. 对已解决的文件执行 git add；',
    '3. 全部解决后执行 git rebase --continue（或 merge --continue）完成合并；',
    '4. 处理过程中说明你的取舍，遇到无法判断的保留冲突标记交给我。'
  ].join('\n')
  ui.openAiRepairPrompt({
    title: 'AI 自动解决未完成',
    message: `${reason}。已为你打开 AI 对话——复制提示词交给 AI，你能看到它的处理过程与取舍。`,
    prompt
  })
}

onUnmounted(() => {
  unsubAiDone?.()
  unsubAiDone = null
})

async function letAiResolve(): Promise<void> {
  if (!ui.conflictResolve) return
  const workspaceId = ui.conflictResolve.workspaceId
  // 启动前快照冲突文件，供失败时 fallback 构建提示词（对话框即将关闭）
  pendingConflictFiles = files.value.map((f) => f.relPath)
  const r = await call('conflict.aiResolve', { workspaceId })
  if (!r.ok) {
    ui.showToast('error', `启动失败：${r.message}`, 4500)
    return
  }
  if (!r.data.started) {
    ui.showToast('info', 'AI 正在处理中，完成后通知你', 3000)
    return
  }
  // 订阅本次完成事件（一次性，收到即解绑）
  unsubAiDone?.()
  unsubAiDone = window.events.on(`conflict.aiResolve.done:${workspaceId}`, (payload: unknown) => {
    unsubAiDone?.()
    unsubAiDone = null
    onAiResolveDone(payload)
  })
  ui.showToast('info', 'AI 开始处理冲突，完成后通知你（处理不了会自动打开 AI 对话）', 4500)
  ui.closeConflictResolve()
}

async function continueOp(): Promise<void> {
  if (!ui.conflictResolve) return
  acting.value = true
  const r = await call('conflict.continue', { workspaceId: ui.conflictResolve.workspaceId })
  acting.value = false
  if (r.ok) {
    ui.showToast('success', '冲突已解决，继续后续操作')
    ui.closeConflictResolve()
  } else {
    error.value = r.message
  }
}

async function abortOp(): Promise<void> {
  if (!ui.conflictResolve) return
  acting.value = true
  const r = await call('conflict.abort', { workspaceId: ui.conflictResolve.workspaceId })
  acting.value = false
  if (r.ok) {
    ui.showToast('info', '已中止，回到操作前状态')
    ui.closeConflictResolve()
  } else {
    error.value = r.message
  }
}

function close(): void {
  if (acting.value) return
  ui.closeConflictResolve()
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[80vh] flex-col sm:max-w-[760px]">
      <DialogHeader class="flex flex-row items-center justify-between gap-4 space-y-0">
        <DialogTitle>解决冲突</DialogTitle>
        <span class="text-xs text-muted-foreground/70">{{ inProgress === 'rebase' ? '合并公共空间 (rebase)' : inProgress === 'merge' ? '合入分支 (merge)' : '当前没有进行中的操作' }}</span>
      </DialogHeader>

      <div class="flex items-center gap-2 text-xs">
        <Button size="sm" :disabled="acting" @click="letAiResolve">让 AI 解决全部</Button>
        <Button variant="outline" size="sm" :disabled="acting" @click="refresh">刷新</Button>
        <span class="text-muted-foreground/70 ml-auto">{{ files.filter((f) => f.resolved).length }}/{{ files.length }} 已处理</span>
      </div>

      <div v-if="loading" class="text-xs text-muted-foreground/70">加载中…</div>
      <div v-else-if="files.length === 0" class="text-xs text-muted-foreground/70">没有冲突</div>
      <ul v-else class="flex-1 overflow-y-auto space-y-3 text-sm">
        <li
          v-for="f in files"
          :key="f.relPath"
          class="border border-border rounded p-3"
          :class="f.resolved ? 'bg-green-50/50 border-green-200' : ''"
        >
          <div class="flex items-center gap-2 mb-2">
            <span class="font-mono text-xs flex-1 truncate">{{ f.relPath }}</span>
            <span v-if="f.binary" class="text-xxs text-muted-foreground/70 px-2 py-0.5 bg-muted rounded">二进制</span>
            <span v-if="f.resolved" class="text-xxs text-green-700">✓ 已处理</span>
            <Button variant="outline" size="sm" :disabled="acting" @click="pickSide(f, 'ours')">保留我的</Button>
            <Button variant="outline" size="sm" :disabled="acting" @click="pickSide(f, 'theirs')">保留对方</Button>
          </div>
          <div v-if="!f.binary && f.chunks.length > 0" class="space-y-2">
            <div
              v-for="(c, i) in f.chunks"
              :key="i"
              class="grid grid-cols-2 gap-2 text-xxs font-mono"
            >
              <pre class="p-2 bg-amber-50 rounded overflow-x-auto whitespace-pre-wrap break-all">我的：{{ c.ours }}</pre>
              <pre class="p-2 bg-sky-50 rounded overflow-x-auto whitespace-pre-wrap break-all">对方：{{ c.theirs }}</pre>
            </div>
          </div>
          <p v-else-if="!f.binary" class="text-xxs text-muted-foreground/70">未检测到 &lt;&lt;&lt;&lt;&lt;&lt;&lt; 标记，可能需要手动用 IDE 打开</p>
        </li>
      </ul>

      <p v-if="error" class="p-2 rounded bg-destructive/10 text-xs text-destructive break-all">{{ error }}</p>

      <DialogFooter>
        <Button variant="outline" :disabled="acting" @click="abortOp">中止</Button>
        <Button :disabled="acting || !allResolved" @click="continueOp">
          {{ acting ? '处理中…' : '全部完成 / 继续' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
