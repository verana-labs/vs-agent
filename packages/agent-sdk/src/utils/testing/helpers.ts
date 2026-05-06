import { DidCommHandshakeProtocol } from '@credo-ts/didcomm'
import {
  VtFlowEventTypes,
  type VtFlowState,
  type VtFlowStateChangedEvent,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { vi } from 'vitest'

import { BaseAgentModules, VsAgent } from '../../agent'

export async function makeConnection(agentA: VsAgent<BaseAgentModules>, agentB: VsAgent<BaseAgentModules>) {
  const agentAOutOfBand = await agentA.didcomm.oob.createInvitation({
    handshakeProtocols: [DidCommHandshakeProtocol.Connections],
  })

  let { connectionRecord: agentBConnection } = await agentB.didcomm.oob.receiveInvitation(
    agentAOutOfBand.outOfBandInvitation,
    { label: agentB.label },
  )

  agentBConnection = await agentB.didcomm.connections.returnWhenIsConnected(agentBConnection!.id)
  let [agentAConnection] = await agentA.didcomm.connections.findAllByOutOfBandId(agentAOutOfBand.id)
  agentAConnection = await agentA.didcomm.connections.returnWhenIsConnected(agentAConnection!.id)

  return [agentAConnection, agentBConnection]
}

export function isVtFlowStateChangedEvent(state: VtFlowState) {
  return (arg: unknown): arg is VtFlowStateChangedEvent => {
    const { type, payload } = arg as any
    return (
      typeof arg === 'object' &&
      arg !== null &&
      type === VtFlowEventTypes.VtFlowStateChanged &&
      payload?.state === state
    )
  }
}

export function waitForEvent<T>(
  eventEmitter: ReturnType<typeof vi.spyOn>,
  predicate: (event: unknown) => event is T,
): Promise<T> {
  const calls = eventEmitter.mock.calls as unknown[][]
  const existingEvent = calls.flat().find(predicate)
  if (existingEvent) {
    return Promise.resolve(existingEvent)
  }

  return new Promise(resolve => {
    const check = () => {
      const calls = eventEmitter.mock.calls as unknown[][]
      const events = calls.flat()
      const matchedEvent = events.find(predicate)
      if (matchedEvent) {
        resolve(matchedEvent)
      } else {
        setImmediate(check)
      }
    }
    check()
  })
}
