import { WorkspacesStore } from './store'
import { externalPoolStore } from '../external-pool/store'
import { detachExternalRef, removeExternalRef } from '../external-pool/service'
import { settingsStore } from '../settings/store'

// 移除旧版自动注册的剪页资源与关联；原始目录和文件留在磁盘上。
export async function retireLegacyClipLibrary(): Promise<void> {
  const workspaces = await new WorkspacesStore().list()
  const clipPaths = new Set(workspaces.filter(w => w.kind === 'knowledge' && w.name === '剪页库').map(w => w.path))
  if (!clipPaths.size) return
  const refs = (await externalPoolStore.list()).filter(ref => ref.kind === 'local' && clipPaths.has(ref.source))
  for (const ref of refs) {
    for (const workspace of workspaces) {
      if (workspace.kind === 'project') await detachExternalRef(workspace.id, ref.id)
    }
    await removeExternalRef(ref.id)
  }
  const removedIds = new Set(refs.map(ref => ref.id))
  if (removedIds.size) {
    const settings = await settingsStore.get()
    await settingsStore.update({ defaultExternalRefIds: settings.defaultExternalRefIds.filter(id => !removedIds.has(id)) })
  }
}
