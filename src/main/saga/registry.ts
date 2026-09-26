import { commitOp, fetchOp, pullRebaseOp, pushOp, rebaseOntoOp, squashUnpushedOp, type GitOp } from '../git/ops'
import { saveSaga } from './sagas/save'
import { syncSaga } from './sagas/sync'
import type { SagaDefinition, SagaIntent } from './types'

export function buildOpRegistry(): Map<string, GitOp<Record<string, unknown>, unknown>> {
  const m = new Map<string, GitOp<Record<string, unknown>, unknown>>()
  for (const op of [commitOp, fetchOp, pullRebaseOp, pushOp, rebaseOntoOp, squashUnpushedOp] as Array<GitOp<Record<string, unknown>, unknown>>) {
    m.set(op.name, op)
  }
  return m
}

export function buildSagaRegistry(): Map<SagaIntent, SagaDefinition> {
  return new Map<SagaIntent, SagaDefinition>([
    ['save', saveSaga],
    ['sync', syncSaga]
  ])
}
