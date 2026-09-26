<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  AssetComponent,
  DocTreeNode,
  FeatureCard
} from '@shared/types'
import { call } from '@/lib/api'
import { useExternalRefsStore } from '@/stores/external-refs'
import { useInspectorPicksStore } from '@/stores/inspector-picks'
import { usePreviewStore } from '@/stores/preview'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useProjectBrowserStore } from '@/stores/project-browser'
import MentionResourceTree from './MentionResourceTree.vue'
import {
  docTreeToMentionNodes,
  filterMentionTree,
  mentionItemPath,
  resolveMentionResourceBindings,
  type MentionItem,
  type MentionResolvedBinding,
  type MentionTreeNode
} from '@/lib/chat/mention-resources'

type SectionKey = 'current' | 'knowledge' | 'components' | 'projects' | 'elements' | 'webpages'
type Section = {
  key: SectionKey
  label: string
  nodes: MentionTreeNode[]
}

const props = defineProps<{
  query: string
  position: { x: number; y: number }
  selectedPaths?: string[]
}>()

const emit = defineEmits<{
  select: [item: MentionItem]
  close: []
}>()

const workspaces = useWorkspacesStore()
const externalRefs = useExternalRefsStore()
const preview = usePreviewStore()
const picks = useInspectorPicksStore()
const browser = useProjectBrowserStore()
const webPageNodes = computed<MentionTreeNode[]>(() => browser.currentPages.map(page => ({
  key: `webpage:${page.id}`, label: page.title, detail: page.url, icon: 'file',
  item: { type: 'resource', resourceKind: 'webpage', alias: page.title, path: `webpage:${page.id}` }
})))
const loading = ref(false)
const activeSection = ref<SectionKey>('current')
const currentProjectNodes = ref<MentionTreeNode[]>([])
const knowledgeNodes = ref<MentionTreeNode[]>([])
const componentNodes = ref<MentionTreeNode[]>([])
const projectNodes = ref<MentionTreeNode[]>([])
const activeIndex = ref(0)
let refreshSeq = 0

const featureRelPath = computed(() => {
  const relPath = preview.activeProject?.relPath ?? ''
  return relPath.startsWith('features/') ? relPath : null
})
const currentProjectRelPath = computed(() => preview.activeProject?.relPath ?? null)

const elementNodes = computed<MentionTreeNode[]>(() =>
  picks.currentPicks.map((pick) => ({
    key: `element:${pick.path}`,
    label: `@${pick.alias}`,
    detail: pick.path,
    icon: 'component',
    item: { type: 'chip', alias: pick.alias, path: pick.path }
  }))
)

const sections = computed<Section[]>(() => [
  { key: 'webpages', label: '已打开网页', nodes: webPageNodes.value },
  { key: 'current', label: '当前项目', nodes: currentProjectNodes.value },
  { key: 'knowledge', label: '知识库', nodes: knowledgeNodes.value },
  { key: 'components', label: '组件资产', nodes: componentNodes.value },
  { key: 'projects', label: '其他项目', nodes: projectNodes.value },
  { key: 'elements', label: '选中元素', nodes: elementNodes.value }
])

const currentSection = computed(() =>
  sections.value.find(section => section.key === activeSection.value) ?? sections.value[0]
)
const filteredNodes = computed(() => filterMentionTree(currentSection.value.nodes, props.query))
const searchItems = computed(() => flattenItems(filteredNodes.value))
const queryActive = computed(() => props.query.trim().length > 0)
const popoverStyle = computed(() => ({
  left: `${Math.max(12, Math.min(props.position.x, window.innerWidth - 512))}px`,
  top: `${Math.max(120, props.position.y - 8)}px`
}))

watch(searchItems, () => {
  activeIndex.value = 0
})

watch(() => [workspaces.activeId, currentProjectRelPath.value] as const, () => {
  void refresh()
}, { immediate: true })

function flattenItems(nodes: MentionTreeNode[]): MentionItem[] {
  const items: MentionItem[] = []
  for (const node of nodes) {
    if (node.item) items.push(node.item)
    if (node.children) items.push(...flattenItems(node.children))
  }
  return items
}

function itemKey(item: MentionItem): string {
  if (item.type === 'fileref') return `file:${item.relPath}`
  if (item.type === 'chip') return `chip:${item.path}`
  return `resource:${item.resourceKind}:${item.path}`
}

function itemLabel(item: MentionItem): string {
  if (item.type === 'fileref') return item.relPath.split('/').at(-1) ?? item.relPath
  if (item.type === 'chip') return `@${item.alias}`
  return item.alias
}

function itemPath(item: MentionItem): string {
  if (item.type === 'fileref') return item.relPath
  return item.path
}

function isSelected(item: MentionItem): boolean {
  return (props.selectedPaths ?? []).includes(mentionItemPath(item))
}

