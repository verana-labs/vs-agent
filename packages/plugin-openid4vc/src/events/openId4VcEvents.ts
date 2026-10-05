import type { BaseLogger } from '@credo-ts/core'
import type {
  OpenId4VcIssuanceSessionStateChangedEvent,
  OpenId4VcVerificationSessionStateChangedEvent,
} from '@credo-ts/openid4vc'
import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { OpenId4VcIssuerEvents, OpenId4VcVerifierEvents } from '@credo-ts/openid4vc'
import { emitModuleMessageEvent } from '@verana-labs/vs-agent-sdk'

import { ISSUER_CAPABILITY_ID, VERIFIER_CAPABILITY_ID } from '../config'
import { toCredentialExchangeDto, toPresentationDto } from '../nestjs/mappers'
import { summarizeIssuanceSession } from '../services/IssuerService'
import { summarizeVerificationSession } from '../services/VerifierService'

export enum OpenId4VcEventType {
  CredentialExchangeStateUpdated = 'openid4vc.credential-exchanges.state-updated',
  PresentationStateUpdated = 'openid4vc.presentations.state-updated',
}

export function openId4VcEvents(agent: VsAgent<any>, logger: BaseLogger): void {
  // credo calls listeners synchronously inside its state update, so a throw here would fail the flow itself
  const emit = (type: OpenId4VcEventType, data: () => Record<string, unknown>): void => {
    try {
      emitModuleMessageEvent(agent, type, data())
    } catch (error) {
      logger.error(`event ${type} emission failed`, { cause: error })
    }
  }

  agent.events.on<OpenId4VcIssuanceSessionStateChangedEvent>(
    OpenId4VcIssuerEvents.IssuanceSessionStateChanged,
    ({ payload: { issuanceSession, previousState } }) => {
      if (issuanceSession.issuerId !== ISSUER_CAPABILITY_ID) return
      emit(OpenId4VcEventType.CredentialExchangeStateUpdated, () => ({
        ...toCredentialExchangeDto(summarizeIssuanceSession(issuanceSession)),
        previousState,
      }))
    },
  )

  agent.events.on<OpenId4VcVerificationSessionStateChangedEvent>(
    OpenId4VcVerifierEvents.VerificationSessionStateChanged,
    ({ payload: { verificationSession, previousState } }) => {
      if (verificationSession.verifierId !== VERIFIER_CAPABILITY_ID) return
      emit(OpenId4VcEventType.PresentationStateUpdated, () => ({
        ...toPresentationDto(summarizeVerificationSession(verificationSession)),
        previousState,
      }))
    },
  )
}
