import { DidCommDidExchangeState } from '@credo-ts/didcomm'

/** 3-value abstraction over Credo's DID Exchange state. */
export enum VtFlowConnectionState {
  /** Handshake in progress or connection closed but record retained. */
  NotConnected = 'NOT_CONNECTED',
  /** DIDComm connection fully open. */
  Established = 'ESTABLISHED',
  /** Connection permanently closed. */
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
      // Future-proof: default to NOT_CONNECTED if Credo adds a new state.
      const _exhaustive: never = state
      void _exhaustive
      return VtFlowConnectionState.NotConnected
    }
  }
}