function sectionCount(nodes: MentionTreeNode[]): number {
  return flattenItems(nodes).length
}

function selectSection(key: SectionKey): void {
  activeSection.value = key
  activeIndex.value = 0
}

async function refresh(): Promise<void> {
  const workspaceId = workspaces.activeId
  const seq = ++refreshSeq
  if (!workspaceId) {
    currentProjectNodes.value = []
    knowledgeNodes.value = []
    componentNodes.value = []
    projectNodes.value = []
    loading.value = false
    return
  }

  loading.value = true
  const [pool, fetchedBindings] = await Promise.all([
    externalRefs.refreshPool(),
    externalRefs.refreshBindings(workspaceId)
  ])
  if (seq !== refreshSeq) return

  // 资源包页以 workspace scan 的 refs 为准；这里合并本次 IPC 返回值，避免读取
  // 可能被其他异步刷新覆盖的全局 resolvedBindings 快照。
  const scannedBindings = workspaces.scan?.kind === 'project' ? workspaces.scan.refs : []
  const bindings = resolveMentionResourceBindings(pool, scannedBindings, fetchedBindings)
  const [currentProject, knowledge, components, projects] = await Promise.all([
    buildCurrentProjectNodes(workspaceId),
    buildKnowledgeNodes(workspaceId, bindings),
    buildComponentNodes(workspaceId, bindings),
    buildProjectNodes(workspaceId)
  ])
  if (seq !== refreshSeq) return

  currentProjectNodes.value = currentProject
  knowledgeNodes.value = knowledge
  componentNodes.value = components
  projectNodes.value = projects
  const firstAvailable = sections.value.find(section => sectionCount(section.nodes) > 0)
  if (firstAvailable && sectionCount(currentSection.value.nodes) === 0) {
    activeSection.value = firstAvailable.key
  }
  loading.value = false
}

async function buildCurrentProjectNodes(workspaceId: string): Promise<MentionTreeNode[]> {
  const project = preview.activeProject
  const relPath = currentProjectRelPath.value
  if (!project || !relPath) return []
  const files = await call('workspace.listFiles', {
    workspaceId,
    relDir: relPath
  })
  if (!files.ok) return []
  return [{
    key: `current-project:${relPath}`,
    label: project.name,
    detail: relPath,
    icon: 'folder',
    item: {
      type: 'resource',
      resourceKind: 'current-project',
      alias: project.name,
      path: relPath
    },
    children: currentProjectPathNodes(project.name, files.data)
  }]
}

function currentProjectPathNodes(projectName: string, nodes: DocTreeNode[]): MentionTreeNode[] {
  return nodes.map((node) => {
    const alias = `${projectName}/${node.name}`
    if (node.kind === 'folder') {
      return {
        key: `current-dir:${node.relPath}`,
        label: node.name,
        detail: node.relPath,
        icon: 'folder',
        item: {
          type: 'resource',
          resourceKind: 'current-project',
          alias,
          path: node.relPath
        },
        children: currentProjectPathNodes(projectName, node.children)
      }
    }
    return {
      key: `current-file:${node.relPath}`,
      label: node.name,
      detail: node.relPath,
      icon: 'file',
      item: {
        type: 'resource',
        resourceKind: 'current-project',
        alias,
        path: node.relPath
      }
    }
  })
}

async function buildKnowledgeNodes(
  workspaceId: string,
  bindings: MentionResolvedBinding[]
): Promise<MentionTreeNode[]> {
  const knowledgeBindings = bindings.filter(({ ref: resource }) => resource?.category === 'knowledge')
  return Promise.all(knowledgeBindings.map(async ({ binding }) => {
    const rootRel = `.external/${binding.alias}`
    const visibleDirs = binding.visibleDirs ?? []
    const roots = visibleDirs.length > 0 ? visibleDirs : ['']
    const results = await Promise.all(roots.map((visibleDir) =>
      call('workspace.listFiles', {
        workspaceId,
        relDir: visibleDir ? `${rootRel}/${visibleDir}` : rootRel
      })
    ))
    const children: MentionTreeNode[] = results.flatMap((result, index): MentionTreeNode[] => {
      const nodes = result.ok ? result.data : []
      const mapped = knowledgeFileNodes(binding.alias, nodes)
      const visibleDir = roots[index]
      if (!visibleDir) return mapped
      const directoryNode: MentionTreeNode = {
        key: `knowledge-dir:${binding.alias}:${visibleDir}`,
        label: visibleDir,
        icon: 'folder',
        item: knowledgeResourceItem(binding.alias, `${rootRel}/${visibleDir}`),
        children: mapped
      }
      return [directoryNode]
    })
    return {
      key: `knowledge:${binding.externalRefId}`,
      label: binding.alias,
      detail: '知识库',
      icon: 'folder',
      item: knowledgeResourceItem(binding.alias, rootRel),
      children
    } satisfies MentionTreeNode
  }))
}

