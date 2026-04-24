import { DidCommDidExchangeState } from '@credo-ts/didcomm'

/** Spec v4 §5.6: 3-value Connection State (NOT_CONNECTED / ESTABLISHED / TERMINATED) derived from Credo's DID Exchange state. */
export enum VtFlowConnectionState {
  NotConnected = 'NOT_CONNECTED',
  Established = 'ESTABLISHED',
  Terminated = 'TERMINATED',
}

export function connectionStateFromDidExchangeState(state: DidCommDidExchangeState): VtFlowConnectionState {
  switch (state) {
    case DidCommDidExchangeState.Completed:
      return VtFlowConnectionState.Established
    case DidCommDidExchangeState.Abandoned:
      return VtFlowConnectionState.Terminated
    case DidCommDidExchangeState.Start:
    case DidCommDidExchangeState.InvitationSent:
    case DidCommDidExchangeState.InvitationReceived:
    case DidCommDidExchangeState.RequestSent:
    case DidCommDidExchangeState.RequestReceived:
    case DidCommDidExchangeState.ResponseSent:
    case DidCommDidExchangeState.ResponseReceived:
      return VtFlowConnectionState.NotConnected
    default: {
      const _exhaustive: never = state
      void _exhaustive
      return VtFlowConnectionState.NotConnected
    }
  }
}
