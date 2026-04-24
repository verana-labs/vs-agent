import type { VtFlowConnectionState } from './VtFlowConnectionState'
import type { VtFlowState } from './VtFlowState'
import type { BaseEvent } from '@credo-ts/core'

export enum VtFlowEventTypes {
  VtFlowStateChanged = 'VtFlowStateChanged',
}

/** Emitted every time a VtFlowRecord's Flow State or Connection State changes; previous fields are null on first write. */
export interface VtFlowStateChangedEvent extends BaseEvent {
  type: typeof VtFlowEventTypes.VtFlowStateChanged
  payload: {
    vtFlowRecordId: string
    threadId: string
    sessionUuid: string
    state: VtFlowState
    previousState: VtFlowState | null
    connectionState: VtFlowConnectionState
    previousConnectionState: VtFlowConnectionState | null
  }
}
