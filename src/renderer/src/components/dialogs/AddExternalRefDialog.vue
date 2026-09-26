<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useExternalRefsStore } from '@/stores/external-refs'
import { call } from '@/lib/api'
import type { ExternalRefCategory } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

const ui = useUiStore()
const ws = useWorkspacesStore()
const ext = useExternalRefsStore()

type Source = 'git' | 'local'

const source = ref<Source>('git')
const category = ref<ExternalRefCategory>('knowledge')
const alias = ref('')
const url = ref('')
const localPath = ref('')
const usageNote = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)
const needsSshSetup = ref(false)

const headerText = computed(() => category.value === 'uikit' ? '绑定 UX 资产资源包' : '绑定知识库资源包')
const subText = computed(() => category.value === 'uikit'
  ? '从本地目录或 Git 仓库安装并绑定。项目内只读。'
  : '从本地目录或 Git 仓库安装并绑定。可绑定多个。')

const canSubmit = computed(() => {
  if (submitting.value) return false
  if (!alias.value.trim()) return false
  if (source.value === 'git') return !!url.value.trim()
  return !!localPath.value.trim()
})

const open = computed({
  get: () => ui.addExternalRefOpen !== false,
  set: (v) => { if (!v) close() },
})

watch(
  () => ui.addExternalRefOpen,
  (cur) => {
    if (cur) {
      category.value = cur.defaultCategory
      source.value = 'git'
      alias.value = ''
      url.value = ''
      localPath.value = ''
      usageNote.value = ''
      error.value = null
      needsSshSetup.value = false
    }
  },
)

async function pickLocal(): Promise<void> {
  const r = await call('system.selectDirectory', { title: '选择本地目录' })
  if (r.ok && r.data) localPath.value = r.data.path
}

function close(): void {
  if (submitting.value) return
  ui.addExternalRefOpen = false
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  if (!ws.active || ws.active.kind !== 'project') {
    error.value = '请先选择一个项目'
    return
  }
  submitting.value = true
  error.value = null
  try {
    const createdResult = source.value === 'git'
      ? await ext.addToPool(alias.value.trim(), category.value, {
          kind: 'git',
          url: url.value.trim(),
        })
      : await ext.addToPool(alias.value.trim(), category.value, { kind: 'local', sourcePath: localPath.value.trim() })
    if (!createdResult.ok) {
      applyExternalAddError(createdResult.code, createdResult.message)
      return
    }
    const created = createdResult.data
    // PM 项目跨端常见两个资产库都要用；binding.assetLibrary 下游也并未实际选用具体 lib
    // （scanner 始终扫源仓所有 lib），所以这里不再让用户挑，attach 时也不传 assetLibrary。
    await attachAndClose(created.id, created.alias)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    submitting.value = false
  }
}

async function attachAndClose(externalRefId: string, displayAlias: string): Promise<void> {
  if (!ws.active) return
  try {
    await ext.attach(ws.active.id, externalRefId, { usageNote: usageNote.value })
    await ws.refreshScan(ws.active.id)
    ui.showToast('success', `已绑定资源包：${displayAlias}`)
    ui.addExternalRefOpen = false
  } catch (e) {
    error.value = (e as Error).message
  }
}

function errorMessageForExternalAdd(code: string, message: string): string {
  if (code === 'SSH_KEY_REQUIRED' || code === 'SSH_AUTH_FAILED') return message
  if (code === 'GIT_FAILED' && /HTTP Basic: Access denied|Authentication failed/i.test(message)) {
    return [
      'Git 认证失败。',
      '如果是自建 GitLab HTTPS 地址，请在弹出的凭据窗口输入用户名，并把 Personal Access Token 填到令牌/密码框；普通登录密码通常不可用。',
      '更推荐改用 SSH 地址，例如 git@gitlab.example.com:team/knowledge.git。',
      '',
      message,
    ].join('\n')
  }
  return `${code}: ${message}`
}

function applyExternalAddError(code: string, message: string): void {
  needsSshSetup.value = code === 'SSH_KEY_REQUIRED' || code === 'SSH_AUTH_FAILED'
  error.value = errorMessageForExternalAdd(code, message)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[520px]" @keydown.esc="close">
      <DialogHeader>
        <DialogTitle>{{ headerText }}</DialogTitle>
        <DialogDescription>{{ subText }}</DialogDescription>
      </DialogHeader>

      <div class="text-xs font-medium text-muted-foreground">安装新资源包</div>

      <div class="flex gap-1 text-xs">
        <Button
          size="sm"
          :variant="source === 'git' ? 'default' : 'secondary'"
          @click="source = 'git'"
        >git 仓库</Button>
        <Button
          size="sm"
          :variant="source === 'local' ? 'default' : 'secondary'"
          @click="source = 'local'"
        >本地目录</Button>
      </div>

      <div class="space-y-3 text-sm">
        <div class="space-y-1">
          <label class="block text-xs text-muted-foreground">别名</label>
          <Input
            v-model="alias"
            :placeholder="category === 'uikit' ? 'saas-uikit' : 'product-spec'"
            class="h-9 font-mono"
          />
          <p class="text-xs text-muted-foreground/70">全局唯一；项目内挂载点 = .external/&lt;alias&gt;/</p>
        </div>

        <div v-if="source === 'git'" class="space-y-1">
          <label class="block text-xs text-muted-foreground">git 地址</label>
          <Input
            v-model="url"
            :placeholder="category === 'uikit' ? 'git@github.com:org/uikit.git' : 'git@github.com:org/spec.git'"
            class="h-9 font-mono"
          />
        </div>

        <div v-else class="space-y-1">
          <label class="block text-xs text-muted-foreground">本地目录</label>
          <div class="flex gap-2">
            <Input
              v-model="localPath"
              placeholder="/Users/me/data"
              class="flex-1 h-9 font-mono"
            />
            <Button variant="outline" size="sm" @click="pickLocal">选择…</Button>
          </div>
        </div>

        <div class="space-y-1">
          <label class="block text-xs text-muted-foreground">当前项目的 AI 使用说明（可选）</label>
          <textarea
            v-model="usageNote"
            maxlength="4000"
            rows="3"
            class="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            placeholder="例如：本项目只使用移动端组件，历史文档仅作背景参考。"
          />
          <p class="text-xs text-muted-foreground/70">资源包可在根目录提供 AI_USAGE.md；这里的说明只对当前项目生效。</p>
        </div>
      </div>

      <div v-if="error" class="flex items-start justify-between gap-3 rounded bg-destructive/10 p-2 text-xs text-destructive">
        <p class="whitespace-pre-line break-all">{{ error }}</p>
        <Button
          v-if="needsSshSetup"
          variant="outline"
          size="sm"
          class="shrink-0"
          @click="ui.openSettings('ssh')"
        >配置 SSH Key</Button>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="submitting" @click="close">取消</Button>
        <Button :disabled="!canSubmit" @click="submit">
          {{ submitting ? '安装中…' : '安装并绑定' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
