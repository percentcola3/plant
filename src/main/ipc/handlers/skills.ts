import { registerIpcHandler } from '../registry'
import { UIClientError } from '../errors'
import { WorkspacesStore } from '../../workspaces/store'
import {
  listSkills,
  ensureBuiltinSkills,
  setSkillDisabled,
  listSkillTemplates,
  createSkill,
  installSkillTemplates,
  deleteSkill
} from '../../skills/service'
import { resolveSkillTemplateRoot, restoreSkillTemplate } from '../../workspaces/templates'

const store = new WorkspacesStore()

// 只有 project / ux 工作区会暴露 skill 模板装入；其他 kind 调用直接拒掉。
function assertTemplateKind(kind: string): asserts kind is 'project' | 'ux' {
  if (kind !== 'project' && kind !== 'ux') {
    throw new UIClientError('VALIDATION', `当前工作区类型（${kind}）不支持 skill 模板`)
  }
}

export function registerSkillsHandlers(): void {
  registerIpcHandler('skills.list', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
    const templatesRoot = await resolveSkillTemplateRoot()
    await ensureBuiltinSkills(ws.path, templatesRoot)
    return listSkills(ws.path, templatesRoot)
  })

  registerIpcHandler('skills.restoreTemplate', async ({ workspaceId, skillName }) => {
    if (!workspaceId || !skillName) throw new UIClientError('VALIDATION', '缺少参数')
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
    await restoreSkillTemplate(ws.path, skillName)
  })

  registerIpcHandler('skills.setDisabled', async ({ workspaceId, skillName, disabled }) => {
    if (!workspaceId || !skillName) throw new UIClientError('VALIDATION', '缺少参数')
    if (typeof disabled !== 'boolean') throw new UIClientError('VALIDATION', 'disabled 必须是布尔值')
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
    await setSkillDisabled(ws.path, skillName, disabled)
  })

  registerIpcHandler('skills.listTemplates', async ({ workspaceId }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
    const templatesRoot = await resolveSkillTemplateRoot()
    return listSkillTemplates(ws.path, templatesRoot)
  })

  registerIpcHandler('skills.create', async ({
    workspaceId,
    name,
    description,
    quickInvocation,
    defaultPrompt
  }) => {
    if (!workspaceId || !name) throw new UIClientError('VALIDATION', '缺少参数')
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
    await createSkill(ws.path, name, description, { quickInvocation, defaultPrompt })
  })

  registerIpcHandler('skills.installTemplates', async ({ workspaceId, names }) => {
    if (!workspaceId) throw new UIClientError('VALIDATION', '缺少 workspaceId')
    if (!Array.isArray(names) || names.length === 0) {
      throw new UIClientError('VALIDATION', '请选择至少一个模板')
    }
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
    assertTemplateKind(ws.kind)
    const templatesRoot = await resolveSkillTemplateRoot()
    return installSkillTemplates(ws.path, templatesRoot, ws.kind, names)
  })

  registerIpcHandler('skills.delete', async ({ workspaceId, skillName }) => {
    if (!workspaceId || !skillName) throw new UIClientError('VALIDATION', '缺少参数')
    const ws = await store.findById(workspaceId)
    if (!ws) throw new UIClientError('NOT_FOUND', `工作区不存在：${workspaceId}`)
    await deleteSkill(ws.path, skillName)
  })
}
