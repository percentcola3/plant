<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { GitPushSummary } from '@shared/git-push-summary'
import { call } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCommitTime } from '@/lib/branch-history'

const props = defineProps<{ workspaceId: string; relPath?: string; branch?: string }>()
const filterPath = ref(props.relPath ?? '')
const appliedPath = ref(props.relPath ?? '')
const records = ref<GitPushSummary[]>([])
const loading = ref(false)
const error = ref('')
const syncWarning = ref('')
const pendingSync = ref(false)
let sequence = 0
onBeforeUnmount(() => { sequence++ })

async function load(retry = false): Promise<void> {
  const path = filterPath.value.trim()
  const requestId = ++sequence
  loading.value = true
  error.value = ''
  const result = await call('git.pushHistory', { workspaceId: props.workspaceId, relPath: path || undefined, branch: props.branch, retry })
  if (requestId !== sequence) return
  loading.value = false
  if (!result.ok) { error.value = result.message; return }
  appliedPath.value = path
  records.value = result.data.records
  syncWarning.value = result.data.syncWarning ?? ''
  pendingSync.value = result.data.pendingSync
}
watch(() => [props.workspaceId, props.relPath, props.branch], () => {
  filterPath.value = props.relPath ?? ''
  void load()
}, { immediate: true })

function shownFiles(record: GitPushSummary) {
  const path = appliedPath.value
  return path ? record.files.filter(file => file.path === path || file.previousPath === path || file.path.startsWith(`${path}/`)) : record.files
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <form class="flex items-end gap-2" @submit.prevent="load()">
      <label class="flex min-w-0 flex-1 flex-col gap-1 text-xs">文档或目录路径
        <Input v-model="filterPath" placeholder="全部文件，或输入 features/login/PRD.md" />
      </label>
      <Button type="submit" variant="outline" size="sm" :disabled="loading">{{ loading ? '读取中…' : '查询 / 刷新' }}</Button>
    </form>
    <p class="text-xs text-muted-foreground">记录随 Git 共享，查询最近 500 次记录变更。基础记录表示 AI 未生成语义总结。</p>
    <div v-if="pendingSync || syncWarning" class="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{{ syncWarning || '有本地变更记录等待共享。' }}</span>
      <Button variant="outline" size="sm" :disabled="loading" @click="load(true)">重试同步记录</Button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <p v-else-if="!loading && !records.length" class="py-5 text-sm text-muted-foreground">暂无匹配的推送记录。启用此功能后的推送会自动生成记录。</p>
    <article v-for="record in records" :key="record.id" class="rounded-md border border-border bg-background p-3">
      <div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{{ formatCommitTime(record.pushedAt) }} · {{ record.branch }}</span>
        <span>{{ record.source === 'ai' ? 'AI 总结' : '基础变更记录' }}</span>
      </div>
      <p class="mt-2 whitespace-pre-wrap break-words text-sm">{{ record.summary }}</p>
      <p class="mt-1 break-all text-xs text-muted-foreground">提交人：{{ record.author }} · {{ record.baseSha?.slice(0, 8) || '新分支' }} → {{ record.headSha.slice(0, 8) }}</p>
      <details class="mt-3" :open="!!appliedPath">
        <summary class="cursor-pointer text-xs">文档与文件变化（{{ shownFiles(record).length }}）</summary>
        <ul class="mt-2 flex flex-col gap-2">
          <li v-for="file in shownFiles(record)" :key="file.path" class="border-l border-border pl-3 text-xs">
            <p class="break-all font-mono text-muted-foreground">{{ file.previousPath ? `${file.previousPath} → ` : '' }}{{ file.path }}</p>
            <p class="mt-1 whitespace-pre-wrap break-words">{{ file.summary }}</p>
          </li>
        </ul>
      </details>
      <p v-if="record.filesTruncated || record.diffTruncated" class="mt-2 text-xs text-muted-foreground">{{ record.filesTruncated ? '文件清单过长，记录已截断。' : '总结基于部分文本差异；未采样文件只列出变更类型。' }}</p>
    </article>
  </div>
</template>
