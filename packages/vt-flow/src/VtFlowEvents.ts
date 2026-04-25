import type { VtFlowState } from './VtFlowState'
import type { BaseEvent } from '@credo-ts/core'

export enum VtFlowEventTypes {
  VtFlowStateChanged = 'VtFlowStateChanged',
}

/** Emitted every time a VtFlowRecord's Flow State changes; `previousState` is null on first write. The DIDComm connection lifecycle is observed by the caller via Credo's `DidCommConnectionStateChangedEvent`. */
export interface VtFlowStateChangedEvent extends BaseEvent {
  type: typeof VtFlowEventTypes.VtFlowStateChanged
  payload: {
    vtFlowRecordId: string
    threadId: string
    sessionUuid: string
    state: VtFlowState
    previousState: VtFlowState | null
  }
}
