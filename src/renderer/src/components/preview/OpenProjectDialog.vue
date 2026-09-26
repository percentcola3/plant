<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { call } from '@/lib/api'
import { usePreviewStore } from '@/stores/preview'
import { useWorkspacesStore } from '@/stores/workspaces'
import { collectProjectPickerItems, createPreviewProjectContext, type ProjectPickerItem } from '@/lib/preview/preview-project'
import { fixedUxSpaceSlug, isOutputsFirstUxProject } from '@/lib/fixed-ux-space'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const open = defineModel<boolean>('open', { default: false })
const workspaces = useWorkspacesStore()
const preview = usePreviewStore()

const workspaceId = ref('')
const spaceSlug = ref('')
const projectRelPath = ref('')
const spaces = ref<Array<{ slug: string; label: string }>>([])
const projects = ref<ProjectPickerItem[]>([])
const loadingSpaces = ref(false)
const loadingProjects = ref(false)
const submitting = ref(false)
const error = ref('')
let loadSeq = 0

const gitProjects = computed(() => workspaces.list.filter(item => !item.hidden && item.kind === 'ux'))
const selectedGitProject = computed(() => gitProjects.value.find(item => item.id === workspaceId.value) ?? null)
const selectedProject = computed(() => projects.value.find(item => item.relPath === projectRelPath.value) ?? null)
const hideWorkspacePicker = computed(() =>
  isOutputsFirstUxProject(
    selectedGitProject.value,
    selectedGitProject.value?.id === workspaces.activeId ? workspaces.scan : null
  )
)
const dialogDescription = computed(() =>
  hideWorkspacePicker.value
    ? '选择 Git 项目和要打开的内部项目。'
    : '选择 Git 项目、工作空间和要打开的项目。'
)

watch(open, (value) => {
  if (!value) return
  const activeVisible = gitProjects.value.find(item => item.id === workspaces.activeId)
  workspaceId.value = activeVisible?.id ?? gitProjects.value[0]?.id ?? ''
  spaceSlug.value = ''
  projectRelPath.value = ''
  error.value = ''
  void loadSpaces()
})

watch(workspaceId, (_next, previous) => {
  if (!open.value || !previous) return
  spaceSlug.value = ''
  projectRelPath.value = ''
  void loadSpaces()
})

watch(spaceSlug, (_next, previous) => {
  if (!open.value || !previous) return
  projectRelPath.value = ''
  void loadProjects()
})

async function loadSpaces(): Promise<void> {
  const id = workspaceId.value
  if (!id) return
  const seq = ++loadSeq
  loadingSpaces.value = true
  error.value = ''
  const result = await call('personalSpace.list', { workspaceId: id })
  if (seq !== loadSeq) return
  loadingSpaces.value = false
  if (!result.ok) {
    spaces.value = []
    error.value = result.message
    return
  }
  spaces.value = result.data.spaces.map(space => ({
    slug: space.slug,
    label: space.displayName ?? (space.isPublic ? '公共空间' : space.slug)
  }))
  const pinnedSlug = fixedUxSpaceSlug(
    selectedGitProject.value,
    selectedGitProject.value?.id === workspaces.activeId ? workspaces.scan : null
  )
  spaceSlug.value = pinnedSlug ?? result.data.activeSlug ?? spaces.value[0]?.slug ?? ''
  await loadProjects()
}

async function loadProjects(): Promise<void> {
  const id = workspaceId.value
  const slug = spaceSlug.value
  if (!id || !slug) return
  const seq = ++loadSeq
  loadingProjects.value = true
  error.value = ''
  const result = await call('workspace.listSpaceFiles', {
    workspaceId: id,
    spaceSlug: slug,
    relDir: 'outputs',
    recursive: true
  })
  if (seq !== loadSeq) return
  loadingProjects.value = false
  if (!result.ok) {
    projects.value = []
    error.value = result.message
    return
  }
  projects.value = collectProjectPickerItems(result.data)
  projectRelPath.value = projects.value[0]?.relPath ?? ''
}

async function submit(): Promise<void> {
  const item = selectedProject.value
  if (!workspaceId.value || !spaceSlug.value || !item || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const activated = await workspaces.activateSpace(workspaceId.value, spaceSlug.value)
    if (!activated) return
    preview.openProject({
      project: createPreviewProjectContext(workspaceId.value, spaceSlug.value, item.relPath, item.name),
      primaryRelPath: item.htmlRelPath
    })
    open.value = false
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>打开项目</DialogTitle>
        <DialogDescription>{{ dialogDescription }}</DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 py-2">
        <label class="grid gap-1.5 text-xs font-medium">
          <span>Git 项目</span>
          <select v-model="workspaceId" class="h-9 rounded-md border border-border bg-background px-3 text-sm">
            <option v-for="item in gitProjects" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <label v-if="!hideWorkspacePicker" class="grid gap-1.5 text-xs font-medium">
          <span>工作空间</span>
          <select v-model="spaceSlug" class="h-9 rounded-md border border-border bg-background px-3 text-sm" :disabled="loadingSpaces">
            <option v-for="space in spaces" :key="space.slug" :value="space.slug">{{ space.label }}</option>
          </select>
        </label>
        <label class="grid gap-1.5 text-xs font-medium">
          <span>项目</span>
          <select v-model="projectRelPath" class="h-9 rounded-md border border-border bg-background px-3 text-sm" :disabled="loadingProjects">
            <option v-for="item in projects" :key="item.relPath" :value="item.relPath">{{ item.name }}</option>
          </select>
        </label>
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
        <p v-else-if="!loadingProjects && spaceSlug && projects.length === 0" class="text-xs text-muted-foreground">当前没有可打开的项目。</p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">取消</Button>
        <Button :disabled="!selectedProject || submitting" @click="submit">{{ submitting ? '打开中…' : '打开' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
