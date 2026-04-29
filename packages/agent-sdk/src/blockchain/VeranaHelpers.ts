import { JsonObject } from '@credo-ts/core'

import { VsAgent } from '../agent/VsAgent'

import { RECORD_ID, VeranaSyncState } from './types'

const emptyState = (): VeranaSyncState => ({
  lastBlockHeight: 0,
  trustRegistries: {},
  credentialSchemas: {},
  permissions: {},
})

export async function loadSyncState(agent: VsAgent): Promise<VeranaSyncState> {
  const record = await agent.genericRecords.findById(RECORD_ID)
  if (!record) return emptyState()
  return (record.content as unknown as VeranaSyncState) ?? emptyState()
}

export async function saveSyncState(agent: VsAgent, state: VeranaSyncState): Promise<void> {
  const existing = await agent.genericRecords.findById(RECORD_ID)
  if (existing) {
    existing.content = state as unknown as JsonObject
    await agent.genericRecords.update(existing)
  } else {
    await agent.genericRecords.save({ id: RECORD_ID, content: state as unknown as JsonObject })
  }
}
