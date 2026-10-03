<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DialogRoot as Dialog, DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from 'reka-ui'
import { GitCommitHorizontal, X } from 'lucide-vue-next'
import type { GitCommitSummary } from '@shared/types'
import { call } from '@/lib/api'
import { formatCommitTime } from '@/lib/branch-history'
import { Button } from '@/components/ui/button'

const props = defineProps<{ workspaceId: string; relPath: string; name?: string }>()
const emit = defineEmits<{ close: [] }>()
const commits = ref<GitCommitSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const hasMore = ref(true)
const offset = ref(0)
let requestSeq = 0
const title = computed(() => props.name ?? props.relPath.split('/').at(-1) ?? '项目')

async function load(reset = false): Promise<void> {
  if (loading.value && !reset) return
  const seq = ++requestSeq
  loading.value = true
  error.value = null
  if (reset) { commits.value = []; offset.value = 0; hasMore.value = true }
  const result = await call('git.history', {
    workspaceId: props.workspaceId, relPath: props.relPath, limit: 30, offset: offset.value
  })
  if (seq !== requestSeq) return
  loading.value = false
  if (!result.ok) { error.value = result.message; return }
  offset.value += result.data.length
  commits.value = [...new Map([...commits.value, ...result.data].map(commit => [commit.sha, commit])).values()]
    .sort((a, b) => Date.parse(b.authoredAt) - Date.parse(a.authoredAt))
  hasMore.value = result.data.length === 30
}
watch(() => [props.workspaceId, props.relPath], () => { void load(true) }, { immediate: true })
</script>

<template>
  <Dialog :open="true" @update:open="value => { if (!value) emit('close') }">
    <DialogPortal>
      <DialogOverlay class="project-history-overlay" />
      <DialogContent class="project-history-drawer">
        <header class="project-history-drawer__header">
          <div class="min-w-0">
            <DialogTitle class="text-sm font-semibold">变更记录 · {{ title }}</DialogTitle>
            <DialogDescription class="mt-1 truncate text-xs text-muted-foreground" :title="relPath">{{ relPath }} · 按提交时间排列</DialogDescription>
          </div>
          <DialogClose class="project-history-drawer__close" aria-label="关闭变更记录"><X :size="16" /></DialogClose>
        </header>
        <div class="project-history-drawer__body">
          <div class="mb-5 flex items-center justify-between text-xs text-muted-foreground">
            <span>项目 Git 历史</span>
            <Button variant="ghost" size="sm" :disabled="loading" @click="load(true)">刷新</Button>
          </div>
          <p v-if="error" role="alert" class="mb-4 text-xs text-destructive">{{ error }}</p>
          <p v-if="loading && !commits.length" class="text-xs text-muted-foreground">正在读取提交记录…</p>
          <p v-else-if="!commits.length && !error" class="text-xs text-muted-foreground">这个项目还没有提交记录。</p>
          <ol v-if="commits.length" class="project-history-timeline">
            <li v-for="commit in commits" :key="commit.sha" class="project-history-timeline__entry">
              <span class="project-history-timeline__dot" aria-hidden="true"><GitCommitHorizontal :size="14" /></span>
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span class="font-medium text-foreground" :title="commit.authorEmail">{{ commit.authorName.trim() || commit.authorEmail || '未知提交人' }}</span>
                <time :datetime="commit.authoredAt">{{ formatCommitTime(commit.authoredAt) }}</time>
              </div>
              <p class="mt-2 break-words text-sm leading-relaxed">{{ commit.subject || '无提交说明' }}</p>
              <span class="mt-2 block font-mono text-[10px] text-muted-foreground">{{ commit.shortSha }}</span>
            </li>
          </ol>
          <Button v-if="hasMore && commits.length" variant="outline" size="sm" class="mt-3 w-full" :disabled="loading" @click="load()">{{ loading ? '读取中…' : '加载更早的记录' }}</Button>
          <Button v-else-if="error" variant="outline" size="sm" @click="load()">重试</Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </Dialog>
</template>

<style scoped>
.project-history-overlay { position: fixed; inset: 0; z-index: 50; background: #0005; }
.project-history-drawer { position: fixed; top: 8px; right: 8px; bottom: 8px; z-index: 50; display: flex; flex-direction: column; width: min(460px, calc(100vw - 16px)); border: 1px solid var(--color-border-subtle); border-radius: 16px; background: var(--color-bg-panel); color: var(--color-text-primary); box-shadow: var(--shadow-md); overflow: hidden; }
.project-history-drawer[data-state='open'] { animation: drawer-enter 180ms ease-out; }
.project-history-drawer__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 22px 20px 18px; border-bottom: 1px solid var(--color-border-subtle); }
.project-history-drawer__close { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 28px; height: 28px; border-radius: 8px; color: var(--color-text-muted); }
.project-history-drawer__close:hover { background: var(--color-bg-hover); }
.project-history-drawer__close:focus-visible { outline: 2px solid var(--color-border-strong); outline-offset: 2px; }
.project-history-drawer__body { min-height: 0; flex: 1; overflow-y: auto; padding: 16px 24px; }
.project-history-timeline { margin-left: 8px; border-left: 1px solid var(--color-border); }
.project-history-timeline__entry { position: relative; padding: 0 0 28px 24px; }
.project-history-timeline__dot { position: absolute; top: 0; left: -10px; display: flex; justify-content: center; align-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--color-bg-panel); color: var(--color-text-muted); }
@keyframes drawer-enter { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .project-history-drawer[data-state='open'] { animation: none; } }
</style>
