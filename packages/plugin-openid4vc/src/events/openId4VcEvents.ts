import type { OpenId4VcAgent } from '../types'

import { emitModuleMessageEvent } from '@verana-labs/vs-agent-sdk'

export enum OpenId4VcEventType {
  CredentialExchangeStateUpdated = 'openid4vc.credential-exchanges.state-updated',
  PresentationStateUpdated = 'openid4vc.presentations.state-updated',
}

export function emitStateUpdated(
  agent: OpenId4VcAgent,
  type: OpenId4VcEventType,
  record: () => object | Promise<object>,
  previousState: string | null,
): void {
  // credo calls listeners synchronously inside its state update, so a throw here would fail the flow itself
  new Promise<object>(resolve => resolve(record()))
    .then(data => emitModuleMessageEvent(agent, type, { ...data, previousState }))
    .catch(error => agent.config.logger.error(`event ${type} emission failed`, { cause: error }))
}
