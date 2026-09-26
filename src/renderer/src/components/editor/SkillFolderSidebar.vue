<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DocTreeNode } from '@shared/types'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import FileTree from '@/components/common/FileTree.vue'

const props = defineProps<{
  workspaceId: string
  rootRelPath: string
  activeRelPath: string
}>()

const emit = defineEmits<{
  (event: 'select', relPath: string): void
}>()

const ui = useUiStore()
const tree = ref<DocTreeNode[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
let loadSequence = 0

function safeChildPath(value: string): string | null {
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) return null
  return normalized
}

async function refresh(): Promise<void> {
  const sequence = ++loadSequence
  loading.value = true
  error.value = null
  const result = await call('workspace.listFiles', {
    workspaceId: props.workspaceId,
    relDir: props.rootRelPath
  })
  if (sequence !== loadSequence) return
  loading.value = false
  if (!result.ok) {
    error.value = result.message
    tree.value = []
    return
  }
  tree.value = result.data
}

async function createFile(): Promise<void> {
  const value = await ui.askPrompt({
    title: '新建 Skill 文件',
    message: '路径相对于当前 Skill 文件夹，例如 scripts/check.py 或 references.md。',
    placeholder: 'references.md',
    confirmLabel: '创建'
  })
  if (value === null) return
  const childPath = safeChildPath(value)
  if (!childPath) {
    ui.showToast('error', '请输入 Skill 文件夹内的有效相对路径')
    return
  }
  const targetRelPath = `${props.rootRelPath}/${childPath}`
  const existing = await call('editor.entryExists', {
    workspaceId: props.workspaceId,
    relPath: targetRelPath,
    scope: 'project'
  })
  if (!existing.ok) {
    ui.showToast('error', `检查文件失败：${existing.message}`)
    return
  }
  if (existing.data.exists) {
    ui.showToast('error', `文件已存在：${childPath}`)
    return
  }
  const result = await call('editor.writeTextFile', {
    workspaceId: props.workspaceId,
    relPath: targetRelPath,
    content: '',
    scope: 'project'
  })
  if (!result.ok) {
    ui.showToast('error', `创建文件失败：${result.message}`)
    return
  }
  await refresh()
  emit('select', targetRelPath)
}

async function createFolder(): Promise<void> {
  const value = await ui.askPrompt({
    title: '新建 Skill 目录',
    message: '路径相对于当前 Skill 文件夹。',
    placeholder: 'scripts',
    confirmLabel: '创建'
  })
  if (value === null) return
  const childPath = safeChildPath(value)
  if (!childPath) {
    ui.showToast('error', '请输入 Skill 文件夹内的有效相对路径')
    return
  }
  const result = await call('editor.createEntry', {
    workspaceId: props.workspaceId,
    targetRelPath: `${props.rootRelPath}/${childPath}`,
    scope: 'project'
  })
  if (!result.ok) {
    ui.showToast('error', `创建目录失败：${result.message}`)
    return
  }
  await refresh()
}

watch(
  () => [props.workspaceId, props.rootRelPath],
  () => void refresh(),
  { immediate: true }
)
</script>

<template>
  <aside class="skill-folder">
    <header class="skill-folder__header">
      <div class="skill-folder__title">
        <span aria-hidden="true">📁</span>
        <span>Skill 文件夹</span>
      </div>
      <code :title="rootRelPath">{{ rootRelPath.split('/').slice(-1)[0] }}</code>
    </header>

    <div class="skill-folder__actions">
      <button type="button" @click="createFile">+ 文件</button>
      <button type="button" @click="createFolder">+ 目录</button>
      <button type="button" title="刷新" aria-label="刷新 Skill 文件夹" @click="refresh">↻</button>
    </div>

    <div class="skill-folder__tree">
      <div v-if="loading" class="skill-folder__state">加载中…</div>
      <div v-else-if="error" class="skill-folder__state is-error">{{ error }}</div>
      <FileTree
        v-else
        :nodes="tree"
        :active-rel-path="activeRelPath"
        empty-text="Skill 文件夹为空"
        @select="(relPath) => emit('select', relPath)"
      />
    </div>
  </aside>
</template>

<style scoped>
.skill-folder {
  display: flex;
  width: 236px;
  flex: 0 0 236px;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
}

.skill-folder__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 12px 10px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.skill-folder__title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 650;
}

.skill-folder__header code {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-folder__actions {
  display: flex;
  gap: 5px;
  padding: 8px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.skill-folder__actions button {
  height: 26px;
  cursor: pointer;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-base);
  padding: 0 8px;
  color: var(--color-text-secondary);
  font-size: 11px;
}

.skill-folder__actions button:hover {
  border-color: var(--color-accent-border);
  color: var(--color-accent-pressed);
}

.skill-folder__tree {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.skill-folder__state {
  padding: 8px;
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.skill-folder__state.is-error {
  color: #d92d20;
}
</style>
