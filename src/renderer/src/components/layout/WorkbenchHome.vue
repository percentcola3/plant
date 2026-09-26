<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ArrowRight, ArrowUp, Loader2, Sparkle } from 'lucide-vue-next'
import type { FeatureCard } from '@shared/types'
import { call } from '@/lib/api'
import { createPreviewProjectContext } from '@/lib/preview/preview-project'
import { usePreviewStore } from '@/stores/preview'
import { useUiStore } from '@/stores/ui'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useExternalRefsStore } from '@/stores/external-refs'
import { Button } from '@/components/ui/button'
import FeatureResourceDropdown from '@/components/resources/FeatureResourceDropdown.vue'
import ProjectCardMoreMenu from '@/components/layout/ProjectCardMoreMenu.vue'

const UNGROUPED_GROUP_VALUE = '__ungrouped__'

const workspaces = useWorkspacesStore()
const preview = usePreviewStore()
const ui = useUiStore()
const externalRefs = useExternalRefsStore()
const { active } = storeToRefs(workspaces)

const prompt = ref('')
const projects = ref<FeatureCard[]>([])
const loading = ref(false)
const building = ref(false)
const error = ref<string | null>(null)
const selectedExternalRefIds = ref<string[]>([])
const setResourcesAsDefault = ref(false)
const resourceDefaultsLoaded = ref(false)

const recentProjects = computed(() => [...projects.value]
  .sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''))
  .slice(0, 3))
const uniqueGroups = computed(() => {
  const groups = new Set<string>()
  for (const card of projects.value) {
    const group = projectGroupOf(card)
    if (group) groups.add(group)
  }
  return [...groups].sort()
})
const canBuild = computed(() => !!prompt.value.trim() && !building.value && resourceDefaultsLoaded.value)