function knowledgeFileNodes(alias: string, nodes: DocTreeNode[]): MentionTreeNode[] {
  return docTreeToMentionNodes(
    nodes,
    (file) => knowledgeResourceItem(alias, file.relPath),
    (folder) => knowledgeResourceItem(alias, folder.relPath)
  )
}

function knowledgeResourceItem(alias: string, path: string): MentionItem {
  return {
    type: 'resource',
    resourceKind: 'knowledge',
    alias: resourceAlias(alias, `.external/${alias}`, path),
    path
  }
}

async function buildComponentNodes(
  workspaceId: string,
  bindings: MentionResolvedBinding[]
): Promise<MentionTreeNode[]> {
  const uikitBindings = bindings.filter(({ ref: resource }) => resource?.category === 'uikit')
  const results = await Promise.all(uikitBindings.map(async ({ binding }): Promise<MentionTreeNode | null> => {
    const rootRel = `.external/${binding.alias}`
    const summary = await call('workspace.uikitSummary', { workspaceId, rootRel })
    if (!summary.ok) return null
    return {
      key: `uikit:${binding.externalRefId}`,
      label: binding.alias,
      detail: '组件资产',
      icon: 'folder',
      children: summary.data.assetLibraries.map((library): MentionTreeNode => ({
        key: `library:${binding.alias}:${library.path}`,
        label: library.name,
        icon: 'folder',
        children: library.components.map((component) =>
          componentNode(binding.alias, rootRel, library.name, component)
        )
      }))
    }
  }))
  return results.filter((node): node is MentionTreeNode => node !== null)
}

function componentNode(
  bindingAlias: string,
  rootRel: string,
  libraryName: string,
  component: AssetComponent
): MentionTreeNode {
  return {
    key: `component:${bindingAlias}:${component.path}`,
    label: component.name,
    detail: component.path,
    icon: 'component',
    item: {
      type: 'resource',
      resourceKind: 'component',
      alias: `${libraryName}/${component.name}`,
      path: `${rootRel}/${component.path}`
    },
    children: (component.demoPaths ?? (component.demoPath ? [component.demoPath] : [])).map((demoPath) => ({
      key: `effect:${bindingAlias}:${demoPath}`,
      label: effectName(component.path, demoPath),
      detail: demoPath,
      icon: 'effect',
      item: {
        type: 'resource',
        resourceKind: 'component-effect',
        alias: `${component.name}/${effectName(component.path, demoPath)}`,
        path: `${rootRel}/${demoPath}`
      }
    }))
  }
}

function effectName(componentPath: string, demoPath: string): string {
  const relative = demoPath.slice(componentPath.length + 1).replace(/\.html?$/i, '')
  return relative.toLowerCase() === 'index' ? '默认效果' : relative
}

async function buildProjectNodes(workspaceId: string): Promise<MentionTreeNode[]> {
  const list = await call('feature.list', { workspaceId })
  if (!list.ok) return []
  const currentRelPath = featureRelPath.value
  const otherProjects = list.data.filter((feature) => feature.relPath !== currentRelPath)
  const trees = await Promise.all(otherProjects.map(async (feature: FeatureCard) => {
    const files = await call('workspace.listFiles', {
      workspaceId,
      relDir: feature.relPath
    })
    return {
      key: `project:${feature.relPath}`,
      label: feature.name,
      detail: feature.relPath,
      icon: 'folder',
      item: projectResourceItem(feature, feature.relPath),
      children: projectFileNodes(feature, files.ok ? files.data : [])
    } satisfies MentionTreeNode
  }))
  return trees
}

function projectFileNodes(feature: FeatureCard, nodes: DocTreeNode[]): MentionTreeNode[] {
  return docTreeToMentionNodes(
    nodes,
    (file) => projectResourceItem(feature, file.relPath),
    (folder) => projectResourceItem(feature, folder.relPath)
  )
}

function projectResourceItem(feature: FeatureCard, path: string): MentionItem {
  return {
    type: 'resource',
    resourceKind: 'project-file',
    alias: resourceAlias(feature.name, feature.relPath, path),
    path
  }
}

function resourceAlias(rootAlias: string, rootPath: string, path: string): string {
  const relative = path === rootPath ? '' : path.slice(rootPath.length).replace(/^\/+/, '')
  return relative ? `${rootAlias}/${relative}` : rootAlias
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (!queryActive.value) {
    if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
    }
    return
  }
  if (searchItems.value.length === 0) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % searchItems.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + searchItems.value.length) % searchItems.value.length
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const item = searchItems.value[activeIndex.value]
    if (item) emit('select', item)
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown, true))
</script>

