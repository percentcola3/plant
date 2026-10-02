// 工作区 store：项目 + 资产 + 知识库三种 kind 的统一抽象。
// 替代旧 stores/projects.ts 与 stores/active-project.ts，按 Workspace v2 模型组织。

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { PersonalSpace, SkillSummary, SkillTemplateInfo, SkillInstallResult, Workspace, WorkspaceScanResult } from '@shared/types'
import { call } from '../lib/api'
import { useUiStore } from './ui'
import { useConversationStore } from './conversation'

export const useWorkspacesStore = defineStore('workspaces', () => {
  const list = ref<Workspace[]>([])
  const activeId = ref<string | null>(null)
  const scan = ref<WorkspaceScanResult | null>(null)
  const scanLoading = ref(false)
  const scanningWorkspaceId = ref<string | null>(null)
  const activatingWorkspaceId = ref<string | null>(null)
  const checkingOutHomeId = ref<string | null>(null)
  const initialized = ref(false)
  const isRefreshing = ref(false)
  let refreshPromise: Promise<void> | null = null
  let scanSeq = 0
  let activationSeq = 0
  const spaceActivationSeq = new Map<string, number>()
  const spaceActivationQueue = new Map<string, Promise<void>>()

  type RefreshOptions = {
    clearKnowledgeOnlyActive?: boolean
  }

  const active = computed<Workspace | null>(() =>
    list.value.find((w) => w.id === activeId.value) ?? null
  )
  // PM / UX 项目个人空间：当前 active 的 project/ux 扫描结果中的 active space。
  // 老 PM 项目（无 space/* 分支）扫描值为 null，触发首次引导。
  const personalSpace = computed<PersonalSpace | null>(() =>
    scan.value?.kind === 'ux' || scan.value?.kind === 'project'
      ? scan.value.personalSpace ?? null
      : null
  )
  const activeScanLoading = computed(() =>
    !!activeId.value && scanLoading.value && scanningWorkspaceId.value === activeId.value
  )
  const activeSwitchLoading = computed(() => activatingWorkspaceId.value !== null)

  function applyActiveId(nextId: string | null): void {
    const changed = activeId.value !== nextId
    activeId.value = nextId
    if (changed) useUiStore().closeTerminalPanel()
  }

  function shouldClearKnowledgeOnlyActive(workspaces: Workspace[], id: string | null): boolean {
    if (!id) return false
    const activeWorkspace = workspaces.find((w) => w.id === id)
    if (activeWorkspace?.kind !== 'knowledge') return false
    return !workspaces.some((w) => w.kind !== 'knowledge')
  }

  async function refresh(options: RefreshOptions = {}): Promise<void> {
    if (refreshPromise) return refreshPromise
    refreshPromise = (async () => {
      isRefreshing.value = true
      // 并行：list + activeId 互相不依赖
      const [r, a] = await Promise.all([
        call('workspace.list', undefined),
        call('workspace.activeId', undefined)
      ])
      if (r.ok) list.value = r.data
      if (a.ok) {
        const nextActiveId = options.clearKnowledgeOnlyActive && r.ok && shouldClearKnowledgeOnlyActive(r.data, a.data)
          ? null
          : a.data
        applyActiveId(nextActiveId)
      }
      initialized.value = true
      // active scan 不阻塞 refresh 返回——splash 可以立刻关，sidebar 先 mount。
      // 中央区域用 activeScanLoading 显示 loading 态（store 已经做了），不会空白。
      if (activeId.value) {
        void refreshScan(activeId.value)
      }
    })().finally(() => {
      isRefreshing.value = false
      refreshPromise = null
    })
    return refreshPromise
  }

  async function initializeDefaultWorkspace(): Promise<Workspace | null> {
    const result = await call('workspace.ensureDefault', undefined)
    if (!result.ok) {
      useUiStore().showToast('error', `初始化本地工作台失败：${result.message}`, 6000)
      return null
    }
    await refresh()
    return result.data
  }

  async function setActive(id: string | null): Promise<void> {
    const seq = ++activationSeq
    activatingWorkspaceId.value = id
    try {
      const r = await call('workspace.setActive', { id })
      if (seq !== activationSeq) return
      if (r.ok) {
        applyActiveId(id)
        if (id) await refreshScan(id)
        else {
          scanSeq += 1
          scan.value = null
          scanLoading.value = false
          scanningWorkspaceId.value = null
        }
      }
    } finally {
      if (seq === activationSeq) activatingWorkspaceId.value = null
    }
  }

  async function checkoutHome(workspaceId: string, preCommitMessage?: string): Promise<boolean> {
    const ui = useUiStore()
    ui.closeTerminalPanel()
    checkingOutHomeId.value = workspaceId
    try {
      const r = await call('workspace.checkoutHome', { workspaceId, preCommitMessage })
      if (!r.ok) {
        if (r.code !== 'UNCOMMITTED_CHANGES') return false
        // 跟 saga / requirements switch 一致：自动 wip 提交，不弹手填对话框
        const autoMsg = `wip(home): ${new Date().toISOString()}`
        const retry = await call('workspace.checkoutHome', {
          workspaceId,
          preCommitMessage: autoMsg
        })
        if (!retry.ok) return false
      }
      if (activeId.value === workspaceId) await refreshScan(workspaceId)
      return true
    } finally {
      checkingOutHomeId.value = null
    }
  }

  async function refreshScan(id: string): Promise<void> {
    const seq = ++scanSeq
    scanningWorkspaceId.value = id
    scanLoading.value = true
    if (activeId.value === id) scan.value = null
    try {
      const r = await call('workspace.scan', { id })
      if (seq !== scanSeq) return
      if (r.ok && activeId.value === id) scan.value = r.data
    } finally {
      if (seq === scanSeq) {
        scanLoading.value = false
        scanningWorkspaceId.value = null
      }
    }
  }

  // UX 个人空间：创建/确保存在（幂等）。当前工作树 dirty 时自动 wip 提交，不打扰用户。
  // 成功后刷新扫描，让 personalSpace computed 与侧边栏/页面立即反映新分支。
  async function ensurePersonalSpace(workspaceId: string, slug?: string): Promise<PersonalSpace | null> {
    const ui = useUiStore()
    const toastWarnings = (w?: string[]): void => {
      if (!w?.length) return
      const suffix = w.length > 1 ? `（另有 ${w.length - 1} 条）` : ''
      ui.showToast('error', `${w[0]}${suffix}`, 7000)
    }
    const r = await call('personalSpace.ensure', { workspaceId, slug })
    if (!r.ok) {
      // dirty 时自动 wip 重试一次，跟 checkoutHome/switchTo 一致
      if (r.code !== 'UNCOMMITTED_CHANGES') {
        ui.showToast('error', `创建个人空间失败：${r.message}`, 6000)
        return null
      }
      const autoMsg = `wip(space): ${new Date().toISOString()}`
      const retry = await call('personalSpace.ensure', { workspaceId, slug, preCommitMessage: autoMsg })
      if (!retry.ok) {
        ui.showToast('error', `创建个人空间失败：${retry.message}`, 6000)
        return null
      }
      await refreshScan(workspaceId)
      toastWarnings(retry.data.externalInitWarnings)
      return retry.data
    }
    await refreshScan(workspaceId)
    toastWarnings(r.data.externalInitWarnings)
    return r.data
  }

  async function activateSpace(workspaceId: string, spaceSlug: string): Promise<boolean> {
    const seq = (spaceActivationSeq.get(workspaceId) ?? 0) + 1
    spaceActivationSeq.set(workspaceId, seq)
    const previous = spaceActivationQueue.get(workspaceId) ?? Promise.resolve()
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        if (spaceActivationSeq.get(workspaceId) !== seq) return false
        return activateSpaceSerial(workspaceId, spaceSlug, seq)
      })
    const tail = task.then(() => undefined, () => undefined)
    spaceActivationQueue.set(workspaceId, tail)
    try {
      return await task
    } finally {
      if (spaceActivationQueue.get(workspaceId) === tail) spaceActivationQueue.delete(workspaceId)
    }
  }

  async function activateSpaceSerial(workspaceId: string, spaceSlug: string, seq: number): Promise<boolean> {
    const ui = useUiStore()
    const isLatest = (): boolean => spaceActivationSeq.get(workspaceId) === seq
    if (activeId.value !== workspaceId) await setActive(workspaceId)
    if (!isLatest()) return false
    const current = await call('personalSpace.list', { workspaceId })
    if (!isLatest()) return false
    if (!current.ok) {
      ui.showToast('error', `读取工作空间失败：${current.message}`, 5000)
      return false
    }
    if (current.data.activeSlug !== spaceSlug) {
      const switched = await call('personalSpace.switch', { workspaceId, slug: spaceSlug })
      if (!isLatest()) return false
      if (!switched.ok) {
        ui.showToast('error', `切换工作空间失败：${switched.message}`, 5000)
        return false
      }
      if (switched.data.externalInitWarnings?.length) {
        ui.showToast('info', switched.data.externalInitWarnings[0], 6000)
      }
    }
    await refresh()
    if (!isLatest()) return false
    await refreshScan(workspaceId)
    return isLatest() && activeId.value === workspaceId
  }

  async function create(parentDir: string, name: string, kind: Workspace['kind'] = 'project'): Promise<Workspace | null> {
    const r = await call('workspace.create', { parentDir, name, kind })
    if (!r.ok) return null
    await refresh()
    await setActive(r.data.id)
    return r.data
  }

  async function importExisting(path: string, name?: string, kind: Workspace['kind'] = 'project'): Promise<Workspace | null> {
    const r = await call('workspace.import', { path, name, kind })
    if (!r.ok) return null
    await refresh()
    await setActive(r.data.id)
    return r.data
  }

  async function cloneFromUrl(url: string, parentDir: string, name: string, kind: Workspace['kind'] = 'project'): Promise<Workspace | null> {
    const r = await call('workspace.clone', { url, parentDir, name, kind })
    if (!r.ok) return null
    await refresh()
    await setActive(r.data.id)
    return r.data
  }

  async function remove(id: string, deleteFiles = false): Promise<boolean> {
    const r = await call('workspace.remove', { id, deleteFiles })
    if (r.ok) {
      useConversationStore().clearAll()
      await refresh()
      return true
    }
    useUiStore().showToast('error', `删除项目失败：${r.message}`, 4500)
    return false
  }

  async function rename(id: string, name: string): Promise<void> {
    const r = await call('workspace.rename', { id, name })
    if (r.ok) await refresh()
  }

  // skills 列表按 workspaceId 缓存。打开"技能"区域时拉一次；编辑/恢复后主动 refresh。
  const skillsByWorkspace = ref<Record<string, SkillSummary[]>>({})
  const skillsLoading = ref<Record<string, boolean>>({})

  async function refreshSkills(workspaceId: string): Promise<void> {
    skillsLoading.value = { ...skillsLoading.value, [workspaceId]: true }
    try {
      const r = await call('skills.list', { workspaceId })
      if (r.ok) {
        skillsByWorkspace.value = { ...skillsByWorkspace.value, [workspaceId]: r.data }
      }
    } finally {
      skillsLoading.value = { ...skillsLoading.value, [workspaceId]: false }
    }
  }

  async function restoreSkillTemplate(workspaceId: string, skillName: string): Promise<boolean> {
    const r = await call('skills.restoreTemplate', { workspaceId, skillName })
    if (!r.ok) {
      useUiStore().showToast('error', `恢复 ${skillName} 失败：${r.message}`, 6000)
      return false
    }
    await refreshSkills(workspaceId)
    useUiStore().showToast('success', `已把 ${skillName} 恢复到模板版本`)
    return true
  }

  async function setSkillDisabled(workspaceId: string, skillName: string, disabled: boolean): Promise<boolean> {
    const r = await call('skills.setDisabled', { workspaceId, skillName, disabled })
    if (!r.ok) {
      useUiStore().showToast('error', `${disabled ? '禁用' : '启用'} ${skillName} 失败：${r.message}`, 6000)
      return false
    }
    await refreshSkills(workspaceId)
    useUiStore().showToast('success', `已${disabled ? '禁用' : '启用'} ${skillName}`)
    return true
  }

  // 模板库每次抽屉打开都重拉，alreadyInstalled 才能反映最新状态；不做缓存。
  async function loadSkillTemplates(workspaceId: string): Promise<SkillTemplateInfo[]> {
    const r = await call('skills.listTemplates', { workspaceId })
    if (!r.ok) {
      useUiStore().showToast('error', `加载模板库失败：${r.message}`, 6000)
      return []
    }
    return r.data
  }

  async function createSkill(
    workspaceId: string,
    name: string,
    description?: string,
    options: { quickInvocation?: boolean; defaultPrompt?: string } = {}
  ): Promise<boolean> {
    const r = await call('skills.create', {
      workspaceId,
      name,
      description,
      quickInvocation: options.quickInvocation,
      defaultPrompt: options.defaultPrompt
    })
    if (!r.ok) {
      useUiStore().showToast('error', `创建 ${name} 失败：${r.message}`, 6000)
      return false
    }
    await refreshSkills(workspaceId)
    useUiStore().showToast('success', `已创建 ${name}`)
    return true
  }

  async function installSkillTemplates(workspaceId: string, names: string[]): Promise<SkillInstallResult | null> {
    const r = await call('skills.installTemplates', { workspaceId, names })
    if (!r.ok) {
      useUiStore().showToast('error', `装入模板失败：${r.message}`, 6000)
      return null
    }
    await refreshSkills(workspaceId)
    const { installed, skipped } = r.data
    if (installed.length === 0 && skipped.length > 0) {
      useUiStore().showToast('info', `选中的 ${skipped.length} 个 skill 已存在，未做修改`)
    } else if (skipped.length > 0) {
      useUiStore().showToast('success', `已装入 ${installed.length} 个，跳过 ${skipped.length} 个`)
    } else {
      useUiStore().showToast('success', `已装入 ${installed.length} 个 skill`)
    }
    return r.data
  }

  async function deleteSkill(workspaceId: string, skillName: string): Promise<boolean> {
    const r = await call('skills.delete', { workspaceId, skillName })
    if (!r.ok) {
      useUiStore().showToast('error', `删除 ${skillName} 失败：${r.message}`, 6000)
      return false
    }
    await refreshSkills(workspaceId)
    useUiStore().showToast('success', `已删除 ${skillName}`)
    return true
  }

  return {
    list,
    activeId,
    active,
    scan,
    scanLoading,
    scanningWorkspaceId,
    activatingWorkspaceId,
    activeScanLoading,
    activeSwitchLoading,
    checkingOutHomeId,
    initialized,
    isRefreshing,
    personalSpace,
    initializeDefaultWorkspace,
    refresh,
    setActive,
    checkoutHome,
    refreshScan,
    ensurePersonalSpace,
    activateSpace,
    create,
    importExisting,
    cloneFromUrl,
    remove,
    rename,
    skillsByWorkspace,
    skillsLoading,
    refreshSkills,
    restoreSkillTemplate,
    setSkillDisabled,
    loadSkillTemplates,
    createSkill,
    installSkillTemplates,
    deleteSkill
  }
})
