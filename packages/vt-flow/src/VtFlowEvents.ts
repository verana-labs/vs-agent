import type { VtFlowConnectionState } from './VtFlowConnectionState'
import type { VtFlowState } from './VtFlowState'
import type { BaseEvent } from '@credo-ts/core'

export enum VtFlowEventTypes {
  VtFlowStateChanged = 'VtFlowStateChanged',
}

/**
 * Fired every time a `VtFlowRecord` state changes. `previousState` and
 * `previousConnectionState` are `null` on the first write.
 */
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