<template>
  <div class="mention-popover" :style="popoverStyle">
    <div class="mention-popover__head">
      <strong>添加上下文</strong>
      <span v-if="query">搜索 “{{ query }}”</span>
      <span v-else>选择后显示别名，AI 将收到真实路径</span>
    </div>
    <div class="mention-popover__tabs" role="tablist" aria-label="上下文类型">
      <button
        v-for="section in sections"
        :key="section.key"
        type="button"
        role="tab"
        :aria-selected="activeSection === section.key"
        :class="{ 'is-active': activeSection === section.key }"
        @mousedown.prevent="selectSection(section.key)"
      >
        {{ section.label }}
        <span>{{ sectionCount(section.nodes) }}</span>
      </button>
    </div>
    <div class="mention-popover__body">
      <div v-if="loading" class="mention-popover__empty">正在读取资源…</div>
      <div v-else-if="filteredNodes.length === 0" class="mention-popover__empty">
        {{ query ? '没有匹配项' : `暂无${currentSection.label}` }}
      </div>
      <div v-else-if="queryActive" class="mention-search-results">
        <button
          v-for="(item, index) in searchItems"
          :key="itemKey(item)"
          type="button"
          :class="{ 'is-active': index === activeIndex, 'is-checked': isSelected(item) }"
          @mouseenter="activeIndex = index"
          @mousedown.prevent="emit('select', item)"
        >
          <span class="mention-search-results__check" :aria-checked="isSelected(item)" role="checkbox">
            <span v-if="isSelected(item)">✓</span>
          </span>
          <span class="mention-search-results__copy">
            <span>{{ itemLabel(item) }}</span>
            <small>{{ itemPath(item) }}</small>
          </span>
        </button>
      </div>
      <MentionResourceTree
        v-else
        :nodes="filteredNodes"
        :selected-paths="selectedPaths ?? []"
        @select="emit('select', $event)"
      />
    </div>
    <div class="mention-popover__hint">勾选目录或文件加入上下文 · 点击三角展开 · 输入文字可搜索 · Esc 关闭</div>
  </div>
</template>

<style scoped>
.mention-popover {
  position: fixed;
  z-index: 1000;
  display: flex;
  width: min(500px, calc(100vw - 24px));
  max-height: min(560px, calc(100vh - 32px));
  transform: translateY(-100%);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-popover-border);
  border-radius: 14px;
  background: var(--color-bg-panel);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
}
.mention-popover__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 9px;
}
.mention-popover__head strong { color: var(--color-text-primary); font-size: 13px; }
.mention-popover__head span {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mention-popover__tabs {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border);
  padding: 0 10px;
}
.mention-popover__tabs button {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  margin-bottom: -1px;
  padding: 8px 10px 9px;
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: color 160ms ease, border-color 160ms ease, background-color 160ms ease;
}
.mention-popover__tabs button:hover {
  background: transparent;
  color: var(--color-text-primary);
}
.mention-popover__tabs button.is-active {
  background: transparent;
  box-shadow: none;
  color: var(--color-text-primary);
  font-weight: 600;
  border-bottom-color: var(--color-accent);
}
.mention-popover__tabs button span {
  min-width: 16px;
  border-radius: 999px;
  background: var(--color-bg-elevated);
  padding: 1px 5px;
  color: var(--color-text-tertiary);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.mention-popover__tabs button.is-active span {
  background: var(--color-accent-subtle);
  color: var(--color-accent-pressed);
}
.mention-popover__tabs button:focus-visible {
  outline: 2px solid var(--color-accent-pressed);
  outline-offset: 2px;
}
.mention-popover__body {
  min-height: 150px;
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.mention-popover__empty {
  display: flex;
  min-height: 140px;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 12px;
}
.mention-search-results { display: flex; flex-direction: column; gap: 2px; }
.mention-search-results button {
  display: flex;
  min-width: 0;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  padding: 7px 9px;
  text-align: left;
  cursor: pointer;
}
.mention-search-results button:hover,
.mention-search-results button.is-active { background: var(--color-bg-hover); }
.mention-search-results__check {
  display: grid;
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  place-content: center;
  border: 1px solid var(--color-border-strong);
  border-radius: 3px;
  background: var(--color-bg-panel);
  color: var(--color-accent-pressed);
  font-size: 10px;
  line-height: 1;
}
.mention-search-results button.is-checked .mention-search-results__check {
  border-color: var(--color-accent);
  background: var(--color-accent-subtle);
}
.mention-search-results__copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.mention-search-results span {
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mention-search-results small {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mention-popover__hint {
  border-top: 1px solid var(--color-border);
  padding: 7px 12px;
  color: var(--color-text-tertiary);
  font-size: 10px;
}
</style>
