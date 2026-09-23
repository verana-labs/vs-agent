import type {
  OpenId4VcIssuanceSessionSummary,
  OpenId4VcVerificationSessionSummary,
} from '@verana-labs/vs-agent-plugin-openid4vc'

import { Openid4vcCredentialExchangeRecordDto, Openid4vcPresentationRecordDto } from './dto'

export function toCredentialExchangeDto(
  session: OpenId4VcIssuanceSessionSummary,
): Openid4vcCredentialExchangeRecordDto {
  return {
    credentialExchangeId: session.id,
    jsonSchemaCredentialId: session.jsonSchemaCredentialId,
    statusListId: session.statusListId,
    statusListIndex: session.statusListIndex,
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    errorMessage: session.errorMessage,
  }
}

export function toPresentationDto(
  session: OpenId4VcVerificationSessionSummary,
): Openid4vcPresentationRecordDto {
  return {
    proofExchangeId: session.id,
    jsonSchemaCredentialId: session.jsonSchemaCredentialId,
    requestedClaims: session.requestedClaims,
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    errorMessage: session.errorMessage,
    cryptographicVerified: session.cryptographicVerified,
    accepted: session.accepted,
    trust: session.trust,
    credential: session.credential,
  }
}
