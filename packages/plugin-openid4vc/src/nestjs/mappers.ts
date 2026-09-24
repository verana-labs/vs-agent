import type { OpenId4VcIssuanceSessionSummary } from '../services/IssuerService'
import type { OpenId4VcVerificationSessionSummary } from '../services/VerifierService'

import { OpenId4VcCredentialExchangeRecordDto, OpenId4VcPresentationRecordDto } from './dto'

export function toCredentialExchangeDto(
  session: OpenId4VcIssuanceSessionSummary,
): OpenId4VcCredentialExchangeRecordDto {
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
): OpenId4VcPresentationRecordDto {
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