function projectDisplayTime(value: string | null): string {
  if (!value) return '刚刚编辑'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '最近编辑'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function projectPreviewDetails(card: FeatureCard): string {
  const prd = card.prdRelPath ? `PRD · ${card.prdRelPath}` : 'PRD · 未配置'
  const uiCount = card.uiArtifacts.length
  return `${prd}    UI · ${uiCount} 个 UI 子页`
}

async function loadProjects(): Promise<void> {
  const workspace = active.value
  if (!workspace || workspace.kind !== 'project') return
  loading.value = true
  error.value = null
  const result = await call('feature.list', { workspaceId: workspace.id })
  loading.value = false
  if (!result.ok) {
    error.value = result.message
    return
  }
  projects.value = result.data
}

async function openProject(card: FeatureCard): Promise<void> {
  const workspace = active.value
  if (!workspace) return
  const project = createPreviewProjectContext(
    workspace.id,
    workspaces.personalSpace?.slug ?? '__public__',
    card.relPath,
    card.name
  )
  await call('uiProduct.seedAgentFiles', {
    workspaceId: workspace.id,
    productRelPath: card.relPath
  }).catch(() => undefined)
  preview.openProject({
    project,
    primaryRelPath: card.uiArtifacts[0]?.htmlRelPath ?? card.prdRelPath ?? undefined
  })
}

function projectGroupOf(card: FeatureCard): string | null {
  const stripped = card.relPath.replace(/^features\//, '')
  const segments = stripped.split('/').filter(Boolean)
  if (segments.length <= 1) return null
  return segments.slice(0, -1).join('/')
}

function normalizeProjectName(input: string): string {
  let rel = input.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!rel) throw new Error('请输入项目名称')
  if (rel.includes('..')) throw new Error('项目路径不能包含 ..')
  if (rel.startsWith('features/')) rel = rel.slice('features/'.length)
  rel = rel.replace(/\/index\.html?$/i, '').replace(/\.html?$/i, '')
  const segments = rel
    .split('/')
    .map((part) => part.trim().replace(/\s+/g, '-').replace(/[<>:"|?*]+/g, ''))
    .filter(Boolean)
  if (segments.length === 0) throw new Error('请输入有效的项目名称')
  return segments.join('/')
}

function normalizeProjectGroupName(input: string): string {
  const normalized = normalizeProjectName(input)
  if (normalized.includes('/')) throw new Error('分组名不能包含 /')
  return normalized
}

function buildProjectRelPath(nameOrPath: string, fallbackGroup: string | null): string {
  const normalized = normalizeProjectName(nameOrPath)
  if (normalized.includes('/')) return `features/${normalized}`
  return fallbackGroup ? `features/${fallbackGroup}/${normalized}` : `features/${normalized}`
}

function closeStaleProjectTabs(oldRelPath: string): void {
  for (const tabItem of [...preview.tabs]) {
    if (
      (tabItem.type === 'product' && tabItem.productMeta?.path === oldRelPath)
      || (tabItem.type === 'files' && tabItem.filesMeta?.rootRelPath === oldRelPath)
    ) {
      preview.closeTab(tabItem.id)
    }
  }
}

function deleteProject(card: FeatureCard): void {
  ui.askConfirm({
    title: '删除 feature',
    message: `确认删除 ${card.name}（${card.relPath}）？整个目录会被删掉。\n\n注意：本地删除后需要在 git 里 commit 才能同步到远端。`,
    confirmLabel: '删除',
    onConfirm: async () => {
      if (!active.value) return
      const result = await call('feature.delete', { workspaceId: active.value.id, relPath: card.relPath })
      if (!result.ok) {
        ui.showToast('error', `删除失败：${result.message}`, 4500)
        return
      }
      closeStaleProjectTabs(card.relPath)
      ui.showToast('info', `已删除 ${card.name}`)
      await loadProjects()
    }
  })
}

async function renameProject(card: FeatureCard): Promise<void> {
  if (!active.value) return
  const input = await ui.askPrompt({
    title: '重命名项目',
    message: `重命名 ${card.name}。名称不能包含 / （如需改分组请用「移动」）。`,
    placeholder: '例如：login-page',
    defaultValue: card.name,
    confirmLabel: '重命名'
  })
  if (!input) return
  let newSlug: string
  try {
    newSlug = normalizeProjectName(input)
    if (newSlug.includes('/')) {
      ui.showToast('error', '重命名不支持包含 /，请用「移动」改分组')
      return
    }
  } catch (e) {
    ui.showToast('error', e instanceof Error ? e.message : String(e))
    return
  }
  if (newSlug === card.name) return
  const result = await call('feature.rename', {
    workspaceId: active.value.id,
    relPath: card.relPath,
    newSlug
  })
  if (!result.ok) {
    ui.showToast('error', `重命名失败：${result.message}`)
    return
  }
  closeStaleProjectTabs(card.relPath)
  await loadProjects()
  ui.showToast('success', '项目已重命名')
}

function projectMoveOptions(card: FeatureCard): Array<{ label: string; value: string; description?: string }> {
  const currentGroup = projectGroupOf(card)
  const options = uniqueGroups.value.map((group) => ({
    label: group,
    value: group,
    description: group === currentGroup ? '当前分组' : `features/${group}/`
  }))
  return [
    {
      label: '未分组',
      value: UNGROUPED_GROUP_VALUE,
      description: currentGroup === null ? '当前分组' : '移动到 features/ 根目录'
    },
    ...options
  ]
}

async function moveProject(card: FeatureCard): Promise<void> {
  if (!active.value) return
  const currentGroup = projectGroupOf(card)
  const targetValue = await ui.askPrompt({
    title: '移动到分组',
    message: `选择 ${card.name} 的目标分组。需要新分组时请到项目列表新建分组。`,
    placeholder: '选择目标分组',
    defaultValue: currentGroup ?? UNGROUPED_GROUP_VALUE,
    confirmLabel: '移动',
    options: projectMoveOptions(card)
  })
  if (targetValue === null) return
  let normalizedGroup: string | null
  try {
    normalizedGroup = targetValue === UNGROUPED_GROUP_VALUE ? null : normalizeProjectGroupName(targetValue)
  } catch (e) {
    ui.showToast('error', e instanceof Error ? e.message : String(e))
    return
  }
  if ((normalizedGroup ?? null) === currentGroup) {
    ui.showToast('info', '已在目标分组')
    return
  }
  const result = await call('feature.move', {
    workspaceId: active.value.id,
    relPath: card.relPath,
    toGroup: normalizedGroup
  })
  if (!result.ok) {
    ui.showToast('error', `移动失败：${result.message}`)
    return
  }
  closeStaleProjectTabs(card.relPath)
  await loadProjects()
  ui.showToast('success', '项目已移动')
}

async function copyProject(card: FeatureCard): Promise<void> {
  if (!active.value) return
  const input = await ui.askPrompt({
    title: '复制项目',
    message: `复制 ${card.name} 为新的 feature 项目。`,
    placeholder: '例如：login-page-copy',
    defaultValue: `${card.name}-copy`,
    confirmLabel: '复制'
  })
  if (!input) return
  let targetRelPath: string
  try {
    targetRelPath = buildProjectRelPath(input, projectGroupOf(card))
  } catch (e) {
    ui.showToast('error', e instanceof Error ? e.message : String(e))
    return
  }
  const result = await call('editor.copyEntry', {
    workspaceId: active.value.id,
    sourceRelPath: card.relPath,
    targetRelPath,
    scope: 'project'
  })
  if (!result.ok) {
    ui.showToast('error', `复制失败：${result.message}`)
    return
  }
  await call('editor.deleteTextFile', {
    workspaceId: active.value.id,
    relPath: `${targetRelPath}/.publish.json`,
    scope: 'project'
  }).catch(() => undefined)
  await loadProjects()
  const copied = projects.value.find((item) => item.relPath === targetRelPath)
  if (copied) await openProject(copied)
  ui.showToast('success', '项目已复制')
}

// 首页「开始构建」不再用对话内容当目录名：项目统一叫「无名」，重名自动加索引。
// 对话原文通过 queueConversationDraft 交给 AI 生成页面内容。
async function createProject(): Promise<{
  featureRelPath: string
  prdRelPath: string | null
  indexHtmlRelPath: string | null
} | null> {
  const workspace = active.value
  if (!workspace) return null
  for (let index = 1; index <= 99; index += 1) {
    const slug = index === 1 ? '无名' : `无名-${index}`
    const result = await call('feature.create', {
      workspaceId: workspace.id,
      slug,
      externalRefIds: [...selectedExternalRefIds.value],
      setResourcesAsDefault: setResourcesAsDefault.value
    })
    if (result.ok) return result.data
    if (result.code !== 'EXISTS') {
      ui.showToast('error', `创建失败：${result.message}`, 5000)
      return null
    }
  }
  ui.showToast('error', '无名项目已达上限（99 个），请到项目列表清理后重试', 5000)
  return null
}

async function startBuild(): Promise<void> {
  const instruction = prompt.value.trim()
  const workspace = active.value
  if (!instruction || !workspace || building.value) return
  building.value = true
  try {
    const created = await createProject()
    if (!created) return
    const name = created.featureRelPath.split('/').at(-1) ?? '无名'
    const project = createPreviewProjectContext(
      workspace.id,
      workspaces.personalSpace?.slug ?? '__public__',
      created.featureRelPath,
      name
    )
    await call('uiProduct.seedAgentFiles', {
      workspaceId: workspace.id,
      productRelPath: created.featureRelPath
    }).catch(() => undefined)
    preview.openProject({
      project,
      primaryRelPath: created.indexHtmlRelPath ?? created.prdRelPath ?? undefined
    })
    ui.queueConversationDraft(instruction)
    prompt.value = ''
    setResourcesAsDefault.value = false
    await loadResourceDefaults()
  } finally {
    building.value = false
  }
}

async function loadResourceDefaults(): Promise<void> {
  try {
    await externalRefs.refreshPool()
    const settings = await call('settings.get', undefined)
    if (!settings.ok) return
    const available = new Set(externalRefs.pool.map((resource) => resource.id))
    selectedExternalRefIds.value = settings.data.defaultExternalRefIds.filter((id) => available.has(id))
  } finally {
    resourceDefaultsLoaded.value = true
  }
}

function onComposerKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void startBuild()
  }
}

onMounted(() => {
  void loadProjects()
  void loadResourceDefaults()
})
watch(() => active.value?.id, () => void loadProjects())
</script>

<template>
  <main class="workbench-home">
    <div class="workbench-home__content">
      <section class="build-hero" aria-labelledby="build-title">
        <div class="build-hero__eyebrow">
          <Sparkle class="build-hero__eyebrow-icon" :size="17" aria-hidden="true" />
          <span class="build-hero__gradient-text">PEEKA</span>
        </div>
        <h1 id="build-title" class="build-hero__gradient-text">下午好，今天想和 AI 一起做什么？</h1>

        <div class="build-composer" :class="{ 'is-busy': building }">
          <textarea
            v-model="prompt"
            aria-label="描述要构建的项目"
            placeholder="描述你的设计需求，例如：设计一个WEB后台订单管理，包含五个状态的订单管理及其流程"
            :disabled="building"
            @keydown="onComposerKeydown"
          />
          <div class="build-composer__footer">
            <div class="build-composer__options">
              <FeatureResourceDropdown
                v-model:selected-ids="selectedExternalRefIds"
                :resources="externalRefs.pool"
                :disabled="building"
              />
            </div>
            <button
              type="button"
              class="build-composer__submit"
              :class="{ 'build-composer__submit--ready': canBuild }"
              :disabled="!canBuild"
              :aria-label="building ? '正在创建…' : '开始构建'"
              :title="building ? '正在创建…' : '开始构建'"
              @click="startBuild"
            >
              <Loader2
                v-if="building"
                class="build-composer__submit-icon build-composer__submit-icon--spin"
                :stroke-width="1.8"
                aria-hidden="true"
              />
              <ArrowUp v-else class="build-composer__submit-icon" :stroke-width="1.8" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <section class="recent-projects" aria-labelledby="recent-title">
        <div class="recent-projects__header">
          <div>
            <h2 id="recent-title">最近编辑</h2>
          </div>
          <Button variant="ghost" size="sm" @click="ui.openProjectManagement()">
            查看全部
            <ArrowRight class="ml-1 h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <div v-if="loading && projects.length === 0" class="recent-projects__empty">正在加载项目…</div>
        <div v-else-if="error" class="recent-projects__error">{{ error }}</div>
        <div v-else-if="recentProjects.length === 0" class="recent-projects__empty">
          还没有项目，在上方描述你的第一个想法吧。
        </div>
        <div v-else class="recent-projects__grid">
          <article
            v-for="card in recentProjects"
            :key="card.relPath"
            class="project-card product-card group/card"
            role="button"
            tabindex="0"
            @click="openProject(card)"
            @keydown.enter.prevent="openProject(card)"
            @keydown.space.prevent="openProject(card)"
          >
            <div class="product-card__preview" aria-hidden="true">
              <div class="product-card__preview-cover">
                <span class="product-card__preview-tag">SAAS</span>
                <div class="product-card__preview-body">
                  <span class="product-card__preview-title">
                    <span class="product-card__preview-title-text">{{ card.name }}</span>
                  </span>
                  <span class="feature-card__preview-details">{{ projectPreviewDetails(card) }}</span>
                </div>
              </div>
            </div>
            <div class="product-card__meta">
              <div class="product-card__text">
                <h3 class="product-card__title">{{ card.name }}</h3>
                <div class="product-card__meta-line">
                  <span class="product-card__time">{{ projectDisplayTime(card.modifiedAt) }}</span>
                </div>
              </div>
              <ProjectCardMoreMenu
                @rename="renameProject(card)"
                @move="moveProject(card)"
                @copy="copyProject(card)"
                @delete="deleteProject(card)"
              />
            </div>
          </article>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.workbench-home {
  position: relative;
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow-y: auto;
  background: transparent;
  padding: 10vh 0 6vh;
}

.workbench-home__content {
  width: calc(100% - 80px);
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 0 24px;
}

.build-hero { text-align: center; }
.build-hero__gradient-text {
  color: var(--color-text-primary);
}
.build-hero__eyebrow { display: inline-flex; align-items: center; gap: 7px; font-size: 18px; font-weight: 700; letter-spacing: 0.02em; }
.build-hero__eyebrow-icon { flex: none; color: var(--color-text-primary); fill: currentColor; stroke: none; }
.build-hero h1 { margin: 22px 0 8px; font-size: 28px; font-weight: 720; letter-spacing: -0.035em; line-height: 1.15; }
.build-hero > p { margin: 0; color: var(--color-text-muted); font-size: 14px; }

.build-composer {
  width: 62%;
  max-width: 100%;
  margin: 46px auto 0;
  overflow: hidden;
  border: none;
  border-radius: 22px;
  background: var(--color-bg-elevated);
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--color-text-primary) 4%, transparent),
    0 8px 24px color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  text-align: left;
  transition:
    box-shadow 180ms ease,
    background-color 180ms ease;
}
.build-composer:focus-within {
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--color-text-primary) 5%, transparent),
    0 12px 32px color-mix(in srgb, var(--color-text-primary) 8%, transparent);
}
.build-composer.is-busy { opacity: 0.88; }
.build-composer textarea {
  display: block;
  width: 100%;
  min-height: 96px;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  padding: 14px 18px 4px;
  color: var(--color-text-primary);
  font: inherit;
  font-size: 15px;
  line-height: 1.7;
}
.build-composer textarea::placeholder {
  color: color-mix(in srgb, var(--color-text-muted) 88%, transparent);
}
.build-composer__footer {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px 10px 14px;
}
.build-composer__options {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}
.build-composer :deep(.feature-resource-dropdown__trigger) {
  gap: 5px;
  border: none;
  border-radius: 8px;
  background: transparent;
  padding: 6px 8px;
  color: var(--color-text-secondary);
  font-size: 12px;
  transition:
    background-color 160ms ease,
    color 160ms ease;
}
.build-composer :deep(.feature-resource-dropdown__trigger:hover:not(:disabled)) {
  border-color: transparent;
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
.build-composer :deep(.feature-resource-dropdown__trigger strong) {
  min-width: 16px;
  height: 16px;
  background: color-mix(in srgb, var(--color-text-tertiary) 16%, transparent);
  color: var(--color-text-secondary);
  font-size: 9px;
  font-weight: 700;
}
.build-composer :deep(.feature-resource-dropdown__trigger:hover:not(:disabled) strong) {
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  color: var(--color-accent);
}
.build-composer :deep(.feature-resource-dropdown__chevron) {
  opacity: 0.5;
}
.build-composer__submit {
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex: none;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-text-tertiary) 20%, var(--color-bg-elevated));
  color: var(--color-text-tertiary);
  cursor: default;
  transition:
    background-color 160ms ease,
    color 160ms ease,
    opacity 160ms ease,
    transform 160ms ease;
}
.build-composer__submit--ready {
  background: color-mix(in srgb, var(--color-text-primary) 88%, #000);
  color: #fff;
  box-shadow: none;
  cursor: pointer;
}
.build-composer__submit--ready:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-text-primary) 96%, #000);
  transform: translateY(-1px);
}
.build-composer__submit:disabled {
  opacity: 1;
}
.build-composer__submit:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--color-text-primary) 24%, transparent);
  outline-offset: 2px;
}
.build-composer__submit-icon {
  width: 17px;
  height: 17px;
  flex: none;
}
.build-composer__submit-icon--spin {
  animation: build-composer-submit-spin 0.8s linear infinite;
}
@keyframes build-composer-submit-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.recent-projects { margin-top: 64px; text-align: left; }
.recent-projects__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.recent-projects h2 { margin: 0; color: var(--color-text-primary); font-size: 17px; font-weight: 700; }
.recent-projects__header p { margin: 4px 0 0; color: var(--color-text-muted); font-size: 12px; }
.recent-projects__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px 20px; }
.recent-projects__empty, .recent-projects__error { display: flex; min-height: 110px; align-items: center; justify-content: center; border: 1px dashed var(--color-border); border-radius: 12px; color: var(--color-text-muted); font-size: 13px; }
.recent-projects__error { border-color: color-mix(in srgb, var(--color-error) 30%, var(--color-border)); color: var(--color-error); }
.project-card {
  display: flex;
  min-width: 0;
  cursor: pointer;
  flex-direction: column;
  gap: 8px;
  border: 0;
  background: transparent;
  text-align: left;
  transition: background var(--duration-normal, 180ms) var(--ease-out, ease);
}
.project-card:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; border-radius: 10px; }
.product-card__preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--color-product-card-border, var(--color-border-subtle));
  border-radius: 8px;
  background: var(--color-bg-base);
}
.product-card__preview-cover {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 16px 20px;
  background: #f8f4ec url('@/assets/project-preview-bg.png') center / cover no-repeat;
}
.product-card__preview-tag {
  z-index: 1;
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  margin-bottom: 8px;
  border-radius: 6px;
  background: #ff5f14;
  padding: 5px 12px;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.2;
}
.product-card__preview-body {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}
.product-card__preview-title { width: 100%; max-width: 100%; overflow: hidden; }
.product-card__preview-title-text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 28px;
  font-weight: 800;
  line-height: 1.3;
}
.feature-card__preview-details {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  overflow: hidden;
  color: #4a4a4a;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.product-card__meta { display: flex; align-items: center; gap: 8px; }
.product-card__text { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 4px; }
.product-card__title {
  overflow: hidden;
  margin: 0;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.product-card__meta-line { display: flex; min-width: 0; align-items: center; gap: 8px; }
.product-card__time {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: 12px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .workbench-home { padding: 8vh 0 5vh; }
  .workbench-home__content { width: calc(100% - 40px); }
  .build-composer { width: 100%; }
  .recent-projects__grid { grid-template-columns: 1fr; }
  .build-composer__footer { justify-content: space-between; padding: 2px 10px 10px 12px; }
}

@media (prefers-reduced-motion: reduce) {
  .build-composer, .project-card { transition: none; }
}
</style>
