import { getSharedProbe } from '../git/probe'
import { SagaRunner, type DispatchInput } from './runner'
import { buildOpRegistry, buildSagaRegistry } from './registry'
import { purgeOldDoneJournals } from './journal'
import type { SagaJournal } from './types'

// 进程级 SagaRunner 单例。main 入口启动时一次性 build；其他模块经此 service 派发。

let shared: SagaRunner | null = null

export function getSharedRunner(): SagaRunner {
  if (!shared) {
    shared = new SagaRunner({
      probe: getSharedProbe(),
      ops: buildOpRegistry(),
      definitions: buildSagaRegistry()
    })
  }
  return shared
}

export function _testOnlyResetRunner(): void {
  shared = null
}

export async function dispatchSaga(input: DispatchInput): Promise<SagaJournal> {
  return getSharedRunner().dispatch(input)
}

export async function resumeWorkspaceSagas(workspaceId: string, workspacePath: string): Promise<SagaJournal[]> {
  return getSharedRunner().resumeAll(workspaceId, workspacePath)
}

// 启动时清理 7 天前的 done 归档；不影响运行中 saga
export async function purgeOldArchives(workspacePath: string): Promise<void> {
  await purgeOldDoneJournals(workspacePath).catch(() => undefined)
}
