import type { OpenId4VcIssuanceSessionSummary } from '../services/IssuerService'
import type { OpenId4VcRevocationResult, OpenId4VcStatusListSummary } from '../services/StatusListService'
import type { OpenId4VcVerificationSessionSummary } from '../services/VerifierService'
import type {
  OpenId4VcCredentialExchangeRecordDto,
  OpenId4VcPresentationRecordDto,
  OpenId4VcRevokeCredentialResponseDto,
  OpenId4VcStatusListRecordDto,
} from './dto'

export function toCredentialExchangeDto(
  session: OpenId4VcIssuanceSessionSummary,
): OpenId4VcCredentialExchangeRecordDto {
  return {
    credentialExchangeId: session.id,
    jsonSchemaCredentialId: session.jsonSchemaCredentialId,
    ...(session.statusListId !== undefined ? { statusListId: session.statusListId } : {}),
    ...(session.statusListIndex !== undefined ? { statusListIndex: session.statusListIndex } : {}),
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

export function toStatusListDto(list: OpenId4VcStatusListSummary): OpenId4VcStatusListRecordDto {
  return {
    statusListId: list.id,
    uri: list.uri,
    size: list.size,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  }
}

export function toRevocationDto(revocation: OpenId4VcRevocationResult): OpenId4VcRevokeCredentialResponseDto {
  return {
    statusListId: revocation.statusListId,
    statusListIndex: revocation.statusListIndex,
    revokedAt: revocation.revokedAt.toISOString(),
  }
}
